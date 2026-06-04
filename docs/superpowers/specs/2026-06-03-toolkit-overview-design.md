# Toolkit 总设计（Overview）

## 一、定位

`@base-client/toolkit` 是面向 Electron 客户端项目的**可选增强能力包**。按能力垂直切片组织：每个能力自含主端代码、preload 桥接（若有）、协议契约；能力之间相互独立，仅共享底层基础设施。用户按需引入。

toolkit 不是统一运行时框架，也不向用户运行时代码注入任何全局状态——所有能力都是用户在主端 `require` + 显式 `init` 才生效。

## 二、设计目标

1. **严格按需引入**
   每个模块可独立使用，模块间不互相依赖（仅共享底层 `shared/`）。装了某模块不代表它会自动接入 Service / Notice，由用户在主端显式挂载（`Service.init({ userSchemas: [...] })`）。

2. **渲染进程零本地 I/O**（核心架构原则）
   渲染进程不直接接触文件系统、操作系统资源、进程信息等本地能力。所有此类能力归主进程，通过 Service 桥接为渲染端可调用接口；主→渲染推送通过 Notice。

3. **垂直切片自包含**
   每个模块自含 main + preload（若需要）+ protocol。新增模块不需要在多个目录间协调改动，channel 名 / payload 形状有唯一真理源。

4. **IPC 安全**
   所有 IPC payload 经 `shared/serializer` 统一编码，业务零修改，永不因不可克隆字段（函数 / Symbol / 类实例 / 循环引用 / Date / Buffer 等）而崩溃。

5. **零运行时侵入**
   `require` 模块不产生副作用，所有生效必须经用户显式 `init` 调用；用户 preload / main 入口完全由用户掌控，toolkit 只提供工具与机制。

## 三、核心能力

- **IPC 桥接（Service / Notice）**：Service 提供渲染→主双向调用（异步 `invoke` / 同步 `sendSync`）；Notice 提供主→渲染推送（broadcast / direct）。两者均自动经 `shared/serializer` 编码 payload，保证 IPC 安全。

- **窗口抽象（BaseWindow）**：在 Electron `BrowserWindow` 之上提供类模板（模板方法 + 钩子），让业务窗口以子类形式声明 URL / options / 生命周期回调。

- **IPC 安全序列化（shared/serializer）**：把任意输入（含函数 / Symbol / 类实例 / 循环引用 / Date / Buffer 等）安全转换为可经 IPC 传输的 plain 数据；同时导出 `safeStringify` 供日志类场景复用；含 `reviveError` 把序列化的错误还原为 Error 实例。

- **主端能力模块接入约定**（`capability/` 命名空间）：约定主端能力模块的导出形态——直接 API + 可选 `serviceSchema` + 可选 `noticeSchema`——以及由用户在 `Service.init` / `Notice.init` 显式挂载的注册路径。`capability/` 是这类模块的家，附最小参考示例供后续能力对齐。

- **Electron 对象增强约定**（`enhance/` 命名空间）：约定 Electron 既有对象（`BrowserWindow` / `app` / `Menu` / `Tray` 等）的封装/抽象模块归此命名空间。BaseWindow 是其中第一个。

- **根入口聚合（便利层）**：`./` 暴露 `{ Service, Notice, BaseWindow, shared, VERSION }`，供快速接入。subpath（`./service`、`./enhance/BaseWindow` 等）仍是按需精确导入的主要通道；根入口只是聚合引用，不触发任何 init / IPC 注册。

- **preload 聚合入口**：`./preload` 提供一行 `init()` 把所有桥接机制（Service / Notice）的渲染端 API 一次性安全暴露（统一承担 `contextBridge.exposeInMainWorld` 样板）。

## 四、模块划分

toolkit 物理结构按 **5 类顶层目录** 组织：

```
src/
├── shared/                  # 共享基础设施
│   └── serializer/
├── service/                 # IPC 桥接：双向调用
│   ├── main.js
│   ├── preload.js
│   └── protocol.js
├── notice/                  # IPC 桥接：主→渲染推送
│   ├── main.js
│   ├── preload.js
│   └── protocol.js
├── capability/              # 主端能力命名空间
├── enhance/                 # Electron 对象增强命名空间（内部组织自由）
│   └── BaseWindow.js
├── index.js                 # 根入口（便利层：聚合主端模块导出）
└── preload.js               # preload 聚合入口（contextBridge 样板 + 装配桥接的渲染端 API）
```

### 5 类顶层目录的角色边界

| 顶层目录 | 角色 | 是否含 IPC 状态 |
|---|---|---|
| `shared/` | 跨模块复用的工具基础设施，纯函数为主 | 否 |
| `service/` / `notice/` | toolkit 的桥接机制承重墙；定义 IPC channel 与 schema 协议 | 是 |
| `capability/` | 主端能力模块容器，模块仅含 main（无 preload 侧） | 否（模块自身无 IPC；schema 经 Service / Notice 暴露） |
| `enhance/` | Electron 既有对象的封装/抽象，纯主端工具 | 否 |

`src/index.js`（根入口聚合）与 `src/preload.js`（preload 聚合入口）是 **packaging 便利层**，不归任何分类目录——它们只汇出/装配下层模块，不持有任何逻辑、不引入新职责。

### 入口文件命名约定

- 具备主端 + preload 双侧的模块（`service/` / `notice/`）：入口为 `main.js`（主端）与 `preload.js`（preload 侧），配套 `protocol.js` 集中协议契约。
- 仅有单侧入口的模块（`shared/serializer/`、`capability/<name>/`）：入口为 `index.js`（Node 惯例）。
- 单类导出的增强模块（如 `enhance/BaseWindow.js`）：文件名即类名，不另设 `index.js`。`enhance/` 内部组织自由——简单的单类直接放 `enhance/<Name>.js`，复杂模块（多文件）可用子目录。

规则：**双侧用语义命名（`main` / `preload`），单侧用 Node 惯例（`index`）**。

### 新增模块的归属判定
- 是新桥接通道？→ 升级到第一层（极少）。
- 是渲染端没有的本地能力？→ 放 `capability/`。
- 是 Electron 既有对象的封装/抽象？→ 放 `enhance/`。
- 是跨模块共享的纯工具？→ 放 `shared/`。

### 本轮总设计涵盖的详细模块

| # | 模块 | 位置 | 形态 | 详细设计文档 |
|---|---|---|---|---|
| **M1** | serializer | `shared/serializer/` | 纯函数库 | `2026-05-27-toolkit-m1-serializer-design.md` |
| **M2** | Service | `service/` | main + preload + protocol | `2026-06-03-toolkit-m2-service-design.md` |
| **M3** | Notice | `notice/` | main + preload + protocol | `2026-06-03-toolkit-m3-notice-design.md` |
| **M4** | BaseWindow | `enhance/` | 仅 main | `2026-06-03-toolkit-m4-base-window-design.md` |
| **M5** | 主端能力模块接入约定 + 参考示例 | `capability/` | 契约文档 + 最小示例代码 | `2026-06-03-toolkit-m5-capability-contract-design.md` |

## 五、模块依赖关系

```
                shared/serializer (M1)
                          ▲
                          │
                          │（IPC 编码/反编码 + 错误还原）
                          │
                ┌─────────┴─────────┐
                │                   │
        service (M2)           notice (M3)
        main/preload           main/preload
                │                   │
                │                   │（preload 子模块）
                └────────┬──────────┘
                         ▼
                 preload.js（聚合入口）
                         │
                         ▼
                 contextBridge.exposeInMainWorld
                 → window.appService / window.appNotice


   enhance/BaseWindow (M4) ── 仅依赖 electron，无内部依赖

   capability/ (M5 契约) ── 模块零依赖；其 serviceSchema / noticeSchema
                            在用户调 Service.init / Notice.init 时被消费
                            （仅数据流入，不构成代码依赖）
```

- **M1 (serializer)** 是基础设施，被 M2 / M3 双向使用，本身零依赖。
- **M2 (Service)** 与 **M3 (Notice)** 是桥接机制，相互独立，同向依赖 M1。
- **M4 (BaseWindow)** 与 M1–M3 完全解耦。
- **preload 聚合入口** 依赖 M2 / M3 的 preload 子模块 + `electron.contextBridge`。
- **根入口聚合（`src/index.js`）** 引用 M2 / M3 / M4 的主端导出与 `shared/`，仅为对外便利层，不触发任何 init / IPC 注册。
- **M5（capability 契约）** 本身无运行时代码依赖；但设计上引用 M2 / M3 的 protocol（`serviceSchema` / `noticeSchema` 形状由 M2 / M3 定义），故 M5 详细设计需在 M2 / M3 稳定之后。

## 六、实施顺序

四个代码模块（M1–M4）+ 一个契约模块（M5）均按最小独立粒度划分，每个都可独立详细设计、独立实现、独立验证。

### 详细设计阶段（本轮）

```
M1（已有 spec，复审）
   ↓
M2 草案 → 确认 → spec → review     ┐
M3 草案 → 确认 → spec → review     │ (M2 / M3 可并行)
   ↓ (M2 / M3 稳定后)
M5 草案 → 确认 → spec → review     ┐
M4 草案 → 确认 → spec → review     │ (M5 / M4 与彼此独立)
```

每份详细设计走"草案 → 用户确认 → 写入 spec → review"的小闭环。所有详细设计全部定稿后再统一启动实现计划。

### 实现阶段（详细设计全部定稿后单独启动）

1. **基础层**：M1 serializer。
2. **桥接层**：M2 Service、M3 Notice（可并行）。
3. **能力空间约定**：M5 落地 capability 命名空间约定 + 参考示例代码（无重型实现）。
4. **增强层**：M4 BaseWindow（任意时序）。

每个模块实现完成、独立验证通过，再进下一个。

## 七、文档结构

```
base-client-toolkit/docs/superpowers/specs/
├── 2026-06-03-toolkit-overview-design.md               # 本总设计
├── 2026-05-27-toolkit-m1-serializer-design.md          # M1 详细设计
├── 2026-06-03-toolkit-m2-service-design.md             # M2 详细设计
├── 2026-06-03-toolkit-m3-notice-design.md              # M3 详细设计
├── 2026-06-03-toolkit-m4-base-window-design.md         # M4 详细设计
└── 2026-06-03-toolkit-m5-capability-contract-design.md # M5 详细设计
```

> 本总设计是活文档。各模块详细设计若需调整模块边界或职责，应反过来更正本总设计，保持一致。

## 八、包发布形态

### 8.1 `package.json` `exports` 字段

```json
{
  "exports": {
    ".":                  "./dist/index.js",
    "./preload":          "./dist/preload.js",
    "./service":          "./dist/service/main.js",
    "./service/preload":  "./dist/service/preload.js",
    "./notice":           "./dist/notice/main.js",
    "./notice/preload":   "./dist/notice/preload.js",
    "./capability/*":     "./dist/capability/*/index.js",
    "./enhance/*":        "./dist/enhance/*.js"
  }
}
```

要点：

- 根入口 `.` 暴露便利层（`{ Service, Notice, BaseWindow, shared, VERSION }`）
- 桥接机制 `./service` / `./notice` 与各自 `./preload` 子路径分别暴露 main 与 preload 侧
- 通配符 `./capability/*` —— 新增 capability 模块 drop in 目录即生效，无需改 `package.json`（依赖 M5 §2.1 强制"目录 + `index.js`"形态）
- 通配符 `./enhance/*` —— 覆盖直接单文件形态的 enhance 模块。若未来出现使用子目录形态的复杂 enhance 模块，需要补静态条目（如 `"./enhance/<group>/<name>": "..."`）
- `./preload` 暴露聚合入口（详见 §8.2）

### 8.2 preload 聚合入口契约

`src/preload.js` 是 packaging 便利层，承担两个责任：

1. **`contextBridge.exposeInMainWorld` 样板** —— 把桥接机制的 preload 子模块（M2 `service/preload.js` 与 M3 `notice/preload.js`）的输出安全暴露给渲染端
2. **opt-out 装配** —— 用户可选择跳过某个 bridge，避免因主端未 `init` 而 `sendSync` 死锁

#### 用户接触面

```js
// 默认装全部桥接（最常用）
require('@base-client/toolkit/preload').init();

// 等价：显式声明
require('@base-client/toolkit/preload').init({ service: true, notice: true });

// opt-out：用户主端只 init 了 Service，preload 端跳过 notice
require('@base-client/toolkit/preload').init({ notice: false });
```

#### 实现草案

```js
const { contextBridge } = require('electron');
const buildAppService = require('./service/preload');
const buildAppNotice  = require('./notice/preload');

function exposeAPI(name, api) {
    if (process.contextIsolated) {
        contextBridge.exposeInMainWorld(name, api);
    } else {
        window[name] = api;
    }
}

function init(opts = {}) {
    const { service = true, notice = true } = opts;
    if (service) exposeAPI('appService', buildAppService());
    if (notice)  exposeAPI('appNotice',  buildAppNotice());
}

module.exports = { init };
```

#### 关键契约

- **若主端未 init Service / Notice，preload 端必须在 opts 中 opt-out 对应 bridge**（设为 `false`）——否则 `buildAppService` / `buildAppNotice` 内的 `sendSync` 元通道因无 listener 而**永久阻塞渲染进程**（`ipcRenderer.sendSync` 无原生 timeout 机制）
- `init()` 应**只调用一次**——同名 `exposeInMainWorld` 二次调用会抛错。重复调用属违规，不做防护
- 未来新增桥接机制（极少）才会扩展 opts 字段；capability / enhance 模块**永远不通过聚合入口暴露**——它们无 preload 侧
- `exposeAPI` **不对外导出**——是 packaging 便利层的内部样板。用户若需暴露自定义 bridge，直接调 Electron 原生 `contextBridge.exposeInMainWorld`

### 8.3 依赖与运行时约束

- `peerDependencies.electron`：`>=22.3.1`——最低支持版本；不上限，后续 Electron 升级若有破坏性改动单独再决策
- toolkit 输出 `.d.ts` 类型定义（手写，与各模块 dist 产物配套）——覆盖 `Service.init` / `Notice.init/broadcast/direct` / `BaseWindow` 公开 API、`serviceSchema` / `noticeSchema` 形态、`appService` / `appNotice` 接触面
