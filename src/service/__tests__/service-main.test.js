import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Pre-populate the require cache for 'electron' with a mock that mimics ipcMain.
// Vitest's vi.mock cannot intercept require() calls inside CJS source modules
// (it only works for ESM import statements). Since src/service/index.js uses
// require('electron'), we inject the mock through Node's require.cache directly.
const Module = require('node:module');
const electronPath = require.resolve('electron');

const handlers = new Map();
const syncListeners = new Map();
const ipcMain = {
    handle: vi.fn((channel, fn) => handlers.set(channel, fn)),
    removeHandler: vi.fn((channel) => handlers.delete(channel)),
    on: vi.fn((channel, fn) => {
        if (!syncListeners.has(channel)) syncListeners.set(channel, []);
        syncListeners.get(channel).push(fn);
    }),
    removeAllListeners: vi.fn((channel) => syncListeners.delete(channel)),
    __getHandlers: () => handlers,
    __getSyncListeners: () => syncListeners,
    __reset: () => { handlers.clear(); syncListeners.clear(); },
};

const fakeElectronModule = new Module(electronPath);
fakeElectronModule.filename = electronPath;
fakeElectronModule.loaded = true;
fakeElectronModule.exports = { ipcMain };
require.cache[electronPath] = fakeElectronModule;

const Service = require('../index.js');

describe('Service main process integration', () => {
    beforeEach(() => {
        ipcMain.__reset();
        Service.cleanup();
    });

    it('handler return value goes through serialize', async () => {
        Service.registerService({
            namespace: 'test',
            handlers: {
                getData: () => ({
                    fn: () => {},
                    date: new Date('2026-01-01T00:00:00.000Z'),
                    val: 42,
                }),
            },
        });
        const handler = ipcMain.__getHandlers().get('test:getData');
        const result = await handler({});
        expect(result.fn).toContain('[Function:');
        expect(result.date).toBe('2026-01-01T00:00:00.000Z');
        expect(result.val).toBe(42);
    });

    it('handler thrown error is serialized and rethrown as Error with JSON message', async () => {
        Service.registerService({
            namespace: 'test',
            handlers: {
                explode: () => { throw new TypeError('boom'); },
            },
        });
        const handler = ipcMain.__getHandlers().get('test:explode');
        await expect(handler({})).rejects.toThrow();
        try {
            await handler({});
            throw new Error('should have thrown');
        } catch (e) {
            const parsed = JSON.parse(e.message);
            expect(parsed.name).toBe('TypeError');
            expect(parsed.message).toBe('boom');
            expect(typeof parsed.stack).toBe('string');
        }
    });

    it('sync handler return value goes through serialize', () => {
        Service.registerService({
            namespace: 'test',
            handlers: {
                ping: () => ({ fn: () => {} }),
            },
        });
        const syncFn = ipcMain.__getSyncListeners().get('test:pingSync')[0];
        const event = {};
        syncFn(event);
        expect(event.returnValue.fn).toContain('[Function:');
    });

    it('sync handler thrown error puts __ipcError on returnValue', async () => {
        Service.registerService({
            namespace: 'test',
            handlers: {
                explodeSync: () => { throw new Error('sync boom'); },
            },
        });
        const syncFn = ipcMain.__getSyncListeners().get('test:explodeSyncSync')[0];
        const event = {};
        await syncFn(event);
        expect(event.returnValue.__ipcError).toBe(true);
        expect(event.returnValue.message).toBe('sync boom');
    });

    it('getServiceList returns plain schema list', () => {
        Service.registerService({
            namespace: 'test',
            handlers: { a: () => 1 },
        });
        const list = Service.getServiceList();
        expect(list).toEqual([
            { namespace: 'test', handlers: ['a'] },
        ]);
    });
});
