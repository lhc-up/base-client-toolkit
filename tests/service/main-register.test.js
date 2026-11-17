import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function buildElectronMock() {
    const handlers = new Map();
    const syncListeners = new Map();
    return {
        app: { getPath: () => require('node:os').tmpdir() },
        ipcMain: {
            handle: vi.fn((channel, fn) => { handlers.set(channel, fn); }),
            on: vi.fn((channel, fn) => { syncListeners.set(channel, fn); }),
            removeHandler: vi.fn(channel => { handlers.delete(channel); }),
            removeAllListeners: vi.fn(channel => { syncListeners.delete(channel); }),
            __handlers: handlers,
            __syncListeners: syncListeners,
        },
    };
}
const electronMock = buildElectronMock();
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
    id: electronPath, filename: electronPath, loaded: true,
    exports: electronMock, children: [], paths: [],
};

const Service = require('../../src/service/main');
const { META_LIST_CHANNEL, asyncChannel, syncChannel } = require('../../src/service/protocol');
const { ipcMain } = electronMock;

function readMetaList() {
    const event = {};
    ipcMain.__syncListeners.get(META_LIST_CHANNEL)(event);
    return event.returnValue.data.map(s => s.namespace);
}

beforeEach(() => {
    Service.cleanup();
    ipcMain.__handlers.clear();
    ipcMain.__syncListeners.clear();
});

describe('Service.register', () => {
    it('throws before init', () => {
        expect(() => Service.register({ namespace: 'foo', handlers: { a() {} } }))
            .toThrow(/init/);
    });

    it('adds handlers and meta entry after init', () => {
        Service.init({ userSchemas: [{ namespace: 'base', handlers: { a() {} } }] });
        Service.register({ namespace: 'pkg', handlers: { b() {} }, sync: ['b'] });

        expect(ipcMain.__handlers.has(asyncChannel('pkg', 'b'))).toBe(true);
        expect(ipcMain.__syncListeners.has(syncChannel('pkg', 'b'))).toBe(true);
        expect(readMetaList()).toEqual(['base', 'pkg']);
    });

    it('rejects namespace conflict with existing schema', () => {
        Service.init({ userSchemas: [{ namespace: 'base', handlers: { a() {} } }] });
        expect(() => Service.register({ namespace: 'base', handlers: { b() {} } }))
            .toThrow(/conflict/);
    });
});

describe('Service.unregister', () => {
    it('removes handlers, sync listeners and meta entry', () => {
        Service.init({ userSchemas: [{ namespace: 'base', handlers: { a() {} } }] });
        Service.register({ namespace: 'pkg', handlers: { b() {} }, sync: ['b'] });

        expect(Service.unregister('pkg')).toBe(true);
        expect(ipcMain.__handlers.has(asyncChannel('pkg', 'b'))).toBe(false);
        expect(ipcMain.__syncListeners.has(syncChannel('pkg', 'b'))).toBe(false);
        expect(readMetaList()).toEqual(['base']);
    });

    it('keeps other namespaces intact', () => {
        Service.init({ userSchemas: [{ namespace: 'base', handlers: { a() {} } }] });
        Service.register({ namespace: 'pkg', handlers: { b() {} } });
        Service.unregister('pkg');
        expect(ipcMain.__handlers.has(asyncChannel('base', 'a'))).toBe(true);
    });

    it('returns false for unknown namespace', () => {
        Service.init({ userSchemas: [] });
        expect(Service.unregister('missing')).toBe(false);
    });

    it('allows re-register after unregister', () => {
        Service.init({ userSchemas: [] });
        Service.register({ namespace: 'pkg', handlers: { b() {} } });
        Service.unregister('pkg');
        expect(() => Service.register({ namespace: 'pkg', handlers: { b() {} } })).not.toThrow();
    });
});
