import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Mock electron by injecting into Node CJS require cache. vi.mock-style
// factory is preserved for parity with the plan; require.cache hookup is
// the integration layer that makes it visible to CJS source modules.
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
const { META_LIST_CHANNEL, asyncChannel, syncChannel } = require('../../src/service/protocol');
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

describe('init: input validation', () => {
    it('non-array userSchemas throws', () => {
        expect(() => Service.init({ userSchemas: 'not array' })).toThrow();
        expect(() => Service.init({ userSchemas: null })).toThrow();
    });
    it('missing opts throws', () => {
        expect(() => Service.init()).toThrow();
    });
    it('empty userSchemas is allowed', () => {
        expect(() => Service.init({ userSchemas: [] })).not.toThrow();
    });
});

describe('init: schema validation', () => {
    it('schema missing namespace throws', () => {
        expect(() => Service.init({
            userSchemas: [{ handlers: { a() {} } }],
        })).toThrow();
    });
    it('schema missing handlers throws', () => {
        expect(() => Service.init({
            userSchemas: [{ namespace: 'foo' }],
        })).toThrow();
    });
    it('handlers not a plain object throws', () => {
        expect(() => Service.init({
            userSchemas: [{ namespace: 'foo', handlers: 'bad' }],
        })).toThrow();
    });
    it('sync item not in handlers throws', () => {
        expect(() => Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { a() {} },
                sync: ['missing'],
            }],
        })).toThrow(/sync/i);
    });
    it('needsEvent item not in handlers throws', () => {
        expect(() => Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { a() {} },
                needsEvent: ['missing'],
            }],
        })).toThrow(/needsEvent/i);
    });
    it('duplicate namespace across schemas throws', () => {
        expect(() => Service.init({
            userSchemas: [
                { namespace: 'foo', handlers: { a() {} } },
                { namespace: 'foo', handlers: { b() {} } },
            ],
        })).toThrow(/conflict|冲突/i);
    });
    it('valid schemas pass', () => {
        expect(() => Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { bar() {}, baz() {}, log() {} },
                sync: ['log'],
                needsEvent: ['baz'],
            }],
        })).not.toThrow();
    });

    it('namespace with dash rejected (must be valid JS identifier)', () => {
        expect(() => Service.init({
            userSchemas: [{ namespace: 'foo-bar', handlers: { a() {} } }],
        })).toThrow(/namespace.*invalid/i);
    });
    it('namespace starting with digit rejected', () => {
        expect(() => Service.init({
            userSchemas: [{ namespace: '1foo', handlers: { a() {} } }],
        })).toThrow(/namespace.*invalid/i);
    });
    it('handler name with dash rejected', () => {
        expect(() => Service.init({
            userSchemas: [{ namespace: 'foo', handlers: { 'bad-name'() {} } }],
        })).toThrow(/handler name.*invalid/i);
    });
    it('handler name starting with digit rejected', () => {
        expect(() => Service.init({
            userSchemas: [{ namespace: 'foo', handlers: { '1bad'() {} } }],
        })).toThrow(/handler name.*invalid/i);
    });
    it('handler value must be a function', () => {
        expect(() => Service.init({
            userSchemas: [{ namespace: 'foo', handlers: { notFn: 'string' } }],
        })).toThrow(/must be function/i);
    });

    it('validateServiceSchema is exported and callable', () => {
        const { validateServiceSchema } = require('../../src/service/main');
        expect(typeof validateServiceSchema).toBe('function');
        expect(() => validateServiceSchema({ namespace: 'foo', handlers: { a() {} } })).not.toThrow();
        expect(() => validateServiceSchema({ namespace: 'foo-bad', handlers: { a() {} } })).toThrow();
    });
});

describe('init: channel registration', () => {
    it('registers ipcMain.handle for each handler (async channel)', () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { bar() {}, baz() {} },
            }],
        });
        expect(ipcMain.handle).toHaveBeenCalledWith(
            asyncChannel('foo', 'bar'), expect.any(Function),
        );
        expect(ipcMain.handle).toHaveBeenCalledWith(
            asyncChannel('foo', 'baz'), expect.any(Function),
        );
    });
    it('registers ipcMain.on for each sync handler only', () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { bar() {}, log() {} },
                sync: ['log'],
            }],
        });
        expect(ipcMain.on).toHaveBeenCalledWith(
            syncChannel('foo', 'log'), expect.any(Function),
        );
        // bar should NOT have a sync listener
        expect(ipcMain.__syncListeners.has(syncChannel('foo', 'bar'))).toBe(false);
    });
    it('registers meta channel listener', () => {
        Service.init({ userSchemas: [] });
        expect(ipcMain.on).toHaveBeenCalledWith(
            META_LIST_CHANNEL, expect.any(Function),
        );
    });
});
