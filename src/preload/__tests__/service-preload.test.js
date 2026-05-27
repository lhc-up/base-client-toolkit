import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const cjsRequire = createRequire(import.meta.url);

// Inject a fake 'electron' module into require.cache BEFORE loading the SUT.
// Required because vi.mock cannot intercept CJS require() inside source modules.
const Module = cjsRequire('node:module');
const electronPath = cjsRequire.resolve('electron');

const invokeImpl = vi.fn();
const sendSyncImpl = vi.fn();
const ipcRenderer = {
    invoke: (...args) => invokeImpl(...args),
    sendSync: (...args) => sendSyncImpl(...args),
    on: vi.fn(),
};

const fakeElectronModule = new Module(electronPath);
fakeElectronModule.filename = electronPath;
fakeElectronModule.loaded = true;
fakeElectronModule.exports = { ipcRenderer };
cjsRequire.cache[electronPath] = fakeElectronModule;

const buildAppService = cjsRequire('../service.js');

const fakeSchema = [
    { namespace: 'test', handlers: ['ping', 'explode'] },
];

describe('preload service args serialization', () => {
    beforeEach(() => {
        invokeImpl.mockReset();
        sendSyncImpl.mockReset();
        // First sendSync call after buildAppService() is for service:getServiceList
        sendSyncImpl.mockImplementation((channel) => {
            if (channel === 'service:getServiceList') return fakeSchema;
            return undefined;
        });
    });

    it('async invoke args go through serialize', async () => {
        invokeImpl.mockResolvedValue('ok');
        const appService = buildAppService();
        await appService.test.ping({ fn: () => {}, ok: 1 });
        const [, ...safeArgs] = invokeImpl.mock.calls[0];
        expect(safeArgs[0].fn).toContain('[Function:');
        expect(safeArgs[0].ok).toBe(1);
    });

    it('sync sendSync args go through serialize', () => {
        sendSyncImpl.mockImplementation((channel) => {
            if (channel === 'service:getServiceList') return fakeSchema;
            return 'sync-ok';
        });
        const appService = buildAppService();
        appService.test.pingSync({ fn: () => {} });
        const lastCall = sendSyncImpl.mock.calls.at(-1);
        expect(lastCall[0]).toBe('test:pingSync');
        expect(lastCall[1].fn).toContain('[Function:');
    });

    it('async error from main is revived as Error instance', async () => {
        const remoteSerialized = { name: 'TypeError', message: 'boom', stack: 's' };
        const remoteErr = new Error(`Error invoking remote method 'test:explode': Error: ${JSON.stringify(remoteSerialized)}`);
        invokeImpl.mockRejectedValue(remoteErr);
        const appService = buildAppService();
        await expect(appService.test.explode()).rejects.toBeInstanceOf(Error);
        await expect(appService.test.explode()).rejects.toMatchObject({ name: 'TypeError', message: 'boom' });
    });

    it('async error without parseable payload propagates as-is', async () => {
        const raw = new Error('Network error');
        invokeImpl.mockRejectedValue(raw);
        const appService = buildAppService();
        await expect(appService.test.explode()).rejects.toThrow('Network error');
    });

    it('sync error envelope is revived to Error', () => {
        const appService = buildAppService();
        sendSyncImpl.mockImplementation((channel) => {
            if (channel === 'service:getServiceList') return fakeSchema;
            if (channel === 'test:explodeSync') return { __ipcError: true, name: 'Error', message: 'sync boom', stack: 's' };
            return undefined;
        });
        expect(() => appService.test.explodeSync()).toThrow('sync boom');
    });
});
