/**
 * 单实例锁：抢锁失败则退出；第二个实例启动时聚焦已有窗口。
 * 业务侧在应用启动早期显式调用。
 */

const { app, BrowserWindow } = require('electron');

module.exports = function checkSingleInstance() {
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) return app.quit();
    app.on('second-instance', () => {
        const windows = BrowserWindow.getAllWindows();
        windows.forEach(win => {
            if (win && !win.isDestroyed()) {
                if (win.isMinimized()) win.restore();
                win.focus();
            }
        });
    });
};
