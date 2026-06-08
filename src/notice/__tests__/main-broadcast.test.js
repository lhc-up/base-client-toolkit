import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function buildElectronMock() {
    const handlers = new Map();
    return {
        ipcMain: {
            on: vi.fn((channel, fn) => { handlers.set(channel, fn); }),
            removeAllListeners: vi.fn(channel => { handlers.delete(channel); }),
            __handlers: handlers,
        },
        BrowserWindow: {
            getAllWindows: vi.fn(() => []),
            fromId: vi.fn(() => null),
        },
    };
}
const electronMock = buildElectronMock();
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
    id: electronPath, filename: electronPath, loaded: true,
    exports: electronMock, children: [], paths: [],
};

const Notice = require('../main');
const { EVENT_CHANNEL } = require('../protocol');
const { BrowserWindow, ipcMain } = electronMock;

function makeWin() {
    return { webContents: { send: vi.fn() } };
}

beforeEach(() => {
    Notice.cleanup();
    BrowserWindow.getAllWindows.mockReset();
    BrowserWindow.fromId.mockReset();
    ipcMain.__handlers.clear();
});

describe('broadcast: validation', () => {
    beforeEach(() => {
        Notice.init({ userSchemas: [{ namespace: 'foo', events: ['evA'] }] });
    });

    it('unregistered namespace throws', () => {
        expect(() => Notice.broadcast('bar.evA', { x: 1 })).toThrow(/not registered/);
    });
    it('registered namespace but unknown event throws', () => {
        expect(() => Notice.broadcast('foo.unknown', { x: 1 })).toThrow(/not registered/);
    });
    it('malformed full event name throws', () => {
        expect(() => Notice.broadcast('no-dot', {})).toThrow(/malformed/);
        expect(() => Notice.broadcast('.evA', {})).toThrow(/malformed/);
        expect(() => Notice.broadcast('foo.', {})).toThrow(/malformed/);
    });
});

describe('broadcast: delivery', () => {
    beforeEach(() => {
        Notice.init({ userSchemas: [{ namespace: 'foo', events: ['evA'] }] });
    });

    it('sends to every window from getAllWindows', () => {
        const w1 = makeWin();
        const w2 = makeWin();
        BrowserWindow.getAllWindows.mockReturnValue([w1, w2]);

        Notice.broadcast('foo.evA', { user: 123 });

        expect(w1.webContents.send).toHaveBeenCalledWith(
            EVENT_CHANNEL,
            'foo.evA',
            { user: 123 },
        );
        expect(w2.webContents.send).toHaveBeenCalledWith(
            EVENT_CHANNEL,
            'foo.evA',
            { user: 123 },
        );
    });

    it('zero windows is a no-op (no throw)', () => {
        BrowserWindow.getAllWindows.mockReturnValue([]);
        expect(() => Notice.broadcast('foo.evA', { x: 1 })).not.toThrow();
    });

    it('payload passes through serialize (function stripped to placeholder)', () => {
        const w1 = makeWin();
        BrowserWindow.getAllWindows.mockReturnValue([w1]);

        Notice.broadcast('foo.evA', { cb: function named() {}, ok: true });

        const sentPayload = w1.webContents.send.mock.calls[0][2];
        expect(sentPayload.ok).toBe(true);
        expect(sentPayload.cb).toBe('[Function: named]');
    });

    it('no per-window state: broadcast iterates getAllWindows() each call', () => {
        const w1 = makeWin();
        BrowserWindow.getAllWindows.mockReturnValueOnce([w1]);
        Notice.broadcast('foo.evA', { n: 1 });

        const w2 = makeWin();
        BrowserWindow.getAllWindows.mockReturnValueOnce([w2]);
        Notice.broadcast('foo.evA', { n: 2 });

        expect(w1.webContents.send).toHaveBeenCalledTimes(1);
        expect(w2.webContents.send).toHaveBeenCalledTimes(1);
        expect(BrowserWindow.getAllWindows).toHaveBeenCalledTimes(2);
    });
});
