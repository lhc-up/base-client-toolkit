/**
 * 平台检测与系统信息工具（Windows / Linux / macOS / Loongnix 等）。
 */
const os = require('os');
const { execSync } = require('child_process');
const logger = require('./logger');

/**
 * 是否是 windows 系统
 * @returns {boolean}
 */
exports.isWindows = function isWindows() {
    return os.platform() === 'win32';
};

/**
 * 是否是 linux 系统或其发行版
 * @returns {boolean}
 */
exports.isLinux = function isLinux() {
    return os.platform() === 'linux';
};

/**
 * 是否是 macOS 系统
 * @returns {boolean}
 */
exports.isMacOS = function isMacOS() {
    return os.platform() === 'darwin';
};

/**
 * 是否是龙芯系统
 * @returns {boolean}
 */
exports.isLoongnix = function isLoongnix() {
    if (!exports.isLinux()) return false;
    try {
        const distributorId = execSync('lsb_release -i -s');
        return distributorId.toString().includes('Loongnix');
    } catch (err) {
        logger.error(err);
        return false;
    }
};

/**
 * 获取 linux 内核
 * @returns {string}
 */
exports.linuxCore = function linuxCore() {
    if (!exports.isLinux()) return '';
    try {
        return execSync('uname -r');
    } catch (err) {
        logger.error(err);
        return '';
    }
};

/**
 * 获取 linux 架构
 * @returns {string}
 */
exports.linuxArch = function linuxArch() {
    if (!exports.isLinux()) return '';
    try {
        return execSync('uname -m');
    } catch (err) {
        logger.error(err);
        return '';
    }
};

/**
 * 获取 linux 发行版
 * @returns {string}
 */
exports.lsbRelease = function lsbRelease() {
    if (!exports.isLinux()) return '';
    try {
        return execSync('lsb_release -i -s');
    } catch (err) {
        logger.error(err);
        return '';
    }
};
