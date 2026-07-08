let initialized = false;

function registerDevToolsShortcut(
    globalShortcut,
    BrowserWindow,
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
    const { app, BrowserWindow, globalShortcut } = require('electron');

    registerDevToolsShortcut(globalShortcut, BrowserWindow);

    app.on('will-quit', function () {
        globalShortcut.unregisterAll();
    });

    initialized = true;
}

module.exports = { init };
