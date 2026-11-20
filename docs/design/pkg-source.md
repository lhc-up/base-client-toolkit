# 包来源：运行方式、选包规则与资源目录

> 状态：已评审（2026-11-19），2026-11-20 修订（包格式统一、`libs/pkg`、启动页口径）。与 `host.md`（宿主、包与宿主运行时）配套。

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

来源常量 `PKG_SOURCE`（`@base-client/toolkit/shared`，主进程与渲染进程共用）。业务按来源区分处理时引用常量，不写字面量。

| 来源 | 包信息从哪来 | 更新 | 适用场景 |
|---|---|---|---|
| `DEV_SERVER`（`devServer`） | `url` 根地址下的描述文件（`dev:app` / `dev:app --pkg-only` 提供，见 §5） | 不比对版本、不下载 | 本地开发自身；联调其他包 |
| `FILE`（`file`） | 指定包文件内的描述文件 | 不比对版本、不下载 | 排查某个具体的包，例如线上下载下来的 |
| `SEMVER`（`semver`） | 选中的包文件内的描述文件 | 按版本（语义化版本）匹配，需要时由调用方下载 | 打包运行的唯一方式；本地调试中未配置的包 |

`semver` 的选包流程（自身的包与其他包相同）：

1. 内置目录：`<资源根目录>/packages/`；
2. 下载目录：`UserData/Packages/`；
3. 给了版本：名称、环境、版本一致者，同版本内置优先；不给版本：名称、环境一致者中版本最新的；
4. 都没有：返回 `null`，由调用方决定是否下载（`pkg.download`）。

「线上版本从哪来」与「版本不一致时怎么办」（更新包、安装包、直接挂载）属于各宿主的业务策略，不在 toolkit 内。

### 4.2 来源规则

- 打包运行：一律 `semver`。
- 本地调试：宿主运行时 `devPkgSources` 中有该包就按配置，没有就 `semver`。
- 「本地调试时自身的包走自己的 dev server」由宿主在暴露宿主运行时时写入 `devPkgSources` 默认项，toolkit 不区分自身与其他包：

```js
devPkgSources: {
    [自身包名]: { type: PKG_SOURCE.DEV_SERVER, url: __BC_BUILD__.devUrl },
    ...pkg.parseDevSources(process.env.BC_DEV_PKG_SOURCES),   // 配置可覆盖默认项
}
```

### 4.3 配置：`BC_DEV_PKG_SOURCES`

- **只在本地调试（`isHostDev = true`）时生效**；打包运行时读取它的代码在构建期被整段删除，值也不会进入产物。
- 写在宿主项目的 `.env` 中，默认空值；宿主静态读取后用 `pkg.parseDevSources` 解析，经宿主运行时提供（字段 `devPkgSources`）。
- 值为 JSON，键为包名（自身的包用自己 `package.json` 的 `name`），值为来源。
- dotenv 支持**单引号包裹的多行值**，因此 JSON 可以分行缩进书写；JSON 内部不能写注释，说明写在变量上方的 `#` 注释中：

```
# 本地调试时各应用包的来源（只在 dev:app 下生效，打包后忽略）。键为包名，未列出的包按默认来源：
#   自身的包默认 devServer（自己的 dev server），其他包默认 semver。
# type 取值：
#   devServer  url = 该包 dev server 的根地址（该项目执行 dev:app --pkg-only 时会打印）
#   file       path = 指定的包文件（.asax / .asar），例如线上下载下来的包
#   semver     按版本选包：内置目录 → 下载目录 → 现场下载
# 示例（去掉 # 后按需修改）：
# BC_DEV_PKG_SOURCES='{
#   "questionaire": { "type": "devServer", "url": "http://localhost:8023/" },
#   "demochild": { "type": "file", "path": "D:/Downloads/demochild-test-v1.0.0.asax" },
#   "eachinacoreframe": { "type": "semver" }
# }'
BC_DEV_PKG_SOURCES=
```

| `type` | 必填字段 | 说明 |
|---|---|---|
| `devServer` | `url` | dev server 未启动时取包报错「dev server 未启动或不可访问」 |
| `file` | `path` | `.asax` 或 `.asar`；文件不存在时取包报错 |
| `semver` | — | 本地调试中也走标准选包流程；用于自身的包时，完整走一遍更新流程（下载更新包等） |

- 配置格式错误（JSON 解析失败、`type` 未知、必填字段缺失）：该项忽略、按默认来源，并输出错误日志；不影响启动。

### 4.4 本地调试的安全约束

- 本地调试时宿主**永不进入大版本安装包流程**（不下载、不安装），只记日志。
- 来源为 `devServer` / `file` 的包不比对版本、不下载；启动检查照常请求线上配置，只是跳过更新。
- `devServer` / `file` 的包名称、环境与预期不符时：**照常加载，并输出警告**。该能力只在本地调试生效，警告不会出现在线上；
  `semver` 下的选包要求名称、环境（与给定的版本）全部匹配，不会选中不符的包。

## 5. 包格式与包信息

### 5.1 描述文件

包根目录下的 `package.json`，由 frame 打包时写入；入口为包内相对路径，页面与目录的命名只由 frame 的布局表决定：

```json
{ "name": "...", "env": "...", "version": "...", "main": "main/pkg.js", "renderer": "renderer/index.html", "update": "renderer/update.html" }
```

- `main`：包主进程入口；`renderer`：主页面；`update`：启动页（包里没有启动页时没有该字段）。
- 本地调试时 `dev:app` 在 dev server 根地址下提供**同格式**的描述文件，入口为可直接使用的值（`main` 为磁盘绝对路径，页面为 dev server 地址）。
  所以 dev server 也是一种包，toolkit 读它的方式与读包文件相同。
- 缺少 `name` / `version` / `env` / `main` / `renderer` 任一项视为无效包。

### 5.2 包信息

`pkg.get` / `pkg.download` 返回：

```js
{ name, version, env, source, main, renderer, update? }
```

- `source`：`PKG_SOURCE` 之一。
- 三个入口都是可直接使用的值：`main` 用于 `require`，`renderer` / `update` 用于 `loadURL`。
- 组装规则只有一条：描述文件中的相对路径按包根目录拼成完整值，已是绝对路径或完整地址的原样使用。

### 5.3 接口（`main/libs/pkg`）

| 方法 | 作用 |
|---|---|
| `get(name, { env, version?, source? })` | 按来源取包（§4）。异步：`devServer` 需要读 dev server 上的描述文件。`source` 一般不传，宿主需要明确指定来源时才传（如 §5.4 的回落） |
| `download({ url, name, env, version?, integrity?, headers?, onProgress? })` | 下载到下载目录：先写不带后缀的临时文件，校验后改名为 `.asar`；名称、环境、版本与预期不符时删除文件并抛错 |
| `removeOtherVersions(pkg)` | 删除下载目录中该包的其他版本；非 `semver` 的包不处理。须在加载该包之前调用（Windows 下被读过的包删不掉） |
| `parseDevSources(raw)` | 解析 `BC_DEV_PKG_SOURCES`（§4.3） |

### 5.4 启动页口径

- 启动页随应用包分发（frame 启动页规范：`src/renderer/update/`），但宿主启动时**始终用随客户端下发的那个包**打开启动页：
  `pkg.get(自身包名, { env, version: 宿主版本 })`，同版本内置优先。
- 因此启动页版本 = 宿主版本，只随大版本（重新安装）更新；启动页上显示宿主版本。客户端版本指首页包（应用包）版本，两者可以不同。
- 取不到时：本地调试用自身的 dev server（`get` 传 `source: { type: DEV_SERVER, url: devUrl }`）；打包运行说明安装包已损坏，提示重新安装并退出。

## 6. `.asax` 的加载：临时副本

Electron 只识别路径中带 `.asar` 的归档，`.asax` 不能直接加载。需要加载 `.asax` 时（`file` 指定的 `.asax`、本地调试时内置目录中的 `.asax`），
toolkit 先复制为 `.asar` 临时副本再加载：

- 位置：`<系统临时目录>/base-client/<宿主名>/pkg-copies/`。系统或清理工具会清理临时目录，作为兜底。
- 文件名：`<原文件名去扩展>-<文件大小>-<修改时间>.asar`；同一文件在一次运行中只复制一次。

- 清理：每次启动、选包之前，删除该目录下的全部旧副本。本次运行尚未加载它们，可以删除；
  被其他运行中的实例占用而删除失败时，只记日志、跳过（按 `host.md` §9.1 的删除规则核对目录列表）。
- 打包运行时内置目录中已是 `.asar`，下载目录统一落盘为 `.asar`，不产生副本。
- 文件与目录操作一律用 `fs-extra`（`ensureDirSync`、`copySync`、`removeSync` 等），目录不存在、重复创建等边界由它处理；
  `.asar` 的读取与删除核对仍遵守 `host.md` §9.1。

## 7. 资源目录收敛到 `resources/`

项目根目录的 `resources/` 是打包后 `resources/` 的镜像，凡是随安装包分发、运行时读取的资源都放这里：

| 源码 | 打包后 | 读取方 |
|---|---|---|
| `resources/packages/*.asax`（内置的其他包） | `resources/packages/*.asar` | toolkit 选包（§4.1） |
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

## 8. 日志

选包与加载统一前缀 `[包]`，每个包每次选择输出一组，保证事后能还原「为什么加载了它」：

```
[包] questionaire：本地调试，依据配置 BC_DEV_PKG_SOURCES，来源=semver
[包] questionaire：下载目录命中 questionaire-test-v2.7.3.asar
[包] questionaire：已选定 { name, version, env, source, main, renderer }
[包] eachinacoreframe：本地调试，默认来源，来源=devServer，url=http://localhost:8066/
[包] demochild：已将 D:/Downloads/demochild-test-v1.0.0.asax 复制为临时副本 ...
[包] demochild：指定的包与预期不符，照常加载：env=test（预期 prod）
```

- 内容：包名、运行方式、依据（默认 / 配置）、依次检查的来源与结果、最终加载的来源与路径或地址、描述文件的名称 / 环境 / 版本、
  不符警告、跳过更新的原因。
- 主进程日志写入日志文件；本地调试时主进程输出由 `dev:app` 转到终端。不在页面提示。

## 9. 不在本设计内

- `semver` 下各宿主「版本不一致时怎么办」的业务策略（更新包 / 安装包 / 重启 / 直接挂载）：保持现状。
- 整合客户端首页模板只为固定的子应用标识写了卡片：业务现状，不改。
- 后台下发的包仍是旧格式：属于后台改造，客户端分支完成后再处理。
