/**
 * 平台检测与系统信息工具（Windows / Linux / macOS / Loongnix 等）。
 */
const os = require('os');
const { execSync, spawn } = require('child_process');
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
 * 同步执行命令，返回去掉首尾空白（含末尾换行）的输出。
 * 失败时记日志并返回空串。
 *
 * @param {string} command
 * @returns {string}
 */
function run(command) {
    try {
        return execSync(command, { encoding: 'utf8' }).trim();
    } catch (err) {
        logger.error(err);
        return '';
    }
}

/**
 * 是否是龙芯系统（Loongnix）。
 * 每次调用都会同步执行一次 `lsb_release -i -s`；没有 `lsb_release` 的发行版上记一条 error 日志并返回 false。
 * @returns {boolean}
 */
exports.isLoongnix = function isLoongnix() {
    if (!exports.isLinux()) return false;
    return run('lsb_release -i -s').includes('Loongnix');
};

/**
 * 获取 linux 内核版本（`uname -r`，如 `5.10.0-8-amd64`）。非 Linux 或执行失败返回空串。
 * @returns {string}
 */
exports.linuxCore = function linuxCore() {
    if (!exports.isLinux()) return '';
    return run('uname -r');
};

/**
 * 获取 linux 架构（`uname -m`，如 `x86_64`、`aarch64`、`loongarch64`）。非 Linux 或执行失败返回空串。
 * @returns {string}
 */
exports.linuxArch = function linuxArch() {
    if (!exports.isLinux()) return '';
    return run('uname -m');
};

/**
 * 获取 linux 发行版名（`lsb_release -i -s`，如 `Ubuntu`、`Loongnix`，不含版本号）。非 Linux 或执行失败返回空串。
 * @returns {string}
 */
exports.lsbRelease = function lsbRelease() {
    if (!exports.isLinux()) return '';
    return run('lsb_release -i -s');
};

/**
 * 打开系统的「日期和时间」设置，供启动页在系统时间与服务器偏差过大时引导用户修改。
 *
 * 目前只支持 Windows：用 `rundll32` 打开 `timedate.cpl`（Win11 会转到「设置」的日期和时间页）。
 * 该进程在设置窗口关闭前不会退出，所以进程启动成功即视为已打开，不等它结束。
 * 其他平台返回 `{ opened: false, reason: 'unsupported-platform' }`，由页面提示用户手动修改。
 *
 * @returns {Promise<{opened: boolean, reason?: string}>}
 *   reason：`unsupported-platform` 当前平台不支持；`open-failed` 启动设置程序失败
 */
exports.openDateTimeSettings = function openDateTimeSettings() {
    if (!exports.isWindows()) {
        logger.warn('[os] 当前平台不支持打开时间设置', os.platform());
        return Promise.resolve({ opened: false, reason: 'unsupported-platform' });
    }
    return new Promise(resolve => {
        let child;
        try {
            // 不起 shell、参数以数组传入
            child = spawn('rundll32.exe', ['shell32.dll,Control_RunDLL', 'timedate.cpl'], {
                stdio: 'ignore',
            });
        } catch (err) {
            logger.error('[os] 打开时间设置失败', err);
            resolve({ opened: false, reason: 'open-failed' });
            return;
        }
        child.once('spawn', () => {
            child.unref();
            logger.info('[os] 已打开时间设置');
            resolve({ opened: true });
        });
        child.once('error', err => {
            logger.error('[os] 打开时间设置失败', err);
            resolve({ opened: false, reason: 'open-failed' });
        });
    });
};
