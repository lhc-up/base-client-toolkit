import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { installElectronMock, reset, lastInstance } = require('./_electron-mock');
installElectronMock(vi);
const BaseWindow = require('../../src/main/enhance/BaseWindow');

describe('onClosed hook', () => {
    beforeEach(() => { reset(); });

    it('is called when BrowserWindow fires closed', () => {
        const onClosed = vi.fn();
        class W extends BaseWindow {
            getPageUrl() { return 'app://x.html'; }
            onClosed() { onClosed(); }
        }
        const w = new W();
        w.create();
        lastInstance()._emit('closed');
        expect(onClosed).toHaveBeenCalledTimes(1);
    });

    it('sees this.browserWindow as null when invoked', () => {
        let observed = 'not-set';
        class W extends BaseWindow {
            getPageUrl() { return 'app://x.html'; }
            onClosed() { observed = this.browserWindow; }
        }
        const w = new W();
        w.create();
        lastInstance()._emit('closed');
        expect(observed).toBe(null);
    });

    it('isDestroyed() inside onClosed returns true', () => {
        let observed = null;
        class W extends BaseWindow {
            getPageUrl() { return 'app://x.html'; }
            onClosed() { observed = this.isDestroyed(); }
        }
        const w = new W();
        w.create();
        lastInstance()._emit('closed');
        expect(observed).toBe(true);
    });

    it('default no-op runs when subclass does not override', () => {
        class W extends BaseWindow {
            getPageUrl() { return 'app://x.html'; }
        }
        const w = new W();
        w.create();
        expect(() => lastInstance()._emit('closed')).not.toThrow();
        expect(w.getWindow()).toBe(null);
    });

    it('multiple closed events: hook fires per event (spec: no double-protection)', () => {
        const onClosed = vi.fn();
        class W extends BaseWindow {
            getPageUrl() { return 'app://x.html'; }
            onClosed() { onClosed(); }
        }
        const w = new W();
        w.create();
        const inst = lastInstance();
        inst._emit('closed');
        inst._emit('closed');
        expect(onClosed).toHaveBeenCalledTimes(2);
        expect(w.getWindow()).toBe(null);
    });
});
