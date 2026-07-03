import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Mock electron by injecting into Node CJS require cache. vi.mock-style
// factory does not work for CJS source modules; require.cache hookup is
// the integration layer that makes the mock visible.
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
    ipcMain.on.mockClear();
    ipcMain.removeAllListeners.mockClear();
    ipcMain.__handlers.clear();
});

describe('init: input validation', () => {
    it('non-array userSchemas throws', () => {
        expect(() => Notice.init({ userSchemas: 'not array' })).toThrow();
        expect(() => Notice.init({ userSchemas: null })).toThrow();
    });
    it('missing opts throws', () => {
        expect(() => Notice.init()).toThrow();
    });
    it('empty userSchemas is allowed', () => {
        expect(() => Notice.init({ userSchemas: [] })).not.toThrow();
    });
});

describe('init: schema validation', () => {
    it('schema missing namespace throws', () => {
        expect(() => Notice.init({ userSchemas: [{ events: ['x'] }] })).toThrow();
    });
    it('schema missing events array throws', () => {
        expect(() => Notice.init({ userSchemas: [{ namespace: 'foo' }] })).toThrow();
    });
    it('events not an array throws', () => {
        expect(() => Notice.init({
            userSchemas: [{ namespace: 'foo', events: 'bar' }],
        })).toThrow();
    });
    it('event name with dot throws', () => {
        expect(() => Notice.init({
            userSchemas: [{ namespace: 'foo', events: ['a.b'] }],
        })).toThrow(/invalid event name/i);
    });
    it('event name with space throws', () => {
        expect(() => Notice.init({
            userSchemas: [{ namespace: 'foo', events: ['has space'] }],
        })).toThrow(/invalid event name/i);
    });
    it('valid event names pass: letters/digits/underscore (no dash)', () => {
        expect(() => Notice.init({
            userSchemas: [{ namespace: 'foo', events: ['abc', 'X', 'event_2', '_underscore'] }],
        })).not.toThrow();
    });
    it('event name with dash rejected (must be valid JS identifier)', () => {
        expect(() => Notice.init({
            userSchemas: [{ namespace: 'foo', events: ['ab-c'] }],
        })).toThrow(/invalid event name/i);
    });
    it('event name starting with digit rejected', () => {
        expect(() => Notice.init({
            userSchemas: [{ namespace: 'foo', events: ['1abc'] }],
        })).toThrow(/invalid event name/i);
    });
    it('namespace with dash rejected', () => {
        expect(() => Notice.init({
            userSchemas: [{ namespace: 'foo-bar', events: ['x'] }],
        })).toThrow(/namespace.*invalid/i);
    });
    it('namespace starting with digit rejected', () => {
        expect(() => Notice.init({
            userSchemas: [{ namespace: '1foo', events: ['x'] }],
        })).toThrow(/namespace.*invalid/i);
    });
    it('validateNoticeSchema is exported and callable', () => {
        const { validateNoticeSchema } = require('../main');
        expect(typeof validateNoticeSchema).toBe('function');
        expect(() => validateNoticeSchema({ namespace: 'foo', events: ['a'] })).not.toThrow();
        expect(() => validateNoticeSchema({ namespace: 'foo-bad', events: ['a'] })).toThrow();
    });
    it('duplicate namespace across schemas throws', () => {
        expect(() => Notice.init({
            userSchemas: [
                { namespace: 'foo', events: ['a'] },
                { namespace: 'foo', events: ['b'] },
            ],
        })).toThrow(/conflict|冲突/i);
    });
});

describe('init: meta channel registration', () => {
    it('registers ipcMain listener on META_GET_SCHEMA_CHANNEL', () => {
        Notice.init({ userSchemas: [{ namespace: 'foo', events: ['x'] }] });
        expect(ipcMain.on).toHaveBeenCalledWith(
            META_GET_SCHEMA_CHANNEL,
            expect.any(Function),
        );
    });
});
