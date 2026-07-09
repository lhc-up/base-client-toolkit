/**
 * Toolkit T-03: capability/shortcut
 *
 * 完全照搬 base-client.bake src/main/libs/shortcut.js。
 * 顶层 app.on('will-quit') 挂钩子；module.exports = function init() 供业务侧显式调用触发注册。
 */

const { app, BrowserWindow, globalShortcut } = require('electron');

function registerDevToolsShortcut(
    keys = 'Command+Control+Alt+F6',
    window = null
) {
    globalShortcut.register(keys, function () {
        let allWindow = BrowserWindow.getAllWindows();
        if (window) allWindow.push(window);
        for (const win of allWindow) {
            if (win.webContents && !win.webContents.isDevToolsOpened()) {
                win.webContents.openDevTools({
                    mode: 'detach',
                });
            }
        }
    });
}

app.on('will-quit', function () {
    globalShortcut.unregisterAll();
});

module.exports = function init() {
    registerDevToolsShortcut();
};
