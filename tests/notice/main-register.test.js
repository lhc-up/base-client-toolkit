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

const Notice = require('../../src/notice/main');
const { META_GET_SCHEMA_CHANNEL } = require('../../src/notice/protocol');
const { ipcMain } = electronMock;

function readMetaList() {
    const event = {};
    ipcMain.__handlers.get(META_GET_SCHEMA_CHANNEL)(event);
    return event.returnValue.data.map(s => s.namespace);
}

beforeEach(() => {
    Notice.cleanup();
    ipcMain.__handlers.clear();
});

describe('Notice.register', () => {
    it('throws before init', () => {
        expect(() => Notice.register({ namespace: 'foo', events: ['a'] })).toThrow(/init/);
    });

    it('makes events broadcastable and listed', () => {
        Notice.init({ userSchemas: [{ namespace: 'base', events: ['a'] }] });
        Notice.register({ namespace: 'pkg', events: ['b'] });
        expect(() => Notice.broadcast('pkg.b')).not.toThrow();
        expect(readMetaList()).toEqual(['base', 'pkg']);
    });

    it('rejects namespace conflict', () => {
        Notice.init({ userSchemas: [{ namespace: 'base', events: ['a'] }] });
        expect(() => Notice.register({ namespace: 'base', events: ['b'] })).toThrow(/conflict/);
    });
});

describe('Notice.unregister', () => {
    it('removes namespace so broadcast throws not registered', () => {
        Notice.init({ userSchemas: [] });
        Notice.register({ namespace: 'pkg', events: ['b'] });
        expect(Notice.unregister('pkg')).toBe(true);
        expect(() => Notice.broadcast('pkg.b')).toThrow(/not registered/);
        expect(readMetaList()).toEqual([]);
    });

    it('returns false for unknown namespace', () => {
        Notice.init({ userSchemas: [] });
        expect(Notice.unregister('missing')).toBe(false);
    });
});
