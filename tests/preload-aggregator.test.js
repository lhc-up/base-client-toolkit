// 测试 src/preload.js 聚合入口契约（per overview §8.2）。
// 关键覆盖：opt-out 必须真正跳过 buildAppService/buildAppNotice 调用，
// 否则 sendSync 元通道因无 listener 会阻塞渲染进程。

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const _originalContextIsolatedDescriptor = Object.getOwnPropertyDescriptor(process, 'contextIsolated');

function buildElectronMock() {
    return {
        contextBridge: { exposeInMainWorld: vi.fn() },
        ipcRenderer: {
            sendSync: vi.fn(),
            on: vi.fn(),
            invoke: vi.fn(),
        },
    };
}

const electronMock = buildElectronMock();
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: electronMock,
    children: [],
    paths: [],
};

const { contextBridge, ipcRenderer } = electronMock;
const preloadPath = require.resolve('../src/preload/index.js');

beforeEach(() => {
    delete require.cache[preloadPath];
    contextBridge.exposeInMainWorld.mockClear();
    ipcRenderer.sendSync.mockReset();
    ipcRenderer.on.mockClear();
    // 默认让 sendSync 返回空 envelope（不抛错地完成）
    ipcRenderer.sendSync.mockReturnValue({ ok: true, data: [] });
});

afterAll(() => {
    if (_originalContextIsolatedDescriptor) {
        Object.defineProperty(process, 'contextIsolated', _originalContextIsolatedDescriptor);
    } else {
        delete process.contextIsolated;
    }
});

describe('preload module exports', () => {
    it('exports init and exposeAPI (per overview §8.2)', () => {
        const { init, exposeAPI } = require('../src/preload/index.js');
        expect(typeof init).toBe('function');
        expect(typeof exposeAPI).toBe('function');
    });

    it('exposeAPI is the same internal helper used by init (contextIsolated path)', () => {
        Object.defineProperty(process, 'contextIsolated', { value: true, configurable: true });
        const { exposeAPI } = require('../src/preload/index.js');
        exposeAPI('myCustomBridge', { hello: 'world' });
        expect(contextBridge.exposeInMainWorld).toHaveBeenCalledWith(
            'myCustomBridge',
            { hello: 'world' },
        );
    });

    it('exposeAPI uses window fallback when not contextIsolated', () => {
        Object.defineProperty(process, 'contextIsolated', { value: false, configurable: true });
        global.window = { existing: 1 };
        const { exposeAPI } = require('../src/preload/index.js');
        exposeAPI('myBridge', { v: 2 });
        expect(contextBridge.exposeInMainWorld).not.toHaveBeenCalled();
        expect(global.window.myBridge).toEqual({ v: 2 });
        expect(global.window.existing).toBe(1);
        delete global.window;
    });
});

describe('preload aggregator: init()', () => {
    it('default opts: exposes both appService and appNotice', () => {
        // 模拟 contextIsolated 环境
        Object.defineProperty(process, 'contextIsolated', { value: true, configurable: true });
        const { init } = require('../src/preload/index.js');
        init();
        const names = contextBridge.exposeInMainWorld.mock.calls.map(c => c[0]).sort();
        expect(names).toEqual(['appNotice', 'appService']);
    });

    it('opts.service=false: skips appService bridge (avoids sendSync deadlock)', () => {
        Object.defineProperty(process, 'contextIsolated', { value: true, configurable: true });
        const { init } = require('../src/preload/index.js');
        init({ service: false });
        const names = contextBridge.exposeInMainWorld.mock.calls.map(c => c[0]);
        expect(names).toEqual(['appNotice']);
    });

    it('opts.notice=false: skips appNotice bridge', () => {
        Object.defineProperty(process, 'contextIsolated', { value: true, configurable: true });
        const { init } = require('../src/preload/index.js');
        init({ notice: false });
        const names = contextBridge.exposeInMainWorld.mock.calls.map(c => c[0]);
        expect(names).toEqual(['appService']);
    });

    it('opts.service=false && opts.notice=false: no bridge exposed', () => {
        Object.defineProperty(process, 'contextIsolated', { value: true, configurable: true });
        const { init } = require('../src/preload/index.js');
        init({ service: false, notice: false });
        expect(contextBridge.exposeInMainWorld).not.toHaveBeenCalled();
    });

    it('non-isolated fallback: writes to window[name]', () => {
        Object.defineProperty(process, 'contextIsolated', { value: false, configurable: true });
        global.window = {};
        const { init } = require('../src/preload/index.js');
        init({ service: false });
        expect(contextBridge.exposeInMainWorld).not.toHaveBeenCalled();
        expect(global.window.appNotice).toBeDefined();
        delete global.window;
    });
});
