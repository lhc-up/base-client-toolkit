/**
 * Notice 模块私有协议：IPC channel 命名规则。
 *
 * EVENT_CHANNEL 载荷契约（webContents.send / ipcRenderer.on 参数）：
 *   (channel, fullEventName, argsArray)
 *   - fullEventName: `${namespace}.${eventName}`
 *   - argsArray: 已经 serializeForIpc 编码的参数数组（可能为空数组）；渲染端 dispatcher cb(...argsArray) 展开
 *
 * META_GET_SCHEMA_CHANNEL 为同步元通道，返回已注册的 namespace 与 event 列表（envelope 包装）。
 */

const EVENT_CHANNEL = 'notice:event';
const META_GET_SCHEMA_CHANNEL = 'notice:getSchema';

module.exports = {
    EVENT_CHANNEL,
    META_GET_SCHEMA_CHANNEL,
};
