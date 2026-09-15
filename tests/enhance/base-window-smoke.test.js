import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { installElectronMock, reset, lastInstance } = require('./_electron-mock');
installElectronMock(vi);
const BaseWindow = require('../../src/main/enhance/BaseWindow');

describe('BaseWindow end-to-end subclass smoke', () => {
    beforeEach(() => { reset(); });

    it('full subclass usage pattern from spec §2.1 / §2.2', () => {
        const created = vi.fn();
        const closed = vi.fn();

        class MainWindow extends BaseWindow {
            getPageUrl() { return 'app://main.html'; }
            getWindowOptions() {
                return {
                    width: 1200,
                    height: 800,
                    webPreferences: { preload: '/abs/preload.js' },
                };
            }
            onCreated(window) { created(window); }
            onClosed() { closed(); }
        }

        const main = new MainWindow();
        const window = main.create();

        expect(window).toBe(lastInstance());

        expect(window.options).toMatchObject({
            show: false,
            backgroundColor: '#ffffff',
            width: 1200,
            height: 800,
            webPreferences: { preload: '/abs/preload.js' },
        });

        expect(created).toHaveBeenCalledWith(window);
        expect(window.loadURL).toHaveBeenCalledWith('app://main.html');

        expect(main.getId()).toBe(window.id);
        expect(main.getWindow()).toBe(window);
        expect(main.isDestroyed()).toBe(false);

        main.send('foo', { v: 1 });
        expect(window.webContents.send).toHaveBeenCalledWith('foo', { v: 1 });

        main.close();
        expect(window.close).toHaveBeenCalled();

        window._emit('closed');
        expect(closed).toHaveBeenCalled();
        expect(main.getWindow()).toBe(null);
        expect(main.getId()).toBeUndefined();
        expect(main.isDestroyed()).toBe(true);
    });

    it('module default export is the BaseWindow class', () => {
        expect(typeof BaseWindow).toBe('function');
        expect(BaseWindow.name).toBe('BaseWindow');
    });
});
