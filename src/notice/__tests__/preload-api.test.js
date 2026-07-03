import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function buildElectronMock() {
    const handlers = new Map();
    return {
        ipcRenderer: {
            on: vi.fn((channel, fn) => { handlers.set(channel, fn); }),
            removeListener: vi.fn(),
            sendSync: vi.fn(),
            __handlers: handlers,
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
const { META_GET_SCHEMA_CHANNEL } = require('../protocol');
const { okEnvelope, errorEnvelope } = require('../../shared/envelope');

const preloadPath = require.resolve('../preload');

beforeEach(() => {
    // Drop cached preload module so each test re-runs factory module load
    delete require.cache[preloadPath];
    ipcRenderer.on.mockClear();
    ipcRenderer.sendSync.mockReset();
    ipcRenderer.removeListener.mockClear();
    ipcRenderer.__handlers.clear();
});

function loadBuilder() {
    return require('../preload');
}

describe('buildAppNotice: factory output shape', () => {
    it('returns object keyed by namespace, each with event names', () => {
        ipcRenderer.sendSync.mockReturnValue(okEnvelope([
            { namespace: 'foo', events: ['userLoggedIn', 'dataReady'] },
            { namespace: 'bar', events: ['ping'] },
        ]));

        const buildAppNotice = loadBuilder();
        const api = buildAppNotice();

        expect(typeof api.foo).toBe('object');
        expect(typeof api.foo.userLoggedIn.on).toBe('function');
        expect(typeof api.foo.userLoggedIn.once).toBe('function');
        expect(typeof api.foo.userLoggedIn.off).toBe('function');
        expect(typeof api.bar.ping.on).toBe('function');
    });

    it('calls sendSync on META_GET_SCHEMA_CHANNEL', () => {
        ipcRenderer.sendSync.mockReturnValue(okEnvelope([]));
        loadBuilder()();
        expect(ipcRenderer.sendSync).toHaveBeenCalledWith(META_GET_SCHEMA_CHANNEL);
    });

    it('throws revived Error when envelope is not ok', () => {
        ipcRenderer.sendSync.mockReturnValue(errorEnvelope({
            name: 'TypeError',
            message: 'meta failed',
        }));
        const buildAppNotice = loadBuilder();
        expect(() => buildAppNotice()).toThrow(/meta failed/);
    });

    it('empty schema list yields empty api object', () => {
        ipcRenderer.sendSync.mockReturnValue(okEnvelope([]));
        const api = loadBuilder()();
        expect(api).toEqual({});
    });
});

describe('buildEventApi: on returns unsubscribe', () => {
    function build() {
        ipcRenderer.sendSync.mockReturnValue(okEnvelope([
            { namespace: 'foo', events: ['evA'] },
        ]));
        return loadBuilder()();
    }

    it('on returns a function that removes the subscription', () => {
        const api = build();
        const cb = vi.fn();
        const off = api.foo.evA.on(cb);

        // Simulate push
        const dispatcher = ipcRenderer.__handlers.get('notice:event');
        dispatcher({}, 'foo.evA', { x: 1 });
        expect(cb).toHaveBeenCalledWith({ x: 1 });

        off();
        dispatcher({}, 'foo.evA', { x: 2 });
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('multiple on subscriptions all fire', () => {
        const api = build();
        const a = vi.fn();
        const b = vi.fn();
        api.foo.evA.on(a);
        api.foo.evA.on(b);

        const dispatcher = ipcRenderer.__handlers.get('notice:event');
        dispatcher({}, 'foo.evA', { v: 1 });
        expect(a).toHaveBeenCalledWith({ v: 1 });
        expect(b).toHaveBeenCalledWith({ v: 1 });
    });
});

describe('buildEventApi: once auto-unsubscribes', () => {
    function build() {
        ipcRenderer.sendSync.mockReturnValue(okEnvelope([
            { namespace: 'foo', events: ['evA'] },
        ]));
        return loadBuilder()();
    }

    it('once fires exactly one time', () => {
        const api = build();
        const cb = vi.fn();
        api.foo.evA.once(cb);

        const dispatcher = ipcRenderer.__handlers.get('notice:event');
        dispatcher({}, 'foo.evA', { n: 1 });
        dispatcher({}, 'foo.evA', { n: 2 });

        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith({ n: 1 });
    });

    it('once returns unsubscribe that prevents firing if called before push', () => {
        const api = build();
        const cb = vi.fn();
        const off = api.foo.evA.once(cb);
        off();

        const dispatcher = ipcRenderer.__handlers.get('notice:event');
        dispatcher({}, 'foo.evA', { n: 1 });
        expect(cb).not.toHaveBeenCalled();
    });
});

describe('buildEventApi: off semantics', () => {
    function build() {
        ipcRenderer.sendSync.mockReturnValue(okEnvelope([
            { namespace: 'foo', events: ['evA'] },
        ]));
        return loadBuilder()();
    }

    it('off(cb) removes only that callback', () => {
        const api = build();
        const a = vi.fn();
        const b = vi.fn();
        api.foo.evA.on(a);
        api.foo.evA.on(b);
        api.foo.evA.off(a);

        const dispatcher = ipcRenderer.__handlers.get('notice:event');
        dispatcher({}, 'foo.evA', { v: 1 });
        expect(a).not.toHaveBeenCalled();
        expect(b).toHaveBeenCalledWith({ v: 1 });
    });

    it('off() with no arg clears all subscriptions for that event', () => {
        const api = build();
        const a = vi.fn();
        const b = vi.fn();
        api.foo.evA.on(a);
        api.foo.evA.on(b);
        api.foo.evA.off();

        const dispatcher = ipcRenderer.__handlers.get('notice:event');
        dispatcher({}, 'foo.evA', { v: 1 });
        expect(a).not.toHaveBeenCalled();
        expect(b).not.toHaveBeenCalled();
    });

    it('off(cb) on unknown callback is a no-op (no throw)', () => {
        const api = build();
        expect(() => api.foo.evA.off(() => {})).not.toThrow();
    });
});
