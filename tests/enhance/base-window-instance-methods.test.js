import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { installElectronMock, reset, lastInstance } = require('./_electron-mock');
installElectronMock(vi);
const BaseWindow = require('../../src/enhance/BaseWindow');

class Win extends BaseWindow {
    getPageUrl() { return 'app://x.html'; }
}

describe('BaseWindow instance methods — live window', () => {
    beforeEach(() => { reset(); });

    it('getWindow returns the BrowserWindow after create', () => {
        const w = new Win();
        w.create();
        expect(w.getWindow()).toBe(lastInstance());
    });

    it('getId returns the BrowserWindow id after create', () => {
        const w = new Win();
        w.create();
        expect(w.getId()).toBe(lastInstance().id);
        expect(typeof w.getId()).toBe('number');
    });

    it('close calls BrowserWindow.close()', () => {
        const w = new Win();
        w.create();
        w.close();
        expect(lastInstance().close).toHaveBeenCalledTimes(1);
    });

    it('isDestroyed reflects BrowserWindow.isDestroyed when alive', () => {
        const w = new Win();
        w.create();
        expect(w.isDestroyed()).toBe(false);
    });

    it('send calls webContents.send with channel + data', () => {
        const w = new Win();
        w.create();
        w.send('foo', { x: 1 });
        expect(lastInstance().webContents.send)
            .toHaveBeenCalledWith('foo', { x: 1 });
    });
});

describe('BaseWindow instance methods — never created', () => {
    beforeEach(() => { reset(); });

    it('getWindow returns null before create', () => {
        expect(new Win().getWindow()).toBe(null);
    });

    it('getId returns undefined before create', () => {
        expect(new Win().getId()).toBeUndefined();
    });

    it('close is a safe no-op before create', () => {
        expect(() => new Win().close()).not.toThrow();
    });

    it('isDestroyed returns true before create (null treated as destroyed)', () => {
        expect(new Win().isDestroyed()).toBe(true);
    });

    it('send is a safe no-op before create', () => {
        expect(() => new Win().send('foo', { x: 1 })).not.toThrow();
    });
});

describe('BaseWindow instance methods — after closed event', () => {
    beforeEach(() => { reset(); });

    function freshClosed() {
        const w = new Win();
        w.create();
        const inst = lastInstance();
        inst._emit('closed');
        return { w, inst };
    }

    it('getWindow returns null after closed', () => {
        const { w } = freshClosed();
        expect(w.getWindow()).toBe(null);
    });

    it('getId returns undefined after closed', () => {
        const { w } = freshClosed();
        expect(w.getId()).toBeUndefined();
    });

    it('isDestroyed returns true after closed', () => {
        const { w } = freshClosed();
        expect(w.isDestroyed()).toBe(true);
    });

    it('close is a safe no-op after closed', () => {
        const { w } = freshClosed();
        expect(() => w.close()).not.toThrow();
    });

    it('send is a safe no-op after closed', () => {
        const { w } = freshClosed();
        expect(() => w.send('foo', { x: 1 })).not.toThrow();
    });
});
