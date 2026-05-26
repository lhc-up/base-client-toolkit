const schema = require('./schema');
const { ipcMain } = require('electron');

let registeredNamespaces = new Set();
let serviceSchemas = [...schema];

function init({ userServiceDir }) {
    // 注册内置 service handlers
    for (const s of schema) {
        registerService(s.namespace, s.handlers);
    }

    ipcMain.on('service:getServiceList', event => {
        event.returnValue = getServiceList();
    });

    // 扫描用户 service 目录
    if (userServiceDir) {
        scanUserServices(userServiceDir);
    }
}

function registerService(namespace, handlers) {
    if (registeredNamespaces.has(namespace)) {
        throw new Error(
            `[Base] Service namespace "${namespace}" 冲突，请检查框架内置和用户定义`
        );
    }
    registeredNamespaces.add(namespace);
    // 注册 handlers 到 ipcMain
    for (const handler of handlers) {
        const channel = `${namespace}:${handler}`;
        ipcMain.handle(channel, () => {
            return { success: true, namespace, handler };
        });
    }
}

function scanUserServices(dir) {
    const fs = require('fs');
    const path = require('path');
    const files = fs.readdirSync(dir);

    for (const file of files) {
        if (!file.endsWith('.js')) continue;
        const service = require(path.join(dir, file));
        registerService(service.namespace, service.handlers);
        serviceSchemas.push({
            namespace: service.namespace,
            handlers: service.handlers
        });
    }
}

function getServiceList() {
    return serviceSchemas;
}

function register(namespace, handlers) {
    registerService(namespace, handlers);
    serviceSchemas.push({ namespace, handlers });
}

function cleanup() {
    ipcMain.removeListener('service:getServiceList');
    registeredNamespaces.clear();
    serviceSchemas = [...schema];
}

module.exports = { init, getServiceList, register, cleanup };
