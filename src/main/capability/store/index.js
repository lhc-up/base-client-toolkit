/**
 * store capability：把 `libs/store` 的两类存储暴露给渲染端。
 *
 * **本文件刻意只有 schema，没有一行实现** —— 六个 handler 直接引用 `libs/store` 的
 * 同名函数（与 `capability/example` 的「一份实现，三种调用路径」同一约定）。
 * 存储机制、落点、文件名校验、二进制归一全在 `libs/store`，这里不重复也不包装。
 *
 * ## 两类存储，渲染端按数据特征选
 *
 * | | API | 适用 |
 * |---|---|---|
 * | 值存储 | `set` / `get` / `remove` | 小而结构化、整体读写；支持点路径嵌套 `a.b.c` |
 * | 文件存储 | `setFile` / `getFile` / `removeFile` | 大块、互不相关、独立读写；**只有它支持二进制** |
 *
 * ## `get` 同时注册在 sync 通道上
 *
 * `appService.store.getSync(key)` 同步返回值，`appService.store.get(key)` 仍是 Promise
 * （sync 是**新增别名**，不是替换）。开放同步读是因为 electron-store 的 `get` 本身同步，
 * 而「必须同步拿到值」是真实存在的消费场景 —— 典型的是宿主要向第三方插件/题包暴露
 * 同步存储 API，那类契约往往改不了。
 *
 * **但调用方要清楚代价**：`get` 每次都读 + 解析整份 `__store__.json`
 * （实测约 196 µs，随文件增大变慢），而 sync 通道上的这段 IO 发生在**主进程**、
 * 会阻塞所有窗口。所以**不要把大块数据放值存储、也不要高频 `getSync`**；
 * 真需要高频或大数据，用文件存储（异步）。
 *
 * ## 其余五个刻意不开 sync
 *
 * `set` / `remove` 的调用方通常不需要返回值，而 electron-store 的写入是同步落盘
 * （实测约 5.58 ms）；`setFile` / `getFile` / `removeFile` 本身就是异步文件 IO。
 * 把它们放上 sync 通道只会把更长的阻塞搬进主进程。
 *
 * ## 二进制跨 IPC 的注意事项（渲染端）
 *
 * `Blob` / `File` **不能跨 IPC** —— 它们是 Web API，经 structured clone 到主进程后
 * 变成 `{}` 空对象且**不报错**。渲染端要存 Blob，先 `await blob.arrayBuffer()` 转
 * `Uint8Array` 再传；`getFile` 回来的是字节（到渲染层即 `Uint8Array`），
 * 要 Blob 自己 `new Blob([bytes])`。
 */
const store = require('../../libs/store');

/** Service schema：六个 handler 与 `libs/store` 指向同一函数引用。 */
const serviceSchema = {
    namespace: 'store',
    handlers: {
        set: store.set,
        get: store.get,
        remove: store.remove,
        setFile: store.setFile,
        getFile: store.getFile,
        removeFile: store.removeFile,
    },
    // `get` 与 `getFile` 开同步别名，理由与代价见文件头
    sync: ['get', 'getFile'],
};

module.exports = {
    ...store,
    serviceSchema,
};
