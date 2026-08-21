# @base-client/toolkit

**Electron 增强工具包**，提供 Service、Notice、BaseWindow 及各 capability 子模块。

## 能力矩阵

| 模块 | 路径 | 说明 |
|---|---|---|
| Service | `require('@base-client/toolkit').Service` | 服务主端 |
| Notice | `require('@base-client/toolkit').Notice` | 通知主端 |
| BaseWindow | `require('@base-client/toolkit').BaseWindow` | 窗口增强 |
| shared | `require('@base-client/toolkit').shared` | 共享工具 |
| logger | `require('@base-client/toolkit/capability').logger` | 日志 |
| os | `require('@base-client/toolkit/capability').os` | 系统能力 |
| shortcut | `require('@base-client/toolkit/capability').shortcut` | 全局热键 |
| singleInstance | `require('@base-client/toolkit/capability').singleInstance` | 单实例 |
| store | `require('@base-client/toolkit/capability').store` | 持久存储 |
| update | `require('@base-client/toolkit/capability').update` | 自动更新 |

也可直接通过子路径精确引入各模块（如 `require('@base-client/toolkit/capability/logger')`）。

## 接入前置依赖

各 capability 依赖的 npm 包需项目侧自行安装（peerDependencies）：

| capability | 依赖包 |
|---|---|
| logger（T-01） | `log4js` |
| store（T-07） | `electron-store` |
| update（T-08） | `semver`, `download`, `@vscode/sudo-prompt` |

安装方式：

```bash
npm install log4js electron-store semver download @vscode/sudo-prompt
```

以上均为 optional peer dependency，按实际使用的 capability 安装即可。聚合入口会延迟加载各 capability；`@vscode/sudo-prompt` 仅在 Linux 的提权安装回退路径实际执行时加载。

update 的 `installApp(filePath)` 只接受绝对路径和当前平台安装器扩展名（Windows `.exe/.msi`、macOS `.dmg/.pkg`、Linux `.deb`）。Windows/macOS 通过 Electron `shell.openPath` 启动，Linux 的 xdg-open/Loongnix 分支使用参数数组执行，dpkg sudo 回退会安全引用路径；未知平台明确返回 `unsupported-platform`。`downloadPkg({ url, integrity? })` 只接受 pathname 以 `.asax` 结尾的 URL，提供 `sha256-<hex>` 或 64 位 hex 时会在临时文件晋升为 `.asar` 前校验内容。

业务主进程已经取得本地增量包时，可调用 `stageLocalPkg({ sourcePath, integrity })`。该方法只接受绝对 `.asax` 路径和必填 SHA-256，先复制到 `updatePackage` 内的随机临时文件，校验成功后再替换为同名 `.asar`；失败只清理临时文件，不删除来源文件，也不会在校验前覆盖已有包。

业务主进程已经取得安装器但需要等待用户确认时，使用 `stageLocalInstaller({ sourcePath, integrity })` 把文件复制到 `<temp>/base-client-toolkit-installers/<uuid>/` 并校验，再把返回的 staged descriptor 仅保存在主进程。确认安装时调用 `installStagedInstaller(staged)`；该方法会验证路径仍位于受控命名空间，并在启动前再次计算 SHA-256。取消时调用 `discardStagedInstaller(staged)`，后续启动可调用 `cleanupStagedInstallers()` best-effort 清理默认超过 24 小时的陈旧目录。Windows 安装器启动后可能锁定文件，旧客户端又会立即退出，因此成功启动不承诺当场删除 staged 文件。

toolkit 只提供下载/本地交接、校验和平台启动 adapter，不决定业务可信源。允许域名、manifest 签名、action 授权和 package/installer provenance 必须由调用方主进程持有，不能把 renderer 传入的 URL/本地路径或伪造的 staged descriptor 直接交给这些 API。

## 热键配置（shortcut）

`shortcut()` 支持按需传入配置对象：

```js
const { shortcut } = require('@base-client/toolkit/capability');

// 默认 F6（Command+Control+Alt+F6）
shortcut();

// 兼容业务历史习惯，指定 F5
shortcut({ devToolsKey: 'Command+Control+Alt+F5' });
```

## 版本

```js
const { VERSION } = require('@base-client/toolkit');
console.log(VERSION); // e.g. "0.0.1"
```
