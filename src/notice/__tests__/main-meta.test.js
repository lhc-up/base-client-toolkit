import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function buildElectronMock() {
    const handlers = new Map();
    return {
        ipcMain: {
            on: vi.fn((channel, fn) => { handlers.set(channel, fn); }),
            removeAllListeners: vi.fn(channel => { handlers.delete(channel); }),
            __handlers: handlers,
        },
        BrowserWindow: {
            getAllWindows: vi.fn(() => []),
            fromId: vi.fn(() => null),
        },
    };
}
const electronMock = buildElectronMock();
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
    id: electronPath, filename: electronPath, loaded: true,
    exports: electronMock, children: [], paths: [],
};

const Notice = require('../main');
const { META_GET_SCHEMA_CHANNEL } = require('../protocol');
const { ipcMain } = electronMock;

beforeEach(() => {
    Notice.cleanup();
    ipcMain.__handlers.clear();
    ipcMain.on.mockClear();
    ipcMain.removeAllListeners.mockClear();
});

describe('meta channel handler', () => {
    it('returnValue is okEnvelope with serialized schema list', () => {
        Notice.init({
            userSchemas: [
                { namespace: 'foo', events: ['a', 'b'] },
                { namespace: 'bar', events: ['c'] },
            ],
        });

        const handler = ipcMain.__handlers.get(META_GET_SCHEMA_CHANNEL);
        expect(typeof handler).toBe('function');

        const event = {};
        handler(event);

        expect(event.returnValue.ok).toBe(true);
        expect(event.returnValue.data).toEqual([
            { namespace: 'foo', events: ['a', 'b'] },
            { namespace: 'bar', events: ['c'] },
        ]);
    });

    it('empty schemas returns empty data array', () => {
        Notice.init({ userSchemas: [] });
        const handler = ipcMain.__handlers.get(META_GET_SCHEMA_CHANNEL);
        const event = {};
        handler(event);
        expect(event.returnValue).toEqual({ ok: true, data: [] });
    });

    it('preserves registration order', () => {
        Notice.init({
            userSchemas: [
                { namespace: 'z', events: ['x'] },
                { namespace: 'a', events: ['y'] },
            ],
        });
        const handler = ipcMain.__handlers.get(META_GET_SCHEMA_CHANNEL);
        const event = {};
        handler(event);
        expect(event.returnValue.data.map(s => s.namespace)).toEqual(['z', 'a']);
    });
});
