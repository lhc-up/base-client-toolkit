const { ipcMain } = require('electron');
const Logger = require('../main/libs/logger');
const { serializeForIpc } = require('../shared/serializer');
const { okEnvelope, errorEnvelope } = require('../shared/envelope');
const { isValidIdentifier } = require('../shared/naming');
const {
    META_LIST_CHANNEL,
    SERIALIZER_REPORT_CHANNEL,
    asyncChannel,
    syncChannel,
} = require('./protocol');

const registeredSchemas = new Map();

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 校验 Service schema 的形态与命名合规。
 * 抛错则 schema 不合规；无返回值。
 *
 * @param {Object} schema
 * @param {string} schema.namespace 合法 JS 标识符
 * @param {Object<string, Function>} schema.handlers 键为 handler 名（合法 JS 标识符），值为函数
 * @param {string[]} [schema.sync] handler 名列表，声明支持 sync 通道
 * @param {string[]} [schema.needsEvent] handler 名列表，声明接收 event 作为末参
 * @throws {Error} 任何不合规抛错
 */
function validateServiceSchema(schema) {
    if (!isPlainObject(schema)) {
        throw new Error('Service schema must be an object');
    }
    const { namespace, handlers } = schema;
    const sync       = schema.sync       || [];
    const needsEvent = schema.needsEvent || [];

    if (!isValidIdentifier(namespace)) {
        throw new Error(
            `Service schema namespace "${namespace}" invalid ` +
            `(must match /^[A-Za-z_][A-Za-z0-9_]*$/)`,
        );
    }
    if (!isPlainObject(handlers)) {
        throw new Error(`Service schema "${namespace}" requires handlers object`);
    }
    const handlerNames = Object.keys(handlers);
    for (const name of handlerNames) {
        if (!isValidIdentifier(name)) {
            throw new Error(
                `Service schema "${namespace}": handler name "${name}" invalid ` +
                `(must match /^[A-Za-z_][A-Za-z0-9_]*$/)`,
            );
        }
        if (typeof handlers[name] !== 'function') {
            throw new Error(
                `Service schema "${namespace}": handler "${name}" must be function`,
            );
        }
    }
    if (!Array.isArray(sync)) {
        throw new Error(`Service schema "${namespace}" sync must be an array`);
    }
    if (!Array.isArray(needsEvent)) {
        throw new Error(`Service schema "${namespace}" needsEvent must be an array`);
    }
    for (const name of sync) {
        if (!handlerNames.includes(name)) {
            throw new Error(
                `Service schema "${namespace}": sync entry "${name}" not in handlers`,
            );
        }
    }
    for (const name of needsEvent) {
        if (!handlerNames.includes(name)) {
            throw new Error(
                `Service schema "${namespace}": needsEvent entry "${name}" not in handlers`,
            );
        }
    }
}

function registerService(schema) {
    validateServiceSchema(schema);
    const { namespace, handlers } = schema;
    const sync       = schema.sync       || [];
    const needsEvent = schema.needsEvent || [];

    if (registeredSchemas.has(namespace)) {
        throw new Error(`Service namespace "${namespace}" conflict`);
    }

    for (const name of Object.keys(handlers)) {
        const fn = handlers[name];
        const wantsEvent = needsEvent.includes(name);

        ipcMain.handle(asyncChannel(namespace, name), async (event, ...args) => {
            try {
                const result = wantsEvent
                    ? await fn(...args, event)
                    : await fn(...args);
                return okEnvelope(serializeForIpc(result));
            } catch (err) {
                return errorEnvelope(serializeForIpc(err));
            }
        });

        if (sync.includes(name)) {
            ipcMain.on(syncChannel(namespace, name), async (event, ...args) => {
                try {
                    const result = await (
                        wantsEvent ? fn(...args, event) : fn(...args)
                    );
                    event.returnValue = okEnvelope(serializeForIpc(result));
                } catch (err) {
                    event.returnValue = errorEnvelope(serializeForIpc(err));
                }
            });
        }
    }

    registeredSchemas.set(namespace, schema);
}

function handleGetServiceList(event) {
    try {
        const list = [...registeredSchemas.values()].map(s => ({
            namespace: s.namespace,
            handlers:  Object.keys(s.handlers),
            sync:      s.sync || [],
        }));
        event.returnValue = okEnvelope(serializeForIpc(list));
    } catch (err) {
        event.returnValue = errorEnvelope(serializeForIpc(err));
    }
}

/**
 * 初始化 Service，注册 schema 列表并挂载元通道 listener。
 *
 * @param {{ userSchemas: Object[] }} opts
 * @throws {Error} opts 缺失、userSchemas 非数组、schema 校验不通过或 namespace 冲突时抛错
 */
function init(opts) {
    if (!opts || !Array.isArray(opts.userSchemas)) {
        throw new Error('Service.init requires { userSchemas: Array }');
    }
    for (const schema of opts.userSchemas) {
        registerService(schema);
    }
    ipcMain.on(META_LIST_CHANNEL, handleGetServiceList);
    ipcMain.on(SERIALIZER_REPORT_CHANNEL, handleSerializerReport);
}

/**
 * 处理 preload 侧上报的序列化异常。
 *
 * 数据在通道上被降级成占位符（不可克隆对象）或触发深度截断时，**此前完全静默** ——
 * 调用方以为成功、主端也拿到了东西，只是内容已经变了。这类静默正是
 * 2026-10-10 `paperJson` 缺陷的同类（那条成因在别处，但同样是"改了数据没人知道"）。
 *
 * **只打日志、不做别的**：上报的信息是给现场排查用的，不改变本次调用的成败 ——
 * 降级本身是必要适配，不是错误。
 *
 * **用 toolkit 自己的 `main/libs/logger` 落盘**，不用 `console.error`：后者不落盘
 * （logger 并未接管 console，实测 `replaceConsole`/`connectLogger` 零命中），
 * 而"现场排查"正是这条上报存在的全部理由 —— 只进终端等于白报。
 * 本模块直接用它是跟随本包既有惯例（`main/libs/os.js`、`main/libs/store.js` 同样直接
 * require），它也本就设计成顶层即 `configure`、无 init 的内部基础设施。
 *
 * @param {Electron.IpcMainEvent} event
 * @param {{ channel: string, reports: Array<{argIndex:number,path:string,reason:string}> }} payload
 */
function handleSerializerReport(event, payload) {
    const reports = payload && payload.reports;
    if (!Array.isArray(reports)) return;
    for (const r of reports) {
        Logger.error(
            `[serializer] ${payload.channel} 第 ${r.argIndex} 个参数在 ${r.path} 处被改动：${r.reason}`,
        );
    }
}

/**
 * 清理所有已注册的 IPC handler / listener。
 * 约定在 app 'will-quit' 中调用；正常运行不需要主动调用。
 */
function cleanup() {
    ipcMain.removeAllListeners(META_LIST_CHANNEL);
    ipcMain.removeAllListeners(SERIALIZER_REPORT_CHANNEL);
    for (const schema of registeredSchemas.values()) {
        const sync = schema.sync || [];
        for (const name of Object.keys(schema.handlers)) {
            ipcMain.removeHandler(asyncChannel(schema.namespace, name));
            if (sync.includes(name)) {
                ipcMain.removeAllListeners(syncChannel(schema.namespace, name));
            }
        }
    }
    registeredSchemas.clear();
}

module.exports = { init, cleanup, validateServiceSchema, handleSerializerReport };
