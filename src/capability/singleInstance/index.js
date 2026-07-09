/**
 * Toolkit T-05: capability/singleInstance
 *
 * 完全照搬 base-client.bake src/main/libs/app.js#checkSingleInstance。
 * module.exports = function checkSingleInstance() 供业务侧显式调用。
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
