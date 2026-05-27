const fs = require('fs');
const path = require('path');
const schema = require('./schema');
const { ipcMain, BrowserWindow } = require('electron');
const { serialize } = require('../shared/serializer');

let registeredNamespaces = new Map();
let noticeSchemas = [...schema];

function init(options = {}) {
    for (const notice of schema) {
        registerEvents(notice.namespace, notice.events);
    }

    ipcMain.on('notice:getSchema', event => {
        event.returnValue = serialize(getSchema(), { strict: false });
    });

    if (options?.userNoticeDir) {
        scanUserNotices(options.userNoticeDir);
    }
}

function registerEvents(namespace, events) {
    if (registeredNamespaces.has(namespace)) {
        throw new Error(`[Base] Notice namespace "${namespace}" 冲突`);
    }
    registeredNamespaces.set(namespace, events);
}

function scanUserNotices(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        if (!file.endsWith('.js')) continue;
        const notice = require(path.join(dir, file));
        registerEvents(notice.namespace, notice.events);
        noticeSchemas.push({
            namespace: notice.namespace,
            events: notice.events,
        });
    }
}

function broadcast(event, data) {
    const [namespace, eventName] = event.split('.');
    const events = registeredNamespaces.get(namespace);
    if (!events || !events[eventName]) {
        throw new Error(`[Base] Notice 事件 "${event}" 未注册`);
    }
    if (!events[eventName].broadcast) {
        throw new Error(
            `[Base] 事件 "${event}" broadcast=true 才能使用 broadcast()`
        );
    }
    const safeData = serialize(data, { strict: false });
    for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('notice:event', event, safeData);
    }
}

function direct(event, windowId, data) {
    const [namespace, eventName] = event.split('.');
    const events = registeredNamespaces.get(namespace);
    if (!events || !events[eventName]) {
        throw new Error(`[Base] Notice 事件 "${event}" 未注册`);
    }
    if (events[eventName].broadcast) {
        throw new Error(
            `[Base] 事件 "${event}" broadcast=false 才能使用 direct()`
        );
    }
    const safeData = serialize(data, { strict: false });
    const win = BrowserWindow.fromId(windowId);
    if (win) {
        win.webContents.send('notice:event', event, safeData);
    }
}

function getSchema() {
    return noticeSchemas;
}

function cleanupWindow(_windowId) {
    // 窗口关闭时清理订阅（由主进程调用，目前无逻辑）
}

module.exports = { init, broadcast, direct, getSchema, cleanupWindow };
