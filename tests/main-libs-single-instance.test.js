import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const electronMock = {
    app: {
        requestSingleInstanceLock: vi.fn(),
        quit: vi.fn(),
        on: vi.fn(),
    },
    BrowserWindow: { getAllWindows: vi.fn(() => []) },
};
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
    id: electronPath, filename: electronPath, loaded: true,
    exports: electronMock, children: [], paths: [],
};

const checkSingleInstance = require('../src/main/libs/singleInstance.js');
const { app, BrowserWindow } = electronMock;

beforeEach(() => {
    app.requestSingleInstanceLock.mockReset();
    app.quit.mockClear();
    app.on.mockClear();
});

describe('main/libs/singleInstance：返回是否拿到锁（K18）', () => {
    it('抢锁失败：调用 app.quit 并返回 false，不注册 second-instance', () => {
        app.requestSingleInstanceLock.mockReturnValue(false);
        expect(checkSingleInstance()).toBe(false);
        expect(app.quit).toHaveBeenCalledTimes(1);
        expect(app.on).not.toHaveBeenCalled();
    });

    it('拿到锁：返回 true，second-instance 时还原并聚焦窗口', () => {
        app.requestSingleInstanceLock.mockReturnValue(true);
        expect(checkSingleInstance()).toBe(true);
        expect(app.quit).not.toHaveBeenCalled();
        expect(app.on).toHaveBeenCalledWith('second-instance', expect.any(Function));

        const win = {
            isDestroyed: () => false,
            isMinimized: () => true,
            restore: vi.fn(),
            focus: vi.fn(),
        };
        BrowserWindow.getAllWindows.mockReturnValue([win]);
        app.on.mock.calls[0][1]();
        expect(win.restore).toHaveBeenCalled();
        expect(win.focus).toHaveBeenCalled();
    });
});
