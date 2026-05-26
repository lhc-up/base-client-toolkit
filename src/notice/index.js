const schema = require('./schema');
const { ipcMain, BrowserWindow } = require('electron');

let registeredNamespaces = new Map();
let noticeSchemas = [...schema];

function init({ userNoticeDir }) {
    for (const notice of schema) {
        registerEvents(notice.namespace, notice.events);
    }

    ipcMain.on('notice:getSchema', event => {
        event.returnValue = getSchema();
    });

    // 扫描用户 notices 目录
    if (userNoticeDir) {
        scanUserNotices(userNoticeDir);
    }
}

function registerEvents(namespace, events) {
    if (registeredNamespaces.has(namespace)) {
        throw new Error(`[Base] Notice namespace "${namespace}" 冲突`);
    }
    registeredNamespaces.set(namespace, events);
}

function scanUserNotices(dir) {
    const fs = require('fs');
    const path = require('path');
    const files = fs.readdirSync(dir);

    for (const file of files) {
        if (!file.endsWith('.js')) continue;
        const notice = require(path.join(dir, file));
        registerEvents(notice.namespace, notice.events);
        noticeSchemas.push({
            namespace: notice.namespace,
            events: notice.events
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
    // 发送给所有窗口
    for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('notice:event', event, data);
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
    const win = BrowserWindow.fromId(windowId);
    if (win) {
        win.webContents.send('notice:event', event, data);
    }
}

function getSchema() {
    return noticeSchemas;
}

function cleanupWindow(windowId) {
    // 窗口关闭时清理订阅（由主进程调用）
}

module.exports = { init, broadcast, direct, getSchema, cleanupWindow };
