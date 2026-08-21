# capability 说明

**日期**：2026-07-09
**项目**：`@base-client/toolkit`
**目标**：定义 `src/capability/` 下各主端能力模块的定位、API、依赖关系、路径配置消费方式与使用示例。

## §1 定位

capability 是运行在 **Electron 主进程**的能力模块，按能力垂直切片、目录组织（`src/capability/<name>/index.js`），供业务侧按需 `require`。每个 capability 独立提供一组主端 API；部分能力（如 logger）导出 `serviceSchema` 供业务侧挂载到 M2 Service 暴露给渲染端，是否挂载由业务侧决定。

capability 相对 M1-M4 的关系：

- 不依赖 M2 Service / M3 Notice（顶层 `require` 禁令，M5 §2.4）
- 可依赖 `shared/*`（如需序列化工具）
- 可依赖 `src/paths.js`（几乎都要）
- capability 之间允许 **DAG（有向无环）依赖**（M5 §5.2）

## §2 capability 依赖 DAG

当前落地：

```
                 ┌──────────┐
                 │  logger  │
                 └──▲───▲───┘
                    │   │
              ┌─────┘   └─────┐
              │               │
          ┌───┴───┐       ┌───┴───┐
          │   os  │       │ store │
          └───▲───┘       └───────┘
              │
          ┌───┴───┐
          │ update│
          └───────┘

  shortcut, singleInstance — 独立，无 capability 依赖
```

- `os` → `logger`
- `store` → `logger`
- `update` → `logger`、`os`
- `logger` / `shortcut` / `singleInstance` → 无 capability 依赖

**运行时假设**：因 CommonJS 缓存，capability A 顶层 `require` B 时，B 顶层装配已完成。A 内部使用 B 的 API **无需 `isInitialized` 校验**。

## §3 路径配置：`src/paths.js`

capability 消费的所有默认目录由 `src/paths.js` 提供，是**唯一的配置入口**。

**默认路径**（首次调用 `getFilePathConfig()` 时求值 + `fse.ensureDirSync`）：

| 字段 | 默认值 |
|---|---|
| `store` | `<userData>/UserData/Store` |
| `storageResource` | `<userData>/UserData/Resource` |
| `updatePackage` | `<userData>/UserData/Packages` |
| `log` | `<userData>/UserData/Logs` |
| `temp` | `app.getPath('temp')` |
| `appResource` | 打包环境 `process.resourcesPath`；开发环境 `<cwd>/resource` |

**业务侧覆盖**（可选）：

```js
const { setPathConfig } = require('@base-client/toolkit/paths');
setPathConfig({ log: '/opt/myapp/Logs', store: '/opt/myapp/State' });
```

只需传要覆盖的字段。**必须在任何 capability 首次被 `require` 之前调用**（否则 capability 顶层已消费默认路径）。

## §4 各能力

### §4.1 `capability/logger`

**定位**：主进程日志能力，基于 `log4js`。分级 + 双 appender（控制台 + 按日期滚动文件）。

**依赖**：`log4js`（optional peerDep），`src/paths.js`

**顶层装配**：`log4js.configure({ ... })` + `log4js.getLogger()` + `isDev = process.env.NODE_ENV === 'development'`

**API**：

```js
const logger = require('@base-client/toolkit/capability/logger');

logger.trace(msg, ...args);   // 仅 isDev 生效
logger.debug(msg, ...args);   // 仅 isDev 生效
logger.info(msg, ...args);
logger.warn(msg, ...args);
logger.error(msg, ...args);
logger.fatal(msg, ...args);
logger.shutdown();             // flush 后关闭
logger.print(fn, ...args);     // 参数预处理工具（Error → stack；object → JSON）
```

**消费路径字段**：`log`（写入日志文件）

**输出格式**：

- 控制台：`[YYYY-MM-DD hh:mm:ss] [LEVEL] - message`（含颜色）
- 文件：`<log>/log-YYYY-MM-DD.log`（按日滚动，最大 100K/文件，最多保留 20 个备份，gzip 压缩）

**参数预处理**（`print` 内部）：

- `Error` 参数 → 展开为 `stack`（若 `stack` 已含 `message`）或 `message + stack`
- 对象参数 → `JSON.stringify`，若抛错则 `console.log(err, v)` 并 raw 透传

---

### §4.2 `capability/os`

**定位**：系统信息只读能力（平台探测、Linux 内核 / 架构 / 发行版）。

**依赖**：`../logger`（错误上报）

**API**：

```js
const os = require('@base-client/toolkit/capability/os');

os.isWindows();      // boolean
os.isLinux();        // boolean
os.isMacOS();        // boolean
os.isLoongnix();     // boolean，Linux 且 lsb_release -i -s 含 "Loongnix"
os.linuxCore();      // string | ''，uname -r
os.linuxArch();      // string | ''，uname -m
os.lsbRelease();     // string | ''，lsb_release -i -s
```

Linux 特化方法在非 Linux 平台返回 `''`；`execSync` 出错时 `logger.error(err)` 后返回 `''` / `false`。

---

### §4.3 `capability/shortcut`

**定位**：全局快捷键注册。当前实现只注册 DevTools 快捷键 `Ctrl+Cmd+Alt+F6`（打开当前所有窗口的 DevTools，`detach` 模式）。

**依赖**：`electron.app`、`electron.BrowserWindow`、`electron.globalShortcut`

**顶层装配**：`app.on('will-quit', () => globalShortcut.unregisterAll())`

**API**：

```js
const shortcutInit = require('@base-client/toolkit/capability/shortcut');
shortcutInit();   // 显式调用触发 globalShortcut.register(...)
```

`module.exports` 是**启动函数**（非生命周期 `init`），业务侧在 `app.whenReady()` 后显式调用。

---

### §4.4 `capability/singleInstance`

**定位**：单实例应用检查 + 第二实例激活。

**依赖**：`electron.app`、`electron.BrowserWindow`

**API**：

```js
const checkSingleInstance = require('@base-client/toolkit/capability/singleInstance');
checkSingleInstance();   // 显式调用
```

- 拿不到锁 → 当前进程 `app.quit()`
- 拿到锁 → 挂 `second-instance` 事件：第二实例启动时聚焦已有窗口（若最小化则 `restore()` + `focus()`）

---

### §4.5 `capability/store`

**定位**：主进程持久化。两级 API —— electron-store 的 KV + 文件形式 KV。

**依赖**：`electron-store`（optional peerDep），`fs-extra`，`../logger`，`src/paths.js`

**顶层装配**：`new Store({ cwd: filePathConfig.store, name: '__store__' })`

**消费路径字段**：`store`（KV 与文件 KV 共用）

**API**：

```js
const store = require('@base-client/toolkit/capability/store');

// KV 通道（electron-store）
store.set(key, value);
store.get(key);
store.remove(key);

// 文件形式 KV 通道（<store>/<key>）
store.setFile(key, value);   // value 非 string 时 JSON.stringify
store.getFile(key);          // 返回 string；不存在返回 null；读错走 logger.error 后 undefined
store.removeFile(key);       // fs-extra removeSync，支持文件或目录
```

---

### §4.6 `capability/update`

**定位**：客户端更新包管理与安装。

**依赖**：`../logger`、`../os`、`fs-extra`、`download`（optional peerDep）、`semver`（optional peerDep）、`@vscode/sudo-prompt`（optional peerDep）、`electron.app` / `dialog` / `shell`、`crypto.randomUUID`

**消费路径字段**：`updatePackage`（增量包与临时下载目录）

**API**：

```js
const update = require('@base-client/toolkit/capability/update');

// 更新包扫描（业务侧传入 corePkg 作为筛选条件）
const list = update.getUpdatePkgList(corePkg);
// [{ name, version, path, type: 'update', ... }, ...]，按 version 降序

const newest = update.getNewestPkg(corePkg);
// { name, version, type: 'core' | 'update', path?, ... }

// 下载增量包（URL pathname 必须以 .asax 结尾；自动创建目录，落盘后改名 .asar）
const finalPath = await update.downloadPkg({ url, integrity: 'sha256-<64 hex chars>' });

// 多平台安装：Windows/macOS shell.openPath；Linux xterm / xdg-open / dpkg
const result = await update.installApp(filePath);
// { started: true }
// { started: false, reason: 'open-failed' | 'unsupported-platform', message? }

// 主动退出（logger.shutdown 后延时 500ms 调 app.exit(1)）
update.quitApp();
```

`corePkg` 形态：`{ name: string, version: string, ... }`。业务侧传入自己的 core 版本（例如从 `pkgJson` 读取）。

`getUpdatePkgList()` 在扫描前确保 `updatePackage` 目录存在，并忽略无法读取或不匹配 `corePkg.name` 的条目。`downloadPkg()` 使用 URL pathname 推导文件名，查询参数不会进入落盘路径；可选 `integrity` 在临时文件晋升前做 SHA-256 校验，失败时清理随机临时文件。`installApp()` 要求绝对路径和平台匹配扩展名，并对未知平台明确返回 `unsupported-platform`，不把“未执行任何安装动作”视为成功。可信 URL、manifest/action 授权和安装包来源仍由业务主进程负责，renderer 输入不得直接透传。

## §5 使用示例

一个典型的主进程入口：

```js
// main.js（业务侧）
const { app } = require('electron');
const { setPathConfig } = require('@base-client/toolkit/paths');

// 1. 覆盖路径（可选，必须在 require 任何 capability 之前）
setPathConfig({
    log: '/opt/myapp/Logs',
});

// 2. require capability 即可用
const logger = require('@base-client/toolkit/capability/logger');
const shortcutInit = require('@base-client/toolkit/capability/shortcut');
const checkSingleInstance = require('@base-client/toolkit/capability/singleInstance');
const store = require('@base-client/toolkit/capability/store');
const update = require('@base-client/toolkit/capability/update');

// 3. 早期动作
checkSingleInstance();

app.whenReady().then(() => {
    shortcutInit();

    logger.info('app ready');

    const corePkg = { name: '@my/app', version: '1.0.0' };
    const newest = update.getNewestPkg(corePkg);
    logger.info('newest pkg', newest);
});
```

将某个 capability 的 `serviceSchema` 挂载到 Service 暴露给渲染端（如果 capability 定义了 schema）：

```js
const Service = require('@base-client/toolkit/service');
const logger = require('@base-client/toolkit/capability/logger');

// 当前 logger 未导出 serviceSchema —— 业务侧如需渲染端调用，可自行定义 schema 包一层
Service.init({ userSchemas: [/* ... */] });
```

## §6 依赖包

toolkit 主包依赖（`dependencies`）：

- `fs-extra` — 所有文件操作
- `lodash.merge` — M4 BaseWindow 内部使用

capability 触发的 optional peerDep（业务侧按需装）：

| capability | peerDep | 用途 |
|---|---|---|
| logger | `log4js` | 日志核心 |
| store | `electron-store` | KV 持久化 |
| update | `download`、`semver`、`@vscode/sudo-prompt` | 下载 / 版本比较 / Linux dpkg sudo |

`electron` 是 toolkit 的 hard peerDep（`>=15.0.0`），所有 capability 均隐含依赖。

## §7 与其它 spec 的关系

- **M5 §2.4 / §5.2**：`require` 有限副作用契约、capability DAG 依赖约束的正式条款
- **架构 §3.1 / §3.6**：全局层面的顶层装配与依赖方向说明
- **M1 shared/serializer**：capability 未直接使用，但 `serviceSchema` 挂载到 M2 后，IPC 传输走 M1 序列化
- **M2 Service / M3 Notice**：capability 只导出 schema 描述对象，实际挂载由业务侧 `Service.init` / `Notice.init` 决定
