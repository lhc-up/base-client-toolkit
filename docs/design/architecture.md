# Toolkit 架构设计

`@base-client/toolkit` 是面向 Electron 客户端项目的**可选增强能力包**。按能力垂直切片组织：每个能力自含主端代码、协议契约与可选的 schema 描述；能力之间相互独立，仅共享底层基础设施。用户按需引入。

toolkit **不是**统一运行时框架，也**不**向用户运行时代码注入任何全局状态——所有能力必须由用户在主端 `require` + 显式 `init` 才生效。

## 1. 设计目标

1. **严格按需引入**——每个模块可独立使用，模块间不互相依赖（仅共享底层 `shared/`）。装了某模块不代表它会自动接入 Service / Notice，由用户在主端显式挂载（`Service.init({ userSchemas: [...] })`）。
2. **渲染进程零本地 I/O**——渲染进程不直接接触文件系统、操作系统资源、进程信息等本地能力。所有此类能力归主进程，通过 Service 桥接为渲染端可调用接口；主→渲染推送通过 Notice。
3. **垂直切片自包含**——每个模块自含 main + preload（若需要）+ protocol。channel 名 / payload 形状有唯一真理源。
4. **IPC 安全**——所有 IPC payload 经 `shared/serializer` 统一编码，永不因不可克隆字段（函数 / Symbol / 类实例 / 循环引用 / Date / Buffer 等）而崩溃。
5. **顶层装配、按需引入**——capability 模块被 `require` 时借助 CommonJS 缓存机制**顶层完成一次运行时装配**（`log4js.configure` / `new Store` / `app.on('will-quit')` 等），无 init 生命周期。业务参数在函数被显式调用时以实参传入。Service / Notice 保留一次性 `init(...)` 挂载 schema。

## 2. 核心不变量

任何模块设计与以下承诺冲突就是错的，review 时对照检查。

### 2.1 `require` 有限副作用

模块被 `require` 时**允许** CommonJS 缓存一次即完成的副作用：消费 `main/paths.js#getFilePathConfig()` 建目录；顶层运行时装配；顶层 `require` 已声明的 DAG 依赖。

**仍不允许**：依赖业务侧参数；发起网络请求；注册 IPC channel（channel 挂载由 `Service.init` / `Notice.init` 承担）；capability 顶层 `require` Service / Notice（capability 只导出 schema 描述对象，是否注册由业务侧决定）。

### 2.2 渲染进程零本地 I/O

需在渲染进程加载的代码禁止 `require('electron')` / `require('fs')` 等 Node 或 Electron 本地模块。例外：preload 模块（必然依赖 `contextBridge` / `ipcRenderer`）与 capability 模块（跑在主进程）。当前需在渲染进程加载的 toolkit 代码只有 `shared/`，其准入规则见第 6 章。

### 2.3 IPC 路径生产环境永不抛错

所有 IPC 序列化经 `serializeForIpc()`（硬编码 `strict: false`）；主端 handler 永不 throw，异常一律封装为 `{ ok: false, error }` 返回；IPC 应答统一信封 `{ ok, data?, error? }`，preload 端解包路径唯一（`if (ok) return data; else throw reviveError(error)`）。

### 2.4 shared/ 进程无关

`shared/` 内代码必须在主进程、渲染进程、preload 三端都可 `require` 且行为一致。禁止依赖 `electron`、`process.env.*`、`fs`、`path` 等任何绑定进程/运行时的 API。准入规则见第 6 章。

### 2.5 preload 一次性 init

`require('@base-client/toolkit/preload').init()` 必须只调用一次；同名 `exposeInMainWorld` 二次调用抛错，重复调用属违规。**opt-out 契约**：主端未 init Service / Notice 时，preload 必须 opt-out 对应 bridge，否则 `sendSync` 元通道无 listener。

违约后果（实测 Electron 22.3.1，2026-11-21）：元通道 `sendSync` 没有 listener 时**不抛异常，而是阻塞 preload**，直到主进程回收这次 IPC 的 event 对象（取决于主进程 GC：自然等待实测约 8 秒，手动 GC 约 2 秒），之后返回 `{ error: 'reply was never sent' }`；这段时间页面加载被卡住，`did-finish-load` 随之推迟。toolkit 识别这个返回值（以及 `sendSync` 抛异常）后，对应 bridge 降级并 `console.warn` 指明「主进程未调用 X.init」：`appService` 为空对象，`appNotice` 只有顶层 `subscribe` / `unsubscribe` / `once`（调用即抛出说明原因的错误）；两个 bridge 各自装配，一个未 init 或装配抛错不影响另一个。阻塞本身无法在 preload 侧避免，所以 opt-out 仍是正确用法。

### 2.6 模块间依赖方向

Service / Notice / BaseWindow 相互独立，互不 `require`。capability 之间允许 DAG 依赖，libs 可被 capability 复用但不得反向依赖 capability。capability 依然不得顶层 `require` Service / Notice。

当前 capability DAG：`os` → `logger`；`store` → `logger`；`update` → `logger`、`os`；`download` / `archive` → `libs/*`（libs 不构成 capability 依赖）。

### 2.7 命名空间口径

Service 内 `namespace` 全局唯一（init 冲突抛错）；Notice 内同理；跨 Service / Notice 允许同名。capability 期望目录名 = `serviceSchema.namespace` = `noticeSchema.namespace`。`namespace` / handler 名 / event 名均须符合 `/^[A-Za-z_][A-Za-z0-9_]*$/`，保证渲染端 dot access 无一例外。

## 3. 目录与模块划分

```text
src/
├── main/
│   ├── capability/          # 希望通过 Service/Notice 提供给 renderer 的完整能力
│   ├── enhance/             # BaseWindow 等 Electron 对象增强
│   ├── libs/                # 主进程通用实现；简单模块用文件，复杂模块用目录
│   ├── paths.js             # 路径配置、目录初始化和缓存
│   └── index.js             # 主进程聚合入口（capability 懒加载）
├── preload/
│   └── index.js             # 应用级 preload 装配入口
├── service/                 # Service IPC 协议（main.js / preload.js / protocol.js）
├── notice/                  # Notice IPC 协议（main.js / preload.js / protocol.js）
└── shared/                  # main/preload 均可加载的纯共享代码
```

| 目录 | 角色 | 进程约束 |
|---|---|---|
| `shared/` | 跨模块复用的通用基础设施 | 三端可 require，零本地依赖 |
| `service/` / `notice/` | 桥接机制承重墙；IPC channel 与 schema 协议 | 主端 + preload |
| `main/capability/` | renderer 可直接使用的一件完整事情，一般含 `serviceSchema` 和/或 `noticeSchema` | 主进程 |
| `main/libs/` | 主进程通用实现，不直接暴露给 renderer | 主进程 |
| `main/enhance/` | Electron 既有对象的封装/抽象 | 主进程 |
| `main/paths.js` | 基础运行时配置 | 主进程 |

入口命名约定：双侧模块（`service/` / `notice/`）用语义命名 `main.js` + `preload.js` + `protocol.js`；单侧模块用 Node 惯例 `index.js`；单类导出的增强模块文件名即类名。

## 4. 模块依赖规则

依赖方向：`renderer → Service / Notice → main/capability → main/libs → shared`。

- `shared/` 三端可加载，零内部依赖
- Service / Notice 依赖 `shared/*` 与 `electron`
- `enhance/BaseWindow` 只依赖 `electron` + `lodash.merge`
- capability 顶层可 `require` `main/paths.js`、`main/libs/*`、`shared/*` 与其它 capability（DAG，禁止环），不得顶层 `require` Service / Notice
- libs 不得依赖 capability
- 专属于某个 capability 的逻辑留在 capability 内，不强制下沉到 libs

## 5. 跨模块共享契约

### 5.1 IPC 应答信封

所有 IPC 应答统一使用信封（`shared/envelope.js` 单一定义，禁止在各模块复写）：

```js
{ ok: true,  data:  <serialize 后的值> }    // 成功
{ ok: false, error: <serialize 后的 Error> } // 失败
```

适用范围：Service 异步通道 / 同步通道 / 元通道；Notice 元通道。**Notice 推送通道 `notice:event` 不走信封**（单向流无返回值）。

### 5.2 IPC 序列化（`serializeForIpc`）

所有 IPC 序列化必须使用 `serializeForIpc()`：内部硬编码 `strict: false`，生产环境 IPC 路径永不抛错；新增 IPC 通道不会漏写配置；未来演进（如统一 `onError` 上报）只改一处。

`serialize` 全局默认 `strict: false`。开发环境想暴露序列化真 bug 可主动 opt-in：`configureSerializer({ strict: true })`。

### 5.3 错误还原（`reviveError`）

- 预期输入为 `serialize(err)` 的输出 `{ name?, message?, stack?, code?, cause? }`，按 `name` 构造对应 Error 子类，未知 `name` 回退 `Error` 但保留字段
- 任何异常输入兜底为 `new Error(String(input))`
- 任何输入下自身不抛异常——远端结构即便损坏，renderer catch 到的始终是 Error 实例

### 5.4 命名口径

`namespace` / handler 名 / event 名统一正则 `/^[A-Za-z_][A-Za-z0-9_]*$/`，`shared/naming.js` 单一定义。唯一性口径见 §2.7。

### 5.5 Schema Validator

Service 导出 `validateServiceSchema(schema)`，Notice 导出 `validateNoticeSchema(schema)`。register 内部使用，同时公开供自定义 IPC 或 capability 测试 delegate——capability 测试不得自写命名正则。

### 5.6 `configureSerializer` 每进程独立

`shared/serializer` 的 `globalDefaults` 是模块级私有变量，主进程 / 渲染进程 / preload 各有一份。主端配置只影响主端；渲染进程直接调 `serialize` 需另行配置。业务经 IPC 时永远安全（`serializeForIpc` 硬编码 `strict: false`），此特性只在直接调 `serialize` / `safeStringify` 或实现自定义 IPC 通道时生效。

### 5.7 protocol.js 模块归属

`service/protocol.js` 与 `notice/protocol.js` 只承载模块私有协议（channel 命名）。envelope 定义在 `shared/envelope.js`，protocol.js 不持有、不 re-export。

## 6. shared/ 准入规则

4 条硬约束，进入 `shared/` 的代码必须同时满足；违反任何一条即应剥离。

1. **进程无关性**：三端可 `require` 且行为一致。禁止依赖 `electron`、`process.env.*`（无例外，模块加载时读 env 亦禁止）、`fs` / `path` / `os` / `child_process` 等 Node 平台 API、任何绑定进程/运行时的第三方库。
2. **无业务 domain**：只放跨模块复用的通用基础设施。禁止业务枚举/配置/领域实体；只被某个特定模块使用的代码归模块私有。
3. **最小化第三方依赖**：`shared/` 的间接依赖会被三端消费（含 preload/渲染 bundle 体积）。禁止新增第三方依赖，除非有硬理由且经架构 review。当前基线为零第三方依赖。
4. **状态封闭**：优先纯函数。如需状态仅限模块内部私有（模块级 `let`，不导出），不得暴露可变全局共享状态供跨模块交叉写。

## 7. 新增模块判定与扩展规则

新增模块时按序判定：

1. **新的 IPC 桥接机制？** → 提升到 `service/` / `notice/` 同级顶层。极少发生。
2. **需要在渲染进程加载？** → `shared/`，且必须同时过第 6 章全部准入规则。
3. **主端本地能力（fs / os / net 等）供渲染进程消费？** → `main/capability/`，必须至少导出一个 schema（`serviceSchema` 或 `noticeSchema`），否则应放 `main/enhance/` 或 `main/libs/`。
4. **主进程通用实现，不直接暴露给 renderer？** → `main/libs/`。简单模块用文件，复杂模块用目录。
5. **Electron 既有对象（BrowserWindow / Menu / Tray / app 等）的封装/抽象？** → `main/enhance/`。
6. **跨模块（≥2）复用的通用主端工具且需渲染端加载？** → `shared/`，过全部准入规则。
7. **只被单一模块使用的私有工具？** → 放该模块目录内私有。
8. **都不匹配？** → 触发架构 review，可能是新分类信号。

capability 特殊约束：必须至少导出一个 schema，否则无法暴露给渲染端，正确归宿是 `main/libs/` 或 `main/enhance/`。运行时不校验（无自然注入点），review 时依据本条打回。两个 schema 都定义时 `namespace` 应一致（不强制）。

## 8. 发布形态

### 8.1 `package.json` `exports`

包边界为显式子路径导出，**无根聚合入口**（`require('@base-client/toolkit')` 不可解析）。当前映射以 `package.json` 为准：`./main`、`./main/capability`、`./main/capability/*`、`./main/enhance/*`、`./main/libs/*`（目录型 libs 单独静态条目）、`./main/paths`、`./preload`、`./service`、`./service/preload`、`./notice`、`./notice/preload`、`./shared`。新增子路径必须同步补充 exports 条目与 `tests/runtime-exports.test.js` 的解析断言。

### 8.2 无 build，直接发布 `src/`

不做 build 步骤：源码是合法 CJS，peer 依赖由 runtime 解析。`package.json` 无 `build` 脚本，`"files": ["src"]` 只发布 src，测试在包外天然排除。若未来需要 TS / tree-shaking / 混淆，走架构 review 重新决策。

### 8.3 Electron 版本范围决定 Node 约束，不是反推

**方向是「声明 → 下界 → 约束代码」，不是「代码 → 反推声明」。**

本节原先写的是后者（"版本范围必须根据实际使用的 API 特性反推"），那是错的，有两层问题：
反推只能描述现状、约束不了任何新增代码；而且它自己就算错了 —— 原文由 `err.cause`
反推出 `electron: ">=15.0.0"`，但 `new Error(msg, { cause })` 是 **Node 16.9+**，
而 Electron 15 的内置 Node 是 **16.5**，根本没有它。声明比代码更宽，等于没约束。

正确的链条：

```
peerDependencies.electron（人决定，闭区间）
      ↓ 查 Electron → 内置 Node 映射
Node 区间（纯导出值，可实测核对 process.versions.node）
      ↓ 作为硬约束施加于 src/main
代码只能用该区间的公共子集
```

**当前声明：`electron: ">=22 <29"`**，对应 Node 区间：

| 端 | Electron | 内置 Node | 约束 |
|---|---|---|---|
| 下界 | 22 | **16.17**（已实测 `process.versions.node`，与 electron-vite 的映射表一致） | 不得使用引入版本高于 16.17 的 API |
| 上界 | 28 | **18.18** | 不得使用在 18.18 已被移除 / 改语义的 API |

**为什么是闭区间**：开放式 `>=` 的上界不可验证 —— 无法对尚不存在的 Node 做兼容检查，
声明了就是空头承诺。本文件其余五个 peer（`sudo-prompt` / `download` / `electron-store` /
`log4js` / `semver`）本来都是闭区间，electron 此前是唯一的破例。
另一个收益：区间越窄，可用 API 的交集越大 —— 从跨 8 个 Node 大版本缩到 2 个。

**扩大范围是一次显式决定**：要支持 Electron 29+ 必须改本节与 `peerDependencies`，
并重新核对两端约束，而不是靠开放式声明被动"自动支持"一批没验过的版本。

**⚠️ 当前语法与 API 两类都没有机器强制**，全靠人工遵守。原因是本包**没有构建步骤**
（见 8.2，直接发布 `src/`），所以这一侧既没有编译器也没有 linter：

| 类别 | 原理上编译期能挡吗 | 现状 | 暴露时机 |
|---|---|---|---|
| 语法（`??=`、顶层 await） | 能（node target / es-check） | 无 | 各消费者编译时，较早 |
| API（`structuredClone`、`fsp.cp`、`Object.hasOwn`） | **永远不能** —— 运行时全局/方法，webpack 原样输出 | 无 | **用户机器运行时**，最晚 |

两点放大了后果：① 直接发布 src 意味着两类问题都原样传给每个消费者；
② 本包测试跑在开发机 Node（18+）上，高版本 API 在那里完全可用、**测试照样全绿**。

**已落地的机制**：`eslint.config.js` 用 `eslint-plugin-n` 的四条规则
（`no-unsupported-features/{es-syntax,node-builtins,es-builtins}` 传入下界 +
`no-deprecated-api` 管上界）同时覆盖语法与 API 两类，不需要再叠 es-check 或构建。
`npm run lint` 执行，并挂在 `prepublishOnly` 上。

三条约束写在那个配置里、此处不复制（避免两处漂移），只记要点：

- **下界由本节的 peer 范围算出**，不手填。放宽 peer 时必须同时补映射表并实测
  `process.versions.node`，否则配置会直接抛错而非静默取错值
- **`version` 刻意不读 `engines.node`** —— 后者表达**开发工具链**要求（当前由 eslint 10
  的 `^20.19 || ^22.13 || >=24` 顶到 20.19，高于 vitest 2 的 18），与运行时下界是两个
  不同的数字；读错会放过 16.17 ~ 20 之间的全部 API
- **必须带 Node 全局表**（复用插件 `flat/recommended-script` 的 `languageOptions`）。
  实测不带时 `structuredClone` 被当未声明变量、**静默漏过**，而漏的恰好是最该抓的
  运行时全局那类

**仍未覆盖的两类**（lint 与构建都管不了，只有在目标环境真跑才行）：

- **依赖内部的用法** —— eslint 不检查 `node_modules`。`archiver` / `unzipper` 内部若用了
  高于下界的 API，两道闸都看不见
- **非语法非 API 的环境差异** —— OpenSSL provider、DNS 解析顺序、原生模块 ABI。
  当前暴露面小（SM4 是纯 JS 自实现、只用 sha256、`src` 无原生模块），但 optional peer
  中的 `@vscode/sudo-prompt` / `electron-store` 可能带原生码

终局形态是**在 Electron（内置 Node 即为下界）里跑测试**，保真度最高且能覆盖上述两类；
引入 Electron 测试环境是独立工程，未排期。

唯一可靠的机制是版本感知的静态检查（`eslint-plugin-n` 的
`no-unsupported-features/{node-builtins,es-builtins,es-syntax}` 传入下界 +
`no-deprecated-api` 管上界），且 `version` 必须**显式传下界**、不能让它读 `engines.node`
—— 那个字段表达的是**开发工具链**的要求（测试用的 vite / vitest 要 Node 18+），
与运行时下界是两个不同的数字；读错就会放过 16.17 ~ 18 之间的全部 API。
尚未落地，属已知缺口。

### 8.4 注释与 JSDoc 规范

- 所有**公开 API**（subpath export、`shared` 导出、辅助函数）必须带 JSDoc，覆盖 `@param` / `@returns` / `@throws`（关键 API 加 `@example`）。toolkit 不提供 `.d.ts`，JSDoc 是类型信息的唯一来源。
- 注释只描述**当前实现**：设计意图、使用方法、坑。简单处不注释。
- 禁止在注释中引用外部文档章节、记录中间状态、演进过程或已删除内容——文档会独立演进，代码注释不与之耦合。

### 8.5 preload 聚合入口契约

`src/preload/index.js` 承担 `exposeInMainWorld` 样板与 opt-out 装配：`init()` 默认装配 `appService` / `appNotice`，`init({ service: false })` / `init({ notice: false })` 跳过对应 bridge。关键契约：主端未 init 时应 opt-out（违约后果见 §2.5：preload 阻塞到主进程 GC，之后该 bridge 降级并警告）；两个 bridge 各自装配，全部尝试后抛出第一个装配错误；`init()` 只能调一次；capability / enhance 永远不通过聚合入口暴露；`exposeAPI` 对外导出供自定义 bridge 复用。

### 8.6 测试目录组织

测试代码不在 `src/` 内，物理位置为项目根 `tests/`，内部镜像 `src/` 结构。`vitest.config.mjs` 的 `include: ['tests/**/*.test.js']`。`"files": ["src"]` 天然不含 `tests/`。

### 8.7 依赖约束

- `dependencies`：`archiver`、`fs-extra`、`lodash.merge`、`unzipper`（主进程 libs 实际使用）
- `peerDependencies`：`electron` 按 §8.3 反推；`log4js` / `electron-store` / `semver` / `download` / `@vscode/sudo-prompt` 为 optional peer，按 capability 按需安装，聚合入口懒加载保证未安装不阻塞
- `devDependencies`：optional peer 的开发副本 + `vitest`
