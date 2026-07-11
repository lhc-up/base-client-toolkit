# Toolkit M3：Notice 模块详细设计

> 所属：[Toolkit 总设计](./2026-06-03-toolkit-overview-design.md) 的 M3 模块。

## 落地文件

- 主端入口：`src/notice/main.js`
- preload 入口：`src/notice/preload.js`
- 私有协议：`src/notice/protocol.js`（channel 命名；envelope 已上收 `shared/envelope`，详见架构 §7.7）

## 依赖与被依赖

**依赖：**
- M1 shared/serializer —— `serialize` / `serializeForIpc` / `reviveError`
- shared/envelope（架构 §7.1）—— `okEnvelope` / `errorEnvelope`
- shared/naming（架构 §7.4）—— `isValidIdentifier`
- electron —— `ipcMain` / `BrowserWindow` (main) / `ipcRenderer` (preload)

**被依赖：**
- M5 capability 契约（文档级）—— 引用 `noticeSchema` 形态与 `validateNoticeSchema`

## 一、定位

M3 Notice 是 toolkit 的 **IPC 单向推送桥接机制**——主进程向渲染进程发送事件，渲染进程订阅消费。它定义事件 schema 协议、`broadcast` / `direct` API 与 preload 端的动态 `appNotice` 接口，让用户用声明式 schema 描述要暴露的事件，无需手写 `webContents.send` / `ipcRenderer.on`。

M3 是**纯机制层**：

- 不持有任何业务逻辑——不带内置 schema，所有事件由用户声明
- 不依赖任何 capability / enhance 模块——反向解耦
- 不向用户运行时代码注入全局状态——主端经 `init` 显式挂载、preload 经聚合入口显式 expose
- **主端无 per-window 订阅状态**——push 时通过 `BrowserWindow.getAllWindows()` / `fromId(id)` 直接定位目标
- 同向依赖：M1 `shared/serializer`（用于 IPC 编码 push payload + 元通道数据）及 `shared/envelope`（架构 §7.1）、`shared/naming`（架构 §7.4）。

## 二、用户接触面

### 2.1 主端：定义 schema 并 init

```js
const Notice = require('@base-client/toolkit/notice');

const fooNotice = {
    namespace: 'foo',
    events: ['userLoggedIn', 'dataReady', 'shutdown'],
};

Notice.init({ userSchemas: [fooNotice /* , ... */] });
```

**约定**：

- schema 只声明事件名（数组形态），不附带任何 per-event 元数据
- 事件名与 namespace 均须为合法 JS 标识符 `/^[A-Za-z_][A-Za-z0-9_]*$/`（详见架构 §3.7 / §7.4），由 `validateNoticeSchema` 承担运行时校验（详见架构 §7.5）。事件名不含点号，避免与 fullEventName 分隔符冲突。
- **namespace 不得为顶层保留字** `subscribe` / `unsubscribe` / `once`——这三个名字预留给渲染端 `appNotice` 顶层语法糖（详见 §2.4），冲突时 `init` 抛错
- 同一 namespace 在所有挂载的 Notice schema 中全局唯一，冲突时 `init` 抛错

### 2.2 主端：推送事件

```js
// 推给所有窗口——支持任意个参数
Notice.broadcast('foo.userLoggedIn', { userId: 123 });
Notice.broadcast('foo.progress', 0.42, 'downloading', { eta: 12 });
Notice.broadcast('foo.tick');   // 零参数合法：作为纯通知

// 推给指定窗口（windowId 是 BrowserWindow.id）
Notice.direct('foo.dataReady', windowId, { rows: 100 });
Notice.direct('foo.chunk', windowId, seq, buffer);
```

**约定**：

- 事件全名形态为 `${namespace}.${event}`（点号分隔）
- `broadcast(fullEvent, ...args)` / `direct(fullEvent, windowId, ...args)` 接受**任意个 payload 参数**（含零个）。渲染端订阅回调按同样顺序收到 `cb(...args)`
- 事件未在 schema 中声明 → 抛错
- `direct` 的目标 windowId 对应窗口不存在（已关闭）→ **静默忽略**，不抛错（窗口生命周期变化是正常情况）
- 全部 `args` 整体经 `serializeForIpc` 编码为**一个数组**后通过 IPC 发送，业务侧无需关心可克隆性

### 2.3 Preload：经聚合入口暴露

```js
// 用户 preload 文件
require('@base-client/toolkit/preload').init();
```

聚合入口 `src/preload.js` 内部 `require` `notice/preload` 子模块，构建并经 `contextBridge.exposeInMainWorld` 暴露 `window.appNotice`。

### 2.4 渲染端：动态生成的 `appNotice` API

`appNotice` 每个 namespace 直接提供 `on / once / off` 三个方法，事件名作为**第一个参数**传入（短名，不含 namespace 前缀）：

```js
// 订阅，返回取消函数
const off = window.appNotice.foo.on('userLoggedIn', data => {
    console.log('登录', data.userId);
});

off();   // 取消订阅

// 多参数：与主端 broadcast 传入的顺序一致
window.appNotice.foo.on('progress', (ratio, phase, meta) => { /* ... */ });

// 只订阅一次
window.appNotice.foo.once('dataReady', data => { /* ... */ });

// off 三态
window.appNotice.foo.off('shutdown', callback);   // 精确解绑
window.appNotice.foo.off('shutdown');             // 清空该事件全部订阅
window.appNotice.foo.off();                       // 清空该 namespace 全部订阅
```

**约定**：

- `appNotice[ns].on(eventName, cb)` 注册订阅，**返回取消函数**（调用即解绑）
- `appNotice[ns].once(eventName, cb)` 注册一次性订阅，触发一次后自动解绑；同样返回取消函数
- `appNotice[ns].off(eventName, cb)` 精确解绑；`off(eventName)` 清空该事件全部订阅；`off()` 清空该 namespace 全部订阅
- `eventName` 必须是该 namespace 在 schema 中声明过的事件名，否则 `on/once/off(eventName, ...)` 抛错（`off()` 无参例外，不校验）
- `on/once` 的 `cb` 必须是函数，`off(eventName, cb)` 若显式传入 `cb` 也须是函数，否则抛错
- 订阅状态只存在于当前 renderer 进程内存，**窗口关闭时随进程退出自动释放**

`appNotice` 顶层同时暴露三个 fullEventName 版语法糖（EventEmitter 风格），与 `[ns].on/off/once` 共享同一订阅存储、任选一路均可：

```js
// fullEventName 形态 = "ns.event"，与主端 broadcast/direct 使用的一致
const off = window.appNotice.subscribe('foo.userLoggedIn', data => { /* ... */ });
off();

// 精确解绑（cb 必须与订阅时同引用）
window.appNotice.unsubscribe('foo.userLoggedIn', cb);
// 清空该事件全部订阅
window.appNotice.unsubscribe('foo.userLoggedIn');

// 一次性订阅
window.appNotice.once('foo.dataReady', data => { /* ... */ });
```

**约定**：

- `subscribe/once` 内部委托到 `appNotice[ns].on/once(eventName, cb)`，返回取消函数
- `unsubscribe(fullEventName, cb?)` 内部委托到 `appNotice[ns].off(eventName, cb)`（`cb` 省略即清空该事件全部订阅）；**不支持无参 `unsubscribe()`**——顶层"清空所有 namespace"过于危险，需要清空整个 namespace 请调 `appNotice[ns].off()`
- `fullEventName` 须为字符串且形如 `"ns.event"`（按第一个 `.` 拆分），否则抛错
- namespace 未在任何 schema 中声明 → 抛错 `Notice {api}: namespace "ns" not registered`
- eventName 未声明 / cb 非函数 → 委托到 `[ns]` 层抛与直调等价的错

### 2.5 关停

```js
Notice.cleanup();
```

清空已注册的 IPC listener 与 namespace 注册表。约定在 `app.on('will-quit', () => Notice.cleanup())` 中调用——退出已确定、最后一次可同步运行清理代码的窗口；正常运行不需要主动调用。

## 三、Protocol

### 3.1 channel 命名

| Channel | 类型 | 用途 |
|---|---|---|
| `notice:event` | `webContents.send` → `ipcRenderer.on` | 推送通道：主→渲染 |
| `notice:getSchema` | `ipcMain.on` sync | 元通道：preload 加载时取 schema 列表 |

**注**：推送通道是**单个共享 channel**，所有事件共用；事件由 payload 中的 `fullEventName` 区分。这与 M2 Service "每 handler 一个 channel" 不同——Notice 的事件数量可能远多于 Service 的 handler，单通道 + payload 路由更紧凑。

### 3.2 推送通道（plain，无信封）

主端：

```js
webContents.send('notice:event', fullEventName, serializeForIpc(args));
// args 是主端 broadcast/direct 收集的 rest 参数数组（可能为空数组）
```

preload 接收：

```js
ipcRenderer.on('notice:event', (_event, fullEventName, args) => {
    // args 是已 serialize 过的 plain 数组；按 fullEventName 派发到订阅者，回调收到 cb(...args)
});
```

无 envelope 包裹——推送是单向流，无返回值、无错误回路（主端 push 抛错属主端业务，不走 IPC）。IPC 参数数固定为三段（channel / fullEventName / argsArray），无论业务传 0 个还是 N 个 payload，protocol 形状不变。

### 3.3 元通道 `notice:getSchema`

元通道 `notice:getSchema` 使用统一信封 `{ ok, data?, error? }`（详见架构 §7.1）。信封 `data` 与 `error` 字段均经 `serializeForIpc()` 编码（详见架构 §7.2）。

`data` 形状：

```js
[
    {
        namespace: 'foo',
        events: ['userLoggedIn', 'dataReady', 'shutdown'],
    },
    ...
]
```

preload 端据此为每个 `namespace` 构建 `appNotice[namespace]` 命名空间对象，挂上共享的 `on/once/off` 方法；`events` 数组转成 `Set` 作为 `assertEvent` 的查询索引。

**调用时机约定**：preload 加载时调一次即可；运行期再调合法但无意义（schema 静态）。

## 四、主端流程

### 4.1 `init`

```js
Notice.init({ userSchemas: [schema1, schema2, ...] })
```

步骤：

1. 校验 `userSchemas` 是数组（否则抛错）。
2. 遍历挂载：对每个 schema 调用内部 `registerSchema(schema)`。
3. 注册元通道 `notice:getSchema`。

### 4.2 内部 `registerSchema`（不对外）

对单个 schema：

`registerSchema(schema)` 内部调用 `validateNoticeSchema(schema)`（M3 公开导出，详见架构 §7.5）完成 schema 形态与命名校验；校验通过后检查 namespace 冲突。校验失败抛错细节由 validateNoticeSchema 定义。

校验通过后记入内部 `registeredSchemas: Map<namespace, eventList>`。

**注**：Notice **不为每个事件注册 IPC channel**——所有推送共用 `notice:event` 通道。`registerSchema` 只是登记"该 namespace 有这些事件名"，供 broadcast / direct 校验和元通道回报。

### 4.3 `broadcast`

IPC payload 与元通道数据统一经 serializeForIpc()（详见架构 §7.2）。`args` 整体作为一个数组编码——单次序列化调用，接收端一次 spread。

```js
function broadcast(fullEventName, ...args) {
    assertRegistered(fullEventName);
    const safeArgs = serializeForIpc(args);
    for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(EVENT_CHANNEL, fullEventName, safeArgs);
    }
}
```

### 4.4 `direct`

```js
function direct(fullEventName, windowId, ...args) {
    assertRegistered(fullEventName);
    const win = BrowserWindow.fromId(windowId);
    if (!win) return;   // 窗口已关闭：静默忽略
    const safeArgs = serializeForIpc(args);
    win.webContents.send(EVENT_CHANNEL, fullEventName, safeArgs);
}
```

**注**：`assertRegistered(fullEventName)` 与旧版内部实现相同——`parseFullEventName` + `registeredSchemas.get(namespace)?.includes(eventName)`，未注册抛错，抛错消息形态不变。

### 4.5 元通道实现

```js
ipcMain.on(META_GET_SCHEMA_CHANNEL, event => {
    try {
        const list = [...registeredSchemas.entries()].map(([namespace, events]) => ({
            namespace,
            events,
        }));
        event.returnValue = okEnvelope(serializeForIpc(list));
    } catch (err) {
        event.returnValue = errorEnvelope(serializeForIpc(err));
    }
});
```

### 4.6 `cleanup`

```js
Notice.cleanup()
```

1. `ipcMain.removeAllListeners(META_GET_SCHEMA_CHANNEL)`
2. `registeredSchemas.clear()`

**注**：推送通道 `notice:event` 是 `webContents.send` 主动发出的，**主端没有 ipcMain 监听器**，无需 remove。

## 五、Preload 流程

### 5.1 入口

`notice/preload.js` 导出 `buildAppNotice()` 工厂：

```js
module.exports = function buildAppNotice() { /* returns appNotice */ };
```

由聚合入口 `src/preload.js` 引用，经 `contextBridge.exposeInMainWorld('appNotice', buildAppNotice())` 暴露给渲染端。`notice/preload.js` 自身**不**自动 init、**不**调用 `contextBridge`。

### 5.2 `buildAppNotice` 流程

preload 端 envelope 解包契约详见架构 §7.1；错误还原 `reviveError` 详见架构 §7.3。

```js
const TOP_LEVEL_KEYS = new Set(['subscribe', 'unsubscribe', 'once']);

function buildAppNotice() {
    const envelope = ipcRenderer.sendSync(META_GET_SCHEMA_CHANNEL);
    if (!envelope || !envelope.ok) throw reviveError(envelope && envelope.error);
    const schemaList = envelope.data || [];

    // 两级 Map：便于 off() 清空整个 namespace 直接 listeners.delete(namespace)
    const listeners = new Map();   // namespace -> Map<eventName, Set<callback>>

    const appNotice = {};
    for (const { namespace, events } of schemaList) {
        if (TOP_LEVEL_KEYS.has(namespace)) {
            throw new Error(`Notice namespace "${namespace}" collides with top-level API`);
        }
        const eventSet = new Set(events);   // 声明索引，供 on/once/off 做 O(1) 严格校验
        appNotice[namespace] = buildNamespaceApi(namespace, eventSet, listeners);
    }

    // 顶层语法糖：subscribe/unsubscribe/once 拆 fullEventName 委托到 [ns] 层
    const resolveNsApi = (fullEventName, api) => {
        const { namespace, eventName } = parseFullEventName(fullEventName);
        const nsApi = appNotice[namespace];
        if (!nsApi) throw new Error(`Notice ${api}: namespace "${namespace}" not registered`);
        return { nsApi, eventName };
    };
    appNotice.subscribe   = (fullEvent, cb) => {
        const { nsApi, eventName } = resolveNsApi(fullEvent, 'subscribe');
        return nsApi.on(eventName, cb);
    };
    appNotice.unsubscribe = (fullEvent, cb) => {
        const { nsApi, eventName } = resolveNsApi(fullEvent, 'unsubscribe');
        nsApi.off(eventName, cb);
    };
    appNotice.once        = (fullEvent, cb) => {
        const { nsApi, eventName } = resolveNsApi(fullEvent, 'once');
        return nsApi.once(eventName, cb);
    };

    // 单一 dispatcher：从 fullEventName 解析出 namespace / eventName，展开 args 数组
    ipcRenderer.on(EVENT_CHANNEL, (_event, fullEventName, args) => {
        const idx = fullEventName.indexOf('.');
        if (idx <= 0) return;
        const namespace = fullEventName.slice(0, idx);
        const eventName = fullEventName.slice(idx + 1);
        const byEvent = listeners.get(namespace);
        if (!byEvent) return;
        const cbs = byEvent.get(eventName);
        if (!cbs) return;
        // Snapshot：once-wrappers 触发时会 mutate cbs，避免迭代破坏
        for (const cb of [...cbs]) cb(...args);
    });

    return appNotice;
}
```

### 5.3 `buildNamespaceApi` —— on / once / off

namespace 级 API：所有事件共用同一份 `on/once/off`，事件名作为第一个参数传入。严格模式——未声明事件与非函数回调均抛错。

```js
function buildNamespaceApi(namespace, eventSet, listeners) {
    const assertEvent = eventName => {
        if (!eventSet.has(eventName)) {
            throw new Error(`Notice event "${namespace}.${eventName}" not registered`);
        }
    };
    const assertFn = (cb, api) => {
        if (typeof cb !== 'function') {
            throw new Error(`Notice ${namespace}.${api} callback must be a function`);
        }
    };
    const ensureSet = eventName => {
        let byEvent = listeners.get(namespace);
        if (!byEvent) { byEvent = new Map(); listeners.set(namespace, byEvent); }
        let cbs = byEvent.get(eventName);
        if (!cbs) { cbs = new Set(); byEvent.set(eventName, cbs); }
        return cbs;
    };
    const unsubscribe = (eventName, cb) => {
        const byEvent = listeners.get(namespace);
        if (!byEvent) return;
        const cbs = byEvent.get(eventName);
        if (!cbs) return;
        cbs.delete(cb);
        if (cbs.size === 0) byEvent.delete(eventName);
        if (byEvent.size === 0) listeners.delete(namespace);
    };

    return {
        on(eventName, cb) {
            assertEvent(eventName);
            assertFn(cb, 'on');
            ensureSet(eventName).add(cb);
            return () => unsubscribe(eventName, cb);
        },
        once(eventName, cb) {
            assertEvent(eventName);
            assertFn(cb, 'once');
            const wrapper = (...args) => {
                unsubscribe(eventName, wrapper);
                cb(...args);
            };
            ensureSet(eventName).add(wrapper);
            return () => unsubscribe(eventName, wrapper);
        },
        off(eventName, cb) {
            if (eventName === undefined) {   // off() —— 清空该 namespace 全部订阅
                listeners.delete(namespace);
                return;
            }
            assertEvent(eventName);
            if (cb === undefined) {          // off(eventName) —— 清空该事件全部订阅
                const byEvent = listeners.get(namespace);
                if (byEvent) {
                    byEvent.delete(eventName);
                    if (byEvent.size === 0) listeners.delete(namespace);
                }
                return;
            }
            assertFn(cb, 'off');             // off(eventName, cb) —— 精确解绑
            unsubscribe(eventName, cb);
        },
    };
}
```

**关键点**：

- 校验顺序：`assertEvent` 先于 `assertFn`——事件名错是更根本的错
- `off()` 是"清空整个 namespace"的大杀器，不做事件名校验（`off()` 语义上无对应事件）
- `once` 的 wrapper 用 `(...args)` 转发，与主端 rest args + dispatcher spread 对称
- 未定义 namespace 的 `appNotice[ns]` 属性直接不存在，`appNotice.unknown.on(...)` 会在解引用时报 `Cannot read properties of undefined` —— 属 JS 原生行为，不是 M3 的错误契约

### 5.4 数据流

```
主端 broadcast(fullEventName, ...args) / direct(fullEventName, windowId, ...args)
                                            │
                                            ▼
              webContents.send('notice:event', fullEventName, serializeForIpc(args))
                                            │
                                            ▼
preload  ipcRenderer.on('notice:event', dispatcher)
                                            │
                                            ▼
                    listeners.get(ns).get(event) 派发到 Set<cb>，回调收到 cb(...args)
```

每个订阅回调被同步调用，`args` 已是 plain serializeForIpc 过的数组，回调按位置解构。

### 5.5 contextBridge 边界

`appNotice` 对象通过 `contextBridge.exposeInMainWorld('appNotice', ...)` 暴露——`on/once/off` 方法及其闭包（含 `listeners` Map）只存在于 preload 进程，渲染端只看到方法接口；回调函数通过 contextBridge 的 proxy 机制在渲染↔preload 之间安全传递。

## 六、模块边界

### 6.1 对外接口

| 方向 | 接口 | 说明 |
|---|---|---|
| 用户主端 → M3 | `Notice.init({ userSchemas })` | 一次性挂载 schema |
| 用户主端 → M3 | `Notice.broadcast(fullEvent, ...args)` | 推送所有窗口，任意个 payload 参数 |
| 用户主端 → M3 | `Notice.direct(fullEvent, windowId, ...args)` | 推送指定窗口（窗口不存在静默忽略），任意个 payload 参数 |
| 用户主端 → M3 | `Notice.cleanup()` | 关停清理 |
| 用户 preload → 聚合入口 | `require('@base-client/toolkit/preload').init()` | 间接装配 appNotice |
| 用户渲染端 ← M3（间接） | `window.appNotice.{namespace}.on(eventName, cb)` / `.once(eventName, cb)` / `.off(eventName?, cb?)` | 由聚合入口经 contextBridge 暴露；namespace 级 API，事件名作首参 |
| 用户渲染端 ← M3（间接） | `window.appNotice.subscribe(fullEventName, cb)` / `.unsubscribe(fullEventName, cb?)` / `.once(fullEventName, cb)` | 顶层语法糖：EventEmitter 风格，接受 `"ns.event"` 全名，内部委托到 `[ns]` 层 |
| M3 preload → 聚合入口 | `module.exports = buildAppNotice` | 由 `src/preload.js` require 后 contextBridge |

### 6.2 对内依赖

| 方向 | 依赖 | 说明 |
|---|---|---|
| M3 主端 → M1 | `serialize` / `serializeForIpc` | 编码 push payload / 元通道数据 / 错误 |
| M3 preload → M1 | `reviveError` | 反序列化元通道错误 |
| M3 主/preload → shared/envelope | `okEnvelope` / `errorEnvelope`（详见架构 §7.1） | 统一信封 |
| M3 主/preload → shared/naming | `isValidIdentifier`（详见架构 §7.4） | 命名校验 |
| M3 主端 → electron | `BrowserWindow.getAllWindows/fromId`、`webContents.send`、`ipcMain.on/removeAllListeners` | 推送 + 元通道 |
| M3 preload → electron | `ipcRenderer.on/sendSync` | 接收推送 + 取 schema |

### 6.3 M3 不负责

- **业务事件内容**——用户自定义；M3 不带任何内置
- **per-window 订阅状态**——若业务需要"按订阅推送"，业务自行维护窗口→事件兴趣的映射
- **主端能力模块的导出形态**——属 M5 capability 契约
- **`contextBridge` 暴露样板**——属聚合入口 `src/preload.js`
- **渲染→主调用**——属 M2 Service
- **窗口创建/管理**——属 M4 BaseWindow

### 6.4 Protocol 内部性

`notice:event` / `notice:getSchema` 与 `{ok, data?, error?}` 信封是 **M3 内部协议**。用户代码、其他模块、第三方代码均**不应直接消费**这些 channel。如需渲染→主调用，用 M2 Service。

## 七、文件结构

```
src/notice/
├── main.js              # 主端入口
├── preload.js           # preload 入口
└── protocol.js          # 协议契约：channel 命名 + 元通道形状（envelope 已上收 shared/envelope，详见架构 §7.7）
```

### 7.1 各文件职责

**`main.js`**

- 公开导出 `init({ userSchemas })`、`broadcast(fullEvent, ...args)`、`direct(fullEvent, windowId, ...args)`、`cleanup()`、`validateNoticeSchema(schema)`
- 内部 `registerSchema(schema)` 完成单 schema 校验与登记
- 内部 `assertRegistered(fullEvent)` —— parseFullEventName + registeredSchemas 查询
- 内部状态 `registeredSchemas: Map<namespace, eventList>`
- 内部 `parseFullEventName(fullEvent)` —— `indexOf('.')` 解析
- 注册元通道 `notice:getSchema`

**`preload.js`**

- 导出 `buildAppNotice()` 工厂
- 内部 `buildNamespaceApi(namespace, eventSet, listeners)` —— namespace 级 on/once/off 工厂，含 assertEvent / assertFn 严格校验
- 内部 `parseFullEventName(fullEventName)` —— 按第一个 `.` 拆 `{namespace, eventName}`，供顶层 subscribe/unsubscribe/once 语法糖复用
- 顶层 `subscribe(fullEvent, cb)` / `unsubscribe(fullEvent, cb?)` / `once(fullEvent, cb)` 三个语法糖挂在 `appNotice` 根上，委托到对应 `[ns]` 层；namespace 命名冲突（撞保留字 subscribe/unsubscribe/once）时构建抛错
- 内部状态 `listeners: Map<namespace, Map<eventName, Set<cb>>>`（两级 Map），顶层与 `[ns]` 层共享
- 单一 `ipcRenderer.on('notice:event', dispatcher)` 派发：解析 fullEventName、按 `[...cbs]` snapshot 迭代、`cb(...args)` 展开
- **不**自动 init、**不**调用 `contextBridge`——由聚合入口 `src/preload.js` 装配

**`protocol.js`**

通道命名的**单一真理源**（envelope 已上收 `shared/envelope`，详见架构 §7.7）。`main.js` 与 `preload.js` 都从这里取，避免常量在两处各写一份漂移。

```js
// 草拟内容
const EVENT_CHANNEL = 'notice:event';
const META_GET_SCHEMA_CHANNEL = 'notice:getSchema';

module.exports = {
    EVENT_CHANNEL,
    META_GET_SCHEMA_CHANNEL,
};
```

元通道返回 `data` 的 schema 形状（仅文档形式列出，无运行时类型）：

```
data: Array<{
    namespace: string,
    events: string[],
}>
```
