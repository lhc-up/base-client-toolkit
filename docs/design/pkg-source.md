# 包来源：运行方式、选包规则与资源目录

> 状态：已评审（2026-11-19）。与 `host.md`（宿主、包与宿主运行时）配套。

## 1. 背景

「宿主 + 包」架构下，宿主自身的业务（整合客户端的首页、问卷的业务功能）与它加载的其他业务（整合客户端里的子应用）
都是应用包，但目前三处各写各的选包规则（整合客户端 `homePkg.js` / `childApp.js`、问卷 `currentPkg.js`），存在以下问题：

- 本地调试时，自身的包会被线上的更新包替换，调试的不是本地代码；问卷在线上版本较新时可能反复重启。
- 选包依据各包自己构建期写死的 `isDev`：本地调试的宿主加载一个打包后的首页包时，首页包里的子应用联调配置整段失效。
- 不能指定加载某个具体的包文件（例如线上下载下来的包）排查问题。
- 本地调试时没有内置包目录（取的是 Electron 自身安装目录），与打包后的行为不一致。
- 内置资源散落在项目各处（`client/`、`addons/`、`build/icons/`），复制规则写在各项目的构建配置里。

本设计把它们统一为一个模型：**运行方式以宿主为准，每个包有一个来源，来源有三种形式。**

## 2. 术语

| 术语 | 含义 |
|---|---|
| 自身的包 | 包名等于宿主自己 `package.json` 的 `name`：整合客户端的 `eachinacoreframe`、问卷的 `questionaire` |
| 其他包 | 宿主加载的其他业务包，如整合客户端里的 `questionaire` |
| 本地调试 | 宿主由 `dev:app` 启动 |
| 打包运行 | 宿主由 `pack` 产出的安装包 / 免安装目录启动 |
| 资源根目录 | 本地调试：`<项目根目录>/resources`；打包运行：`process.resourcesPath` |

## 3. 运行方式：`isHostDev` 与 `isPkgDev`

两个布尔值，含义都是「是否本地调试」，分别对应宿主与包：

| 字段 | 位置 | 来源 | 用途 |
|---|---|---|---|
| `isHostDev` | 宿主运行时（主进程） | 宿主入口用自身构建信息设置一次：`dev:app` 为 `true`，`pack` 为 `false` | **宿主唯一的运行时依据**：加载哪个包、从哪里加载（选包）、资源根目录、是否跳过更新、是否允许包来源配置 |
| `isPkgDev` | `appInfo`（三端，由 `__BC_BUILD__.isPkgDev` 映射） | 包自己构建时写死 | **应用包唯一的运行时依据**：包内部自身的行为，例如是否显示调试信息 |

- 宿主和包分别构建、各自写死自己的值，两者可以不同：本地调试的宿主加载一个打包后的包时，`isHostDev = true`，该包的 `isPkgDev = false`。
- 原则：**被加载的一方不能用自身的标志位决定自己怎么被加载。** 包是否加载、从哪里加载，由宿主决定，依据宿主的 `isHostDev`；
  包自身的 `isPkgDev` 只管包内部的行为。一个包被加载之前，它的代码还没有运行，用它的标志位决定它的加载在逻辑上不成立。
- 由此：**凡是与「加载什么、从哪里加载」有关的判断，一律读宿主运行时的 `isHostDev`，不得读 `isPkgDev`**，即使选包代码写在某个包里
  （如整合客户端首页包里的子应用选包，它是代宿主加载其他包）。包在主进程通过 `getHostRuntime().isHostDev` 取；
  渲染层需要时由包自己封装能力提供（与 `host.md` §3.1 一致）。
- 打包运行的宿主 `isHostDev` 恒为 `false`：它来自构建期字面量，不读任何运行时环境变量或启动参数，无法被外部改变。
- frame 的构建信息字段同步改名为 `__BC_BUILD__.isPkgDev`（原 `dev`），与 `appInfo.isPkgDev` 一致；`devUrl` 不变。
  宿主入口与包在同一次构建中产出、共用同一组构建信息，宿主入口以它设置 `isHostDev`。

## 4. 包来源

### 4.1 三种来源

| `type` | 主进程入口 | 页面 | 更新 | 适用场景 |
|---|---|---|---|---|
| `devServer` | `main` 指定的主进程入口（`dev:app` 或 `dev:app --pkg-only` 编译出的 `app/main/pkg.js`） | `url`（dev server，可热更新） | 不比对版本、不下载 | 本地开发自身；联调其他包 |
| `file` | 指定包文件内的 `main/pkg.js` | 包内页面 | 不比对版本、不下载 | 排查某个具体的包，例如线上下载下来的 |
| `semver` | 选中包内的 `main/pkg.js` | 包内页面 | 按线上版本（语义化版本）匹配，需要时下载 | 打包运行的唯一方式；本地调试中未配置的其他包 |

`semver` 的选包流程（自身的包与其他包相同）：

1. 内置目录：`<资源根目录>/packages/`，名称、环境、版本与线上一致者；
2. 下载目录：`UserData/Packages/`，同上；
3. 现场下载：按线上下发的地址下载、校验、晋升为 `.asar`，再选中。

自身的包与其他包在 `semver` 下的差异只在「线上版本从哪来」与「版本不一致时怎么办」（更新包、安装包、重启或直接挂载），
这部分属于各宿主的业务策略，保持现状，不在本设计内。

### 4.2 默认来源（写在 toolkit 代码中，配置不写即为默认）

| | 打包运行 | 本地调试 |
|---|---|---|
| 自身的包 | `semver` | `devServer`：`main` 为本项目编译出的 `app/main/pkg.js`，`url` 为宿主自己的 `appInfo.devUrl` |
| 其他包 | `semver` | `semver` |

### 4.3 配置：`BC_DEV_PKG_SOURCES`

- **只在本地调试（`isHostDev = true`）时生效**；打包运行时读取它的代码在构建期被整段删除，值也不会进入产物。
- 写在宿主项目的 `.env` 中，默认空值；宿主静态读取后解析，经宿主运行时提供给包（字段 `devPkgSources`）。
- 值为 JSON，键为包名（自身的包用自己 `package.json` 的 `name`），值为来源。
- dotenv 不支持 YAML 式的缩进语法，但支持**单引号包裹的多行值**，因此 JSON 可以分行缩进书写（实测 dotenv 17）；
  JSON 内部不能写注释，说明写在变量上方的 `#` 注释中。`.env` 中给出带注释的结构化示例：

```
# 本地调试时各应用包的来源（只在 dev:app 下生效，打包后忽略）。键为包名，未列出的包按默认来源：
#   自身的包默认 devServer（本项目编译目录 + 自己的 dev server），其他包默认 semver。
# type 取值：
#   devServer  main = 编译出的 app/main/pkg.js 路径，url = 该包页面的 dev server 地址
#   file       path = 指定的包文件（.asax / .asar），例如线上下载下来的包
#   semver     按线上版本选包：内置目录 → 下载目录 → 现场下载
# 示例（去掉 # 后按需修改）：
# BC_DEV_PKG_SOURCES='{
#   "questionaire": {
#     "type": "devServer",
#     "main": "E:/code/eachina/questionnaire-answer-v3.0/app/main/pkg.js",
#     "url": "http://localhost:8023/"
#   },
#   "demochild": { "type": "file", "path": "D:/Downloads/demochild-test-v1.0.0.asax" },
#   "eachinacoreframe": { "type": "semver" }
# }'
BC_DEV_PKG_SOURCES=
```

| `type` | 必填字段 | 说明 |
|---|---|---|
| `devServer` | `main`、`url` | `main` 指向的文件必须存在 |
| `file` | `path` | `.asax` 或 `.asar` |
| `semver` | — | 本地调试中也走标准选包流程；用于自身的包时，完整走一遍更新流程（下载更新包等） |

- 写了的包按配置，没写的按 §4.2 默认值。
- 配置格式错误（JSON 解析失败、`type` 未知、必填字段缺失）：该项忽略、按默认值，并输出错误日志；不影响启动。

### 4.4 本地调试的安全约束

- 本地调试时宿主**永不进入大版本安装包流程**（不下载、不安装），只记日志。
- 来源为 `devServer` / `file` 的包不比对版本、不下载；启动检查照常请求线上配置（子应用列表、黑名单等仍需要它），只是跳过更新。
- `file` 指定的包，描述文件中的名称、环境、版本与预期不符时：**照常加载，并在日志与终端输出警告**。
  该能力只在本地调试生效（§4.3），打包运行时既无此代码也无此配置，因此警告不会出现在线上、不会被用户看到；
  `semver` 下的选包要求名称、环境、版本全部匹配，不会选中不符的包。

## 5. `.asax` 的加载：临时副本

Electron 只识别路径中带 `.asar` 的归档，`.asax` 不能直接加载。需要加载 `.asax` 时（`file` 指定的 `.asax`、本地调试时内置目录中的 `.asax`），
toolkit 先复制为 `.asar` 临时副本再加载：

- 位置：`<系统临时目录>/base-client/<宿主名>/pkg-copies/`。系统或清理工具会清理临时目录，作为兜底。
- 文件名：`<原文件名去扩展>-<文件大小>-<修改时间>.asar`；同一文件在一次运行中只复制一次。

- 清理：每次启动、选包之前，删除该目录下的全部旧副本。本次运行尚未加载它们，可以删除；
  被其他运行中的实例占用而删除失败时，只记日志、跳过（按 `host.md` §9.1 的删除规则核对目录列表）。
- 打包运行时内置目录中已是 `.asar`，下载目录统一落盘为 `.asar`，不产生副本。
- 文件与目录操作一律用 `fs-extra`（`ensureDirSync`、`copySync`、`removeSync` 等），目录不存在、重复创建等边界由它处理；
  `.asar` 的读取与删除核对仍遵守 `host.md` §9.1。

## 6. 资源目录收敛到 `resources/`

项目根目录的 `resources/` 是打包后 `resources/` 的镜像，凡是随安装包分发、运行时读取的资源都放这里：

| 源码 | 打包后 | 读取方 |
|---|---|---|
| `resources/packages/*.asax`（内置的其他包） | `resources/packages/*.asar` | toolkit 选包（§4.1 第 1 步） |
| —（自身的包由 frame 构建） | `resources/packages/<name>-<env>-v<版本>.asar` | 同上 |
| `resources/addons/` | `resources/addons/` | 宿主经 `frameResourceDir` 传给子应用 |
| `resources/icons/` | `resources/icons/` | Linux 窗口图标（整合客户端 `icon.js`） |

- **资源根目录由 toolkit 统一计算**（§2），依据 `isHostDev`：本地调试为 `<项目根目录>/resources`（`dev:app` 在项目根目录启动，取 `process.cwd()`），打包运行为 `process.resourcesPath`。
  内置包目录、图标、`frameResourceDir` 都基于它，业务代码不再自行判断调试或打包。
- `frameResourceDir` 的值改为资源根目录本身；子应用以它拼接 `addons` 等子目录的方式不变。
- **复制由 frame 统一负责**：打包时把 `resources/` 整体复制进安装包的 `resources/`，其中 `packages/*.asax` 改名为 `.asar`；
  自身的包也落到 `resources/packages/`。若 `resources/packages/` 中已有与自身包同名的文件，构建报错。项目不再在构建配置里写 `extraResources`。
- `build/icon.png` 是 frame 生成安装包图标的构建输入，留在 `build/`，不属于运行时资源。
- `.gitignore`：`resources/packages/*` 忽略（保留 `.gitkeep`），`addons`、`icons` 入库。

## 7. 日志

选包与加载统一前缀 `[包来源]`，每个包每次选择输出一组，保证事后能还原「为什么加载了它」：

```
[包来源] questionaire：本地调试，依据配置 BC_DEV_PKG_SOURCES，type=semver
[包来源] questionaire：内置目录 <资源根目录>/packages 未命中（期望 test v2.7.3）
[包来源] questionaire：下载目录命中 questionaire-test-v2.7.3.asar
[包来源] questionaire：已加载 来源=下载目录 路径=... 描述文件 name=questionaire env=test version=2.7.3
[包来源] eachinacoreframe：本地调试，默认 type=devServer，dir=...\app url=http://localhost:8066/，跳过更新（线上 1.5.1）
[包来源] demochild：file 指定 D:/Downloads/demochild-test-v1.0.0.asax，已复制为临时副本 ...；描述文件 env=test 与当前 mock 不符（警告）
```

- 内容：包名、运行方式、依据（默认 / 配置）、依次检查的来源与结果、最终加载的来源与路径或地址、描述文件的名称 / 环境 / 版本、
  不符警告、跳过更新的原因。
- 主进程日志写入日志文件；本地调试时主进程输出由 `dev:app` 转到终端。不在页面提示。

## 8. 改动清单

### toolkit

- 新增选包函数（暂定 `main/libs/pkgSource`）：输入包名、是否自身、线上版本与地址、`isHostDev`、`devPkgSources`，
  输出 `{ type, path, url?, version, env, ... }`；内含 §4 规则、§5 临时副本、§7 日志。toolkit 不直接读环境变量。
- 资源根目录计算；update 能力的内置目录改为 `<资源根目录>/packages`，读取目录时兼容 `.asax`（经 §5 副本加载）。
- `host.md` 补充宿主运行时约定字段 `isHostDev`、`devPkgSources`；README 与本文档说明 `BC_DEV_PKG_SOURCES`。

### frame

- 构建信息字段 `dev` 改名为 `isPkgDev`（§3）。
- 打包时复制 `resources/` 到安装包（`packages/*.asax` → `.asar`），自身包落 `resources/packages/` 并检查重名。
- `pkg-contract.md`、README 补充资源目录约定。

### 整合客户端

- 宿主入口在宿主运行时设置 `isHostDev`、`devPkgSources`（静态读取 `process.env.BC_DEV_PKG_SOURCES`）。
- `homePkg.js`、`childApp.js` 改用 toolkit 选包；`icon.js`、`frameResourceDir` 改用资源根目录；删除 `getDevOverride`。
- 启动页：自身来源不是 `semver` 时跳过版本比对与下载；本地调试时不进入安装包流程。
- `client/` → `resources/packages/`，`addons/` → `resources/addons/`，`build/icons/` → `resources/icons/`；删除 `electron-builder.config.js` 的 `extraResources` 与 `builtinChildPkgs`；更新 `.gitignore`。
- `.env`：`BC_DEV_PKGS` 改为 `BC_DEV_PKG_SOURCES`（§4.3 的带注释示例）；`appInfo.isDev` 改为 `isPkgDev`。

### 问卷

- 宿主入口设置 `isHostDev`、`devPkgSources`；`currentPkg.js` 改用 toolkit 选包。
- 启动页：自身来源不是 `semver` 时跳过版本比对与下载；本地调试时不进入安装包流程。
- `.env` 增加 `BC_DEV_PKG_SOURCES=`（§4.3 的带注释示例）；`appInfo.isDev` 改为 `isPkgDev`。

## 9. 不在本设计内

- `semver` 下各宿主「版本不一致时怎么办」的业务策略（更新包 / 安装包 / 重启 / 直接挂载）：保持现状。
- 整合客户端首页模板只为固定的子应用标识写了卡片：业务现状，不改。
- 后台下发的包仍是旧格式：属于后台改造，客户端分支完成后再处理。
