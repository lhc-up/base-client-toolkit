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
    okEnvelope, errorEnvelope, META_LIST_CHANNEL,
} = require('../protocol');

const preloadPath = require.resolve('../preload');

beforeEach(() => {
    // Drop cached preload module so each test re-runs factory module load
    delete require.cache[preloadPath];
    ipcRenderer.invoke.mockReset();
    ipcRenderer.sendSync.mockReset();
});

function loadBuilder() {
    return require('../preload');
}

describe('buildAppService: meta consumption', () => {
    it('calls sendSync on META_LIST_CHANNEL', () => {
        ipcRenderer.sendSync.mockReturnValue(okEnvelope([]));
        loadBuilder()();
        expect(ipcRenderer.sendSync).toHaveBeenCalledWith(META_LIST_CHANNEL);
    });

    it('throws revived Error when envelope is not ok', () => {
        ipcRenderer.sendSync.mockReturnValue(errorEnvelope({
            name: 'TypeError',
            message: 'meta failed',
        }));
        const buildAppService = loadBuilder();
        expect(() => buildAppService()).toThrow(/meta failed/);
    });

    it('empty schema list yields empty api object', () => {
        ipcRenderer.sendSync.mockReturnValue(okEnvelope([]));
        const api = loadBuilder()();
        expect(api).toEqual({});
    });
});

describe('buildAppService: API surface generation', () => {
    it('each handler becomes async caller on namespace', () => {
        ipcRenderer.sendSync.mockReturnValue(okEnvelope([
            { namespace: 'foo', handlers: ['bar', 'baz'], sync: [] },
        ]));
        const api = loadBuilder()();
        expect(typeof api.foo.bar).toBe('function');
        expect(typeof api.foo.baz).toBe('function');
    });

    it('each sync-listed handler ALSO gets {name}Sync caller', () => {
        ipcRenderer.sendSync.mockReturnValue(okEnvelope([
            { namespace: 'foo', handlers: ['bar', 'log'], sync: ['log'] },
        ]));
        const api = loadBuilder()();
        expect(typeof api.foo.bar).toBe('function');
        expect(typeof api.foo.log).toBe('function');
        expect(typeof api.foo.logSync).toBe('function');
        // non-sync handler does NOT get Sync variant
        expect(api.foo.barSync).toBeUndefined();
    });

    it('multiple namespaces each get their own object', () => {
        ipcRenderer.sendSync.mockReturnValue(okEnvelope([
            { namespace: 'foo', handlers: ['a'], sync: [] },
            { namespace: 'bar', handlers: ['b'], sync: ['b'] },
        ]));
        const api = loadBuilder()();
        expect(typeof api.foo.a).toBe('function');
        expect(typeof api.bar.b).toBe('function');
        expect(typeof api.bar.bSync).toBe('function');
    });
});
