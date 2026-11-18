/**
 * env capability：运行环境信息（设备 / 系统标识、主屏分辨率），渲染层经 `appService.env.*` 获取。
 *
 * 宿主注册为通用能力；分辨率变化经 `env.displayMetricsChanged` 推送（宿主在 ready 后调 `init()` 开始监听）。
 */
const os = require('os');
const { screen } = require('electron');
const Notice = require('../../../notice/main');
const toolkitOs = require('../../libs/os');
const Logger = require('../../libs/logger');

// 默认最低分辨率，可由 init({ minWidth, minHeight }) 覆盖
let minWidth = 1280;
let minHeight = 720;

/**
 * 取本机 mac 地址串：遍历全部网卡，收集非空且不为 `00:00:00:00:00:00` 的 mac，逗号连接。
 * 失败时返回字符串 `'not get mac address'`（不抛），这是业务后端已有的取值约定。
 *
 * @returns {Promise<string>} 形如 `aa:bb:cc:dd:ee:ff,11:22:33:44:55:66`
 */
async function getMac() {
    try {
        const networkInterfaces = os.networkInterfaces();
        const networkList = [];
        for (const netName in networkInterfaces) {
            const itemArr = networkInterfaces[netName];
            if (!Array.isArray(itemArr)) continue;
            itemArr.forEach(item => {
                if (item.mac && item.mac !== '00:00:00:00:00:00') networkList.push(item.mac);
            });
        }
        return networkList.join(',');
    } catch (err) {
        Logger.error('获取mac地址失败', err);
        return 'not get mac address';
    }
}

/**
 * 取系统架构描述。只在 Linux 下有值，其余平台返回空串。
 *
 * @returns {Promise<string>} Linux 下形如 `x86_64,5.10.0,Ubuntu 20.04`；其余平台为 `''`
 */
async function getSystemDesc() {
    try {
        if (toolkitOs.isLinux()) {
            return `${toolkitOs.linuxArch()},${toolkitOs.linuxCore()},${toolkitOs.lsbRelease()}`;
        }
    } catch (err) {
        Logger.error('获取系统信息失败', err);
    }
    return '';
}

/**
 * 取本机内网 IP：第一个 IPv4 且非 internal 的网卡地址。
 * `net.family` 在部分 Node 版本下是数字 4，两种都判。
 *
 * @returns {Promise<string>} 取不到为 `''`
 */
async function getIp() {
    try {
        const nets = os.networkInterfaces();
        for (const name in nets) {
            const itemArr = nets[name];
            if (!Array.isArray(itemArr)) continue;
            for (const net of itemArr) {
                const isIPv4 = net.family === 'IPv4' || net.family === 4;
                if (isIPv4 && !net.internal && net.address) return net.address;
            }
        }
        return '';
    } catch (err) {
        Logger.error('获取IP失败', err);
        return '';
    }
}

function isBoundsValid(bounds) {
    return bounds.width >= minWidth && bounds.height >= minHeight;
}

/**
 * 主显示器分辨率是否达到最低要求（默认 1280×720）。
 *
 * @returns {Promise<boolean>}
 */
async function isScreenValid() {
    return isBoundsValid(screen.getPrimaryDisplay().bounds);
}

/**
 * 开始监听显示器参数变化，推送变化的那块显示器分辨率是否达标（`env.displayMetricsChanged`，载荷 `{ isValid }`）。
 * `screen` 模块要在 app ready 之后才能使用。
 *
 * @param {{ minWidth?: number, minHeight?: number }} [options] 最低分辨率
 */
function init(options = {}) {
    if (Number.isFinite(options.minWidth)) minWidth = options.minWidth;
    if (Number.isFinite(options.minHeight)) minHeight = options.minHeight;
    screen.on('display-metrics-changed', (event, display) => {
        Notice.broadcast('env.displayMetricsChanged', { isValid: isBoundsValid(display.bounds) });
    });
}

/**
 * `getMac` / `getSystemDesc` / `isScreenValid` 声明 `sync`：渲染层首屏前需要同步取值。
 */
const serviceSchema = {
    namespace: 'env',
    handlers: { getMac, getSystemDesc, getIp, isScreenValid },
    sync: ['getMac', 'getSystemDesc', 'isScreenValid'],
};

const noticeSchema = {
    namespace: 'env',
    events: ['displayMetricsChanged'],
};

module.exports = { getMac, getSystemDesc, getIp, isScreenValid, init, serviceSchema, noticeSchema };
