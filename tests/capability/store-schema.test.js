import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// libs/store 顶层会 `new Store({...})` 并 `logger` 顶层 configure：注入最小替身，
// 只为了拿到 capability 的 schema（该 capability 刻意零实现，handler 直接引用 libs/store）。
const electronStorePath = require.resolve('electron-store');
require.cache[electronStorePath] = {
    id: electronStorePath,
    filename: electronStorePath,
    loaded: true,
    exports: class FakeStore {
        constructor() { this.data = {}; }
        get(key) { return this.data[key]; }
        set(key, value) { this.data[key] = value; }
        delete(key) { delete this.data[key]; }
    },
    children: [],
    paths: [],
};
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: { app: { getPath: () => require('node:os').tmpdir() } },
    children: [],
    paths: [],
};
const loggerPath = require.resolve('../../src/main/libs/logger.js');
require.cache[loggerPath] = {
    id: loggerPath,
    filename: loggerPath,
    loaded: true,
    exports: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn(), debug: vi.fn(), fatal: vi.fn(), print: vi.fn(), shutdown: vi.fn() },
    children: [],
    paths: [],
};

const store = require('../../src/main/capability/store/index.js');
const libsStore = require('../../src/main/libs/store.js');

describe('capability/store schema', () => {
    it('setFile / removeFile 与 get / getFile 一样开放同步别名', () => {
        expect(store.serviceSchema.sync).toEqual(['get', 'getFile', 'setFile', 'removeFile']);
    });

    it('六个 handler 与 libs/store 指向同一函数引用', () => {
        for (const name of ['set', 'get', 'remove', 'setFile', 'getFile', 'removeFile']) {
            expect(store.serviceSchema.handlers[name]).toBe(libsStore[name]);
        }
    });
});
