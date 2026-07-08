const os = require('os');
const { execSync } = require('child_process');

/**
 * 是否是windows系统
 * @returns {boolean}
 */
exports.isWindows = function isWindows() {
    return os.platform() === 'win32';
}

/**
 * 是否是linux系统或其发行版
 * @returns {boolean}
 */
exports.isLinux = function isLinux() {
    return os.platform() === 'linux';
}

/**
 * 是否是macOS系统
 * @returns {boolean}
 */
exports.isMacOS = function isMacOS() {
    return os.platform() === 'darwin';
}

/**
 * 是否是龙芯系统
 * @returns {boolean}
 */
exports.isLoongnix = function isLoongnix() {
    if (!exports.isLinux()) return false;
    try {
        const distributorId = execSync('lsb_release -i -s');
        return distributorId.toString().includes('Loongnix');
    } catch(err) {
        return false;
    }
}

/**
 * 获取linux内核
 * @returns {string}
 */
exports.linuxCore = function linuxCore() {
    if (!exports.isLinux()) return '';
    try {
        return execSync('uname -r');
    } catch(err) {
        return '';
    }
}

/**
 * 获取linux架构
 * @returns {string}
 */
exports.linuxArch = function linuxArch() {
    if (!exports.isLinux()) return '';
    try {
        return execSync('uname -m');
    } catch(err) {
        return '';
    }
}

/**
 * 获取linux内核
 * @returns {string}
 */
exports.lsbRelease = function lsbRelease() {
    if (!exports.isLinux()) return '';
    try {
        return execSync('lsb_release -i -s');
    } catch(err) {
        return '';
    }
}
