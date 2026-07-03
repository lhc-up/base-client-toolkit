import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { installElectronMock, reset, lastInstance } = require('./_electron-mock');
installElectronMock(vi);
const BaseWindow = require('../../src/enhance/BaseWindow');

describe('BaseWindow.create() options merge', () => {
    beforeEach(() => { reset(); });

    it('passes defaults when subclass returns empty options', () => {
        class W extends BaseWindow {
            getPageUrl() { return 'app://x.html'; }
        }
        new W().create();
        expect(lastInstance().options).toEqual({
            show: false,
            backgroundColor: '#ffffff',
        });
    });

    it('merges user options on top of defaults', () => {
        class W extends BaseWindow {
            getPageUrl() { return 'app://x.html'; }
            getWindowOptions() {
                return { width: 1200, height: 800 };
            }
        }
        new W().create();
        expect(lastInstance().options).toEqual({
            show: false,
            backgroundColor: '#ffffff',
            width: 1200,
            height: 800,
        });
    });

    it('user can override show:false (defaults < userOptions)', () => {
        class W extends BaseWindow {
            getPageUrl() { return 'app://x.html'; }
            getWindowOptions() { return { show: true }; }
        }
        new W().create();
        expect(lastInstance().options.show).toBe(true);
    });

    it('user can override backgroundColor', () => {
        class W extends BaseWindow {
            getPageUrl() { return 'app://x.html'; }
            getWindowOptions() { return { backgroundColor: '#000000' }; }
        }
        new W().create();
        expect(lastInstance().options.backgroundColor).toBe('#000000');
    });

    it('deep-merges webPreferences (does NOT clobber)', () => {
        class W extends BaseWindow {
            getPageUrl() { return 'app://x.html'; }
            getWindowOptions() {
                return {
                    webPreferences: {
                        preload: '/abs/preload.js',
                        contextIsolation: true,
                    },
                };
            }
        }
        new W().create();
        expect(lastInstance().options.webPreferences).toEqual({
            preload: '/abs/preload.js',
            contextIsolation: true,
        });
    });

    it('does NOT inject any webPreferences defaults', () => {
        class W extends BaseWindow {
            getPageUrl() { return 'app://x.html'; }
        }
        new W().create();
        expect(lastInstance().options.webPreferences).toBeUndefined();
    });
});
