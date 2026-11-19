import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function buildElectronMock() {
    const handlers = new Map();
    const syncListeners = new Map();
    return {
        // service/main.js 直接 require 了 main/libs/logger，后者经 paths.js 读
        // app.getPath('userData') —— 缺 app 会让整个测试文件在 collect 阶段就挂
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
const { asyncChannel } = require('../../src/service/protocol');
const { ipcMain } = electronMock;

beforeEach(() => {
    Service.cleanup();
    ipcMain.__handlers.clear();
    ipcMain.__syncListeners.clear();
});

describe('async channel handler', () => {
    it('returns okEnvelope with serialized result for sync handler', async () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { add(a, b) { return a + b; } },
            }],
        });
        const handler = ipcMain.__handlers.get(asyncChannel('foo', 'add'));
        const envelope = await handler({}, 1, 2);
        expect(envelope).toEqual({ ok: true, data: 3 });
    });

    it('awaits async handler before responding', async () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: {
                    async delay(v) {
                        await new Promise(r => setTimeout(r, 1));
                        return v * 2;
                    },
                },
            }],
        });
        const handler = ipcMain.__handlers.get(asyncChannel('foo', 'delay'));
        const envelope = await handler({}, 5);
        expect(envelope).toEqual({ ok: true, data: 10 });
    });

    it('handler throw -> errorEnvelope (never re-throws)', async () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { bad() { throw new TypeError('boom'); } },
            }],
        });
        const handler = ipcMain.__handlers.get(asyncChannel('foo', 'bad'));
        const envelope = await handler({});
        expect(envelope.ok).toBe(false);
        expect(envelope.error.name).toBe('TypeError');
        expect(envelope.error.message).toBe('boom');
    });

    it('async handler rejection -> errorEnvelope', async () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: {
                    async reject() { throw new RangeError('nope'); },
                },
            }],
        });
        const handler = ipcMain.__handlers.get(asyncChannel('foo', 'reject'));
        const envelope = await handler({});
        expect(envelope.ok).toBe(false);
        expect(envelope.error.name).toBe('RangeError');
    });

    it('needsEvent: handler receives event as last arg', async () => {
        const spy = vi.fn((a, event) => ({ a, hasSender: !!event.sender }));
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { peek: spy },
                needsEvent: ['peek'],
            }],
        });
        const handler = ipcMain.__handlers.get(asyncChannel('foo', 'peek'));
        const fakeEvent = { sender: {} };
        const envelope = await handler(fakeEvent, 42);
        expect(envelope.ok).toBe(true);
        expect(spy).toHaveBeenCalledWith(42, fakeEvent);
        expect(envelope.data).toEqual({ a: 42, hasSender: true });
    });

    it('non-needsEvent handler does NOT receive event (rest-params safe)', async () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { sum(...nums) { return nums.reduce((a, b) => a + b, 0); } },
            }],
        });
        const handler = ipcMain.__handlers.get(asyncChannel('foo', 'sum'));
        const envelope = await handler({}, 1, 2, 3, 4);
        expect(envelope).toEqual({ ok: true, data: 10 });
    });

    it('result 原样保留 Date（structured clone 语义）', async () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { now() { return new Date('2026-01-01T00:00:00.000Z'); } },
            }],
        });
        const handler = ipcMain.__handlers.get(asyncChannel('foo', 'now'));
        const envelope = await handler({});
        expect(envelope.data).toBeInstanceOf(Date);
        expect(envelope.data.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });
});
