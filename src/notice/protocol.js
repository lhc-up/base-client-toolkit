/**
 * Notice 模块私有协议：channel 命名。
 * envelope 定义已上收到 shared/envelope（详见架构 §7.1 / §7.7）。
 *
 * EVENT_CHANNEL 载荷契约（webContents.send / ipcRenderer.on 参数）：
 *   (channel, fullEventName, argsArray)
 *   - fullEventName: `${namespace}.${eventName}`
 *   - argsArray: 已经 serializeForIpc 编码的参数数组（可能为空数组）；渲染端 dispatcher cb(...argsArray) 展开
 *
 * META_GET_SCHEMA_CHANNEL 载荷契约详见 M3 spec §3.3。
 */

const EVENT_CHANNEL = 'notice:event';
const META_GET_SCHEMA_CHANNEL = 'notice:getSchema';

module.exports = {
    EVENT_CHANNEL,
    META_GET_SCHEMA_CHANNEL,
};
