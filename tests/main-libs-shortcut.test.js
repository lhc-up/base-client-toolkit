import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const electronMock = {
    app: { once: vi.fn() },
    BrowserWindow: { getAllWindows: vi.fn(() => []) },
    Menu: {
        setApplicationMenu: vi.fn(),
        buildFromTemplate: vi.fn(template => ({ template })),
    },
    globalShortcut: {
        register: vi.fn(() => true),
        unregister: vi.fn(),
    },
};
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
    id: electronPath, filename: electronPath, loaded: true,
    exports: electronMock, children: [], paths: [],
};

const loggerMock = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
const loggerPath = require.resolve('../src/main/libs/logger');
require.cache[loggerPath] = {
    id: loggerPath, filename: loggerPath, loaded: true,
    exports: loggerMock, children: [], paths: [],
};

const os = require('../src/main/libs/os');
const shortcut = require('../src/main/libs/shortcut.js');
const { app, BrowserWindow, Menu, globalShortcut } = electronMock;
// 加载模块时的调用次数，必须在任何 beforeEach 清空之前记录
const callsAtLoad = {
    once: app.once.mock.calls.length,
    register: globalShortcut.register.mock.calls.length,
    setApplicationMenu: Menu.setApplicationMenu.mock.calls.length,
};

function fakeWindow({ destroyed = false, devToolsOpened = false } = {}) {
    return {
        isDestroyed: () => destroyed,
        webContents: {
            isDevToolsOpened: () => devToolsOpened,
            openDevTools: vi.fn(),
        },
    };
}

beforeEach(() => {
    vi.restoreAllMocks();
    Menu.setApplicationMenu.mockClear();
    Menu.buildFromTemplate.mockClear();
    globalShortcut.register.mockReset();
    globalShortcut.register.mockReturnValue(true);
    globalShortcut.unregister.mockClear();
    app.once.mockClear();
    loggerMock.warn.mockClear();
});

describe('main/libs/shortcut.removeDefaultMenu', () => {
    it('Windows / Linux：去掉应用菜单（setApplicationMenu(null)）', () => {
        vi.spyOn(os, 'isMacOS').mockReturnValue(false);
        shortcut.removeDefaultMenu();
        expect(Menu.setApplicationMenu).toHaveBeenCalledWith(null);
        expect(Menu.buildFromTemplate).not.toHaveBeenCalled();
    });

    it('macOS：保留只含「应用」「编辑」的最小菜单（输入框复制粘贴依赖编辑菜单）', () => {
        vi.spyOn(os, 'isMacOS').mockReturnValue(true);
        shortcut.removeDefaultMenu();
        expect(Menu.buildFromTemplate).toHaveBeenCalledWith([{ role: 'appMenu' }, { role: 'editMenu' }]);
        expect(Menu.setApplicationMenu).toHaveBeenCalledWith({ template: [{ role: 'appMenu' }, { role: 'editMenu' }] });
    });
});

describe('main/libs/shortcut.registerDevToolsShortcut', () => {
    it('默认热键为 Command+Control+Alt+F5', () => {
        expect(shortcut.DEFAULT_DEVTOOLS_SHORTCUT).toBe('Command+Control+Alt+F5');
    });

    it('注册成功：按下时给所有未打开 DevTools 的窗口打开（停靠底部），跳过已销毁的窗口', () => {
        expect(shortcut.registerDevToolsShortcut('Command+Control+Alt+F9')).toBe(true);
        expect(globalShortcut.register).toHaveBeenCalledWith('Command+Control+Alt+F9', expect.any(Function));

        const closed = fakeWindow();
        const opened = fakeWindow({ devToolsOpened: true });
        const destroyed = fakeWindow({ destroyed: true });
        BrowserWindow.getAllWindows.mockReturnValue([closed, opened, destroyed]);
        globalShortcut.register.mock.calls[0][1]();

        expect(closed.webContents.openDevTools).toHaveBeenCalledWith({ mode: 'bottom' });
        expect(opened.webContents.openDevTools).not.toHaveBeenCalled();
        expect(destroyed.webContents.openDevTools).not.toHaveBeenCalled();
    });

    it('will-quit 时只注销自己的热键；同一热键重复调用不重复注册', () => {
        shortcut.registerDevToolsShortcut('Command+Control+Alt+F10');
        expect(shortcut.registerDevToolsShortcut('Command+Control+Alt+F10')).toBe(true);
        expect(globalShortcut.register).toHaveBeenCalledTimes(1);
        expect(app.once).toHaveBeenCalledTimes(1);
        expect(app.once).toHaveBeenCalledWith('will-quit', expect.any(Function));

        app.once.mock.calls[0][1]();
        expect(globalShortcut.unregister).toHaveBeenCalledWith('Command+Control+Alt+F10');
    });

    it('注册失败（被占用）：返回 false 并写警告日志，不挂 will-quit', () => {
        globalShortcut.register.mockReturnValue(false);
        expect(shortcut.registerDevToolsShortcut('Command+Control+Alt+F11')).toBe(false);
        expect(loggerMock.warn).toHaveBeenCalledWith(expect.stringContaining('DevTools 热键注册失败'), 'Command+Control+Alt+F11');
        expect(app.once).not.toHaveBeenCalled();
    });

    it('加载模块本身不注册事件、热键，也不改菜单（无副作用）', () => {
        expect(callsAtLoad).toEqual({ once: 0, register: 0, setApplicationMenu: 0 });
    });
});
