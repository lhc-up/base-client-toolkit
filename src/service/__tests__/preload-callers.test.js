import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function buildElectronMock() {
    return {
        ipcRenderer: {
            invoke: vi.fn(),
            sendSync: vi.fn(),
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
const {
    asyncChannel, syncChannel,
} = require('../protocol');
const { okEnvelope, errorEnvelope } = require('../../shared/envelope');

const preloadPath = require.resolve('../preload');

beforeEach(() => {
    delete require.cache[preloadPath];
    ipcRenderer.invoke.mockReset();
    ipcRenderer.sendSync.mockReset();
});

function build(schemaList) {
    ipcRenderer.sendSync.mockReturnValueOnce(okEnvelope(schemaList));
    const buildAppService = require('../preload');
    return buildAppService();
}

describe('async caller', () => {
    it('invokes correct channel with serialized args', async () => {
        const api = build([
            { namespace: 'foo', handlers: ['add'], sync: [] },
        ]);
        ipcRenderer.invoke.mockResolvedValue(okEnvelope(3));

        const result = await api.foo.add(1, 2);

        expect(ipcRenderer.invoke).toHaveBeenCalledWith(
            asyncChannel('foo', 'add'), 1, 2,
        );
        expect(result).toBe(3);
    });

    it('unwraps okEnvelope.data', async () => {
        const api = build([{ namespace: 'foo', handlers: ['get'], sync: [] }]);
        ipcRenderer.invoke.mockResolvedValue(okEnvelope({ user: 'alice' }));
        await expect(api.foo.get()).resolves.toEqual({ user: 'alice' });
    });

    it('errorEnvelope -> throws revived Error', async () => {
        const api = build([{ namespace: 'foo', handlers: ['fail'], sync: [] }]);
        ipcRenderer.invoke.mockResolvedValue(errorEnvelope({
            name: 'RangeError',
            message: 'out of range',
        }));
        await expect(api.foo.fail()).rejects.toBeInstanceOf(RangeError);
        await expect(api.foo.fail()).rejects.toThrow(/out of range/);
    });

    it('args serialized: function arg becomes placeholder', async () => {
        const api = build([{ namespace: 'foo', handlers: ['take'], sync: [] }]);
        ipcRenderer.invoke.mockResolvedValue(okEnvelope(null));
        await api.foo.take({ cb: function named() {}, n: 5 });

        const sentArg = ipcRenderer.invoke.mock.calls[0][1];
        expect(sentArg.n).toBe(5);
        expect(sentArg.cb).toBe('[Function: named]');
    });

    it('Date arg serialized to ISO string', async () => {
        const api = build([{ namespace: 'foo', handlers: ['log'], sync: [] }]);
        ipcRenderer.invoke.mockResolvedValue(okEnvelope(null));
        await api.foo.log(new Date('2026-01-01T00:00:00.000Z'));
        expect(ipcRenderer.invoke.mock.calls[0][1]).toBe('2026-01-01T00:00:00.000Z');
    });
});

describe('sync caller', () => {
    it('uses sendSync on syncChannel and unwraps data', () => {
        const api = build([
            { namespace: 'foo', handlers: ['log'], sync: ['log'] },
        ]);
        ipcRenderer.sendSync.mockReturnValueOnce(okEnvelope('ok'));

        const result = api.foo.logSync('hello');

        expect(ipcRenderer.sendSync).toHaveBeenLastCalledWith(
            syncChannel('foo', 'log'), 'hello',
        );
        expect(result).toBe('ok');
    });

    it('errorEnvelope -> throws revived Error synchronously', () => {
        const api = build([
            { namespace: 'foo', handlers: ['fail'], sync: ['fail'] },
        ]);
        ipcRenderer.sendSync.mockReturnValueOnce(errorEnvelope({
            name: 'TypeError',
            message: 'sync bad',
        }));
        expect(() => api.foo.failSync()).toThrow(TypeError);
        expect(() => {
            ipcRenderer.sendSync.mockReturnValueOnce(errorEnvelope({
                name: 'TypeError', message: 'sync bad',
            }));
            api.foo.failSync();
        }).toThrow(/sync bad/);
    });

    it('args serialized before sendSync', () => {
        const api = build([
            { namespace: 'foo', handlers: ['emit'], sync: ['emit'] },
        ]);
        ipcRenderer.sendSync.mockReturnValueOnce(okEnvelope(null));

        api.foo.emitSync({ fn: () => {}, n: 1 });

        const sentArg = ipcRenderer.sendSync.mock.calls.at(-1)[1];
        expect(sentArg.n).toBe(1);
        expect(sentArg.fn).toMatch(/^\[Function/);
    });

    it('non-sync handler has no Sync variant (regression guard)', () => {
        const api = build([
            { namespace: 'foo', handlers: ['bar'], sync: [] },
        ]);
        expect(api.foo.barSync).toBeUndefined();
    });
});
