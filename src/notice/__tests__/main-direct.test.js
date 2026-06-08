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
    BrowserWindow.fromId.mockReset();
    BrowserWindow.getAllWindows.mockReset();
    ipcMain.__handlers.clear();
    Notice.init({ userSchemas: [{ namespace: 'foo', events: ['evA'] }] });
});

describe('direct', () => {
    it('unregistered event throws', () => {
        expect(() => Notice.direct('foo.unknown', 1, {})).toThrow(/not registered/);
    });

    it('sends to the window returned by fromId(windowId)', () => {
        const w = makeWin();
        BrowserWindow.fromId.mockImplementation(id => (id === 42 ? w : null));

        Notice.direct('foo.evA', 42, { hello: 'world' });

        expect(BrowserWindow.fromId).toHaveBeenCalledWith(42);
        expect(w.webContents.send).toHaveBeenCalledWith(
            EVENT_CHANNEL,
            'foo.evA',
            { hello: 'world' },
        );
    });

    it('silently ignores when fromId returns null (window closed)', () => {
        BrowserWindow.fromId.mockReturnValue(null);
        expect(() => Notice.direct('foo.evA', 999, { x: 1 })).not.toThrow();
    });

    it('does not iterate getAllWindows', () => {
        const w = makeWin();
        BrowserWindow.fromId.mockReturnValue(w);
        Notice.direct('foo.evA', 1, {});
        expect(BrowserWindow.getAllWindows).not.toHaveBeenCalled();
    });

    it('payload passes through serialize', () => {
        const w = makeWin();
        BrowserWindow.fromId.mockReturnValue(w);

        Notice.direct('foo.evA', 1, { d: new Date('2026-01-01T00:00:00.000Z'), n: 5 });

        const payload = w.webContents.send.mock.calls[0][2];
        expect(payload.d).toBe('2026-01-01T00:00:00.000Z');
        expect(payload.n).toBe(5);
    });
});
