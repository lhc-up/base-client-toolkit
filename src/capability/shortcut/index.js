const { app, BrowserWindow, globalShortcut } = require('electron');

let initialized = false;

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
                    mode: 'detach'
                });
            }
        }
    });
}

function init() {
    if (initialized) {
        throw new Error('[toolkit/shortcut] Shortcut already initialized');
    }
    registerDevToolsShortcut();
    app.on('will-quit', function () {
        globalShortcut.unregisterAll();
    });
    initialized = true;
}

module.exports = { init };
