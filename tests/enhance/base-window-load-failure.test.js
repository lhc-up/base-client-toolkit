import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const {
    installElectronMock,
    reset,
    lastInstance,
    getCallLog,
    setLoadResult,
    getLoggerMock,
} = require('./_electron-mock');
installElectronMock(vi);
const BaseWindow = require('../../src/main/enhance/BaseWindow');

class W extends BaseWindow {
    getPageUrl() { return 'file:///app/renderer/index.html'; }
}

describe('BaseWindow.create()：页面加载失败与渲染进程退出写日志', () => {
    beforeEach(() => { reset(); });

    it('在 onCreated 之后、loadURL 之前绑定 did-fail-load 与 render-process-gone', () => {
        new W().create();
        const methods = getCallLog().map(c => `${c.method}${c.args[0] && typeof c.args[0] === 'string' ? ':' + c.args[0] : ''}`);
        const failIndex = methods.indexOf('webContents.on:did-fail-load');
        const goneIndex = methods.indexOf('webContents.on:render-process-gone');
        const loadIndex = methods.findIndex(m => m.startsWith('loadURL'));
        expect(failIndex).toBeGreaterThan(-1);
        expect(goneIndex).toBeGreaterThan(-1);
        expect(failIndex).toBeLessThan(loadIndex);
        expect(goneIndex).toBeLessThan(loadIndex);
    });

    it('主页面加载失败：写错误日志，带错误码、原因与地址', () => {
        new W().create();
        lastInstance().webContents._emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'file:///app/renderer/index.html', true);
        expect(getLoggerMock().error).toHaveBeenCalledTimes(1);
        expect(getLoggerMock().error).toHaveBeenCalledWith('[窗口] 页面加载失败', {
            errorCode: -6,
            errorDescription: 'ERR_FILE_NOT_FOUND',
            url: 'file:///app/renderer/index.html',
        });
    });

    it('子 frame 加载失败、加载被跳转打断（-3 ERR_ABORTED）：不记', () => {
        new W().create();
        const wc = lastInstance().webContents;
        wc._emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'iframe-resource://pkg-1/index.html', false);
        wc._emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'file:///app/renderer/index.html', true);
        expect(getLoggerMock().error).not.toHaveBeenCalled();
    });

    it('渲染进程退出：写错误日志，带原因与退出码', () => {
        new W().create();
        lastInstance().webContents._emit('render-process-gone', {}, { reason: 'crashed', exitCode: 3 });
        expect(getLoggerMock().error).toHaveBeenCalledWith('[窗口] 渲染进程退出', { reason: 'crashed', exitCode: 3 });
    });

    it('loadURL 失败不产生未处理的 Promise 拒绝', async () => {
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);
        try {
            setLoadResult(() => Promise.reject(new Error('ERR_FILE_NOT_FOUND (-6)')));
            new W().create();
            await new Promise(resolve => setTimeout(resolve, 20));
            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            process.off('unhandledRejection', unhandled);
        }
    });
});
