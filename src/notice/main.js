const { ipcMain, BrowserWindow } = require('electron');
const { serializeForIpc } = require('../shared/serializer');
const { okEnvelope, errorEnvelope } = require('../shared/envelope');
const { isValidIdentifier } = require('../shared/naming');
const {
    EVENT_CHANNEL,
    META_GET_SCHEMA_CHANNEL,
} = require('./protocol');

const registeredSchemas = new Map();

/**
 * 校验 Notice schema 的形态与命名合规（详见架构 §7.5）。
 * 抛错则 schema 不合规；无返回值。
 *
 * @param {Object} schema
 * @param {string} schema.namespace 合法 JS 标识符
 * @param {string[]} schema.events 事件名数组，每项须为合法 JS 标识符
 * @throws {Error} 任何不合规抛错
 */
function validateNoticeSchema(schema) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
        throw new Error('Notice schema must be an object');
    }
    const { namespace, events } = schema;
    if (!isValidIdentifier(namespace)) {
        throw new Error(
            `Notice schema namespace "${namespace}" invalid ` +
            `(must match /^[A-Za-z_][A-Za-z0-9_]*$/)`,
        );
    }
    if (!Array.isArray(events)) {
        throw new Error(`Notice schema "${namespace}" requires events array`);
    }
    for (const ev of events) {
        if (!isValidIdentifier(ev)) {
            throw new Error(
                `Notice schema "${namespace}": invalid event name "${ev}" ` +
                `(must match /^[A-Za-z_][A-Za-z0-9_]*$/)`,
            );
        }
    }
}

function registerSchema(schema) {
    validateNoticeSchema(schema);
    const { namespace, events } = schema;
    if (registeredSchemas.has(namespace)) {
        throw new Error(`Notice namespace "${namespace}" conflict`);
    }
    registeredSchemas.set(namespace, [...events]);
}

/**
 * 初始化 Notice，注册 schema 列表并挂载元通道 listener。
 *
 * @param {{ userSchemas: Object[] }} opts
 * @throws {Error} opts 缺失、userSchemas 非数组、schema 校验不通过或 namespace 冲突时抛错
 */
function init(opts) {
    if (!opts || !Array.isArray(opts.userSchemas)) {
        throw new Error('Notice.init requires { userSchemas: Array }');
    }
    for (const schema of opts.userSchemas) {
        registerSchema(schema);
    }
    ipcMain.on(META_GET_SCHEMA_CHANNEL, handleGetSchema);
}

function handleGetSchema(event) {
    try {
        const list = [...registeredSchemas.entries()].map(([namespace, events]) => ({
            namespace,
            events,
        }));
        event.returnValue = okEnvelope(serializeForIpc(list));
    } catch (err) {
        event.returnValue = errorEnvelope(serializeForIpc(err));
    }
}

function parseFullEventName(fullEventName) {
    if (typeof fullEventName !== 'string') {
        throw new Error('Notice event name must be a string');
    }
    const idx = fullEventName.indexOf('.');
    if (idx <= 0 || idx === fullEventName.length - 1) {
        throw new Error(`Notice event "${fullEventName}" malformed (expected "ns.event")`);
    }
    return {
        namespace: fullEventName.slice(0, idx),
        eventName: fullEventName.slice(idx + 1),
    };
}

function assertRegistered(fullEventName) {
    const { namespace, eventName } = parseFullEventName(fullEventName);
    const events = registeredSchemas.get(namespace);
    if (!events || !events.includes(eventName)) {
        throw new Error(`Notice event "${fullEventName}" not registered`);
    }
}

/**
 * 推送事件到所有窗口。
 *
 * @param {string} fullEventName 形如 "namespace.event"
 * @param {...*} args 推送 payload 参数（任意个，含零个）；整体经 serializeForIpc 编码为数组后发送
 * @throws {Error} 事件未注册抛错
 */
function broadcast(fullEventName, ...args) {
    assertRegistered(fullEventName);
    const safeArgs = serializeForIpc(args);
    for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(EVENT_CHANNEL, fullEventName, safeArgs);
    }
}

/**
 * 推送事件到指定窗口。窗口不存在则静默忽略。
 *
 * @param {string} fullEventName 形如 "namespace.event"
 * @param {number} windowId BrowserWindow.id
 * @param {...*} args 推送 payload 参数（任意个，含零个）；整体经 serializeForIpc 编码为数组后发送
 * @throws {Error} 事件未注册抛错
 */
function direct(fullEventName, windowId, ...args) {
    assertRegistered(fullEventName);
    const win = BrowserWindow.fromId(windowId);
    if (!win) return;
    const safeArgs = serializeForIpc(args);
    win.webContents.send(EVENT_CHANNEL, fullEventName, safeArgs);
}

/**
 * 清理元通道 listener 和 namespace 注册表。
 * 约定在 app 'will-quit' 中调用；正常运行不需要主动调用。
 */
function cleanup() {
    ipcMain.removeAllListeners(META_GET_SCHEMA_CHANNEL);
    registeredSchemas.clear();
}

module.exports = { init, broadcast, direct, cleanup, validateNoticeSchema };
