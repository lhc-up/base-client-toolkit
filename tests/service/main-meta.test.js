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
const { META_LIST_CHANNEL } = require('../../src/service/protocol');
const { ipcMain } = electronMock;

beforeEach(() => {
    Service.cleanup();
    ipcMain.__handlers.clear();
    ipcMain.__syncListeners.clear();
});

describe('meta channel', () => {
    it('returnValue is okEnvelope with full schema list', () => {
        Service.init({
            userSchemas: [
                {
                    namespace: 'foo',
                    handlers: { bar() {}, baz() {}, log() {} },
                    sync: ['log'],
                    needsEvent: ['baz'],
                },
                {
                    namespace: 'qux',
                    handlers: { ping() {} },
                },
            ],
        });
        const listener = ipcMain.__syncListeners.get(META_LIST_CHANNEL);
        expect(typeof listener).toBe('function');

        const event = {};
        listener(event);

        expect(event.returnValue.ok).toBe(true);
        expect(event.returnValue.data).toEqual([
            { namespace: 'foo', handlers: ['bar', 'baz', 'log'], sync: ['log'] },
            { namespace: 'qux', handlers: ['ping'],              sync: [] },
        ]);
    });

    it('needsEvent is NOT exposed in meta data', () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { bar() {} },
                needsEvent: ['bar'],
            }],
        });
        const listener = ipcMain.__syncListeners.get(META_LIST_CHANNEL);
        const event = {};
        listener(event);
        expect(event.returnValue.data[0]).not.toHaveProperty('needsEvent');
    });

    it('empty schemas -> empty data array', () => {
        Service.init({ userSchemas: [] });
        const listener = ipcMain.__syncListeners.get(META_LIST_CHANNEL);
        const event = {};
        listener(event);
        expect(event.returnValue).toEqual({ ok: true, data: [] });
    });

    it('preserves registration order', () => {
        Service.init({
            userSchemas: [
                { namespace: 'z', handlers: { a() {} } },
                { namespace: 'a', handlers: { b() {} } },
            ],
        });
        const listener = ipcMain.__syncListeners.get(META_LIST_CHANNEL);
        const event = {};
        listener(event);
        expect(event.returnValue.data.map(s => s.namespace)).toEqual(['z', 'a']);
    });
});
