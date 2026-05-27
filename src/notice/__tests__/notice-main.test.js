import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const cjsRequire = createRequire(import.meta.url);

const Module = cjsRequire('node:module');
const electronPath = cjsRequire.resolve('electron');

const sendMock = vi.fn();
const fakeWindow = { webContents: { send: sendMock } };

const ipcMain = {
    on: vi.fn(),
    removeAllListeners: vi.fn(),
};

const BrowserWindow = {
    getAllWindows: () => [fakeWindow],
    fromId: () => fakeWindow,
};

const fakeElectronModule = new Module(electronPath);
fakeElectronModule.filename = electronPath;
fakeElectronModule.loaded = true;
fakeElectronModule.exports = { ipcMain, BrowserWindow };
cjsRequire.cache[electronPath] = fakeElectronModule;

const Notice = cjsRequire('../index.js');

describe('Notice broadcast/direct data serialization', () => {
    beforeAll(() => {
        // init registers internal schema (system / update / app / window) and
        // calls ipcMain.on once — mocked, no-op.
        Notice.init();
    });

    beforeEach(() => {
        sendMock.mockReset();
    });

    it('broadcast data is serialized', () => {
        // system.networkDisconnected: broadcast=true
        Notice.broadcast('system.networkDisconnected', { fn: () => {}, val: 1 });
        expect(sendMock).toHaveBeenCalled();
        const [, , data] = sendMock.mock.calls[0];
        expect(data.fn).toContain('[Function:');
        expect(data.val).toBe(1);
    });

    it('direct data is serialized', () => {
        // update.progress: broadcast=false
        Notice.direct('update.progress', 1, { date: new Date('2026-01-01T00:00:00.000Z') });
        expect(sendMock).toHaveBeenCalled();
        const [, , data] = sendMock.mock.calls[0];
        expect(data.date).toBe('2026-01-01T00:00:00.000Z');
    });
});
