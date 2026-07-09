import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function buildElectronMock() {
    const listeners = new Map(); // channel -> listener fn
    return {
        ipcRenderer: {
            invoke: vi.fn(),
            sendSync: vi.fn(),
            on: vi.fn((channel, listener) => {
                listeners.set(channel, listener);
            }),
            removeAllListeners: vi.fn((channel) => {
                listeners.delete(channel);
            }),
            // 测试辅助：模拟主进程发出 event.sender.send(channel, data)
            __trigger(channel, data) {
                const listener = listeners.get(channel);
                if (listener) listener({}, data);
            },
            __listenerCount() {
                return listeners.size;
            },
            __registeredChannels() {
                return [...listeners.keys()];
            },
        },
    };
}
const electronMock = buildElectronMock();
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
    id: electronPath, filename: electronPath, loaded: true,
    exports: electronMock, children: [], paths: [],
};

const { ipcRenderer } = electronMock;
const { asyncChannel, syncChannel } = require('../../src/service/protocol');
const { okEnvelope } = require('../../src/shared/envelope');

const preloadPath = require.resolve('../../src/service/preload');

beforeEach(() => {
    delete require.cache[preloadPath];
    ipcRenderer.invoke.mockReset();
    ipcRenderer.sendSync.mockReset();
    ipcRenderer.on.mockClear();
    ipcRenderer.removeAllListeners.mockClear();
});

function build(schemaList) {
    ipcRenderer.sendSync.mockReturnValueOnce(okEnvelope(schemaList));
    const buildAppService = require('../../src/service/preload');
    return buildAppService();
}

describe('T-09 preload callback channel: async caller', () => {
    it('registers ipcRenderer.on with dynamic channel for each function field', async () => {
        const api = build([{ namespace: 'dl', handlers: ['download'], sync: [] }]);
        ipcRenderer.invoke.mockResolvedValue(okEnvelope('/tmp/foo'));

        await api.dl.download('https://x', '/tmp', {
            filename: 'foo',
            onProgress: vi.fn(),
        });

        expect(ipcRenderer.on).toHaveBeenCalledTimes(1);
        const [registeredChannel] = ipcRenderer.on.mock.calls[0];
        expect(registeredChannel).toMatch(new RegExp(`^${asyncChannel('dl', 'download')}-onProgress-\\d+-`));
    });

    it('triggering the channel invokes the original callback with data', async () => {
        const api = build([{ namespace: 'dl', handlers: ['download'], sync: [] }]);
        // 让 invoke 挂起，模拟主进程还在跑
        let resolveInvoke;
        ipcRenderer.invoke.mockReturnValue(new Promise(r => { resolveInvoke = r; }));

        const onProgress = vi.fn();
        const promise = api.dl.download({ onProgress });

        // 从注册记录里拿 channel，模拟主进程发送
        const cbChannel = ipcRenderer.__registeredChannels()[0];
        ipcRenderer.__trigger(cbChannel, 45);
        ipcRenderer.__trigger(cbChannel, 90);

        expect(onProgress).toHaveBeenCalledTimes(2);
        expect(onProgress).toHaveBeenNthCalledWith(1, 45);
        expect(onProgress).toHaveBeenNthCalledWith(2, 90);

        resolveInvoke(okEnvelope('/tmp/foo'));
        await promise;
    });

    it('removes listeners after invoke resolves', async () => {
        const api = build([{ namespace: 'dl', handlers: ['download'], sync: [] }]);
        ipcRenderer.invoke.mockResolvedValue(okEnvelope('/tmp/foo'));

        await api.dl.download({ onProgress: vi.fn() });

        expect(ipcRenderer.removeAllListeners).toHaveBeenCalledTimes(1);
        expect(ipcRenderer.__listenerCount()).toBe(0);
    });

    it('removes listeners even when invoke rejects', async () => {
        const api = build([{ namespace: 'dl', handlers: ['download'], sync: [] }]);
        ipcRenderer.invoke.mockRejectedValue(new Error('boom'));

        await expect(
            api.dl.download({ onProgress: vi.fn() })
        ).rejects.toBeInstanceOf(Error);

        expect(ipcRenderer.removeAllListeners).toHaveBeenCalledTimes(1);
        expect(ipcRenderer.__listenerCount()).toBe(0);
    });

    it('does NOT mutate the caller-passed object', async () => {
        const api = build([{ namespace: 'dl', handlers: ['download'], sync: [] }]);
        ipcRenderer.invoke.mockResolvedValue(okEnvelope(null));

        const original = { filename: 'foo', onProgress: vi.fn() };
        await api.dl.download(original);

        // 原对象不应被改动
        expect(typeof original.onProgress).toBe('function');
        expect(original.filename).toBe('foo');
    });

    it('multiple function fields → multiple channels registered', async () => {
        const api = build([{ namespace: 'dl', handlers: ['download'], sync: [] }]);
        ipcRenderer.invoke.mockResolvedValue(okEnvelope(null));

        await api.dl.download({
            onProgress: vi.fn(),
            onDone: vi.fn(),
            onError: vi.fn(),
        });

        expect(ipcRenderer.on).toHaveBeenCalledTimes(3);
    });

    it('top-level (non-plain-object) function arg is NOT channel-ized', async () => {
        // T-09 只处理 plain object 里的 function 字段；顶层 function 走 M1 serializer 的 placeholder
        const api = build([{ namespace: 'foo', handlers: ['take'], sync: [] }]);
        ipcRenderer.invoke.mockResolvedValue(okEnvelope(null));

        await api.foo.take(() => {});

        expect(ipcRenderer.on).not.toHaveBeenCalled();
        const sentArg = ipcRenderer.invoke.mock.calls[0][1];
        expect(sentArg).toMatch(/^\[Function/);
    });

    it('Array/Date args are not walked', async () => {
        const api = build([{ namespace: 'foo', handlers: ['bar'], sync: [] }]);
        ipcRenderer.invoke.mockResolvedValue(okEnvelope(null));

        // Array 里有 function、Date 都不应触发 channel 化
        await api.foo.bar([1, vi.fn()], new Date('2026-01-01'));

        expect(ipcRenderer.on).not.toHaveBeenCalled();
    });
});

describe('T-09 preload callback channel: sync caller', () => {
    it('registers channel and cleans up after sendSync', () => {
        const api = build([{ namespace: 'foo', handlers: ['bar'], sync: ['bar'] }]);
        ipcRenderer.sendSync.mockReturnValueOnce(okEnvelope('ok'));

        const onDone = vi.fn();
        api.foo.barSync({ onDone });

        expect(ipcRenderer.on).toHaveBeenCalledTimes(1);
        const [regChannel] = ipcRenderer.on.mock.calls[0];
        expect(regChannel).toMatch(new RegExp(`^${syncChannel('foo', 'bar')}-onDone-\\d+-`));

        expect(ipcRenderer.removeAllListeners).toHaveBeenCalledWith(regChannel);
        expect(ipcRenderer.__listenerCount()).toBe(0);
    });

    it('cleanup happens even when sendSync throws (revived error)', () => {
        const api = build([{ namespace: 'foo', handlers: ['bar'], sync: ['bar'] }]);
        ipcRenderer.sendSync.mockImplementationOnce(() => { throw new Error('sync boom'); });

        expect(() => api.foo.barSync({ onDone: vi.fn() })).toThrow();

        expect(ipcRenderer.removeAllListeners).toHaveBeenCalledTimes(1);
        expect(ipcRenderer.__listenerCount()).toBe(0);
    });
});
