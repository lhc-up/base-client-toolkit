const fs = require('fs');
const { BrowserWindow } = require('electron');
const merge = require('lodash.merge');
const Logger = require('../libs/logger');
const { resolveResource } = require('../libs/resourceRoot');
const { APP_ICON_FILE } = require('../frameContract');

/** 加载被新的跳转打断，不是失败 */
const ERR_ABORTED = -3;

/**
 * 主页面加载失败、渲染进程退出时写错误日志。子 frame（如交互题 iframe）不记，免得刷屏。
 *
 * @param {import('electron').BrowserWindow} window
 */
function logLoadFailures(window) {
    window.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame || errorCode === ERR_ABORTED) {
            return;
        }
        Logger.error('[窗口] 页面加载失败', { errorCode, errorDescription, url: validatedURL });
    });
    window.webContents.on('render-process-gone', (event, details) => {
        Logger.error('[窗口] 渲染进程退出', { reason: details.reason, exitCode: details.exitCode });
    });
}

/**
 * Linux 下的默认窗口图标：资源根目录下的应用图标（frame 打包时从 `build/icon.png` 复制）。
 * 窗口直接设 icon，任务栏、Alt+Tab 不依赖 `.desktop` 的 `StartupWMClass` 能否关联上。
 * 其他平台用可执行文件自带的图标；文件不存在（如本地调试）时不设。
 *
 * @returns {{ icon?: string }}
 */
function defaultIconOptions() {
    if (process.platform !== 'linux') {
        return {};
    }
    const iconPath = resolveResource(APP_ICON_FILE);
    if (!iconPath || !fs.existsSync(iconPath)) {
        return {};
    }
    return { icon: iconPath };
}

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
     * 与内置默认 `{ show: false, backgroundColor: '#ffffff' }` 深合并；Linux 下内置默认还有 `icon`（资源根目录下的
     * `app-icon.png`，存在时）。
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
     * 触发 onCreated → 绑加载失败 / 渲染进程退出的日志 → loadURL。
     *
     * onCreated 严格早于 loadURL，保证用户绑的早期事件不因 loadURL 已触发而漏掉。
     *
     * 主页面加载失败时窗口照样 ready-to-show，但只有白屏；`loadURL` 的 reject 不接住时
     * Electron 只往 stderr 打一行警告，不触发 unhandledRejection（Electron 22 实测），
     * 日志里什么都没有。因此在这里统一记日志，不通知页面（失败的正是这个页面）。
     *
     * @returns {import('electron').BrowserWindow}
     */
    create() {
        const userOptions = this.getWindowOptions();
        const mergedOptions = merge(
            { show: false, backgroundColor: '#ffffff', ...defaultIconOptions() },
            userOptions,
        );
        const window = new BrowserWindow(mergedOptions);
        this.browserWindow = window;

        window.on('closed', () => {
            this.browserWindow = null;
            this.onClosed();
        });

        this.onCreated(window);
        logLoadFailures(window);
        window.loadURL(this.getPageUrl()).catch(() => {
            // 失败已由 did-fail-load 记录，这里不再处理（Electron 仍会往 stderr 打一行 Failed to load URL）
        });

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
