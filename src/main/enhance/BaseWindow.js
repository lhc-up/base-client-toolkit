const { BrowserWindow } = require('electron');
const merge = require('lodash.merge');

/**
 * BrowserWindow 抽象基类。
 *
 * 模板方法模式：`create()` 是模板方法；子类实现 `getPageUrl()` 抽象方法，
 * 可选 override `getWindowOptions()` / `onCreated(window)` / `onClosed()`。
 * 实例方法（`getWindow` / `getId` / `close` / `isDestroyed` / `send`）
 * 不应被 override。
 *
 * @example
 * class MainWindow extends BaseWindow {
 *     getPageUrl() { return 'app://main.html'; }
 *     getWindowOptions() { return { width: 1200, height: 800 }; }
 *     onCreated(window) { window.once('ready-to-show', () => window.show()); }
 * }
 * const main = new MainWindow();
 * main.create();
 */
class BaseWindow {
    constructor() {
        /** @type {import('electron').BrowserWindow | null} */
        this.browserWindow = null;
    }

    // —— 抽象方法（必须 override） ——

    /**
     * 返回窗口加载的 URL。子类必须实现。
     * @returns {string}
     * @throws {Error} 未 override 时抛错
     */
    getPageUrl() {
        throw new Error('子类必须实现 getPageUrl()');
    }

    // —— 可选 override ——

    /**
     * 返回 BrowserWindow 构造 options。默认为 `{}`。
     * 与内置默认 `{ show: false, backgroundColor: '#ffffff' }` 深合并。
     * @returns {import('electron').BrowserWindowConstructorOptions}
     */
    getWindowOptions() {
        return {};
    }

    /**
     * 窗口创建后、loadURL 前触发。用户在此绑早期事件（如 did-start-loading）。
     * @param {import('electron').BrowserWindow} window 新创建的窗口
     */
    onCreated(/* window */) {
        // no-op
    }

    /**
     * 窗口关闭时触发，`this.browserWindow` 此时已置 null，
     * `this.isDestroyed()` 返回 true。
     */
    onClosed() {
        // no-op
    }

    // —— 模板方法 ——

    /**
     * 创建 BrowserWindow 并绑定生命周期。
     *
     * 流程：读子类 options → 深合并默认 → 构造 BrowserWindow → 绑 'closed' →
     * 触发 onCreated → loadURL。
     *
     * onCreated 严格早于 loadURL，保证用户绑的早期事件不因 loadURL 已触发而漏掉。
     *
     * @returns {import('electron').BrowserWindow}
     */
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

    /** @returns {import('electron').BrowserWindow | null} */
    getWindow() {
        return this.browserWindow;
    }

    /** @returns {number | undefined} 窗口 id；关闭后返回 undefined */
    getId() {
        return this.browserWindow ? this.browserWindow.id : undefined;
    }

    /** 关闭窗口；null 安全 */
    close() {
        if (this.browserWindow) this.browserWindow.close();
    }

    /** @returns {boolean} 窗口是否已销毁；null 视为已销毁 */
    isDestroyed() {
        if (!this.browserWindow) return true;
        return this.browserWindow.isDestroyed();
    }

    /**
     * escape hatch：直接经 webContents.send 发送。null 安全。
     *
     * 日常主→渲染推送请使用 Notice；本方法仅供 debug / 一次性私下沟通场景。
     *
     * @param {string} channel
     * @param {*} data
     */
    send(channel, data) {
        if (!this.browserWindow) return;
        this.browserWindow.webContents.send(channel, data);
    }
}

module.exports = BaseWindow;
