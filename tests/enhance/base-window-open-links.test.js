import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { installElectronMock, reset, lastInstance, getShellMock, getLoggerMock } = require('./_electron-mock');
installElectronMock(vi);
const BaseWindow = require('../../src/main/enhance/BaseWindow');

class W extends BaseWindow {
    getPageUrl() { return 'app://x.html'; }
}

function openWindow(url) {
    return lastInstance().webContents.windowOpenHandler({ url });
}

describe('BaseWindow.create() 新窗口处理', () => {
    beforeEach(() => { reset(); });

    it('http(s) 地址交给系统浏览器，不在客户端里新开窗口', () => {
        new W().create();
        expect(openWindow('https://example.com/a')).toEqual({ action: 'deny' });
        expect(openWindow('HTTP://example.com/b')).toEqual({ action: 'deny' });
        expect(getShellMock().openExternal.mock.calls).toEqual([
            ['https://example.com/a'],
            ['HTTP://example.com/b'],
        ]);
    });

    it('非 http(s) 地址忽略并记警告', () => {
        new W().create();
        expect(openWindow('file:///etc/passwd')).toEqual({ action: 'deny' });
        expect(openWindow('about:blank')).toEqual({ action: 'deny' });
        expect(getShellMock().openExternal).not.toHaveBeenCalled();
        expect(getLoggerMock().warn).toHaveBeenCalledTimes(2);
    });

    it('系统浏览器打开失败时记错误日志', async () => {
        getShellMock().openExternal.mockImplementation(() => Promise.reject(new Error('no browser')));
        new W().create();
        openWindow('https://example.com');
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(getLoggerMock().error).toHaveBeenCalledWith(
            '[窗口] 用系统浏览器打开链接失败',
            { url: 'https://example.com', error: 'no browser' },
        );
    });

    it('子类在 onCreated 中设置的处理覆盖默认处理', () => {
        const custom = () => ({ action: 'allow' });
        class Custom extends BaseWindow {
            getPageUrl() { return 'app://x.html'; }
            onCreated(window) { window.webContents.setWindowOpenHandler(custom); }
        }
        new Custom().create();
        expect(lastInstance().webContents.windowOpenHandler).toBe(custom);
    });
});
