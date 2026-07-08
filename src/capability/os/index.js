const os = require('os');
const { execSync } = require('child_process');

let state = null;

function assertInitialized() {
    if (!state) {
        throw new Error('[toolkit/os] Os not initialized');
    }
}

/**
 * 上报错误。未注入 Logger 或 Logger 缺 error 方法时降级到 console.error。
 * 当前仅接线 error；将来 os 若需要 info/warn 等，按同模式加对应 report 函数。
 */
function reportError(err) {
    if (state.logger && typeof state.logger.error === 'function') {
        state.logger.error(err);
    } else {
        console.error(err);
    }
}

/**
 * @param {object} [opts]
 * @param {object} [opts.logger] 具备 error 方法（未来可能用到其他方法）的 logger 实例
 */
function init(opts = {}) {
    if (state) {
        throw new Error('[toolkit/os] Os already initialized');
    }
    state = {
        logger: opts.logger || null,
    };
}

/**
 * 是否是 Windows 系统
 * @returns {boolean}
 */
function isWindows() {
    assertInitialized();
    return os.platform() === 'win32';
}

/**
 * 是否是 Linux 系统或其发行版
 * @returns {boolean}
 */
function isLinux() {
    assertInitialized();
    return os.platform() === 'linux';
}

/**
 * 是否是 macOS 系统
 * @returns {boolean}
 */
function isMacOS() {
    assertInitialized();
    return os.platform() === 'darwin';
}

/**
 * 是否是龙芯系统
 * @returns {boolean}
 */
function isLoongnix() {
    assertInitialized();
    if (os.platform() !== 'linux') return false;
    try {
        const distributorId = execSync('lsb_release -i -s');
        return distributorId.toString().includes('Loongnix');
    } catch (err) {
        reportError(err);
        return false;
    }
}

/**
 * 获取 Linux 内核
 * @returns {string|Buffer}
 */
function linuxCore() {
    assertInitialized();
    if (os.platform() !== 'linux') return '';
    try {
        return execSync('uname -r');
    } catch (err) {
        reportError(err);
        return '';
    }
}

/**
 * 获取 Linux 架构
 * @returns {string|Buffer}
 */
function linuxArch() {
    assertInitialized();
    if (os.platform() !== 'linux') return '';
    try {
        return execSync('uname -m');
    } catch (err) {
        reportError(err);
        return '';
    }
}

/**
 * 获取 Linux 发行版
 * @returns {string|Buffer}
 */
function lsbRelease() {
    assertInitialized();
    if (os.platform() !== 'linux') return '';
    try {
        return execSync('lsb_release -i -s');
    } catch (err) {
        reportError(err);
        return '';
    }
}

module.exports = {
    init,
    isWindows,
    isLinux,
    isMacOS,
    isLoongnix,
    linuxCore,
    linuxArch,
    lsbRelease,
};
