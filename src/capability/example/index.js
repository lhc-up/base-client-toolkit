/**
 * 参考 capability 模块：示范 M5 契约（详见架构 §4 / M5 spec）。
 *
 * 契约要点：
 * - 顶层导出 echo 方法（主端可直接调用）
 * - serviceSchema：供 Service.init 挂载，暴露给渲染端 async + sync
 * - noticeSchema：供 Notice.init 挂载，定义事件命名空间
 * - echo 在三处出现（顶层 export / serviceSchema.handlers.echo / sync: ['echo']），
 *   三处指向同一份函数引用 —— 一份实现，三种调用路径。
 * - 零副作用：require 该模块只产生上述对象，不触发任何 IPC 注册 / IO（架构 §3.1）
 * - 零依赖 Service / Notice：capability 只导出描述对象，是否真注册由用户 init 时决定
 */

/**
 * 回显 message。用于示范 M2 Service handler 形态。
 * @param {*} message
 * @returns {*}
 */
const echo = message => message;

/** Service schema：暴露给渲染端。命名遵循架构 §7.4 合法 JS 标识符规则。 */
const serviceSchema = {
    namespace: 'example',
    handlers: {
        echo,
    },
    sync: ['echo'],
};

/** Notice schema：定义事件命名空间。 */
const noticeSchema = {
    namespace: 'example',
    events: ['tick'],
};

module.exports = {
    echo,
    serviceSchema,
    noticeSchema,
};
