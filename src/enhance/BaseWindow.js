const { BrowserWindow } = require('electron');
const merge = require('lodash.merge');

class BaseWindow {
    constructor() {
        this.browserWindow = null;
    }

    // —— 抽象方法（必须 override） ——

    getPageUrl() {
        throw new Error('子类必须实现 getPageUrl()');
    }

    // —— 可选 override ——

    getWindowOptions() {
        return {};
    }

    onCreated(/* window */) {
        // no-op
    }

    onClosed() {
        // no-op
    }

    // —— 模板方法 ——

    create() {
        const userOptions = this.getWindowOptions();
        const mergedOptions = merge(
            { show: false, backgroundColor: '#ffffff' },
            userOptions,
        );
        const window = new BrowserWindow(mergedOptions);
        this.browserWindow = window;

        window.on('closed', () => {
            this.browserWindow = null;
            this.onClosed();
        });

        this.onCreated(window);
        window.loadURL(this.getPageUrl());

        return window;
    }

    // —— 实例方法（不应 override） ——

    getWindow() {
        return this.browserWindow;
    }

    getId() {
        return this.browserWindow ? this.browserWindow.id : undefined;
    }

    close() {
        if (this.browserWindow) this.browserWindow.close();
    }

    isDestroyed() {
        if (!this.browserWindow) return true;
        return this.browserWindow.isDestroyed();
    }

    send(channel, data) {
        if (!this.browserWindow) return;
        this.browserWindow.webContents.send(channel, data);
    }
}

module.exports = BaseWindow;
