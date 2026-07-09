const { app, BrowserWindow } = require('electron');

let initialized = false;

/**
 * 单实例检查 + 第二实例激活。
 * - 拿不到锁：当前进程是第二实例，直接 app.quit()
 * - 拿到锁：注册 second-instance 事件，第二实例启动时聚焦已有窗口（最小化则还原）
 */
function init() {
    if (initialized) {
        throw new Error('[toolkit/singleInstance] SingleInstance already initialized');
    }
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
        app.quit();
        return;
    }
    app.on('second-instance', () => {
        const windows = BrowserWindow.getAllWindows();
        windows.forEach(win => {
            if (win && !win.isDestroyed()) {
                if (win.isMinimized()) win.restore();
                win.focus();
            }
        });
    });
    initialized = true;
}

module.exports = { init };
