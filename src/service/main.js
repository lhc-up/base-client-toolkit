const { ipcMain } = require('electron');
// IPC 路径必须永不抛错：strict=false 覆盖 dev 默认的 strict=true。
const { serialize } = require('../shared/serializer');
const {
    META_LIST_CHANNEL,
    asyncChannel,
    syncChannel,
    okEnvelope,
    errorEnvelope,
} = require('./protocol');

const registeredSchemas = new Map();

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function registerService(schema) {
    if (!isPlainObject(schema)) {
        throw new Error('Service schema must be an object');
    }
    const { namespace, handlers } = schema;
    const sync       = schema.sync       || [];
    const needsEvent = schema.needsEvent || [];

    if (typeof namespace !== 'string' || !namespace) {
        throw new Error('Service schema requires string namespace');
    }
    if (!isPlainObject(handlers)) {
        throw new Error(`Service schema "${namespace}" requires handlers object`);
    }
    if (!Array.isArray(sync)) {
        throw new Error(`Service schema "${namespace}" sync must be an array`);
    }
    if (!Array.isArray(needsEvent)) {
        throw new Error(`Service schema "${namespace}" needsEvent must be an array`);
    }
    const handlerNames = Object.keys(handlers);
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
    if (registeredSchemas.has(namespace)) {
        throw new Error(`Service namespace "${namespace}" conflict`);
    }

    for (const name of handlerNames) {
        const fn = handlers[name];
        const wantsEvent = needsEvent.includes(name);

        ipcMain.handle(asyncChannel(namespace, name), async (event, ...args) => {
            try {
                const result = wantsEvent
                    ? await fn(...args, event)
                    : await fn(...args);
                return okEnvelope(serialize(result, { strict: false }));
            } catch (err) {
                return errorEnvelope(serialize(err, { strict: false }));
            }
        });

        if (sync.includes(name)) {
            ipcMain.on(syncChannel(namespace, name), async (event, ...args) => {
                try {
                    const result = await (
                        wantsEvent ? fn(...args, event) : fn(...args)
                    );
                    event.returnValue = okEnvelope(serialize(result, { strict: false }));
                } catch (err) {
                    event.returnValue = errorEnvelope(serialize(err, { strict: false }));
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
        event.returnValue = okEnvelope(serialize(list, { strict: false }));
    } catch (err) {
        event.returnValue = errorEnvelope(serialize(err, { strict: false }));
    }
}

function init(opts) {
    if (!opts || !Array.isArray(opts.userSchemas)) {
        throw new Error('Service.init requires { userSchemas: Array }');
    }
    for (const schema of opts.userSchemas) {
        registerService(schema);
    }
    ipcMain.on(META_LIST_CHANNEL, handleGetServiceList);
}

function cleanup() {
    ipcMain.removeAllListeners(META_LIST_CHANNEL);
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

module.exports = { init, cleanup };
