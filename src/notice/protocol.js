/**
 * Notice 模块私有协议：channel 命名。
 * envelope 定义已上收到 shared/envelope（详见架构 §7.1 / §7.7）。
 */

const EVENT_CHANNEL = 'notice:event';
const META_GET_SCHEMA_CHANNEL = 'notice:getSchema';

module.exports = {
    EVENT_CHANNEL,
    META_GET_SCHEMA_CHANNEL,
};
