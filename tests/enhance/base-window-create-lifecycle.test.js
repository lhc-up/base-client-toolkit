import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { installElectronMock, reset, lastInstance, getCallLog } = require('./_electron-mock');
installElectronMock(vi);
const BaseWindow = require('../../src/enhance/BaseWindow');

describe('BaseWindow.create() lifecycle', () => {
    beforeEach(() => { reset(); });

    it('returns the BrowserWindow instance', () => {
        class W extends BaseWindow {
            getPageUrl() { return 'app://x.html'; }
        }
        const result = new W().create();
        expect(result).toBe(lastInstance());
    });

    it('sets this.browserWindow before calling onCreated', () => {
        let observedDuringHook = null;
        class W extends BaseWindow {
            getPageUrl() { return 'app://x.html'; }
            onCreated() {
                observedDuringHook = this.browserWindow;
            }
        }
        new W().create();
        expect(observedDuringHook).toBe(lastInstance());
    });

    it('registers a closed listener on the window', () => {
        class W extends BaseWindow {
            getPageUrl() { return 'app://x.html'; }
        }
        new W().create();
        const inst = lastInstance();
        expect(inst.on).toHaveBeenCalledWith('closed', expect.any(Function));
        expect(inst.listeners.get('closed')).toHaveLength(1);
    });

    it('calls onCreated with the BrowserWindow instance', () => {
        const onCreated = vi.fn();
        class W extends BaseWindow {
            getPageUrl() { return 'app://x.html'; }
            onCreated(win) { onCreated(win); }
        }
        new W().create();
        expect(onCreated).toHaveBeenCalledTimes(1);
        expect(onCreated).toHaveBeenCalledWith(lastInstance());
    });

    it('calls loadURL with the result of getPageUrl', () => {
        class W extends BaseWindow {
            getPageUrl() { return 'app://main.html'; }
        }
        new W().create();
        expect(lastInstance().loadURL).toHaveBeenCalledWith('app://main.html');
    });

    it('closed listener is wired BEFORE loadURL (mock call log)', () => {
        class W extends BaseWindow {
            getPageUrl() { return 'app://x.html'; }
        }
        new W().create();
        const log = getCallLog().filter(e => e.method === 'on' || e.method === 'loadURL');
        const onIdx = log.findIndex(e => e.method === 'on');
        const loadIdx = log.findIndex(e => e.method === 'loadURL');
        expect(onIdx).toBeLessThan(loadIdx);
    });

    it('on → loadURL via mock.invocationCallOrder', () => {
        class W extends BaseWindow {
            getPageUrl() { return 'app://x.html'; }
        }
        new W().create();
        const inst = lastInstance();
        const onOrder = inst.on.mock.invocationCallOrder[0];
        const loadOrder = inst.loadURL.mock.invocationCallOrder[0];
        expect(onOrder).toBeLessThan(loadOrder);
    });
});
