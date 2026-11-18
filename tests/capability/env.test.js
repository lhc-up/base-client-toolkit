import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const listeners = {};
const electronMock = {
    app: { getPath: () => require('node:os').tmpdir() },
    ipcMain: { on: vi.fn(), removeAllListeners: vi.fn() },
    BrowserWindow: { getAllWindows: () => [], fromId: () => null },
    screen: {
        getPrimaryDisplay: vi.fn(() => ({ bounds: { width: 1280, height: 720 } })),
        on: vi.fn((event, fn) => { listeners[event] = fn; }),
    },
};
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
    id: electronPath, filename: electronPath, loaded: true,
    exports: electronMock, children: [], paths: [],
};

const Notice = require('../../src/notice/main');
const env = require('../../src/main/capability/env');

describe('capability/env', () => {
    it('schema shape', () => {
        expect(env.serviceSchema.namespace).toBe('env');
        expect(env.serviceSchema.sync).toEqual(['getMac', 'getSystemDesc', 'isScreenValid']);
        expect(env.noticeSchema.events).toEqual(['displayMetricsChanged']);
    });

    it('isScreenValid uses the default 1280x720 floor', async () => {
        expect(await env.isScreenValid()).toBe(true);
        electronMock.screen.getPrimaryDisplay.mockReturnValueOnce({ bounds: { width: 1279, height: 720 } });
        expect(await env.isScreenValid()).toBe(false);
    });

    it('getMac / getIp return strings', async () => {
        expect(typeof await env.getMac()).toBe('string');
        expect(typeof await env.getIp()).toBe('string');
    });

    it('init broadcasts displayMetricsChanged with the configured floor', () => {
        Notice.init({ userSchemas: [env.noticeSchema] });
        const spy = vi.spyOn(Notice, 'broadcast').mockImplementation(() => {});
        env.init({ minWidth: 1600, minHeight: 900 });
        listeners['display-metrics-changed']({}, { bounds: { width: 1280, height: 720 } });
        expect(spy).toHaveBeenCalledWith('env.displayMetricsChanged', { isValid: false });
    });
});
