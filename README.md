# @base-client/toolkit

**Electron 增强工具包**，提供 Service、Notice、BaseWindow、窗口/系统工具库，以及 renderer 可直接使用的运行时 capability。

包边界为显式子路径导出，**没有根聚合入口**（`require('@base-client/toolkit')` 不可解析）。

## 环境要求 —— 两个不同的 Node 版本，别混

| | 数字 | 由谁决定 | 载体 |
|---|---|---|---|
| **运行时** | **Node 16.17**（下界） | 宿主 Electron 的内置 Node。`peerDependencies.electron` 当前为 `>=22 <29`，Electron 22 内置 16.17（已实测 `process.versions.node`） | `peerDependencies.electron` |
| **开发 / 测试** | **Node 20.19+**（见 `engines`） | 本仓工具链。当前由 eslint 10 的 `^20.19.0 \|\| ^22.13.0 \|\| >=24` 顶上去，高于 vitest 2 的 `^18 \|\| >=20` | `engines.node` + `.nvmrc` |

**本包代码本身从不运行在独立 Node 上** —— 它运行在 Electron 主进程里，所以运行时版本是
Electron 版本的导出结果，不由 `engines` 表达。`engines` 只管「要在本仓干活、跑 lint 和
测试，你的 Node 得是多少」。

```bash
nvm use            # 读 .nvmrc（22.15.1，实测通过 lint + 测试的版本）
npm install
npm run lint       # 版本兼容检查，详见下
npm test
```

> ⚠️ 在低于 `engines` 的 Node（如 16.x）上，`npm test` 与 `npm run lint` **都起不来**，
> 且报的是 `crypto$2.getRandomValues is not a function` 这类与版本八竿子打不着的错。
> 看到它先查 `node -v`。

### 运行时版本约束怎么被强制

`npm run lint` 用 `eslint-plugin-n` 的四条规则，把**运行时下界**施加于 `src/`：
语法（`es-syntax`）、语言层全局（`es-builtins`）、Node 内置模块与方法（`node-builtins`），
外加 `no-deprecated-api` 管上界。

下界**不手填**，由 `eslint.config.js` 从 `peerDependencies.electron` 算出 ——
改 peer 范围，约束自动跟着走。放宽到映射表外的 Electron 版本时配置会直接抛错，
提示必须补表并实测。

**两类仍未覆盖**：依赖内部的用法（eslint 不查 `node_modules`）、
非语法非 API 的环境差异（OpenSSL provider、原生模块 ABI）。
详见 `docs/design/architecture.md` §8.3。

## 包边界

| 子路径 | 进程 | 说明 |
|---|---|---|
| `/main` | main | 主进程聚合入口（capability 懒加载、BaseWindow、paths） |
| `/main/capability` | main | capability 聚合入口（懒加载） |
| `/main/capability/*` | main | 单个 capability（`example`/`update`/`download`/`archive`/`store`/`env`/`logger`） |
| `/main/enhance/*` | main | 窗口增强（如 `BaseWindow`） |
| `/main/libs/*` | main | 主进程通用库（见下表） |
| `/main/paths` | main | 受控路径配置（`getFilePathConfig`/`setPathConfig`） |
| `/service`、`/service/preload` | main / preload | Service 主端与 preload 桥 |
| `/notice`、`/notice/preload` | main / preload | Notice 主端与 preload 桥 |
| `/preload` | preload | preload 聚合入口（装配 `appService`/`appNotice`） |
| `/shared` | 通用 | 共享工具（envelope、serializer 等，不含 Node/Electron 依赖） |
| `/host` | main（宿主） | `exposeHostRuntime`、`createHost`：建立宿主运行时、挂载包。包不得引用 |
| `/runtime` | main（包） | `getHostRuntime`、`definePkg`：零依赖，打进包的 bundle |
| `/build` | 构建期 | `toolkitExternals`：bc.config `main.externals` 中使用 |

宿主、包与宿主运行时的完整设计见 `docs/design/host.md`。

```js
const { capability, paths } = require('@base-client/toolkit/main');
const { download } = require('@base-client/toolkit/main/capability');
const sm4 = require('@base-client/toolkit/main/libs/sm4');
```

## 主进程 libs（`/main/libs/*`）

| 库 | 形态 | 说明 |
|---|---|---|
| `download` | 目录 | Electron `net.request` 流式下载：多 URL fallback、进度回调、取消、临时文件原子晋升 |
| `archive` | 目录 | ZIP 双向。`extractZip` 流式解压：可选解密 Transform 直连、独占目录替换、路径边界校验、staging 清理。`createZip({ sources, output, level, signal })` 打包：`sources` 收绝对路径数组、文件或目录皆可，缺源即报 `ARCHIVE_SOURCE_MISSING`（不静默产出残缺 zip），先写 staging 再 rename 原子晋升 |
| `integrity` | 目录 | 异步流式完整性校验（sha256/md5） |
| `sm4` | 目录 | SM4-CBC 标准实现，Node crypto 风格 API（流式/非流式） |
| `scope` | 目录 | 受控 scope 规则：`/` 字符串或段数组规范化、逃逸拒绝、纯 fileName 校验 |
| `logger` | 文件 | log4js 封装，六级方法 + `print` + `shutdown`。顶层即 `configure`、无 init。**契约：六级方法与 `shutdown` 永不抛**，失败走 `console.error` 次级通道自报并丢弃该条 —— 写日志不得影响主流程，调用方（尤其经 Service 跨进程的渲染层）可放心 fire-and-forget。要覆盖日志目录须在 require 本模块**之前**调 `setPathConfig({ log })` |
| `store` | 文件 | **持久存储，两类分开用**（详见下方小节） |
| `os`、`shortcut`、`singleInstance` | 文件 | 系统信息、全局热键、单实例 |
| `protocol` | 文件 | 自定义协议：宿主 `declareSchemes`（ready 前一次），包 `serveResource` / `serveIframeResource`（返回撤销函数） |

### store：两类存储，别混用

```js
const store = require('@base-client/toolkit/main/libs/store');
```

| | API | 落点 | 适用 |
|---|---|---|---|
| **值存储** | `set(key, value)` / `get(key)` / `remove(key)` | `{store}/__store__.json` | 小而结构化、整体读写（窗口位置、用户偏好）。支持点路径嵌套 `a.b.c` |
| **文件存储** | `await setFile(key, value)` / `await getFile(key)` / `await removeFile(key)` | `{store}/files/` | 大块、互不相关、独立读写（答案草稿、过程性文件）。**只有它支持二进制** |

**值存储的 `get` 是同步的** —— 这是它的核心价值之一，可以服务那些必须同步返回的旧契约。
代价是每次 `get` 都读 + 解析整份 JSON（实测约 196 µs，随文件增大变慢），
**所以不要往里放大块数据或做高频读取**。`set` 每次同步写盘（实测约 5.58 ms）。

**文件存储的三条约定**：

- `setFile` 的 `value`：`Buffer` / `TypedArray` / `ArrayBuffer` **原样写**；字符串按 utf8 写；
  其余 `JSON.stringify` 后写。`null` / `undefined` 直接抛。
- `getFile` **返回 `Buffer`，不替调用方解码**（不存在时为 `null`）。只有调用方知道自己存的是
  JSON、文本还是二进制；统一 `.toString()` 会把二进制静默损坏。要文本就 `buf.toString()`，
  要 Blob 就 `new Blob([buf])`。
- `key` 必须是**纯文件名**（经 `scope.normalizeFileName` 校验，拒绝 `..`、路径分隔符、`\0`）。
  落点刻意放 `files/` 子目录而非 `{store}` 根 —— `key` 常来自外部（下载来的插件、题包、
  服务端下发的文件名），同级存放意味着一次普通写入就能覆盖掉 `__store__.json`。
  需要把这个目录交给协议白名单一类场景，用导出的 `fileDir`。

> ⚠️ **文件存储的三个方法曾是同步的、且存不了二进制**（`JSON.stringify` + `.toString()`，
> 落点在 `{store}` 根）。现已改为异步 + 二进制直写 + 子目录，**对应调用方需要 `await`、
> 返回类型由 `string` 变 `Buffer`，旧位置的遗留文件不会被读到**。

## Capability（`/main/capability/*`）

capability 是 renderer 可直接使用的一件完整事情，通过 `serviceSchema`/`noticeSchema` 挂载：

```js
// 主进程
const Service = require('@base-client/toolkit/service');
const Notice = require('@base-client/toolkit/notice');
const { download, archive } = require('@base-client/toolkit/main/capability');

Service.init({ userSchemas: [download.serviceSchema, archive.serviceSchema] });
Notice.init({ userSchemas: [download.noticeSchema, archive.noticeSchema] });

// preload
require('@base-client/toolkit/preload').init();
```

### download capability

Service：`download.start(options) → { taskId }`，`download.cancel(taskId) → { accepted }`。

```js
appService.download.start({
    scope: 'paper/1',                 // '/' 分隔字符串或段数组，解析在受控存储根目录下
    urls: ['https://a/f.bin', 'https://b/f.bin'],  // 多 URL 按序 fallback
    fileName: 'f.bin',                // 可选；缺省取 URL basename，再缺省生成 UUID
    integrity: { expected: '<sha256 hex>' },       // 可选；不匹配则删文件并 failed
});
// 批量：{ scope, files: [{ urls, fileName?, integrity? }, ...] }，同一 taskId 顺序执行
```

Notice：`download.changed`，载荷 `{ taskId, scope, fileName, state, transferred?, total?, percent?, size?, error? }`，`state` 为 `started/progress/completed/failed/cancelled`。**不提供 getState/getProgress**，进度与终态只通过 Notice 推送；载荷不含绝对路径；`taskId` 仅用于取消和事件关联，持久文件以 `scope + fileName` 引用。

### archive capability

Service：`archive.extract(options) → { taskId }`，`archive.cancel(taskId) → { accepted }`。

```js
appService.archive.extract({
    source: { scope: 'incoming', fileName: 'pack.zip' },
    target: { scope: 'papers' },      // 解压到 papers/pack/（按包名独占目录，替换不影响邻居）
    decrypt: { name: 'biz-sm4' },     // 可选；引用主进程注册的命名解密器
});
```

Notice：`archive.changed`，载荷 `{ taskId, source, targetScope, state, directory?, error? }`，`state` 为 `started/completed/failed/cancelled`。

解密材料不出主进程：业务在主进程启动时注册命名解密器，renderer 只传名字：

```js
const sm4 = require('@base-client/toolkit/main/libs/sm4');
archive.registerDecryptor('biz-sm4', () => sm4.createDecipheriv('SM4-CBC', key, iv));
```

归档语义：首版只支持 ZIP；不恢复 symlink/hardlink 元数据（流式 parser 暴露为普通文件的按普通文件写入）；只校验 entry 最终解析路径不越出解压根目录；不设人为大小阈值，磁盘错误由文件系统返回；失败清理 staging 并保留旧目标目录。
### update capability

保留既有契约。`installApp(filePath)` 只接受绝对路径和当前平台安装器扩展名（Windows `.exe/.msi`、macOS `.dmg/.pkg`、Linux `.deb`）。Windows/macOS 通过 Electron `shell.openPath` 启动，Linux 的 xdg-open/Loongnix 分支使用参数数组执行，dpkg sudo 回退会安全引用路径；未知平台明确返回 `unsupported-platform`。`downloadPkg({ url, integrity?, onProgress? })` 只接受 pathname 以 `.asax` 结尾的 URL，提供 `sha256-<hex>` 或 64 位 hex 时会在临时文件晋升为 `.asar` 前校验内容。**下载底座是本库自己的 `libs/download`**（Electron `net.request`，多 URL fallback、临时文件原子晋升、尊重 Chromium 代理设置），`onProgress` 直接透传给它、载荷为 `{ transferred, total?, percent? }`；**该回调只在主进程内调用、不跨 IPC**，节流由调用方决定。2026-10-19 之前这里用的是 npm `download`（无进度回调），已整体移除。

业务主进程已经取得本地增量包时，可调用 `stageLocalPkg({ sourcePath, integrity })`。该方法只接受绝对 `.asax` 路径和必填 SHA-256，先复制到 `updatePackage` 内的随机临时文件，校验成功后再替换为同名 `.asar`；失败只清理临时文件，不删除来源文件，也不会在校验前覆盖已有包。

业务主进程已经取得安装器但需要等待用户确认时，使用 `stageLocalInstaller({ sourcePath, integrity })` 把文件复制到 `<temp>/base-client-toolkit-installers/<uuid>/` 并校验，再把返回的 staged descriptor 仅保存在主进程。确认安装时调用 `installStagedInstaller(staged)`；该方法会验证路径仍位于受控命名空间，并在启动前再次计算 SHA-256。取消时调用 `discardStagedInstaller(staged)`，后续启动可调用 `cleanupStagedInstallers()` best-effort 清理默认超过 24 小时的陈旧目录。Windows 安装器启动后可能锁定文件，旧客户端又会立即退出，因此成功启动不承诺当场删除 staged 文件。

toolkit 只提供下载/本地交接、校验和平台启动 adapter，不决定业务可信源。允许域名、manifest 签名、action 授权和 package/installer provenance 必须由调用方主进程持有，不能把 renderer 传入的 URL/本地路径或伪造的 staged descriptor 直接交给这些 API。

## 接入前置依赖

`archiver`、`fs-extra`、`lodash.merge`、`unzipper` 为 toolkit 直接依赖，随包安装。其余按 capability 自行安装（optional peerDependencies）：

| capability | 依赖包 |
|---|---|
| logger | `log4js` |
| store | `electron-store` |
| update | `semver`, `@vscode/sudo-prompt` |

**⚠️ `log4js` 声明为 optional，但实际上是必装** —— 它被 Service 直接依赖
（`src/service/main.js` 用 toolkit 自己的 logger 记录来自 preload 的诊断上报，
见 `service:serializerReport`）。只要用到 Service（几乎必然）就会加载它，
未装则在加载 `main/libs/logger` 时直接抛。声明保持 optional 是为了不动既有消费者的
安装要求，但**新接入的客户端请一并安装 `log4js`**。

聚合入口懒加载各 capability；`@vscode/sudo-prompt` 仅在 Linux 提权安装回退路径实际执行时加载。

## 热键配置（shortcut）

```js
const shortcut = require('@base-client/toolkit/main/libs/shortcut');

// 默认 F6（Command+Control+Alt+F6）
shortcut();

// 兼容业务历史习惯，指定 F5
shortcut({ devToolsKey: 'Command+Control+Alt+F5' });
```