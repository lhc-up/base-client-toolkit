# base-client.bake 功能对照（基线 F7）

2026-11-21 盘点。toolkit / frame 从 `base-client.bake` 演进而来，过程中有意改过设计，所以**只在功能层面对照**：
bake 里的每个功能，现在在 frame、toolkit 或两个项目的接入层里有没有着落。**不比较实现方式，实现不同不算问题**，
也不把 bake 的实现当作对齐标准。

结论分四种：

| 结论 | 含义 | 处理 |
|---|---|---|
| 有着落 | 找到了对应实现 | 不动 |
| 有意去掉 | 已被新方案取代或不再需要 | 不动，写明依据 |
| 缺失 | 找不到对应实现，也没有取代方案 | 逐条找用户确认要不要补；要补也按现在的设计实现 |
| 不在基线范围 | 业务功能，或 bake 自身的示例 / 未接通的试验代码 | 不动 |

拿不准的标「存疑」。「缺失」均在 toolkit、frame、两个项目的接入层中按关键词搜过并抽查核实。

路径简写：bake = `base-client.bake`，tk = toolkit，fr = frame，问卷 = `questionnaire-answer-v3.0`，整合 = `eachinaclientframe`。

## 1. 缺失（已核实）

| # | 功能 | bake 中的作用 | 现状 | 可能的影响 |
|---|---|---|---|---|
| R1 | 主进程未捕获异常写日志 | `src/main/main.js:14-19` 注册 `uncaughtException` / `unhandledRejection` 写日志 | tk 与两个项目都没有注册 | 主进程异常不进日志，事后无从排查；Electron 默认会弹出「A JavaScript error occurred in the main process」对话框 |
| R2 | 整合客户端正常退出时等日志写完 | `main.js:47-56`、`libs/app.js:98-103` 退出前 `Logger.shutdown()` | 整合 `src/main/index.js:69`、`capability/app.js:12,21` 直接 `app.exit`；问卷已正确处理 | 整合客户端每次正常退出都可能丢最后一段日志（tk logger 文件头有实测） |
| R3 | 打开系统时间设置：macOS / Linux | `service/system/timeSetting.js:32-61`：macOS 系统偏好；Linux 依次试 gnome / dde（UOS）/ KDE | 问卷 `capability/update/index.js:214`、整合 `capability/update.js:125` 非 Windows 直接返回 `unsupported-platform` | Linux / 龙芯上时间不对时，启动页「修改时间」只能提示手动修改 |
| B1 | dev:app 主进程调试参数 | `build/client/dev.js:95-100`：`--inspect=5858 --trace-warnings --unhandled-rejections=strict` | fr `dev-app` 只传入口文件 | 本地调试主进程无法附加调试器；未处理的 Promise 拒绝在开发期不暴露 |
| B2 | dev:app 关闭 Electron 后询问重启 | `dev.js:107-109,126-162` | fr `dev-app.js:166` Electron 关闭即退出 | 开发时每次关窗口都要重新执行 `dev:app`、等完整编译 |
| B3 | 生产构建删除 console | `client.webpack.main.config.js:36-37` 等：`drop_console` / `pure_funcs` | fr 与两个项目只用 webpack 默认压缩 | 安装包保留 console 输出，体积略大 |
| B4 | 循环依赖检测 | `build/config/modules/plugins.js:14-17`（CircularDependencyPlugin） | 没有 | 循环 import 不在构建期提示，运行时可能取到 `undefined` 且难定位 |

## 2. 存疑

| # | 内容 | 为什么拿不准 |
|---|---|---|
| S1 | 产物加密的运行时解密：bake `libs/protocol.js:66-69` 拦截 `file://` 解密；fr 有构建期加密，但 `docs/crypto-artifact-contract.md` 写明运行时解密由业务实现，tk 与两个项目都没有 | 两个项目都 `encrypt: false`，目前无影响；一旦开启加密页面会加载不出来。分不清是有意延后还是遗漏 |
| S2 | 加密范围变窄：bake 加密 renderer / update 下全部文件，fr 只加密 `.js` | 没找到收窄的说明 |
| S3 | 键盘锁定：bake `service/system/index.js:4-20` 加载 `block-keyboard` 原生插件；现在没有，整合 `resources/addons/` 为空，问卷没有 `resources/` | 两个项目都没有调用方，没有取舍说明 |
| S4 | 页面加载失败通知：bake `win/index.js:91-101` 在 `did-fail-load` 时通知渲染层；现在没有 | bake 渲染层也没有监听方，可能本来就没用 |
| S5 | `no-sandbox`：bake `main.js:38` 设置；两个项目都没有（deb 安装脚本会给 chrome-sandbox 设 SUID） | Linux / 龙芯未真机验证（§5） |
| S6 | 两个宿主接入不一致：DevTools 热键、F11 拦截、Linux 窗口图标、用浏览器打开链接，整合有、问卷没有 | 没找到问卷有意不做的说明 |
| S7 | 第三方库单独拆 vendor 文件：bake 有，现在用 webpack 默认拆分 | 客户端影响很小，无法判断是有意不要还是漏了 |
| S8 | `package.json` 的 name 支持什么格式（bake `待办.md` 未完成）：fr 不校验，name 被用于 Linux 可执行文件名、更新包文件名、包来源键名 | 没找到验证结论 |

## 3. bake `待办.md` 中未完成、现在也没有着落的

| 条目 | 现状 |
|---|---|
| 可视化打包 | fr 只有命令行 |
| electron 镜像源（npmmirror） | 仓库内没有配置 `ELECTRON_MIRROR`；龙芯镜像由 fr 内置（F8） |
| 本地服务端口被占用时自动换端口 | fr `run-dev-server.js` 用固定端口（可用 `--port` 覆盖） |
| 资源加密 | 见 S1、S2 |
| 云电脑环境下用户会话是否会串 | 没有结论；随机 partition 已去掉，Partitions 增长问题随之消失 |

`待办.md` 中其余已完成或现在已有着落的条目，见第 5、6 节。

## 4. 不在基线范围（标出备查，不处理）

- web 构建按环境复制 `update.json`（bake `build/web/build.js:92-103`）：问卷提交 `12f8ca8c` 已删除，现在由谁发布属于部署 / 业务。问卷 `docs/客户端升级详细设计文档.md:495-506` 仍描述旧做法。
- 问卷自带的 `default.conf` 没有 history 路由回落规则：属于部署配置。
- 启动页「已下架」状态、内网跳过更新、网络失败时的官网链接：启动页由各项目自写，更新策略属业务（tk `docs/design/host.md` §1）。
- bake 的 `src/renderer`（登录、http、存储工具等）、`templates/vue2`、业务配置与枚举、`.html` / `.tpl` 加载、注入 js 加密：业务或示例。
- bake 里声明了但从未接通的代码：Notice 内置事件、`global.wjConfig.webMode` 在线模式、`encryptInjectJs`。

## 5. 运行时对照（有着落 / 有意去掉）

| 功能 | 结论 | 现在的位置或依据 |
|---|---|---|
| 单实例 | 有着落 | tk `src/main/libs/singleInstance.js`（K18 加返回值）；两个项目 `src/main/index.js` |
| 进程级开关（硬件加速、证书） | 有着落（各项目自定） | 整合 `src/main/index.js:53-55`；问卷用 `setCertificateVerifyProc`；`no-sandbox` 见 S5 |
| 证书校验放行 | 有着落 | 两个项目 `src/main/index.js`；tk `host.md:40` 写明证书策略属业务 |
| 全部窗口关闭后退出、退出前关日志 | 问卷有着落；整合见 R2 | 问卷 `src/main/index.js:209-241` |
| 退出 / 重启 / 最小化 | 有着落 | 两个项目的 `capability/app`、`capability/window` |
| 主窗口、启动页窗口、启动页交接主窗口 | 有着落 | tk `BaseWindow`；两个项目 `src/main/win/*`、`capability/update` 的 `launch` |
| 拦截任务栏关闭 | 有着落（各项目自定） | 整合 `win/main.js:67`；问卷靠作答页 beforeunload |
| 主窗口页面地址（dev server / 打包） | 有着落 | tk `libs/pkg`（`docs/design/pkg-source.md` §4） |
| cookie 共享与 Origin / Referer 改写 | 有着落 | 整合 `src/main/libs/cookie.js`；问卷只改写 Referer |
| 每次启动随机 partition | 有意去掉 | 两个项目用 defaultSession；问卷启动时清残留 cookie |
| 渲染层直接用 Node（nodeIntegration、remote） | 有意去掉 | tk `architecture.md` §1、§2.2；两个项目 `contextIsolation: true` |
| DevTools 热键 | 有着落 | tk `src/main/libs/shortcut.js`；问卷未接，见 S6 |
| 选本地最新版本的包、热更包下载 | 有着落 | tk `src/main/libs/pkg`（K16） |
| 安装包下载与进度 | 有着落 | 两个项目 `capability/update`（基于 tk `libs/download`） |
| Windows / Linux / 龙芯安装 | 有着落 | tk `capability/update`；Linux / 龙芯的偏差已登记 K13 / K14 |
| 系统识别 | 有着落 | tk `src/main/libs/os.js`（K17） |
| 缓存目录规整 | 有着落 | tk `src/main/paths.js`（目录结构与 bake 相同） |
| 日志（含轮转）、渲染层写主进程日志 | 有着落 | tk `libs/logger.js`、`loggerConfig.js`、`capability/logger`（新增日志导出） |
| 本地存储 | 有着落 | tk `libs/store.js`、`capability/store` |
| 压缩 / 解压、通用下载、资源缓存 | 有着落 | tk `libs/archive`、`libs/download`、`capability/download` / `archive`；问卷 `capability/resource` |
| 原生插件加载 | 有着落（机制） | tk `libs/resourceRoot.js`；具体插件见 S3 |
| 用浏览器打开链接 | 有着落（只在整合） | 整合 `capability/window.js:24`；见 S6 |
| MAC 地址、分辨率检查 | 有着落 | tk `capability/env` |
| 打开系统时间设置 | Windows 有着落；macOS / Linux 见 R3 | 两个项目 `capability/update` |
| 把路径配置、全局变量开放给渲染层 | 有意去掉 | tk `architecture.md` §1、`host.md:76`；由 `update.getPkg`、`appInfo` 等替代 |
| `resource://` 协议 | 有着落 | tk `libs/protocol.js`（增加了根目录校验） |
| `file://` 解密 | 见 S1 | — |
| Service（异步、同步、回调参数、错误回传） | 有着落 | tk `src/service`；同步方法改为在 schema 中声明 |
| preload 只做转发 | 有着落 | tk `src/preload`；两个项目 preload 只有一行 |
| Notice | 有着落 | tk `src/notice`（bake 中未接通） |
| 应用信息 | 有着落 | fr `__BC_BUILD__`；两个项目 `src/shared/appInfo.js` |
| shared 中的业务枚举 | 有意去掉 | tk `architecture.md` §6：shared 禁止放业务枚举 |
| 启动页：顶栏信息、时间校验、版本比对分流、热更与安装包流程、最少展示时长、关闭确认、可定制 | 有着落 | 两个项目 `src/renderer/update/`；启动页规范（F9） |

## 6. 构建对照（有着落 / 有意去掉）

| 功能 | 结论 | 现在的位置或依据 |
|---|---|---|
| web 生产构建、ES5 校验、兼容范围、favicon | 有着落 | fr `commands/build.js`、`presets/web.js`；问卷 `bc.config.js` web 段、`postbuild`、`.browserslistrc`、`index.ejs` |
| web 多页 HTML | 有意去掉 | history 路由回落 `index.html`（问卷 `技术约定.md:122`，提交 `12f8ca8c`） |
| web 开发服务器（热更新、代理） | 有着落 | fr `dev-web`、`run-dev-server.js`；问卷 `bc.config.js` devServer |
| 客户端 main / preload / renderer / 启动页构建 | 有着落 | fr `presets/main.js`、`preload.js`、`renderer.js`、`update-page.js` |
| 打包流水线、免安装目录、复用免安装目录出安装包 | 有着落 | fr `commands/pack.js`（`--dir`）、`commands/installer.js` |
| dev:app 编译三进程、渲染进程热更新、启动 Electron | 有着落 | fr `commands/dev-app.js` |
| dev:app 监听 main / preload 改动自动重编译 | 有意去掉 | fr `dev-app.js:108`（main + preload 一次编译）；bake 的监听路径本身写错、不起作用 |
| 环境变量加载与注入 | 有着落（形式已改） | fr `core/env.js`、`user-env-plugin.js`（只允许静态 `BC_` 写法） |
| 构建信息注入 | 有着落 | fr `core/build-info.js`、`build-info-plugin.js` |
| 全局常量 `ENV` / `__PROXY_ENV__` / `__PROXY_HOST__` | 有意去掉 | 被 `__BC_BUILD__.env` 与 `.env` 的 `BC_API_SERVER` 取代 |
| babel / css 兼容范围（Electron 22、Node 16） | 有着落 | 两个项目 `.browserslistrc`、`babel.config.js` |
| CSS 抽离与压缩、图片字体规则 | 有着落 | fr `presets/renderer-defaults.js`（F6） |
| Worker 构建 | 有着落 | 改用 webpack 5 原生写法 |
| 路径别名 | 有着落 | 两个项目 `bc.config.js` |
| 渲染层 AES 加密 | 有着落（范围见 S2） | fr `pack/encrypt.js`；两个项目 `encrypt: false` |
| bytenode | 有着落 | fr `pack/bytenode.js`；两个项目 `bytenode: false`（bake 中实际未开启） |
| 小版本更新包 | 有着落（模型已改） | fr `pack/pkg.js`（`<name>-<env>-v<version>.asax`） |
| 子应用包 | 有意去掉 | 被 `pack --pkg-only` 取代（fr `docs/pkg-contract.md`） |
| 平台 / 架构选择、安装包目标 | 有着落 | fr `electron/build-targets.js`（默认架构改为构建机） |
| Windows 代码签名 | 有着落 | `pack --sign`；两个项目 `electron-builder.config.js` |
| 龙芯打包 | 有着落 | fr `electron/loong64.js`（F8） |
| 安装 / 卸载脚本生成、NSIS 系统版本检测页 | 有着落 | fr `pack/shell.js`、`templates/shell/*` |
| NSIS 安装前删除 HKCU 卸载项 | 有意去掉 | fr 提交 `dd554f7`；bake 中 `{{GUID}}` 从未被替换，本来就不起作用 |
| 随安装包分发的资源目录 | 有着落（机制） | fr `pack/pkg.js`、README「资源目录」；具体资源见 S3 |
| 安装包不含 node_modules | 有着落 | fr `presets/pack.js` |
| 客户端图标（多尺寸、ico、icns，含 96×96） | 有着落 | fr `pack/icon.js`（从 `build/icon.png` 自动生成） |
| 安装包命名与元数据 | 有着落 | fr `presets/pack.js`；两个项目 `electron-builder.config.js` |
| 构建进度显示 | 有着落 | fr `webpack-runner/compile-spinner.js` |
| 命令行参数（cross-env） | 有意去掉 | 被 cac CLI 选项取代 |
