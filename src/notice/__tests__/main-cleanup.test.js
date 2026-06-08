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
const { META_GET_SCHEMA_CHANNEL } = require('../protocol');
const { ipcMain } = electronMock;

beforeEach(() => {
    Notice.cleanup();
    ipcMain.removeAllListeners.mockClear();
    ipcMain.on.mockClear();
    ipcMain.__handlers.clear();
});

describe('cleanup', () => {
    it('removes meta channel listener', () => {
        Notice.init({ userSchemas: [{ namespace: 'foo', events: ['a'] }] });
        Notice.cleanup();
        expect(ipcMain.removeAllListeners).toHaveBeenCalledWith(META_GET_SCHEMA_CHANNEL);
    });

    it('clears registry so re-init same namespace does not conflict', () => {
        Notice.init({ userSchemas: [{ namespace: 'foo', events: ['a'] }] });
        Notice.cleanup();
        expect(() =>
            Notice.init({ userSchemas: [{ namespace: 'foo', events: ['a'] }] }),
        ).not.toThrow();
    });

    it('after cleanup, broadcast on cleared namespace throws not-registered', () => {
        Notice.init({ userSchemas: [{ namespace: 'foo', events: ['a'] }] });
        Notice.cleanup();
        expect(() => Notice.broadcast('foo.a', {})).toThrow(/not registered/);
    });

    it('cleanup is idempotent (callable without prior init)', () => {
        expect(() => Notice.cleanup()).not.toThrow();
        expect(() => Notice.cleanup()).not.toThrow();
    });
});
