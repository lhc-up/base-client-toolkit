# Toolkit 架构设计

**日期**：2026-07-03
**项目**：`@base-client/toolkit`
**性质**：架构层设计（活文档），M1-M5 模块详细设计的父文档

> 本文档是 toolkit 的**唯一架构层真理源**。凡涉及 ≥2 个模块的契约、共享基础设施、核心不变量、目录组织、发布形态、文档治理规则 —— 均在此定义。M1-M5 模块 spec 只写模块内私有内容；跨模块内容一律以 "参见架构 §X" 形式引用本文档，禁止复述。

---

## 目录

- §1 定位
- §2 设计目标
- §3 核心不变量
- §4 核心能力
- §5 模块划分
- §6 模块依赖关系
- §7 跨模块共享契约
- §8 shared/ 准入规则
- §9 新增模块判定与扩展规则
- §10 发布形态
- §11 文档治理

---

## §1 定位

`@base-client/toolkit` 是面向 Electron 客户端项目的**可选增强能力包**。按能力垂直切片组织：每个能力自含主端代码、preload 桥接（若有）、协议契约；能力之间相互独立，仅共享底层基础设施。用户按需引入。

toolkit **不是**统一运行时框架，也**不**向用户运行时代码注入任何全局状态 —— 所有能力必须由用户在主端 `require` + 显式 `init` 才生效。

---

## §2 设计目标

1. **严格按需引入** —— 每个模块可独立使用，模块间不互相依赖（仅共享底层 `shared/`）。装了某模块不代表它会自动接入 Service / Notice，由用户在主端显式挂载（`Service.init({ userSchemas: [...] })`）。

2. **渲染进程零本地 I/O**（核心架构原则）—— 渲染进程不直接接触文件系统、操作系统资源、进程信息等本地能力。所有此类能力归主进程，通过 Service 桥接为渲染端可调用接口；主→渲染推送通过 Notice。

3. **垂直切片自包含** —— 每个模块自含 main + preload（若需要）+ protocol。新增模块不需要在多个目录间协调改动，channel 名 / payload 形状有唯一真理源。

4. **IPC 安全** —— 所有 IPC payload 经 `shared/serializer` 统一编码，业务零修改，永不因不可克隆字段（函数 / Symbol / 类实例 / 循环引用 / Date / Buffer 等）而崩溃。

5. **顶层装配、按需引入** —— capability 模块被 `require` 时借助 CommonJS 缓存机制**顶层完成一次运行时装配**（`log4js.configure` / `new Store` / `app.on('will-quit')` 等），无 init 生命周期。业务参数（如 `corePkg`、URL、文件路径）在函数被显式调用时以实参传入，不通过 init/opts 收。M2 Service / M3 Notice 保留一次性 `init(...)` 挂载 schema。用户 preload / main 入口完全由用户掌控。

---

## §3 核心不变量

7 条运行时架构承诺。任何模块设计与它冲突就是错的。review 时对照检查。

### §3.1 `require` 有限副作用

toolkit 任何模块被 `require` 时**允许**以下 CommonJS 缓存一次即完成的副作用：

- 消费 `src/paths.js#getFilePathConfig()` 得到默认路径（会 `fse.ensureDirSync` 建目录）
- 顶层完成运行时装配（如 `log4js.configure`、`new Store({ cwd })`、挂 `app.on('will-quit')`）
- 顶层 `require` 已声明的 DAG 依赖 capability（详见 §3.6）

**仍不允许**：

- 依赖业务侧参数（业务参数只能在函数被显式调用时作为实参传入）
- 发起网络请求
- 注册 IPC channel（IPC channel 挂载仍由 `Service.init` / `Notice.init` 承担）
- 顶层 `require` M2 Service / M3 Notice（capability 只导出 schema 描述对象；是否真注册由用户在业务侧 `Service.init({ userSchemas })` 决定）

**架构意义**：CommonJS 有模块缓存，`require` 时的初始化代码只跑一次。把配置延后到 `init(opts)` 与"顶层跑一次"在**执行次数**上等价，为"防止重复执行"设立 init 是误诊。取消 init 后 API 收敛，业务侧写法从 N 个 `xxx.init(...)` 收敛到"直接 require 即可用"。

### §3.2 渲染进程零本地 I/O

toolkit 中所有**需要在渲染进程加载**的代码，禁止 `require('electron')` / `require('fs')` / `require('path')` 等 Node 或 Electron 本地模块，**必须能在浏览器环境中运行**。

**例外**：
- **preload 模块**（`src/preload.js` 及 `service/preload.js` / `notice/preload.js`）—— 必然依赖 `electron.contextBridge` / `ipcRenderer`
- **capability 模块**（`capability/*`）—— 跑在主进程，为渲染进程提供的本地能力，允许 Node / Electron 依赖

**当前落地**：需在渲染进程加载的 toolkit 代码只有 `shared/`（M2/M3 主端、M4 BaseWindow、capability 均只跑在主进程）。`shared/` 的具体准入规则见 §8。

**未来约束**：若新增"渲染进程专用模块"，同样受此约束。

**架构意义**：这条不变量是"渲染进程业务侧的所有本地能力访问必须走 IPC"这一设计意图的**代码层强制** —— 不但业务运行时不接触本地能力，连 toolkit 的模块也不能带本地依赖进入渲染进程。

### §3.3 IPC 路径生产环境永不抛错

所有 IPC 主端响应的序列化**必须使用 `serializeForIpc()` 封装**（M1 内部硬编码 `strict: false`），业务代码零手动传参。

**主端 handler 永不 throw**：Service `ipcMain.handle` / `on` 回调、Notice 元通道回调 —— 全部 try/catch，异常一律封装为 `{ ok: false, error: serializeForIpc(err) }` 返回，避免触发 Electron 内置错误包装（`Error invoking remote method ...`）。

**IPC 应答统一信封**：所有 IPC 应答形态为 `{ ok, data?, error? }`；异步/同步/元通道协议同构；preload 端解包路径唯一（`if (ok) return data; else throw reviveError(error)`）。

**架构意义**：生产环境 IPC 路径**没有 uncatchable exception**；渲染端拿到的始终是 Error 实例或数据。

### §3.4 shared/ 进程无关

`shared/` 内代码必须在**主进程、渲染进程、preload 三端**都可 `require` 且行为一致。禁止依赖 `electron`、`process.env.*`、`fs`、`path` 等任何绑定进程/运行时的 API。

**架构意义**：`shared/` 是唯一的"跨进程共享逻辑层"，其内容必须"进程无立场"。是 §3.2 的具体落地。

具体准入规则见 §8。

### §3.5 preload 一次性 init

用户 preload 中的 `require('@base-client/toolkit/preload').init()` **必须只调用一次**。同名 `contextBridge.exposeInMainWorld` 二次调用抛错；重复调用属违规，toolkit 不做防护。

**opt-out 契约**：主端未 `init` Service / Notice 时，preload 必须 opt-out 对应 bridge —— 否则 `sendSync` 元通道因无 listener **永久阻塞渲染进程**（Electron 无原生 timeout）。

**架构意义**：preload 层是渲染↔主握手关键点；一次性 + opt-out 双保险，防渲染进程死锁。

### §3.6 模块间依赖方向

M2 Service / M3 Notice / M4 BaseWindow 相互独立，**互不 `require`**。M5 capability 之间允许 **DAG（有向无环图）依赖**。

**允许的依赖方向**：

- M2 / M3 同向依赖 M1
- M4 只依赖 `electron` + `lodash.merge`
- capability 顶层可 `require` `src/paths.js`、`shared/*` 与**其它 capability**（构成 DAG，禁止环）
- capability 依然**不得**顶层 `require` M2 Service / M3 Notice —— 只导出 schema 描述对象，由用户在业务侧挂载

**运行时假设**：因 CommonJS 缓存机制，capability A 顶层 `require` B 时，B 顶层装配已完成，A 内部使用 B 的 API 无需再校验"B 是否已初始化"。

**当前 capability DAG 落地**：

- `os` → `logger`
- `store` → `logger`
- `update` → `logger`、`os`
- `logger`、`shortcut`、`singleInstance` → 无 capability 依赖

**环检测**：建议在 CI 里加一段静态扫描（scan `src/capability/*/index.js` 顶层 `require('../<name>')`，跑 DAG 环检测）。

**架构意义**：每模块可独立设计、实现、测试、发布；capability 层允许 DAG 引用避免业务侧写重复"依赖装配"样板。

### §3.7 命名空间口径

- **Service 内**：所有 Service schema 的 `namespace` 全局唯一（`Service.init` 内冲突抛错）
- **Notice 内**：所有 Notice schema 的 `namespace` 全局唯一
- **跨 Service / Notice**：允许同名
- **capability 期望**：目录名 = `serviceSchema.namespace` = `noticeSchema.namespace`（不强制运行时校验，偏离会让用户接触面失去直觉）

**命名字符规则**：`namespace` / `handler` 名 / `event` 名三者均须符合 `/^[A-Za-z_][A-Za-z0-9_]*$/`（合法 JS 标识符）。理由见 §7.4。

**架构意义**：命名空间承担 IPC channel 命名前缀（`{ns}:{handler}` / `{ns}.{event}`），且作为渲染端 API 属性名（`appService.foo.bar` / `appNotice.foo.userLoggedIn`），全部合法 JS 标识符保证 dot access 无一例外。

---

## §4 核心能力

- **IPC 桥接（Service / Notice）** —— Service 提供渲染→主双向调用（异步 `invoke` / 同步 `sendSync`）；Notice 提供主→渲染推送（`broadcast` / `direct`）。两者 IPC payload 均自动经 `shared/serializer` 编码。详见 M2 / M3 spec。
- **窗口抽象（BaseWindow）** —— 在 Electron `BrowserWindow` 之上提供类模板（模板方法 + 钩子）。详见 M4 spec。
- **IPC 安全序列化（shared/serializer）** —— 任意输入（含函数 / Symbol / 类实例 / 循环引用 / Date / Buffer 等）安全转换为可经 IPC 传输的 plain 数据；`safeStringify` 供日志类场景复用；`reviveError` 把序列化的错误还原为 Error 实例。详见 M1 spec。
- **主端能力模块接入约定**（`capability/`）—— 主端能力模块的导出形态约定：直接 API + 可选 `serviceSchema` + 可选 `noticeSchema`；由用户在 `Service.init` / `Notice.init` 显式挂载。详见 M5 spec。
- **Electron 对象增强约定**（`enhance/`）—— Electron 既有对象（`BrowserWindow` / `app` / `Menu` / `Tray` 等）的封装/抽象归此命名空间。BaseWindow 是其中第一个。
- **根入口聚合 + preload 聚合入口** —— packaging 便利层，详见 §10。

---

## §5 模块划分

toolkit 物理结构按 **5 类顶层目录**组织：

```
src/
├── shared/                  # 共享基础设施（进程无关，§8 准入规则）
│   ├── serializer/          # M1
│   ├── envelope.js          # 跨模块 envelope 定义（§7.1）
│   └── naming.js            # 命名规则单一真理源（§7.4）
├── service/                 # M2 IPC 桥接：双向调用
│   ├── main.js
│   ├── preload.js
│   └── protocol.js          # channel 命名等模块私有协议
├── notice/                  # M3 IPC 桥接：主→渲染推送
│   ├── main.js
│   ├── preload.js
│   └── protocol.js
├── capability/              # M5 主端能力命名空间
│   └── example/             # 参考示例
├── enhance/                 # M4 类：Electron 对象增强命名空间
│   └── BaseWindow.js
├── index.js                 # 根入口（便利层：聚合主端模块导出）
└── preload.js               # preload 聚合入口
```

### 5 类顶层目录的角色边界

| 顶层目录 | 角色 | 进程约束 | 是否含 IPC 状态 |
|---|---|---|---|
| `shared/` | 跨模块复用的通用基础设施，纯函数为主 | 三端可 require（§3.4） | 否 |
| `service/` / `notice/` | toolkit 的桥接机制承重墙；定义 IPC channel 与 schema 协议 | 主端 + preload | 是 |
| `capability/` | 主端能力模块容器，模块仅含 main（无 preload 侧） | 主端 | 否（模块自身无 IPC；schema 经 Service / Notice 暴露） |
| `enhance/` | Electron 既有对象的封装/抽象，纯主端工具 | 主端 | 否 |

`src/index.js` 与 `src/preload.js` 是 **packaging 便利层**，不归任何分类目录 —— 只汇出/装配下层模块，不持有任何逻辑、不引入新职责。

### 入口文件命名约定

- 具备主端 + preload 双侧的模块（`service/` / `notice/`）：入口为 `main.js`（主端）与 `preload.js`（preload 侧），配套 `protocol.js` 集中模块私有协议契约
- 仅有单侧入口的模块（`shared/serializer/`、`capability/<name>/`）：入口为 `index.js`（Node 惯例）
- 单类导出的增强模块（如 `enhance/BaseWindow.js`）：文件名即类名，不另设 `index.js`

规则：**双侧用语义命名（`main` / `preload`），单侧用 Node 惯例（`index`）**。

---

## §6 模块依赖关系

### 依赖图

```
                shared/serializer (M1) ─── shared/envelope.js ─── shared/naming.js
                          ▲                       ▲                     ▲
                          │                       │                     │
                          └───────────┬───────────┴─────────┬───────────┘
                                      │                     │
                              service (M2)             notice (M3)
                              main/preload             main/preload
                                      │                     │
                                      └──────────┬──────────┘
                                                 ▼
                                         preload.js（聚合入口）
                                                 │
                                                 ▼
                                     contextBridge.exposeInMainWorld
                                     → window.appService / window.appNotice


   enhance/BaseWindow (M4) ── 仅依赖 electron + lodash.merge，无内部依赖

   capability/ (M5 契约) ── 模块零依赖 M2 / M3；其 serviceSchema / noticeSchema
                            在用户调 Service.init / Notice.init 时被消费
```

### 依赖矩阵

| 模块 → 依赖 | shared/serializer | shared/envelope | shared/naming | M2 Service | M3 Notice | M4 BaseWindow | electron | lodash.merge |
|---|---|---|---|---|---|---|---|---|
| M1 shared/serializer | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| shared/envelope | ✗ | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| shared/naming | ✗ | ✗ | — | ✗ | ✗ | ✗ | ✗ | ✗ |
| M2 Service | ✓ | ✓ | ✓ | — | ✗ | ✗ | ✓ | ✗ |
| M3 Notice | ✓ | ✓ | ✓ | ✗ | — | ✗ | ✓ | ✗ |
| M4 BaseWindow | ✗ | ✗ | ✗ | ✗ | ✗ | — | ✓ | ✓ |
| M5 capability | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | 按需 | 按需 |
| `src/index.js` | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ |
| `src/preload.js` | ✗ | ✗ | ✗ | ✓（preload） | ✓（preload） | ✗ | ✓ | ✗ |

**登记规则**：任何跨模块依赖新增/修改，必须**同步**更新本矩阵 + 相关 M spec 头部 `## 依赖与被依赖` 小节。review 时缺失双写视为不合规。

---

## §7 跨模块共享契约

本章是**跨模块契约的唯一真理源**。M1-M5 spec 涉及以下契约的段落均以"参见架构 §7.X"形式引用，禁止复述。

### §7.1 IPC 应答信封

**形态**：所有 IPC 应答统一使用信封：

```js
{ ok: true,  data:  <serialize 后的值> }    // 成功
{ ok: false, error: <serialize 后的 Error> } // 失败
```

**物理位置**：`shared/envelope.js` 单一定义：

```js
// shared/envelope.js
const okEnvelope    = data  => ({ ok: true,  data });
const errorEnvelope = error => ({ ok: false, error });
module.exports = { okEnvelope, errorEnvelope };
```

**使用**：M2/M3 主端与 preload 直接 `require('../shared/envelope')`。禁止在各模块 protocol.js 或其他位置复写 envelope 定义。

**适用范围**：Service 异步通道 / 同步通道 / 元通道；Notice 元通道。**Notice 推送通道 `notice:event` 不走信封**（单向流无返回值）。

### §7.2 IPC 序列化契约（`serializeForIpc`）

**规则**：所有 IPC 主端响应的序列化必须使用 `serializeForIpc()` 封装（M1 提供）：

```js
// shared/serializer/index.js 内新增
function serializeForIpc(value) {
    return serialize(value, { strict: false });
}
```

**理由**：
- 生产环境 IPC 路径永不抛错（§3.3）—— 内部硬编码 `strict: false`，业务代码零手动传参
- 未来若加新 IPC 通道，只需调 `serializeForIpc()`，不会漏写 `{ strict: false }`
- 契约集中于 M1 内部，未来演进（如加统一 `onError` 上报）只改一处

**M2/M3 调用点**：service/main.js、service/preload.js、notice/main.js 全部 `serialize(x, { strict: false })` 调用改为 `serializeForIpc(x)`。

**`serialize` 全局默认**：`strict` 默认为 `false`（硬编码，不再读 `NODE_ENV`）。开发环境用户若想暴露序列化真 bug，主动 opt-in：
```js
if (process.env.NODE_ENV !== 'production') {
    configureSerializer({ strict: true });
}
```

### §7.3 错误还原契约（`reviveError`）

**公开出口**：`reviveError` 是公开 API，从 `shared/serializer.reviveError` 导出。同 `exposeAPI` 一样属"IPC 辅助工具族"。

**三层契约**：

- **主契约**：预期输入形态为 `serialize(err)` 的输出 —— `{ name?, message?, stack?, code?, cause? }` 对象；按各字段构造对应 Error 子类（`Error` / `TypeError` / `RangeError` / `SyntaxError` / `ReferenceError` / `EvalError` / `URIError`），未知 `name` 回退到 `Error` 但保留 `name` 字段
- **兜底行为**：任何异常输入（`null` / `undefined` / 非对象 / 结构异常对象）→ `new Error(String(input))`，返回一个信息不完整但可用的 Error 实例
- **永不抛错**：`reviveError` 本身**在任何输入下都不抛异常**，符合 §3.3 IPC 路径永不抛错精神

**架构意义**：远端 envelope.error 结构即便损坏，preload 端 `throw reviveError(error)` 也能保证 renderer catch 到的始终是 Error 实例。

### §7.4 命名口径

**统一正则**：`namespace` / `handler` 名 / `event` 名三者均须符合 `/^[A-Za-z_][A-Za-z0-9_]*$/`（合法 JS 标识符）。

**物理位置**：`shared/naming.js` 单一定义：

```js
// shared/naming.js
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
function isValidIdentifier(s) {
    return typeof s === 'string' && IDENTIFIER_RE.test(s);
}
module.exports = { IDENTIFIER_RE, isValidIdentifier };
```

**唯一性口径**：
- Service 内 `namespace` 全局唯一（`Service.init` 内冲突抛错）
- Notice 内 `namespace` 全局唯一
- 跨 Service / Notice 允许同名；capability 期望三者（目录名 / serviceSchema.namespace / noticeSchema.namespace）一致

**理由**：所有三者都会作为渲染端 API 属性名参与 dot access（`appService.foo.bar` / `appNotice.foo.userLoggedIn`），合法 JS 标识符保证无一例外用 dot 语法。

### §7.5 Schema Validator

**M2 导出**：`validateServiceSchema(schema)` —— 校验 namespace 合法、handlers 是对象、每个 handler 名合法、sync / needsEvent 列表元素在 handlers 内。

**M3 导出**：`validateNoticeSchema(schema)` —— 校验 namespace 合法、events 数组、每个 event 名合法。

**使用**：
- M2 `registerService` / M3 `registerSchema` 内部调用，抽取现有内联校验
- 公开导出供用户自定义 IPC 或 capability 测试 delegate 使用

**M5 capability 测试**：不再自己写命名正则；直接调 `validateServiceSchema` / `validateNoticeSchema`（delegate 到单一真理源）。

### §7.6 `configureSerializer` 每进程独立

**特性**：`shared/serializer` 的 `globalDefaults` 是模块级私有变量，主进程 / 渲染进程 / preload **各有一份**。

**含义**：用户在主端调 `configureSerializer({...})` 只影响主进程 serialize 默认；若渲染进程想直接调 `serialize`，需在渲染进程再调一次。

**影响**：业务代码几乎不受影响，因为业务不直接调 `serialize` —— IPC 路径经 `serializeForIpc` 硬编码 `strict:false`，业务经 IPC 时永远安全。此特性只在两种场景生效：
1. 用户主端/渲染端直接调 `serialize` / `safeStringify`（如 logger 场景）
2. 用户实现自定义 IPC 通道，手动调 `serialize`

### §7.7 protocol.js 模块归属

`service/protocol.js` 与 `notice/protocol.js` 只承载**模块私有协议**：

- Service：`META_LIST_CHANNEL`、`asyncChannel(ns, name)`、`syncChannel(ns, name)`
- Notice：`EVENT_CHANNEL`、`META_GET_SCHEMA_CHANNEL`

**envelope 已上收到 `shared/envelope.js`（§7.1），protocol.js 不再持有 envelope 定义**。M2/M3 主端和 preload 直接 `require('../shared/envelope')`，不通过 protocol.js re-export。

---

## §8 shared/ 准入规则

4 条硬约束。任何进入 `shared/` 的代码必须**同时**满足。违反任何一条 → 应从 shared/ 剥离（去 capability / enhance / 用户主项目 / 删除）。

### 规则 1：进程无关性

`shared/` 内代码必须在**主进程、渲染进程、preload 三端**都可 `require` 且行为一致。**禁止**依赖：

- `electron`（任何模块 / API）
- `process.env.*`（**无例外**；模块加载时读 env 亦禁止）
- `fs`、`path`、`os`、`child_process` 等 Node 平台 API
- 任何绑定进程 / 运行时的第三方库

**校验**：任何 `shared/` 内代码在浏览器环境 `require` 后必须能正常运行（除非该文件本就未被渲染进程加载路径引用）。

### 规则 2：无业务 domain

`shared/` 只放**跨模块复用的通用基础设施**（IPC 序列化、envelope、命名规则等）。**禁止**：

- 业务 domain 数据（业务枚举、业务配置、领域实体）
- 只被某个特定 capability / 模块使用的代码 —— 归模块私有

**判定线**：若一段代码只有某个模块会用 → 放模块内部，不进 shared。

### 规则 3：最小化第三方依赖

`shared/` 因需在三端 require，其间接依赖也会被三端消费（含 preload/渲染进程 bundle 体积）。**禁止**在 `shared/` 内新增第三方依赖，除非有硬理由且经架构 review。

**当前基线**：`shared/serializer`、`shared/envelope`、`shared/naming` 均零第三方依赖 —— 这是目标。

### 规则 4：状态封闭

`shared/` 代码**优先纯函数**。如需状态（如 `configureSerializer` 的全局默认），应**仅限模块内部私有状态**（模块级 `let` 变量，不导出），不得暴露可变全局共享状态供跨模块交叉写。

**示例合规**：`shared/serializer/limits.js` 内 `globalDefaults` 是模块级私有，仅通过 `configureSerializer` setter 修改 —— 每进程独立（§7.6）。

---

## §9 新增模块判定与扩展规则

### §9.1 决策树

新增模块时按序问自己：

1. **是新的 IPC 桥接机制？**（如"渲染→主的流式通道"）→ 提升到 `service/` / `notice/` 同级顶层。极少发生。
2. **需要在渲染进程加载？**（受 §3.2 约束）→ `shared/`。且必须**同时**过 §8 全部 4 条准入规则。
3. **是主端"本地能力"（fs / os / net / db 等）供渲染进程消费？** → `capability/`。必须至少导出一个 schema（`serviceSchema` 或 `noticeSchema`），否则应放 `enhance/`。
4. **是 Electron 既有对象（BrowserWindow / Menu / Tray / app 等）的封装 / 抽象？** → `enhance/`。
5. **是跨模块（≥2）复用的通用主端工具？** → `shared/`。同样过 §8 全部 4 条准入。
6. **只被单一模块使用的私有工具？** → 放该模块目录内私有。
7. **都不匹配？** → 触发架构 review，可能是新分类信号。

### §9.2 命名约定

- 双侧模块（含 main + preload）→ `main.js` + `preload.js` + `protocol.js`
- 单侧模块 → `index.js`（Node 惯例）
- 单类导出的增强模块 → 文件名即类名（如 `BaseWindow.js`）
- `enhance/` 内部组织自由 —— 简单单类 `enhance/<Name>.js`，复杂模块可用子目录

### §9.3 capability 特殊约束

capability 模块**必须**至少导出一个 schema（`serviceSchema` 或 `noticeSchema`）—— 否则该模块无法暴露给渲染端，沦为纯主端工具，正确归宿是 `enhance/` 而非 `capability/`。

**运行时不校验**（无自然注入点），review 时依据本条打回。

若两个 schema 都定义，二者 `namespace` 应当一致（M5 §2.3；不强制）。

---

## §10 发布形态

### §10.1 `package.json` `exports` 字段

```json
{
  "exports": {
    ".":                  "./src/index.js",
    "./preload":          "./src/preload.js",
    "./service":          "./src/service/main.js",
    "./service/preload":  "./src/service/preload.js",
    "./notice":           "./src/notice/main.js",
    "./notice/preload":   "./src/notice/preload.js",
    "./capability/*":     "./src/capability/*/index.js",
    "./enhance/*":        "./src/enhance/*.js"
  }
}
```

- 根入口 `.` 暴露便利层（`{ Service, Notice, BaseWindow, shared, VERSION }`）
- 桥接机制 `./service` / `./notice` 与各自 `./preload` 分别暴露 main 与 preload 侧
- 通配符 `./capability/*` —— 新增 capability drop-in 即生效
- 通配符 `./enhance/*` —— 覆盖单文件形态；未来子目录复杂 enhance 模块需补静态条目
- `./preload` 暴露聚合入口（详见 §10.5）

### §10.2 无 build，直接发布 `src/`

**决策**：toolkit **不做 build 步骤**，直接从 `src/` 发布。

**理由**：源码是合法 CJS，peerDependency 由 runtime 解析。之前的教训是引入 rollup 会强加 lazy-require 包装（`*2.js` / `_virtual/` 结构），bundle 反而膨胀；退化到 `fs-extra.copy` 只是一次无意义搬运；进一步**连 copy 都不需要**。

**具体表现**：
- `package.json` 无 `"build"` 脚本
- `"files": ["src"]` —— 只发布 src 目录
- 测试代码不在 src 目录内（见 §10.6），发布时天然排除
- 无 `dist/` / `dist-test/` / `scripts/` 目录
- 无 `fs-extra` 依赖

**未来重议**：若未来需要 TS 迁移 / tree-shaking / 代码混淆等，走 §11 治理流程重新决策，不可"随手改 build"。

### §10.3 peer 依赖版本反推方法论

**规则**：`peerDependencies` 版本范围**必须**根据 toolkit 实际使用的 API 特性反推 —— API 用到什么、版本范围就从那个版本起，不许拍脑袋定精确版本。

**本轮盘点结果**：

| 使用的 API | 最低 electron 版本 |
|---|---|
| `err.cause`（ES2022） | 15.0（首个附带 Node 16 的版本） |
| `process.contextIsolated` | 12.0 |
| `ipcMain.handle` / `ipcRenderer.invoke` / `ipcMain.removeHandler` | 7.0 |
| `contextBridge.exposeInMainWorld` | 5.0 |
| 其余 API（`ipcMain.on` / `BrowserWindow` / `webContents.send` 等） | ≤ 5.0 |

**当前值**：`peerDependencies.electron: ">=15.0.0"`。

### §10.4 JSDoc 规范

**规则**：所有**公开 API**（含 subpath export、`shared` 导出、`exposeAPI` / `reviveError` / `configureSerializer` / `serializeForIpc` / `validateServiceSchema` / `validateNoticeSchema` 等辅助）**必须**带符合 JSDoc 规范的注释，覆盖 `@param` / `@returns` / `@throws` / `@example`（关键 API）。

**理由**：toolkit **不提供 .d.ts 类型定义**（历史 overview §8.3 的承诺废除 —— 手写 .d.ts 长期维护成本远超收益）。JSDoc 让 IDE 能推导类型；未来若真需 TS，走 §11 治理流程重议。

**内部私有函数**：按需，不强制。

### §10.5 preload 聚合入口契约

`src/preload.js` 承担两个责任：

1. **`contextBridge.exposeInMainWorld` 样板** —— 把桥接机制的 preload 子模块的输出安全暴露给渲染端
2. **opt-out 装配** —— 用户可选择跳过某个 bridge，避免因主端未 `init` 而 `sendSync` 死锁

**用户接触面**：

```js
require('@base-client/toolkit/preload').init();                          // 默认全装
require('@base-client/toolkit/preload').init({ service: true, notice: true }); // 等价
require('@base-client/toolkit/preload').init({ notice: false });         // opt-out
```

**关键契约**：
- 若主端未 init Service / Notice，preload 必须在 opts 中 opt-out（详见 §3.5 死锁风险）
- `init()` 只能调一次（详见 §3.5）
- 未来新增桥接机制才会扩展 opts 字段；capability / enhance **永远不通过聚合入口暴露**
- `exposeAPI` **对外导出**（作为 packaging 便利层的对外辅助函数）—— 用户暴露自定义 bridge 时可复用；Electron 原生 `contextBridge.exposeInMainWorld` 仍可独立调用

### §10.6 测试目录组织

测试代码**不在** `src/` 内。物理位置：项目根 `tests/`，内部**镜像 `src/` 结构**：

```
tests/
├── preload-aggregator.test.js
├── service/*.test.js
├── notice/*.test.js
├── enhance/
│   ├── _electron-mock.js        # BrowserWindow 共享 mock fixture（§11.8）
│   └── *.test.js
├── shared/serializer/*.test.js
└── capability/example/*.test.js
```

**vitest.config.mjs**：`include: ['tests/**/*.test.js']`。

**发布**：`"files": ["src"]` 天然不含 `tests/`。

### §10.7 依赖与运行时约束

- `peerDependencies.electron`：按 §10.3 方法论，当前 `">=15.0.0"`
- `dependencies`：`lodash.merge`（M4 使用）
- `devDependencies`：`vitest`（无 `fs-extra`，无 rollup 相关）

---

## §11 文档治理

### §11.1 章节篇幅硬红线

- **本架构文档每章 ≤ 6KB**
- 超标即触发红线：要么内容过细（该下沉到 M spec）、要么该拆章
- review 时视为不合规

### §11.2 内容划分规则（R1）

**"跨模块 vs 模块内"硬边界**：

**架构文档写**：
- 涉及 ≥2 个模块的契约（envelope、序列化契约、错误还原、命名口径、schema validator 等）
- 共享基础设施（shared/ 里放什么、准入规则）
- 架构级不变量（§3 全部）
- 模块分类、依赖图、新模块归属
- 发布形态（exports、无 build、peer 版本、JSDoc、preload 聚合、测试目录）
- 文档治理规则（本章）

**M1-M5 spec 写**：
- 模块定位（"我是什么"）
- 模块**私有协议**（channel 命名、handler 签名）
- 主端流程 / preload 流程 / API contract / 文件结构
- 引用架构文档的位置显式标注（"参见架构 §X"）

**任何一段内容归哪里都是二元判定**：涉及 ≥2 个模块 → 架构文档；模块内 → M spec。

### §11.3 M spec 跨模块段落改写规则

M1-M5 spec 里跨模块段落改写形式：

- **一句概述** + **"（详见架构 §X）"**
- **禁止**保留原完整段落 + 加"single source"标签 —— 允许复述 = 允许漂移

**示例**：M2 §3.2 现有 20 行 envelope 描述 →
> "IPC 应答使用统一信封 `{ ok, data?, error? }`（envelope 定义与错误还原契约详见架构 §7.1 / §7.3）"

### §11.4 M6+ 编写顺序

新增 M6+ 时：

- **若触碰跨模块契约**（新加共享工具 / 修 envelope / 加 IPC 通用规则 / 加命名规则）→ **必须先立架构文档 PR**，再回 M6 spec
- **若只是模块私有内容** → 直接写 M6 spec，架构文档只需更新 §5 模块划分表 + §6 依赖矩阵

**顺序违反**（先写 M6 spec 后改架构文档）视为不合规。

### §11.5 spec ↔ 代码映射

每份 M spec 头部加 `## 落地文件` 小节，列该模块关键源文件路径。例如 M2 spec 头部：

```
## 落地文件
- 主端入口：src/service/main.js
- preload 入口：src/service/preload.js
- 私有协议：src/service/protocol.js
```

**目的**：防止契约漂移 —— overview §8.2 "同步修"事件的根因就是 spec ↔ 代码未登记。

### §11.6 模块依赖登记

**双向登记**：

- **架构 §6 依赖矩阵**：全局视图
- **每 M spec 头部 `## 依赖与被依赖` 小节**：局部登记

新增任何跨模块依赖必须两处**同步**更新。缺失双写视为不合规。

### §11.7 TDD 工作流

所有新增功能、修复、重构必须遵循 TDD：

- 先写失败测试 → 实现最小代码通过 → 重构
- M1-M5 现有代码（一次性删除的旧 plans 记录了 TDD 步骤）是范本；M6+ 沿用

### §11.8 Mock 策略分域规则

测试代码 mock `electron` 按 **API 域**分风格：

- **BrowserWindow 相关**测试 → 用共享 fixture `tests/enhance/_electron-mock.js`
- **ipcMain / ipcRenderer / contextBridge 相关**测试 → 各自内联 `vi.mock('electron', ...)`

**理由**：两种 API 域 mock 语义天然不同（BrowserWindow 是"对象生命周期"，IPC 是"消息传递"），强扭一致的复杂度不值得。规则划分适用面即可。

### §11.9 活文档同步约束

- 本架构文档是**活文档**；模块边界或职责调整应**反过来更新本文档**保持一致
- 架构文档变更必须**先于**相关代码/M spec 变更 —— 契约先立，代码兑现
- 违反此顺序（代码/M spec 已改但架构文档未同步）视为不合规
