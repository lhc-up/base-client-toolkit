const { BrowserWindow } = require('electron');
const path = require('path');
const merge = require('lodash.merge');
// const preloadPath = require('../preload/index.js');

class BaseWindow {
    constructor(options = {}) {
        this.options = options;
        this.browserWindow = null;
    }

    // ==================== 抽象方法（子类必须实现） ====================
    getPageUrl() {
        throw new Error('子类必须实现 getPageUrl()');
    }

    getWindowOptions() {
        return {};
    }

    // ==================== 可覆盖的钩子 ====================
    onBeforeCreate(options) {
        return options;
    }

    onCreated(window) {}

    onClosed() {}

    // ==================== 模板方法 ====================
    create() {
        const window = this._createWindow();
        this.browserWindow = window;
        this._setupEventListeners(window);
        this.onCreated(window);
        return window;
    }

    _createWindow() {
        const userOptions = this.getWindowOptions();
        const mergedOptions = merge(
            {
                show: true,
                frame: true,
                backgroundColor: '#ffffff',
                allowRunningInsecureContent: true,
                webPreferences: {
                    // preload: preloadPath,
                    contextIsolation: true,
                    nodeIntegration: true
                }
            },
            userOptions
        );
        this.onBeforeCreate(mergedOptions);

        const window = new BrowserWindow(mergedOptions);
        window.loadURL(this.getPageUrl());
        
        this.onCreated(window);
        return window;
    }

    _setupEventListeners(window) {
        window.on('closed', () => {
            this.browserWindow = null;
            this.onClosed();
        });
    }

    // ==================== 实例方法 ====================
    center() {
        this.browserWindow?.center();
    }

    show() {
        this.browserWindow?.show();
    }

    hide() {
        this.browserWindow?.hide();
    }

    close() {
        this.browserWindow?.close();
    }

    getId() {
        return this.browserWindow?.id;
    }

    getWebContents() {
        return this.browserWindow?.webContents;
    }

    send(channel, data) {
        this.browserWindow?.webContents.send(channel, data);
    }

    isDestroyed() {
        return this.browserWindow?.isDestroyed() ?? true;
    }
}

module.exports = BaseWindow;
