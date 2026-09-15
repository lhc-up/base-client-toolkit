import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { installElectronMock, reset } = require('./_electron-mock');
installElectronMock(vi);
const BaseWindow = require('../../src/main/enhance/BaseWindow');

describe('BaseWindow abstract contract', () => {
    beforeEach(() => { reset(); });

    it('default getPageUrl throws the documented message', () => {
        class W extends BaseWindow {}
        const w = new W();
        expect(() => w.getPageUrl()).toThrow('子类必须实现 getPageUrl()');
    });

    it('default getWindowOptions returns an empty object', () => {
        class W extends BaseWindow {
            getPageUrl() { return 'app://x.html'; }
        }
        expect(new W().getWindowOptions()).toEqual({});
    });

    it('default onCreated is a no-op (does not throw, returns undefined)', () => {
        class W extends BaseWindow {
            getPageUrl() { return 'app://x.html'; }
        }
        const w = new W();
        expect(w.onCreated({})).toBeUndefined();
    });

    it('default onClosed is a no-op (does not throw, returns undefined)', () => {
        class W extends BaseWindow {
            getPageUrl() { return 'app://x.html'; }
        }
        const w = new W();
        expect(w.onClosed()).toBeUndefined();
    });

    it('subclass override of getPageUrl is honored', () => {
        class W extends BaseWindow {
            getPageUrl() { return 'app://main.html'; }
        }
        expect(new W().getPageUrl()).toBe('app://main.html');
    });
});
