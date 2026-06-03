# Toolkit M2：Service 模块详细设计

> 所属：[Toolkit 总设计](./2026-06-03-toolkit-overview-design.md) 的 M2 模块。

## 一、定位

M2 Service 是 toolkit 的 **IPC 双向调用桥接机制**。它定义 渲染→主 调用的 IPC 协议和注册机制，让用户用声明式 schema 描述要暴露的 handler，无需手写 `ipcMain.handle` / `ipcRenderer.invoke`。

M2 是**纯机制层**：

- 不持有任何业务逻辑——不带内置 schema，所有 handler 由用户挂载
- 不依赖任何 capability / enhance 模块——反向解耦
- 不向用户运行时代码注入全局状态——主端经 `init` 显式挂载、preload 经聚合入口显式 expose、渲染端 `window.appService` 仅是 `contextBridge` 暴露的纯数据接口
- 唯一同向依赖：M1 `shared/serializer`（用于 IPC 编码/反编码 + 错误还原）

## 二、用户接触面

### 2.1 主端：定义 schema 并 init

```js
const Service = require('@base-client/toolkit/service');

const fooSchema = {
    namespace: 'foo',
    handlers: {
        bar(arg1, arg2)     { return arg1 + arg2; },
        baz(content, event) { /* 用 event.sender 等 */ return 'ok'; },
        log(...messages)    { console.log(...messages); },
    },
    sync:       ['log'],     // 可选；声明哪些 handler 同时支持 sync 调用
    needsEvent: ['baz'],     // 可选；声明哪些 handler 接收 event 作为末参
};

Service.init({ userSchemas: [fooSchema /* , ... */] });
```

**约定**：

- 默认情况下 handler 签名仅为 `(...callerArgs)`——Service 调用时不注入任何 IPC 参数，**rest-params 安全可用**（如 `log(...messages)`）。
- handler 名位列 schema 的 `needsEvent` 列表时，Service 调用形态变为 `handler(...callerArgs, event)`——`event` 是 Electron 的 `IpcMainInvokeEvent`，位于参数末位。
- handler 名位列 `sync` 列表时**可以是同步或异步函数**——Service 会 `await` 异步 handler 再写 `returnValue`。但 **sync 通道会阻塞渲染进程直到响应返回**，handler 若 `await` 长耗时操作，渲染端会冻结相应时长。仅在能保证快速返回的场景使用 sync 通道。
- **`rest-params` + `needsEvent`** 同用为**未支持组合**（event 会卷入 rest 中），需要 event 的 handler 应使用具名参数。
- 同一 namespace 在所有挂载的 schema 中**全局唯一**，冲突时 `init` 抛错。

### 2.2 Preload：经聚合入口暴露

```js
// 用户 preload 文件
require('@base-client/toolkit/preload').init();
```

聚合入口 `src/preload.js` 内部 `require` `service/preload` 子模块，构建并经 `contextBridge.exposeInMainWorld` 暴露 `window.appService`。

### 2.3 渲染端：动态生成的 `appService` API

```js
// 异步调用（所有 handler 都有 async 通道）
const result = await window.appService.foo.bar(1, 2);     // 3

// 同步调用（仅 schema 中位列 sync 的 handler）
window.appService.foo.logSync('hello', 'world');           // 同步阻塞

// 主端 handler 抛错 → 渲染端 await throw 还原后的 Error
try {
    await window.appService.foo.bar(...);
} catch (err) {
    console.error(err.message, err.stack);
}
```

**约定**：

- 异步通道 → 渲染端 `appService[ns][name](...)` 返回 Promise。
- 同步通道 → 渲染端 `appService[ns][nameSync](...)` 直接返回值（阻塞渲染进程，仅在不可异步场景使用）。
- 主端错误经统一信封传到渲染端，由 `reviveError` 还原成 Error 实例后 throw。
- 渲染端传入的所有参数会经 `serialize` 编码后再过 IPC，业务侧无需关心可克隆性。

### 2.4 关停

```js
Service.cleanup();
```

清空所有已注册的 IPC handler 与 listener。typically 在 Electron `app` 退出回调中调用，正常运行不需要。

## 三、Protocol

### 3.1 channel 命名

| Channel | 类型 | 用途 |
|---|---|---|
| `{namespace}:{handler}` | `ipcMain.handle` async | 异步调用 |
| `{namespace}:{handler}Sync` | `ipcMain.on` sync | 同步调用（仅 schema `sync` 列表声明的 handler 有） |
| `service:getServiceList` | `ipcMain.on` sync | 元通道：preload 加载时取 schema 列表 |

### 3.2 统一信封

所有上述通道的响应数据使用同一信封：

```js
{ ok: true,  data:  <serialize(value)> }       // 成功
{ ok: false, error: <serialize(error)> }       // 失败
```

主端 ipcMain.handle 的回调**永不 reject/throw**——所有错误都包成 `{ok: false, error}` 返回。这避免触发 Electron 内置错误包装（`Error invoking remote method ...`），保证 preload 端解析路径只有一种形态。

`data` / `error` 字段均经 M1 `shared/serializer` 编码，保证 IPC 安全。

### 3.3 元通道 `service:getServiceList`

返回数据形状（位于 `data` 字段内）：

```js
[
    {
        namespace: 'foo',
        handlers:  ['bar', 'baz', 'log'],
        sync:      ['log'],         // 该 namespace 下哪些 handler 同时支持 sync
    },
    ...
]
```

preload 端据此动态构建 `appService`：每个 handler 生成 async 方法；位列 `sync` 的额外生成 `{name}Sync` 方法。

**调用时机约定**：preload 加载时调一次即可；运行期再调合法但无意义（schema 静态，结果不变）。

**注**：`needsEvent` **不进**元通道返回——它是主端调用形态决定项，preload 端无须知晓。

## 四、主端流程

### 4.1 `init`

```js
Service.init({ userSchemas: [schema1, schema2, ...] })
```

步骤：

1. 校验 `userSchemas` 是数组（否则抛错）。
2. 遍历挂载：对每个 schema 调用内部 `registerService(schema)`。
3. 注册元通道 `service:getServiceList`。

### 4.2 内部 `registerService`（不对外）

对单个 schema：

1. **校验 namespace**：与已注册命名空间冲突 → 抛 `Service namespace "${ns}" 冲突`。
2. **校验 `sync` 列表**：每项必须存在于 `handlers` 键名内，否则抛错。
3. **校验 `needsEvent` 列表**：同上。
4. **遍历 handler name**：
   - **注册异步通道** `ipcMain.handle(asyncChannel(ns, name), ...)`：
     ```js
     async (event, ...args) => {
         try {
             const fn = handlers[name];
             const result = needsEvent.includes(name)
                 ? await fn(...args, event)
                 : await fn(...args);
             return okEnvelope(serialize(result, { strict: false }));
         } catch (err) {
             return errorEnvelope(serialize(err, { strict: false }));
         }
     }
     ```
     **永不 throw**——所有错误装信封返回。
   - **若 name 在 `sync`**：额外注册 `ipcMain.on(syncChannel(ns, name), ...)`：
     ```js
     async (event, ...args) => {
         try {
             const fn = handlers[name];
             const result = await (
                 needsEvent.includes(name) ? fn(...args, event) : fn(...args)
             );
             event.returnValue = okEnvelope(serialize(result, { strict: false }));
         } catch (err) {
             event.returnValue = errorEnvelope(serialize(err, { strict: false }));
         }
     }
     ```
     handler 可为同步或异步函数；异步 handler 会被 `await` 后写 `returnValue`，期间渲染端持续阻塞（见 2.1 约定）。
5. 记入内部 `registeredSchemas: Map<namespace, schema>`。

### 4.3 元通道实现

```js
ipcMain.on(META_LIST_CHANNEL, event => {
    const list = [...registeredSchemas.values()].map(s => ({
        namespace: s.namespace,
        handlers:  Object.keys(s.handlers),
        sync:      s.sync || [],
    }));
    event.returnValue = okEnvelope(serialize(list, { strict: false }));
});
```

### 4.4 `cleanup`

```js
Service.cleanup()
```

1. `ipcMain.removeAllListeners(META_LIST_CHANNEL)`。
2. 遍历 `registeredSchemas`：
   - 每个 handler `ipcMain.removeHandler(asyncChannel(ns, name))`。
   - 每个 sync 项 `ipcMain.removeAllListeners(syncChannel(ns, name))`。
3. `registeredSchemas.clear()`。

## 五、Preload 流程

### 5.1 入口

`service/preload.js` 导出 `buildAppService()` 工厂：

```js
module.exports = function buildAppService() { /* returns appService */ };
```

由聚合入口 `src/preload.js` 引用，经 `contextBridge.exposeInMainWorld('appService', buildAppService())` 暴露给渲染端。`service/preload.js` 自身**不**自动 init、**不**调用 contextBridge。

### 5.2 `buildAppService` 流程

```js
function buildAppService() {
    const envelope = ipcRenderer.sendSync(META_LIST_CHANNEL);
    if (!envelope.ok) throw reviveError(envelope.error);
    const schemaList = envelope.data;

    const appService = {};
    for (const { namespace, handlers, sync } of schemaList) {
        appService[namespace] = {};
        for (const name of handlers) {
            appService[namespace][name] = buildAsyncCaller(namespace, name);
        }
        for (const name of sync) {
            appService[namespace][`${name}Sync`] = buildSyncCaller(namespace, name);
        }
    }
    return appService;
}
```

### 5.3 异步调用包装

```js
function buildAsyncCaller(ns, name) {
    return async (...args) => {
        const safeArgs = args.map(a => serialize(a, { strict: false }));
        const envelope = await ipcRenderer.invoke(asyncChannel(ns, name), ...safeArgs);
        if (envelope.ok) return envelope.data;
        throw reviveError(envelope.error);
    };
}
```

### 5.4 同步调用包装

```js
function buildSyncCaller(ns, name) {
    return (...args) => {
        const safeArgs = args.map(a => serialize(a, { strict: false }));
        const envelope = ipcRenderer.sendSync(syncChannel(ns, name), ...safeArgs);
        if (envelope.ok) return envelope.data;
        throw reviveError(envelope.error);
    };
}
```

### 5.5 渲染端参数序列化

调用方传入的 args 在 IPC 之前经 `serialize` 编码，与主端 handler 返回值的序列化构成 **IPC 安全闭环**——任意一侧无意中放入不可克隆字段都不会让 IPC 崩，业务零修改。

## 六、模块边界

### 6.1 对外接口

| 方向 | 接口 | 说明 |
|---|---|---|
| 用户主端 → M2 | `Service.init({ userSchemas })` | 一次性挂载 schema |
| 用户主端 → M2 | `Service.cleanup()` | 关停清理 |
| 用户 preload → 聚合入口 | `require('@base-client/toolkit/preload').init()` | 间接装配 appService |
| 用户渲染端 ← M2（间接） | `window.appService.{namespace}.{handler}` | 由聚合入口经 contextBridge 暴露 |
| M2 preload → 聚合入口 | `module.exports = buildAppService` | 由 `src/preload.js` require 后 contextBridge |

### 6.2 对内依赖

| 方向 | 依赖 | 说明 |
|---|---|---|
| M2 主端 → M1 | `serialize` | 编码 handler 返回值 / 错误 / 元通道数据 |
| M2 preload → M1 | `serialize` / `reviveError` | 编码 args；反序列化错误 |
| M2 主端 → electron | `ipcMain.handle/on/removeHandler/removeAllListeners` | 通道注册与清理 |
| M2 preload → electron | `ipcRenderer.invoke/sendSync` | IPC 调用 |

### 6.3 M2 不负责

- **业务 schema 内容**——用户自定义；M2 不带任何内置
- **主端能力模块的导出形态**——属 M5 capability 契约
- **`contextBridge` 暴露样板**——属聚合入口 `src/preload.js`
- **主→渲染推送**——属 M3 Notice
- **窗口创建/管理**——属 M4 BaseWindow

### 6.4 Protocol 内部性

`service:getServiceList` / `{ns}:{name}` / `{ns}:{name}Sync` 与 `{ok, data?, error?}` 信封是 **M2 内部协议**。用户代码、其他模块、第三方代码均**不应直接消费**这些 channel。如需主→渲染推送，用 M3 Notice。

## 七、文件结构

```
src/service/
├── main.js              # 主端入口
├── preload.js           # preload 入口
└── protocol.js          # 协议契约：channel 命名 + 信封 + 元通道形状
```

### 7.1 各文件职责

**`main.js`**

- 公开导出 `init({ userSchemas })` 和 `cleanup()`
- 内部 `registerService(schema)` 完成单 schema 注册（含 async / sync 通道配对）
- 内部状态 `registeredSchemas: Map<namespace, schema>`
- 注册元通道 `service:getServiceList`

**`preload.js`**

- 导出 `buildAppService()` 工厂
- 内部 `buildAsyncCaller(ns, name)` / `buildSyncCaller(ns, name)` 包装器
- **不**自动 init、**不**调用 `contextBridge`——由聚合入口 `src/preload.js` 装配

**`protocol.js`**

通道命名与信封的**单一真理源**。`main.js` 与 `preload.js` 都从这里取，避免常量在两处各写一份漂移。

```js
// 草拟内容
const META_LIST_CHANNEL = 'service:getServiceList';

const asyncChannel = (ns, name) => `${ns}:${name}`;
const syncChannel  = (ns, name) => `${ns}:${name}Sync`;

const okEnvelope    = data  => ({ ok: true,  data });
const errorEnvelope = error => ({ ok: false, error });

module.exports = {
    META_LIST_CHANNEL,
    asyncChannel,
    syncChannel,
    okEnvelope,
    errorEnvelope,
};
```

元通道返回 `data` 的 schema 形状（仅文档形式列出，无运行时类型）：

```
data: Array<{
    namespace: string,
    handlers:  string[],
    sync:      string[],
}>
```
