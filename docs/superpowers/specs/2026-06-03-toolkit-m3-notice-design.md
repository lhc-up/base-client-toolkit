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
- 同一 namespace 在所有挂载的 Notice schema 中全局唯一，冲突时 `init` 抛错

### 2.2 主端：推送事件

```js
// 推给所有窗口
Notice.broadcast('foo.userLoggedIn', { userId: 123 });

// 推给指定窗口（windowId 是 BrowserWindow.id）
Notice.direct('foo.dataReady', windowId, { rows: 100 });
```

**约定**：

- 事件全名形态为 `${namespace}.${event}`（点号分隔）
- 事件未在 schema 中声明 → 抛错
- `direct` 的目标 windowId 对应窗口不存在（已关闭）→ **静默忽略**，不抛错（窗口生命周期变化是正常情况）
- payload 经 `serializeForIpc` 编码后通过 IPC 发送，业务侧无需关心可克隆性

### 2.3 Preload：经聚合入口暴露

```js
// 用户 preload 文件
require('@base-client/toolkit/preload').init();
```

聚合入口 `src/preload.js` 内部 `require` `notice/preload` 子模块，构建并经 `contextBridge.exposeInMainWorld` 暴露 `window.appNotice`。

### 2.4 渲染端：动态生成的 `appNotice` API

```js
// 订阅，返回取消函数
const off = window.appNotice.foo.userLoggedIn.on(data => {
    console.log('登录', data.userId);
});

off();   // 取消订阅

// 只订阅一次
window.appNotice.foo.dataReady.once(data => { /* ... */ });

// 显式 off，不传 cb 时清空该事件全部订阅
window.appNotice.foo.shutdown.off(callback);
window.appNotice.foo.shutdown.off();
```

**约定**：

- `appNotice[ns][event].on(cb)` 注册订阅，**返回取消函数**（调用即解绑）
- `appNotice[ns][event].once(cb)` 注册一次性订阅，触发一次后自动解绑
- `appNotice[ns][event].off(cb)` 显式解绑；不传 cb 时清空该事件全部订阅
- 订阅状态只存在于当前 renderer 进程内存，**窗口关闭时随进程退出自动释放**

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
webContents.send('notice:event', fullEventName, serializeForIpc(data));
```

preload 接收：

```js
ipcRenderer.on('notice:event', (_event, fullEventName, data) => {
    // data 已是 serialize 过的 plain 数据；按 fullEventName 派发到订阅者
});
```

无 envelope 包裹——推送是单向流，无返回值、无错误回路（主端 push 抛错属主端业务，不走 IPC）。

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

preload 端据此构建 `appNotice[ns][eventName]`，每个事件挂上 on/once/off 方法。

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

IPC payload 与元通道数据统一经 serializeForIpc()（详见架构 §7.2）。

```js
function broadcast(fullEventName, data) {
    const { namespace, eventName } = parseFullEventName(fullEventName);
    const events = registeredSchemas.get(namespace);
    if (!events || !events.includes(eventName)) {
        throw new Error(`Notice 事件 "${fullEventName}" 未注册`);
    }
    const safeData = serializeForIpc(data);
    for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(EVENT_CHANNEL, fullEventName, safeData);
    }
}
```

### 4.4 `direct`

```js
function direct(fullEventName, windowId, data) {
    const { namespace, eventName } = parseFullEventName(fullEventName);
    const events = registeredSchemas.get(namespace);
    if (!events || !events.includes(eventName)) {
        throw new Error(`Notice 事件 "${fullEventName}" 未注册`);
    }
    const win = BrowserWindow.fromId(windowId);
    if (!win) return;   // 窗口已关闭：静默忽略
    const safeData = serializeForIpc(data);
    win.webContents.send(EVENT_CHANNEL, fullEventName, safeData);
}
```

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
function buildAppNotice() {
    const envelope = ipcRenderer.sendSync(META_GET_SCHEMA_CHANNEL);
    if (!envelope.ok) throw reviveError(envelope.error);
    const schemaList = envelope.data;

    const listeners = new Map();   // fullEventName -> Set<callback>

    // 单一 dispatcher：所有事件共用
    ipcRenderer.on(EVENT_CHANNEL, (_event, fullEventName, data) => {
        const cbs = listeners.get(fullEventName);
        if (cbs) cbs.forEach(cb => cb(data));
    });

    const appNotice = {};
    for (const { namespace, events } of schemaList) {
        appNotice[namespace] = {};
        for (const eventName of events) {
            const fullEventName = `${namespace}.${eventName}`;
            appNotice[namespace][eventName] = buildEventApi(fullEventName, listeners);
        }
    }
    return appNotice;
}
```

### 5.3 `buildEventApi` —— on / once / off

```js
function buildEventApi(fullEventName, listeners) {
    const ensureSet = () => {
        if (!listeners.has(fullEventName)) listeners.set(fullEventName, new Set());
        return listeners.get(fullEventName);
    };
    const unsubscribe = cb => {
        const cbs = listeners.get(fullEventName);
        if (!cbs) return;
        cbs.delete(cb);
        if (cbs.size === 0) listeners.delete(fullEventName);
    };
    return {
        on(cb) {
            ensureSet().add(cb);
            return () => unsubscribe(cb);
        },
        once(cb) {
            const wrapper = data => {
                unsubscribe(wrapper);
                cb(data);
            };
            ensureSet().add(wrapper);
            return () => unsubscribe(wrapper);
        },
        off(cb) {
            if (!cb) listeners.delete(fullEventName);
            else unsubscribe(cb);
        },
    };
}
```

### 5.4 数据流

```
主端 broadcast / direct  ──→  webContents.send('notice:event', fullEventName, serializeForIpc(data))
                                            │
                                            ▼
preload  ipcRenderer.on('notice:event', dispatcher)
                                            │
                                            ▼
                              listeners.get(fullEventName).forEach(cb => cb(data))
```

每个订阅回调被同步调用，`data` 已是 plain serializeForIpc 过的数据。

### 5.5 contextBridge 边界

`appNotice` 对象通过 `contextBridge.exposeInMainWorld('appNotice', ...)` 暴露——`on/once/off` 方法及其闭包（含 `listeners` Map）只存在于 preload 进程，渲染端只看到方法接口；回调函数通过 contextBridge 的 proxy 机制在渲染↔preload 之间安全传递。

## 六、模块边界

### 6.1 对外接口

| 方向 | 接口 | 说明 |
|---|---|---|
| 用户主端 → M3 | `Notice.init({ userSchemas })` | 一次性挂载 schema |
| 用户主端 → M3 | `Notice.broadcast(fullEvent, data)` | 推送所有窗口 |
| 用户主端 → M3 | `Notice.direct(fullEvent, windowId, data)` | 推送指定窗口（窗口不存在静默忽略） |
| 用户主端 → M3 | `Notice.cleanup()` | 关停清理 |
| 用户 preload → 聚合入口 | `require('@base-client/toolkit/preload').init()` | 间接装配 appNotice |
| 用户渲染端 ← M3（间接） | `window.appNotice.{namespace}.{event}.on/once/off` | 由聚合入口经 contextBridge 暴露 |
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

- 公开导出 `init({ userSchemas })`、`broadcast(fullEvent, data)`、`direct(fullEvent, windowId, data)`、`cleanup()`
- 内部 `registerSchema(schema)` 完成单 schema 校验与登记
- 内部状态 `registeredSchemas: Map<namespace, eventList>`
- 内部 `parseFullEventName(fullEvent)` —— `split('.')` 解析
- 注册元通道 `notice:getSchema`

**`preload.js`**

- 导出 `buildAppNotice()` 工厂
- 内部 `buildEventApi(fullEvent, listeners)` 包装器
- 单一 `ipcRenderer.on('notice:event', dispatcher)` 派发
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
