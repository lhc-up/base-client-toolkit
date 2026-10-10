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
const {
    META_LIST_CHANNEL, asyncChannel, syncChannel,
} = require('../../src/service/protocol');
const { ipcMain } = electronMock;

beforeEach(() => {
    Service.cleanup();
    ipcMain.handle.mockClear();
    ipcMain.on.mockClear();
    ipcMain.removeHandler.mockClear();
    ipcMain.removeAllListeners.mockClear();
    ipcMain.__handlers.clear();
    ipcMain.__syncListeners.clear();
});

describe('cleanup', () => {
    it('removes meta channel listener', () => {
        Service.init({
            userSchemas: [{ namespace: 'foo', handlers: { a() {} } }],
        });
        Service.cleanup();
        expect(ipcMain.removeAllListeners).toHaveBeenCalledWith(META_LIST_CHANNEL);
    });

    it('removes async handler for each registered handler', () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { bar() {}, baz() {} },
            }],
        });
        Service.cleanup();
        expect(ipcMain.removeHandler).toHaveBeenCalledWith(asyncChannel('foo', 'bar'));
        expect(ipcMain.removeHandler).toHaveBeenCalledWith(asyncChannel('foo', 'baz'));
    });

    it('removes sync listener for each sync handler', () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { bar() {}, log() {} },
                sync: ['log'],
            }],
        });
        Service.cleanup();
        expect(ipcMain.removeAllListeners).toHaveBeenCalledWith(
            syncChannel('foo', 'log'),
        );
        // bar has no sync listener, so removeAllListeners NOT called for foo:barSync
        const calls = ipcMain.removeAllListeners.mock.calls.map(c => c[0]);
        expect(calls).not.toContain(syncChannel('foo', 'bar'));
    });

    it('clears registry so re-init same namespace does not conflict', () => {
        Service.init({
            userSchemas: [{ namespace: 'foo', handlers: { a() {} } }],
        });
        Service.cleanup();
        expect(() => Service.init({
            userSchemas: [{ namespace: 'foo', handlers: { a() {} } }],
        })).not.toThrow();
    });

    it('cleanup is idempotent (callable without prior init)', () => {
        expect(() => Service.cleanup()).not.toThrow();
        expect(() => Service.cleanup()).not.toThrow();
    });

    it('after cleanup, meta + handler maps in mock are empty', () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { bar() {}, log() {} },
                sync: ['log'],
            }],
        });
        Service.cleanup();
        expect(ipcMain.__handlers.size).toBe(0);
        expect(ipcMain.__syncListeners.size).toBe(0);
    });
});
