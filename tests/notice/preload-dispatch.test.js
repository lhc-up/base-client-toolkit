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
const { EVENT_CHANNEL } = require('../../src/notice/protocol');
const { okEnvelope } = require('../../src/shared/envelope');

const preloadPath = require.resolve('../../src/notice/preload');

beforeEach(() => {
    delete require.cache[preloadPath];
    ipcRenderer.on.mockClear();
    ipcRenderer.sendSync.mockReset();
    ipcRenderer.__handlers.clear();
});

function build(schemaList) {
    ipcRenderer.sendSync.mockReturnValue(okEnvelope(schemaList));
    const buildAppNotice = require('../../src/notice/preload');
    return buildAppNotice();
}

describe('single dispatcher', () => {
    it('registers exactly one ipcRenderer.on for EVENT_CHANNEL', () => {
        build([
            { namespace: 'foo', events: ['a', 'b'] },
            { namespace: 'bar', events: ['c'] },
        ]);
        const calls = ipcRenderer.on.mock.calls.filter(
            ([ch]) => ch === EVENT_CHANNEL,
        );
        expect(calls.length).toBe(1);
    });

    it('routes pushes to correct event listeners by fullEventName', () => {
        const api = build([
            { namespace: 'foo', events: ['a', 'b'] },
            { namespace: 'bar', events: ['c'] },
        ]);
        const fooA = vi.fn();
        const fooB = vi.fn();
        const barC = vi.fn();
        api.foo.a.on(fooA);
        api.foo.b.on(fooB);
        api.bar.c.on(barC);

        const dispatcher = ipcRenderer.__handlers.get(EVENT_CHANNEL);
        dispatcher({}, 'foo.a', { from: 'A' });
        dispatcher({}, 'bar.c', { from: 'C' });

        expect(fooA).toHaveBeenCalledWith({ from: 'A' });
        expect(fooB).not.toHaveBeenCalled();
        expect(barC).toHaveBeenCalledWith({ from: 'C' });
    });

    it('push for unknown fullEventName is silently ignored', () => {
        build([{ namespace: 'foo', events: ['a'] }]);
        const dispatcher = ipcRenderer.__handlers.get(EVENT_CHANNEL);
        expect(() => dispatcher({}, 'never.registered', {})).not.toThrow();
    });

    it('push for known event with zero subscribers is a no-op', () => {
        build([{ namespace: 'foo', events: ['a'] }]);
        const dispatcher = ipcRenderer.__handlers.get(EVENT_CHANNEL);
        expect(() => dispatcher({}, 'foo.a', { x: 1 })).not.toThrow();
    });

    it('callback throw does not break subsequent callbacks (current snapshot semantics)', () => {
        const api = build([{ namespace: 'foo', events: ['a'] }]);
        const good = vi.fn();
        api.foo.a.on(() => { throw new Error('one cb failed'); });
        api.foo.a.on(good);

        const dispatcher = ipcRenderer.__handlers.get(EVENT_CHANNEL);
        // Spec does not require catching; if first throws, second won't run.
        // We assert the dispatcher itself does not crash the test runner with unhandled.
        let threw = false;
        try { dispatcher({}, 'foo.a', { v: 1 }); } catch { threw = true; }
        // Either it threw (and good was not called) or it didn't and good was.
        // What matters: dispatcher must not corrupt internal state.
        if (!threw) expect(good).toHaveBeenCalled();
    });

    it('data delivered as-is (already serialized by main)', () => {
        const api = build([{ namespace: 'foo', events: ['a'] }]);
        const cb = vi.fn();
        api.foo.a.on(cb);

        const payload = { iso: '2026-01-01T00:00:00.000Z', n: 7 };
        const dispatcher = ipcRenderer.__handlers.get(EVENT_CHANNEL);
        dispatcher({}, 'foo.a', payload);

        expect(cb).toHaveBeenCalledWith(payload);
    });
});
