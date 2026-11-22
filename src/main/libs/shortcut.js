/**
 * 应用菜单与全局热键。
 *
 * - `removeDefaultMenu()`：去掉 Electron 的默认菜单。应用不设置菜单时，Electron 会挂默认菜单，
 *   菜单栏在无边框窗口中看不见，但快捷键照样生效（Electron 22 实测）：`Ctrl+R` 刷新、
 *   `Ctrl+Shift+I` 打开 DevTools、`F11` 切换全屏等，任何用户都能按到。
 *   macOS 保留只含「应用」「编辑」两项的最小菜单：macOS 上没有编辑菜单时输入框不能复制粘贴。
 * - `registerDevToolsShortcut(keys)`：注册打开 DevTools 的全局热键（打开所有窗口的 DevTools，停靠底部），
 *   供现场排查；`will-quit` 时只注销这一个热键，不影响宿主注册的其他热键。
 *
 * 宿主在 `app.whenReady()` 中、创建第一个窗口之前调用。
 */

const { app, BrowserWindow, Menu, globalShortcut } = require('electron');
const os = require('./os');
const Logger = require('./logger');

/**
 * 打开 DevTools 的默认热键。
 * `Command` 在 Windows 上是 Win 键（Electron 22 实测：按 Ctrl+Alt+F5 不触发，Win+Ctrl+Alt+F5 触发），
 * Linux 上对应 Super 键（未实测），即实际按键为 Win / Super + Ctrl + Alt + F5。
 */
const DEFAULT_DEVTOOLS_SHORTCUT = 'Command+Control+Alt+F5';

/** 已注册的 DevTools 热键，避免重复注册与重复挂 will-quit */
const registeredKeys = new Set();

function removeDefaultMenu() {
    if (os.isMacOS()) {
        Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]));
        return;
    }
    Menu.setApplicationMenu(null);
}

function openAllDevTools() {
    for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) {
            continue;
        }
        if (!win.webContents.isDevToolsOpened()) {
            win.webContents.openDevTools({ mode: 'bottom' });
        }
    }
}

/**
 * @param {string} [keys] Electron accelerator，默认 `Command+Control+Alt+F5`
 * @returns {boolean} 是否注册成功（热键被其他程序占用时为 false，并写警告日志）
 */
function registerDevToolsShortcut(keys = DEFAULT_DEVTOOLS_SHORTCUT) {
    if (registeredKeys.has(keys)) {
        return true;
    }
    const ok = globalShortcut.register(keys, openAllDevTools);
    if (!ok) {
        Logger.warn('[热键] DevTools 热键注册失败（可能被其他程序占用）', keys);
        return false;
    }
    registeredKeys.add(keys);
    app.once('will-quit', () => {
        globalShortcut.unregister(keys);
        registeredKeys.delete(keys);
    });
    return true;
}

module.exports = {
    removeDefaultMenu,
    registerDevToolsShortcut,
    DEFAULT_DEVTOOLS_SHORTCUT,
};
