// 共享的 BrowserWindow mock fixture（M4 测试用）。
// CJS 模块；vi 由调用方传入以解耦——vitest 2.x 拒绝从 CJS require 引入。
// 通过 require.cache 注入 electron，与 M2/M3 测试 mock 模式保持一致。

let _vi = null;
let MockBrowserWindow = null;
const state = { instances: [], nextId: 1, callLog: [], loadResult: () => Promise.resolve() };
let loggerMock = null;

function buildMockClass() {
    const log = state.callLog;
    return class MockBW {
        constructor(options) {
            this.id = state.nextId++;
            this.options = options;
            this.listeners = new Map();
            this.destroyed = false;

            const webContentsListeners = new Map();
            this.webContents = {
                listeners: webContentsListeners,
                send: _vi.fn((channel, data) => {
                    log.push({ instance: this.id, method: 'webContents.send', args: [channel, data] });
                }),
                on: _vi.fn((event, handler) => {
                    if (!webContentsListeners.has(event)) webContentsListeners.set(event, []);
                    webContentsListeners.get(event).push(handler);
                    log.push({ instance: this.id, method: 'webContents.on', args: [event] });
                }),
                _emit(event, ...args) {
                    const handlers = webContentsListeners.get(event) || [];
                    for (const h of handlers) h(...args);
                },
            };

            this.on = _vi.fn((event, handler) => {
                if (!this.listeners.has(event)) this.listeners.set(event, []);
                this.listeners.get(event).push(handler);
                log.push({ instance: this.id, method: 'on', args: [event] });
            });

            this.loadURL = _vi.fn(url => {
                log.push({ instance: this.id, method: 'loadURL', args: [url] });
                return state.loadResult();
            });

            this.close = _vi.fn(() => {
                log.push({ instance: this.id, method: 'close', args: [] });
            });

            this.isDestroyed = _vi.fn(() => this.destroyed);

            state.instances.push(this);
            log.push({ instance: this.id, method: 'constructor', args: [options] });
        }

        _emit(event, ...args) {
            const handlers = this.listeners.get(event) || [];
            for (const h of handlers) h(...args);
        }
    };
}

function installElectronMock(vi) {
    if (!_vi) {
        _vi = vi;
        MockBrowserWindow = buildMockClass();
    }
    const electronPath = require.resolve('electron');
    require.cache[electronPath] = {
        id: electronPath,
        filename: electronPath,
        loaded: true,
        exports: { BrowserWindow: MockBrowserWindow },
        children: [],
        paths: [],
    };

    // 真实 logger 加载时就要 app.getPath，这里换成只记录调用的 mock
    if (!loggerMock) {
        loggerMock = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn() };
    }
    const loggerPath = require.resolve('../../src/main/libs/logger');
    require.cache[loggerPath] = {
        id: loggerPath,
        filename: loggerPath,
        loaded: true,
        exports: loggerMock,
        children: [],
        paths: [],
    };
}

function reset() {
    state.instances.length = 0;
    state.nextId = 1;
    state.callLog.length = 0;
    state.loadResult = () => Promise.resolve();
    if (loggerMock) {
        for (const fn of Object.values(loggerMock)) fn.mockClear();
    }
}

/** 让之后的 loadURL 返回指定结果（如 reject 模拟加载失败）；reset 后恢复为 resolve */
function setLoadResult(factory) {
    state.loadResult = factory;
}

function getLoggerMock() { return loggerMock; }

function getInstances() { return state.instances; }
function lastInstance() { return state.instances[state.instances.length - 1]; }
function getCallLog() { return state.callLog.slice(); }

module.exports = {
    installElectronMock,
    reset,
    getInstances,
    lastInstance,
    getCallLog,
    setLoadResult,
    getLoggerMock,
    get MockBrowserWindow() { return MockBrowserWindow; },
};
