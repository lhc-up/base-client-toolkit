/**
 * Service 模块私有协议：channel 命名。
 *
 * envelope 定义已上收到 shared/envelope（详见架构 §7.1 / §7.7），
 * 本文件只承载 Service 模块内部使用的 channel 命名规则。
 * M2 主端与 preload 直接 require shared/envelope。
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
