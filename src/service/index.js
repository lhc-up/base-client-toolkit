const isFunction = require('lodash.isfunction');
const exampleService = require('./__example');
const { ipcMain } = require('electron');

const REPLY_ERROR_KEY = '__ipcError';

const internalSchemas = [
    exampleService.schema,
];

// 已注册的service schema
const registeredSchemas = new Map();

function init(options={}) {
    ipcMain.on('service:getServiceList', event => {
        event.returnValue = getServiceList();
    });
    
    // 注册内置 service
    for (const schema of internalSchemas) {
        registerService(schema);
    }

    // 注册用户 service
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

    // 注册 handlers 到 ipcMain
    for (const handlerName of Object.keys(handlers)) {
        const channel = `${namespace}:${handlerName}`;
        const syncChannel = `${channel}Sync`;
        const handler = handlers[handlerName];
        // 异步api
        ipcMain.handle(channel, (event, ...args) => {
            return handler(...args, event);
        });
        // 同步api
        ipcMain.on(syncChannel, async (event, ...args) => {
            try {
                const result = handler(...args, event);
                const value = isFunction(result?.then)
                    ? await result
                    : result;
                event.returnValue = value;
            } catch (err) {
                event.returnValue = {
                    [REPLY_ERROR_KEY]: true,
                    message: err.message,
                    stack: err.stack
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
    // TODO: preload中如何同步后续注册的service？
    const schemas = [...registeredSchemas.values()];
    return schemas.map(s => {
        return {
            namespace: s.namespace,
            // 只返回handler名称
            handlers: Object.keys(s.handlers)
        }
    });
}

// service变化时通知更新
function emitServiceChange(schema) {
    console.log(schema);
}

function cleanup() {
    ipcMain.removeListener('service:getServiceList');
    for (const schema of registeredSchemas.values()) {
        unRegisterService(schema);
    }
    registeredSchemas.clear();
}

module.exports = { init, getServiceList, registerService, cleanup };

// TODO: IPC通信不能传递【不能被克隆的对象】，否则会报错，注意处理（统一处理？）