/**
 * 全局热键：注册 DevTools 开关快捷键（默认 Command+Control+Alt+F6）。
 * 业务侧显式调用触发注册；app will-quit 时自动反注册全部热键。
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

/**
 * @param {{ devToolsKey?: string }} [opts]
 */
module.exports = function init(opts = {}) {
    const keys = opts?.devToolsKey ?? 'Command+Control+Alt+F6';
    registerDevToolsShortcut(keys);
};
