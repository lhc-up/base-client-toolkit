# Host：宿主、包与宿主运行时

> 状态：设计稿，待评审。本文只认领 toolkit 侧职责。
> 包（pkg）的产物格式见 frame `docs/pkg-contract.md`。

## 1. 模型

任何客户端都由两部分组成：

| 部分 | 内容 | 更新方式 |
|---|---|---|
| **宿主（host）** | 主进程入口、宿主职责（§2）、toolkit、通用能力、preload | 安装包 |
| **包（pkg）** | `main/pkg.js`（业务能力）+ `renderer/`（页面）+ 描述文件 | 更新包（也随安装包内置一份） |

宿主可以挂载一个或多个包。挂载几个包、何时挂载、窗口显示哪个包的页面，都是该客户端的业务，toolkit 不区分客户端类型。

toolkit 是**平台 SDK**，由宿主提供（类比 `electron` 由运行时提供）：宿主与包的主进程代码都从宿主运行时取 toolkit，进程内只有一份。

toolkit 为此提供：

1. 宿主运行时：宿主向包的主进程提供 toolkit 与业务字段的统一锚点。
2. 包的声明与挂载：`definePkg` / `createHost`。
3. Service / Notice 按 namespace 动态注册与注销。
4. 构建期映射：全量子包表、`toolkitExternals`。
5. 自定义协议：特权 scheme 声明、`resource://`、`iframe-resource://`。
6. 包管理：查找、下载、清理包，下载与安装安装包（`update` 能力）。

非目标：更新策略（何时检查、何时发更新包或安装包、加载哪个版本，属业务）；窗口切换页面（业务）；向渲染层开放宿主运行时（由包按需封装能力）。

## 2. 宿主职责

以下是任何宿主都要做的事，包不得做：

| 职责 | 时机 | toolkit 支持 |
|---|---|---|
| 建立宿主运行时 | 主进程入口第一行 | `exposeHostRuntime` |
| 单实例 | ready 前 | `main/libs/singleInstance` |
| 声明特权 scheme | ready 前，整个进程一次 | `main/libs/protocol` 的 `declareSchemes` |
| 创建宿主、注册通用能力（含 `update`） | ready 后 | `createHost`、`main/capability/update` |
| 证书策略、启动时清理残留 cookie、preload 加载失败日志 | ready 后、首个窗口前 | 业务实现（toolkit 不修改全局证书策略） |
| 创建窗口 | — | preload 使用 toolkit preload |
| 加载包：`require(<包>/main/pkg.js)` → `host.mount` → 窗口加载 `<包>/renderer/` 下的页面 | 业务决定 | `createHost` |
| `window-all-closed` 退出、退出前日志 flush | 退出时 | `main/libs/logger` 的 `shutdown` |

宿主自己的页面（如启动/升级页）可以直接从内置包中加载：内置包随安装包安装、不被更新包替换，其中的页面随宿主版本发布。

## 3. 宿主运行时

### 3.1 结构

```js
globalThis[Symbol.for('base-client')] = {
    // toolkit 字段：Symbol key，只有 toolkit 自己读写；默认只有这一项
    [Symbol.for('base-client.toolkit')]: { 'service': ..., 'main/libs/logger': ..., ... },

    // 业务字段（示例）：普通字符串 key，由宿主与包自行约定
    foo: ...,
    bar: ...,
};
```

| 部分 | 保护 | 说明 |
|---|---|---|
| 锚点 | 不可写、不可配置 | 防止整个对象被替换（会连带丢失 toolkit 子包表） |
| toolkit 字段 | Symbol key，不可写、不可配置；子包表冻结（只冻结表，不冻结模块对象） | 构建期映射依赖它 |
| 业务字段 | 无 | 普通属性，浅覆盖，结果由业务负责；读取按 JS 默认行为；值可以是数据或函数 |

- toolkit 字段用 Symbol key，业务字段取名因此不受限制。
- 约定字段：以下业务字段由每个宿主在入口设置，toolkit（`main/libs/resourceRoot`）与包按约定读取。设计见 `pkg-source.md`。

  | 字段 | 类型 | 含义 |
  |---|---|---|
  | `isHostDev` | boolean | 宿主是否本地调试（`dev:app` 启动），取宿主构建信息 `__BC_BUILD__.isPkgDev`；加载与选包的唯一依据 |
  | `devPkgSources` | object | 本地调试时各包的来源：宿主先放入自身包的默认项（`{ type: 'devServer', url: __BC_BUILD__.devUrl }`），再合并 `pkg.parseDevSources(BC_DEV_PKG_SOURCES)`；打包运行为 `{}` |

- 宿主运行时只在主进程。渲染层需要其中的信息时，由包自己封装能力提供，toolkit 不做通用开放。

### 3.2 key 常量

```js
// src/shared/hostKeys.js（三端可加载，零依赖）
const HOST_RUNTIME_KEY = 'base-client';
const TOOLKIT_KEY = 'base-client.toolkit';
```

- toolkit 源码内一律引用常量，toolkit 之外的源码不出现这两个字符串。
- 构建产物中会以字面量出现：映射表达式由 §7 的 `toolkitExternals` 在构建期用常量展开生成。
- 各 bundle 各有一份常量，靠字符串相同得到同一个 Symbol，因此两个字符串一经发布**不得修改**。

### 3.3 API

```js
// 宿主侧：@base-client/toolkit/host
exposeHostRuntime(fields);   // 首次调用：建立锚点并装入 toolkit 子包表；之后每次调用等同 Object.assign
// 包侧：@base-client/toolkit/runtime
getHostRuntime();            // 返回锚点对象；锚点不存在时抛错「宿主运行时未建立」
```

- 业务字段浅覆盖：同名 key 整体替换。需要合并时业务自己展开：`exposeHostRuntime({ foo: { ...getHostRuntime().foo, x } })`。
- 可多次调用：入口第一行先调（此后 toolkit 可用），之后按需再暴露。
- 首次调用必须早于任何 toolkit 引用被执行（映射后，引用 toolkit 即读锚点）。

### 3.4 子路径分工

| 子路径 | 使用方 | 内容 | 映射 |
|---|---|---|---|
| `./host` | 宿主 | `exposeHostRuntime`、`createHost`；引入全量子包表 | 否。包不得引用（会把全量 toolkit 打进包），由业务用 eslint `no-restricted-imports` 约束 |
| `./runtime` | 包 | `getHostRuntime`、`definePkg`；零依赖小文件，打进包的 bundle | 否 |
| `./build` | bc.config | `toolkitExternals`；构建期使用，零依赖 | 否 |
| preload 相关子路径 | preload | 渲染进程侧 bridge | 否 |
| 其余子路径 | 宿主、包 | toolkit 能力本身 | 是（主进程） |

## 4. 全量子包表

`src/host/modules.js` 由脚本从 `package.json#exports` 生成（通配项展开为实际文件），提交入库，不手改：

```js
module.exports = {
    get 'service'()          { return require('../service/main'); },
    get 'main/libs/logger'() { return require('../main/libs/logger'); },
    // ...
};
```

- 运行时文件：宿主经 `exposeHostRuntime` 装入；webpack 依赖其中的静态 `require` 把全量 toolkit 打进宿主。
- getter 惰性加载：首次访问才 `require`，未用到的子包不执行顶层代码。
- 范围 = §3.4 中「映射：是」的子路径；测试校验与 exports 展开结果一致，新增子包未重新生成即失败。
- 宿主需安装 toolkit 的全部 optional peer（`log4js` / `electron-store` / `semver` / `@vscode/sudo-prompt`）。

## 5. 包的声明与挂载

### 5.1 `definePkg`：包的主进程入口

包的 `main/pkg.js` 默认导出 `definePkg` 的结果，向宿主声明三件事：依赖哪些通用能力、自带哪些业务能力、挂载/卸载时做什么。

```js
const { definePkg } = require('@base-client/toolkit/runtime');

module.exports = definePkg({
    name: 'demo',
    uses: ['logger', 'store'],     // 依赖的通用能力（namespace，由宿主注册）
    provides: [foo, bar],          // 自带业务能力（capability 模块）
    activate() {},                 // 挂载后调用
    deactivate() {},               // 卸载前调用，撤销 activate 的副作用
});
```

- `definePkg` 在包被 `require` 时执行，只做形态校验并返回冻结的描述对象，无副作用。形态错误在加载时即抛出。
- `activate` / `deactivate` 的参数（挂载上下文）暂不设计。

### 5.2 `createHost`：在宿主中挂载包

```js
// 宿主主进程入口
const { exposeHostRuntime, createHost } = require('@base-client/toolkit/host');
exposeHostRuntime();
const host = createHost({ capabilities: [/* 通用能力 */] });   // 内部完成 Service.init / Notice.init

const pkg = require(pkgEntry);   // pkgEntry：包内的 main/pkg.js（内置包或下载的包）
await host.mount(pkg);           // uses 校验 → 重名校验 → 注册 provides → activate
await host.unmount(pkg.name);    // deactivate → 注销 provides
```

- 可同时挂载多个包；`provides` 与通用能力或其他已挂载包重名时抛错。
- `uses` 中有宿主未注册的能力时抛错。
- 注册中途失败回滚；`activate` 抛错时注销后再抛出；`deactivate` 抛错只记日志，不阻断注销。
- 同一包模块只 `require` 一次（Node 模块缓存），重复挂载只重新执行 `activate` / `deactivate`。
- 不做版本兼容校验：宿主未提供包所需的 toolkit 子包或通用能力时，在测试阶段即会报错。

### 5.3 `provides` 的完整链路

```text
编写：src/main/pkg.js 中 import 业务能力模块（每个模块导出 serviceSchema / noticeSchema，与现有 capability 约定一致），放入 provides
打包：frame 以 pkg.js 为入口，把它与全部业务能力模块打成一个 bundle → app/main/pkg.js
      （toolkit 的引用经 toolkitExternals 映射为从宿主运行时取，不打进 bundle）
挂载：宿主 require(<包>/main/pkg.js) 得到 definePkg 的描述对象
      → host.mount：uses 校验 → 遍历 provides，Service.register(serviceSchema) / Notice.register(noticeSchema) → activate
卸载：host.unmount：deactivate → 遍历 provides，Service.unregister / Notice.unregister
```

渲染层在挂载之后加载页面，preload 重新拉取清单，即可通过 `appService.<namespace>` 调用包的业务能力。

## 6. Service / Notice 动态注册

```js
Service.register(schema);  Service.unregister(namespace);
Notice.register(schema);   Notice.unregister(namespace);
```

- `register` 须在 `init` 之后；namespace 冲突抛错。`unregister` 不存在的 namespace 静默返回。
- 渲染端：页面每次加载都会重跑 preload 并重新拉取清单，「先挂载、再加载页面」即可拿到新能力，bridge 不需要改动。
- 注销后渲染端再调用：async 调用 reject，sync 调用抛错，不悬挂。

## 7. 构建期映射

主进程代码中的 `require('@base-client/toolkit/<subpath>')`（§3.4 中映射为「是」的子路径）在构建时被替换为从宿主运行时取值，业务源码不变。子包不存在时得到 `undefined`，按 JS 默认行为在使用处报错。

```js
// @base-client/toolkit/build
toolkitExternals   // webpack externals 函数；宿主与包的主进程 bundle 共用
```

表达式格式与 key 常量由 toolkit 维护。由业务项目在 bc.config 的 `main.externals` 中接入（frame 不感知 toolkit），preload 不接入。

## 8. 自定义协议（`main/libs/protocol`）

| API | 调用方 | 说明 |
|---|---|---|
| `declareSchemes(list?)` | 宿主，ready 前一次 | 声明特权 scheme。默认包含 `resource` 与 `iframe-resource`，可追加 |
| `serveResource({ roots })` | 包，`activate` 中 | 注册 `resource://`：按允许的根目录提供文件，校验路径不逃逸；返回撤销函数 |
| `serveIframeResource({ roots })` | 包，`activate` 中 | 注册 `iframe-resource://`：`pkg-*` 独立 origin（standard + secure），供交互内容使用；返回撤销函数 |

- 特权声明只能在 ready 前，因此由宿主统一声明；包加载时只注册/撤销 handler。
- 根目录由包传入；特权配置以问卷现有实现为准迁入。

## 9. 包管理（`main/capability/update` 扩展）

现有 update 能力（下载并晋升包、取本地最新包、下载与安装安装包）扩展为通用的包管理机制，宿主作为通用能力注册：

| 能力 | 说明 |
|---|---|
| 查找包 | 按 `{ name, version?, env }` 在内置目录（`resources/packages/`）与下载目录中查找；不传 `version` 时返回最新版本 |
| 下载包 | 下载、校验、晋升为 `.asar` |
| 清理 | 删除同名的其他版本 |
| 安装包 | 下载与安装安装包（现有能力） |

- 策略由业务决定：何时检查、按 semver 判断发更新包还是安装包、加载最新版还是与配置一致的版本。
- **分发用 `.asax`，落盘用 `.asar`**：构建产物、上传、下载地址用 `.asax`；下载晋升与内置包落盘为 `.asar`。
  原因：任何 Electron 程序（包括 VS Code）碰到 `.asar` 都会当作归档打开并持有句柄，Windows 下随后无法删除、覆盖；
  而 Electron 只有路径中出现 `.asar` 才能读取包内文件。下载地址也兼容 `.asar`。

### 9.1 `.asar` 文件操作规则

Electron 22 实测结论（Windows）：

| 场景 | 结果 |
|---|---|
| 经 Electron 的 asar 支持读过包（`fse.readJSON(xxx.asar/package.json)`、require 包内模块、加载包内页面） | Electron 缓存并持有归档句柄：`fse.removeSync` **静默不删**，`rename` / `unlink` 报 `EBUSY` |
| 未经 Electron 读过的包 | `fse.removeSync`、`fse.renameSync` 正常 |
| `fse.statSync(xxx.asar).isFile()` | `false`（被当作目录），`existsSync` 也不可靠 |

据此：

| 操作 | 做法 |
|---|---|
| 写入 | 先写不带 `.asar` 后缀的临时文件，校验后 `fse.renameSync` 晋升为 `.asar` |
| 读取描述文件 | `readAsarFile`：用原生 fs（Electron 下为 `original-fs`）自行解析归档头，读完即关闭句柄，不经 Electron 缓存。这是 toolkit 内唯一使用 `original-fs` 的地方 |
| 判断是否存在 | 按 `fse.readdirSync(目录)` 的列表判断 |
| 删除 | `fse.removeSync` 后按目录列表核对，删不掉时抛「包文件被占用」；清理时记日志并跳过 |

推论：本次运行中已挂载（require 过、加载过页面）的包无法删除。清理旧版本应在选定版本之后、加载之前进行，被挂载的那个版本本来就是保留项。

## 10. 影响

- 新增 exports：`./host`、`./runtime`、`./build`、`./main/libs/protocol`。
- update 能力：下载接受 `.asax` / `.asar` 地址、统一落盘为 `.asar`；新增按 `{ name, version, env }` 查找与内置目录支持。
- 新增通用能力 `main/capability/env`、`main/capability/logger`（由问卷宿主沉淀），宿主直接注册。
- `Service.init` / `Notice.init` 行为不变，存量项目不改也能用。
- 架构文档 §2.1「require 有限副作用」不变：`exposeHostRuntime` 是显式调用，不在 require 时执行。
- 准入口径已更新为「领域内通用」（`capability-governance.md` §1）。
