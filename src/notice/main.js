const { ipcMain, BrowserWindow } = require('electron');
// IPC 路径必须永不抛错：strict=false 覆盖 dev 默认的 strict=true。
const { serialize } = require('../shared/serializer');
const {
    EVENT_CHANNEL,
    META_GET_SCHEMA_CHANNEL,
    okEnvelope,
    errorEnvelope,
} = require('./protocol');

const EVENT_NAME_RE = /^[A-Za-z0-9_-]+$/;

const registeredSchemas = new Map();

function registerSchema(schema) {
    if (!schema || typeof schema !== 'object') {
        throw new Error('Notice schema must be an object');
    }
    const { namespace, events } = schema;
    if (typeof namespace !== 'string' || !namespace) {
        throw new Error('Notice schema requires string namespace');
    }
    if (!Array.isArray(events)) {
        throw new Error(`Notice schema "${namespace}" requires events array`);
    }
    for (const ev of events) {
        if (typeof ev !== 'string' || !EVENT_NAME_RE.test(ev)) {
            throw new Error(
                `Notice schema "${namespace}": invalid event name "${ev}" ` +
                `(allowed: [A-Za-z0-9_-]+)`,
            );
        }
    }
    if (registeredSchemas.has(namespace)) {
        throw new Error(`Notice namespace "${namespace}" conflict`);
    }
    registeredSchemas.set(namespace, [...events]);
}

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
        event.returnValue = okEnvelope(serialize(list, { strict: false }));
    } catch (err) {
        event.returnValue = errorEnvelope(serialize(err, { strict: false }));
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

function broadcast(fullEventName, data) {
    assertRegistered(fullEventName);
    const safeData = serialize(data, { strict: false });
    for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(EVENT_CHANNEL, fullEventName, safeData);
    }
}

function direct(fullEventName, windowId, data) {
    assertRegistered(fullEventName);
    const win = BrowserWindow.fromId(windowId);
    if (!win) return;
    const safeData = serialize(data, { strict: false });
    win.webContents.send(EVENT_CHANNEL, fullEventName, safeData);
}

function cleanup() {
    ipcMain.removeAllListeners(META_GET_SCHEMA_CHANNEL);
    registeredSchemas.clear();
}

module.exports = { init, broadcast, direct, cleanup };
