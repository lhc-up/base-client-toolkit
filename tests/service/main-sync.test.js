import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function buildElectronMock() {
    const handlers = new Map();
    const syncListeners = new Map();
    return {
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
const { syncChannel } = require('../../src/service/protocol');
const { ipcMain } = electronMock;

beforeEach(() => {
    Service.cleanup();
    ipcMain.__handlers.clear();
    ipcMain.__syncListeners.clear();
});

describe('sync channel handler', () => {
    it('sets event.returnValue to okEnvelope for sync handler', async () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { upper(s) { return s.toUpperCase(); } },
                sync: ['upper'],
            }],
        });
        const listener = ipcMain.__syncListeners.get(syncChannel('foo', 'upper'));
        const event = {};
        await listener(event, 'hi');
        expect(event.returnValue).toEqual({ ok: true, data: 'HI' });
    });

    it('awaits async handler before writing returnValue', async () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: {
                    async asyncLog(msg) {
                        await new Promise(r => setTimeout(r, 1));
                        return `logged:${msg}`;
                    },
                },
                sync: ['asyncLog'],
            }],
        });
        const listener = ipcMain.__syncListeners.get(syncChannel('foo', 'asyncLog'));
        const event = {};
        await listener(event, 'hello');
        expect(event.returnValue).toEqual({ ok: true, data: 'logged:hello' });
    });

    it('handler throw -> errorEnvelope on returnValue', async () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { boom() { throw new Error('sync-boom'); } },
                sync: ['boom'],
            }],
        });
        const listener = ipcMain.__syncListeners.get(syncChannel('foo', 'boom'));
        const event = {};
        await listener(event);
        expect(event.returnValue.ok).toBe(false);
        expect(event.returnValue.error.message).toBe('sync-boom');
    });

    it('async handler rejection -> errorEnvelope on returnValue', async () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: {
                    async reject() { throw new TypeError('async-bad'); },
                },
                sync: ['reject'],
            }],
        });
        const listener = ipcMain.__syncListeners.get(syncChannel('foo', 'reject'));
        const event = {};
        await listener(event);
        expect(event.returnValue.ok).toBe(false);
        expect(event.returnValue.error.name).toBe('TypeError');
    });

    it('needsEvent on sync handler: event passed as last arg', async () => {
        const spy = vi.fn((msg, event) => `${msg}:${event.sender.id}`);
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { tag: spy },
                sync: ['tag'],
                needsEvent: ['tag'],
            }],
        });
        const listener = ipcMain.__syncListeners.get(syncChannel('foo', 'tag'));
        const event = { sender: { id: 9 } };
        await listener(event, 'hi');
        expect(spy).toHaveBeenCalledWith('hi', event);
        expect(event.returnValue).toEqual({ ok: true, data: 'hi:9' });
    });

    it('sync handler result serialized', async () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { mk() { return { fn: () => {}, n: 5 }; } },
                sync: ['mk'],
            }],
        });
        const listener = ipcMain.__syncListeners.get(syncChannel('foo', 'mk'));
        const event = {};
        await listener(event);
        expect(event.returnValue.ok).toBe(true);
        expect(event.returnValue.data.n).toBe(5);
        expect(event.returnValue.data.fn).toMatch(/^\[Function/);
    });
});
