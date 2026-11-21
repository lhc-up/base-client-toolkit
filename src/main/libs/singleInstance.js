/**
 * 单实例锁：抢锁失败则退出；第二个实例启动时聚焦已有窗口。
 * 业务侧在应用启动早期显式调用。
 *
 * `app.quit()` 是异步的：抢锁失败后调用方后面的代码仍会执行，直到进程真正退出。
 * 用返回值提前返回，避免第二个实例在退出前注册全局热键、启动服务等。
 */

const { app, BrowserWindow } = require('electron');

/**
 * @returns {boolean} 是否拿到锁；false 时已调用 `app.quit()`
 */
module.exports = function checkSingleInstance() {
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
        app.quit();
        return false;
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
    return true;
};
