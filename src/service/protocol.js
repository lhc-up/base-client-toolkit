/**
 * Service 模块私有协议：IPC channel 命名规则。
 * 应答信封形态见 shared/envelope。
 */

const META_LIST_CHANNEL = 'service:getServiceList';

/**
 * 序列化异常报告通道（preload → main，**单向 `send`、不等回复**）。
 *
 * 用途：`serializeForIpc` 在途中发现不可克隆的对象或超出深度时，把「哪个通道、第几个参数、
 * 字段路径、什么原因」报给主进程落盘。见 `src/service/preload.js` 的 `serializeArgs`。
 *
 * **载荷刻意不经 `serializeForIpc`** —— 全是原始 string / number，直接过
 * `ipcRenderer.send`。否则就是"序列化出问题时再走一次序列化"，有自激风险。
 */
const SERIALIZER_REPORT_CHANNEL = 'service:serializerReport';

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
    SERIALIZER_REPORT_CHANNEL,
    asyncChannel,
    syncChannel,
};
