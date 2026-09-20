/**
 * Service 模块私有协议：IPC channel 命名规则。
 * 应答信封形态见 shared/envelope。
 */

const META_LIST_CHANNEL = 'service:getServiceList';

/**
 * 异步通道名。
 * @param {string} ns
 * @param {string} name
 * @returns {string}
 */
const asyncChannel = (ns, name) => `${ns}:${name}`;

/**
 * 同步通道名（在 async 通道名后附 "Sync"）。
 * @param {string} ns
 * @param {string} name
 * @returns {string}
 */
const syncChannel  = (ns, name) => `${ns}:${name}Sync`;

module.exports = {
    META_LIST_CHANNEL,
    asyncChannel,
    syncChannel,
};
