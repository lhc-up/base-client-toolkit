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
}

module.exports = BaseWindow;
