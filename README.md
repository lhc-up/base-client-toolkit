# @base-client/toolkit

**Electron 增强工具包**，提供 Service、Notice、BaseWindow 及各 capability 子模块。

## 能力矩阵

| 模块 | 路径 | 说明 |
|---|---|---|
| Service | `require('@base-client/toolkit').Service` | 服务主端 |
| Notice | `require('@base-client/toolkit').Notice` | 通知主端 |
| BaseWindow | `require('@base-client/toolkit').BaseWindow` | 窗口增强 |
| shared | `require('@base-client/toolkit').shared` | 共享工具 |
| logger | `require('@base-client/toolkit').logger` | 日志（T-01） |
| os | `require('@base-client/toolkit').os` | 系统能力（T-05） |
| shortcut | `require('@base-client/toolkit').shortcut` | 全局热键（T-03） |
| singleInstance | `require('@base-client/toolkit').singleInstance` | 单实例（T-04） |
| store | `require('@base-client/toolkit').store` | 持久存储（T-07） |
| update | `require('@base-client/toolkit').update` | 自动更新（T-08） |

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

以上均为 optional peer dependency，绿地项目无安装链时首次接入会 missing，需手动安装一次。

## 热键配置（shortcut）

`shortcut.init()` 支持按需传入配置对象：

```js
const shortcut = require('@base-client/toolkit').shortcut;

// 默认 F6（Command+Control+Alt+F6）
shortcut.init();

// 兼容业务历史习惯，指定 F5
shortcut.init({ devToolsKey: 'Command+Control+Alt+F5' });
```

## 版本

```js
const { VERSION } = require('@base-client/toolkit');
console.log(VERSION); // e.g. "0.0.1"
```
