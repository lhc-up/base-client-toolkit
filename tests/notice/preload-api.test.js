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
const { META_GET_SCHEMA_CHANNEL } = require('../../src/notice/protocol');
const { okEnvelope, errorEnvelope } = require('../../src/shared/envelope');

const preloadPath = require.resolve('../../src/notice/preload');

beforeEach(() => {
    delete require.cache[preloadPath];
    ipcRenderer.on.mockClear();
    ipcRenderer.sendSync.mockReset();
    ipcRenderer.removeListener.mockClear();
    ipcRenderer.__handlers.clear();
});

function loadBuilder() {
    return require('../../src/notice/preload');
}

function build(schemaList) {
    ipcRenderer.sendSync.mockReturnValue(okEnvelope(schemaList));
    return loadBuilder()();
}

describe('buildAppNotice: factory output shape', () => {
    it('returns object keyed by namespace, each with on/once/off methods', () => {
        const api = build([
            { namespace: 'foo', events: ['userLoggedIn', 'dataReady'] },
            { namespace: 'bar', events: ['ping'] },
        ]);
        expect(typeof api.foo).toBe('object');
        expect(typeof api.foo.on).toBe('function');
        expect(typeof api.foo.once).toBe('function');
        expect(typeof api.foo.off).toBe('function');
        expect(typeof api.bar.on).toBe('function');
        // Per-event sub-objects must not exist
        expect(api.foo.userLoggedIn).toBeUndefined();
        expect(api.bar.ping).toBeUndefined();
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
        expect(() => loadBuilder()()).toThrow(/meta failed/);
    });

    it('empty schema list yields empty api object', () => {
        ipcRenderer.sendSync.mockReturnValue(okEnvelope([]));
        expect(loadBuilder()()).toEqual({});
    });
});

describe('on: subscribe and unsubscribe', () => {
    it('on returns a function that removes the subscription', () => {
        const api = build([{ namespace: 'foo', events: ['evA'] }]);
        const cb = vi.fn();
        const off = api.foo.on('evA', cb);

        const dispatcher = ipcRenderer.__handlers.get('notice:event');
        dispatcher({}, 'foo.evA', [{ x: 1 }]);
        expect(cb).toHaveBeenCalledWith({ x: 1 });

        off();
        dispatcher({}, 'foo.evA', [{ x: 2 }]);
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('multiple on subscriptions all fire', () => {
        const api = build([{ namespace: 'foo', events: ['evA'] }]);
        const a = vi.fn();
        const b = vi.fn();
        api.foo.on('evA', a);
        api.foo.on('evA', b);

        const dispatcher = ipcRenderer.__handlers.get('notice:event');
        dispatcher({}, 'foo.evA', [{ v: 1 }]);
        expect(a).toHaveBeenCalledWith({ v: 1 });
        expect(b).toHaveBeenCalledWith({ v: 1 });
    });
});

describe('once: auto-unsubscribes', () => {
    it('once fires exactly one time', () => {
        const api = build([{ namespace: 'foo', events: ['evA'] }]);
        const cb = vi.fn();
        api.foo.once('evA', cb);

        const dispatcher = ipcRenderer.__handlers.get('notice:event');
        dispatcher({}, 'foo.evA', [{ n: 1 }]);
        dispatcher({}, 'foo.evA', [{ n: 2 }]);

        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith({ n: 1 });
    });

    it('once returns unsubscribe that prevents firing if called before push', () => {
        const api = build([{ namespace: 'foo', events: ['evA'] }]);
        const cb = vi.fn();
        const off = api.foo.once('evA', cb);
        off();

        const dispatcher = ipcRenderer.__handlers.get('notice:event');
        dispatcher({}, 'foo.evA', [{ n: 1 }]);
        expect(cb).not.toHaveBeenCalled();
    });
});

describe('off: three-mode semantics', () => {
    it('off(eventName, cb) removes only that callback', () => {
        const api = build([{ namespace: 'foo', events: ['evA'] }]);
        const a = vi.fn();
        const b = vi.fn();
        api.foo.on('evA', a);
        api.foo.on('evA', b);
        api.foo.off('evA', a);

        const dispatcher = ipcRenderer.__handlers.get('notice:event');
        dispatcher({}, 'foo.evA', [{ v: 1 }]);
        expect(a).not.toHaveBeenCalled();
        expect(b).toHaveBeenCalledWith({ v: 1 });
    });

    it('off(eventName) clears all subscriptions for that event', () => {
        const api = build([{ namespace: 'foo', events: ['evA', 'evB'] }]);
        const a = vi.fn();
        const b = vi.fn();
        const c = vi.fn();
        api.foo.on('evA', a);
        api.foo.on('evA', b);
        api.foo.on('evB', c);
        api.foo.off('evA');

        const dispatcher = ipcRenderer.__handlers.get('notice:event');
        dispatcher({}, 'foo.evA', [{ v: 1 }]);
        dispatcher({}, 'foo.evB', [{ v: 2 }]);
        expect(a).not.toHaveBeenCalled();
        expect(b).not.toHaveBeenCalled();
        expect(c).toHaveBeenCalledWith({ v: 2 });
    });

    it('off() with no args clears the entire namespace', () => {
        const api = build([{ namespace: 'foo', events: ['evA', 'evB'] }]);
        const a = vi.fn();
        const b = vi.fn();
        api.foo.on('evA', a);
        api.foo.on('evB', b);
        api.foo.off();

        const dispatcher = ipcRenderer.__handlers.get('notice:event');
        dispatcher({}, 'foo.evA', [{ v: 1 }]);
        dispatcher({}, 'foo.evB', [{ v: 2 }]);
        expect(a).not.toHaveBeenCalled();
        expect(b).not.toHaveBeenCalled();
    });

    it('off(eventName, unknownCb) is a no-op (no throw)', () => {
        const api = build([{ namespace: 'foo', events: ['evA'] }]);
        expect(() => api.foo.off('evA', () => {})).not.toThrow();
    });

    it('off() does not affect other namespaces', () => {
        const api = build([
            { namespace: 'foo', events: ['evA'] },
            { namespace: 'bar', events: ['evB'] },
        ]);
        const a = vi.fn();
        const b = vi.fn();
        api.foo.on('evA', a);
        api.bar.on('evB', b);
        api.foo.off();

        const dispatcher = ipcRenderer.__handlers.get('notice:event');
        dispatcher({}, 'foo.evA', [{ v: 1 }]);
        dispatcher({}, 'bar.evB', [{ v: 2 }]);
        expect(a).not.toHaveBeenCalled();
        expect(b).toHaveBeenCalledWith({ v: 2 });
    });
});

describe('strict event-name validation', () => {
    it('on throws when event is not declared in schema', () => {
        const api = build([{ namespace: 'foo', events: ['evA'] }]);
        expect(() => api.foo.on('undeclared', () => {}))
            .toThrow(/Notice event "foo\.undeclared" not registered/);
    });

    it('once throws when event is not declared in schema', () => {
        const api = build([{ namespace: 'foo', events: ['evA'] }]);
        expect(() => api.foo.once('undeclared', () => {}))
            .toThrow(/Notice event "foo\.undeclared" not registered/);
    });

    it('off(eventName, ...) throws when event is not declared', () => {
        const api = build([{ namespace: 'foo', events: ['evA'] }]);
        expect(() => api.foo.off('undeclared'))
            .toThrow(/Notice event "foo\.undeclared" not registered/);
        expect(() => api.foo.off('undeclared', () => {}))
            .toThrow(/Notice event "foo\.undeclared" not registered/);
    });

    it('off() with no args does NOT throw even if namespace has no subscriptions', () => {
        const api = build([{ namespace: 'foo', events: ['evA'] }]);
        expect(() => api.foo.off()).not.toThrow();
    });
});

describe('strict callback-type validation', () => {
    it('on throws when cb is not a function', () => {
        const api = build([{ namespace: 'foo', events: ['evA'] }]);
        expect(() => api.foo.on('evA', 'not-a-fn'))
            .toThrow(/Notice foo\.on callback must be a function/);
        expect(() => api.foo.on('evA', null))
            .toThrow(/Notice foo\.on callback must be a function/);
        expect(() => api.foo.on('evA', undefined))
            .toThrow(/Notice foo\.on callback must be a function/);
    });

    it('once throws when cb is not a function', () => {
        const api = build([{ namespace: 'foo', events: ['evA'] }]);
        expect(() => api.foo.once('evA', 42))
            .toThrow(/Notice foo\.once callback must be a function/);
    });

    it('off(eventName, cb) throws when cb is provided but not a function', () => {
        const api = build([{ namespace: 'foo', events: ['evA'] }]);
        expect(() => api.foo.off('evA', 'not-a-fn'))
            .toThrow(/Notice foo\.off callback must be a function/);
    });

    it('assertEvent runs before assertFn (event-name error takes precedence)', () => {
        const api = build([{ namespace: 'foo', events: ['evA'] }]);
        // Undeclared event + non-function cb → event-name error wins
        expect(() => api.foo.on('undeclared', 'not-a-fn'))
            .toThrow(/not registered/);
    });
});
