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
 * ## 同步实现的三个：只有 `get` 开 sync
 *
 * `set` / `get` / `remove` 是**同步函数**，handler 一执行就卡住主进程事件循环、
 * 所有窗口跟着卡；`set` / `remove` 的调用方通常也不需要返回值。因此只给 `get` 开 sync。

## 异步实现的两个：同样开 sync
 *
 * `setFile` / `removeFile` 是 `async` + 真实 IO，**await 期间主进程事件循环照常跑**，
 * 不存在"阻塞主进程"；被阻塞的只是发起调用的那个渲染进程，代价性质与上面不同。
 * 上游 `getFile` 同为异步实现且已开 sync，理由一致。
 *
 * 真实需求是「写了立刻读得到」：写走 `setFile`、读走 `getFileSync`，两者在主进程是
 * 互不串行的 async handler，纯异步写后立即读大概率读到旧值（`writeFile` 先 truncate
 * 再写），两次并发写也可能先发起的后落盘。sync 是**新增别名、不替换**：
 * 需要顺序语义时用 `setFileSync`，愿意并发时继续用 `setFile` —— 手段由 toolkit 提供，
 * 是否串行化由业务决定。
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
    // 同步别名：`get`（同步实现，代价见文件头）、`getFile` / `setFile` / `removeFile`（异步实现）
    sync: ['get', 'getFile', 'setFile', 'removeFile'],
};

module.exports = {
    ...store,
    serviceSchema,
};
