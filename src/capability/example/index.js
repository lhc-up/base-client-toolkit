// 参考 capability 模块：示范 M5 契约
// - 顶层 echo 方法（主端直接调用）
// - serviceSchema：供 M2 Service.init 挂载，暴露给渲染端 async + sync
// - noticeSchema：供 M3 Notice.init 挂载，定义事件名空间
//
// echo 在三处出现（顶层 export / serviceSchema.handlers.echo / sync: ['echo']），
// 三处指向同一份函数引用 —— 一份实现，三种调用路径。

const echo = message => message;

const serviceSchema = {
    namespace: 'example',
    handlers: {
        echo,
    },
    sync: ['echo'],
};

const noticeSchema = {
    namespace: 'example',
    events: ['tick'],
};

module.exports = {
    echo,
    serviceSchema,
    noticeSchema,
};
