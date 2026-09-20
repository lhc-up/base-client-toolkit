/**
 * capability 样例：示范 Service / Notice 契约的标准用法。
 *
 * 契约要点：
 * - 顶层导出方法供主进程直接调用；serviceSchema 供 Service.init 挂载（async + sync）；
 *   noticeSchema 供 Notice.init 挂载（事件命名空间）。
 * - echo 在顶层 export / serviceSchema.handlers.echo / sync: ['echo'] 三处指向同一函数引用：
 *   一份实现，三种调用路径。
 * - 真实 capability 允许在顶层完成运行时装配（如 log4js.configure、new Store）。
 * - 顶层不 require Service / Notice：只导出 schema 描述对象，是否挂载由业务侧决定。
 */
/**
 * 回显 message。
 * @param {*} message
 * @returns {*}
 */
const echo = message => message;

/** Service schema：暴露给渲染端。namespace 与 handler 名须为合法 JS 标识符。 */
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
