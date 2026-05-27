const exampleService = require('./__example');
const { ipcMain } = require('electron');
const { serialize } = require('../shared/serializer');

const REPLY_ERROR_KEY = '__ipcError';

const internalSchemas = [
    exampleService.schema,
];

const registeredSchemas = new Map();

function init(options = {}) {
    ipcMain.on('service:getServiceList', event => {
        event.returnValue = serialize(getServiceList(), { strict: false });
    });

    for (const schema of internalSchemas) {
        registerService(schema);
    }

    const userSchemas = options?.userSchemas;
    if (Array.isArray(userSchemas)) {
        for (const schema of userSchemas) {
            registerService(schema);
        }
    }
}

function registerService(schema) {
    const { namespace, handlers } = schema;
    if (registeredSchemas.has(namespace)) {
        throw new Error(
            `[Base] Service namespace "${namespace}" 冲突，请检查框架内置和用户定义`
        );
    }
    registeredSchemas.set(namespace, schema);

    for (const handlerName of Object.keys(handlers)) {
        const channel = `${namespace}:${handlerName}`;
        const syncChannel = `${channel}Sync`;
        const handler = handlers[handlerName];

        ipcMain.handle(channel, async (event, ...args) => {
            try {
                const result = await handler(...args, event);
                return serialize(result, { strict: false });
            } catch (err) {
                const serialized = serialize(err, { strict: false });
                throw new Error(JSON.stringify(serialized));
            }
        });

        ipcMain.on(syncChannel, async (event, ...args) => {
            try {
                const result = handler(...args, event);
                const value = result && typeof result.then === 'function' ? await result : result;
                event.returnValue = serialize(value, { strict: false });
            } catch (err) {
                event.returnValue = {
                    [REPLY_ERROR_KEY]: true,
                    ...serialize(err, { strict: false }),
                };
            }
        });
    }

    emitServiceChange(schema);
}

function unRegisterService(schema) {
    const { namespace, handlers } = schema;
    if (!registeredSchemas.has(namespace)) return;
    for (const handlerName of Object.keys(handlers)) {
        const channel = `${namespace}:${handlerName}`;
        const syncChannel = `${channel}Sync`;
        ipcMain.removeHandler(channel);
        ipcMain.removeAllListeners(syncChannel);
    }
    registeredSchemas.delete(namespace);
    emitServiceChange(schema);
}

function getServiceList() {
    const schemas = [...registeredSchemas.values()];
    return schemas.map(s => ({
        namespace: s.namespace,
        handlers: Object.keys(s.handlers),
    }));
}

function emitServiceChange(_schema) {
    // reserved for future schema-change notification to renderers
}

function cleanup() {
    ipcMain.removeAllListeners('service:getServiceList');
    for (const schema of registeredSchemas.values()) {
        unRegisterService(schema);
    }
    registeredSchemas.clear();
}

module.exports = { init, getServiceList, registerService, unRegisterService, cleanup };
