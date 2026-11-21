# 基线待办清单

基线版本 = **满足全平台全架构**的 toolkit / frame 版本。本文是跨仓库的唯一待办跟踪表；
实现细节与实测依据仍保留在各仓库原有的限制文档里（见 §6），本文只跟踪状态、优先级与决策。

- 平台顺序：Windows 先，Linux / 龙芯在后，但**全部条目都属于基线**，不是可选项。
- 状态：`待确认` → `待做` → `进行中` → `已完成`。用户确认后把「待确认」改为「待做」。
- 编号一经分配不再复用；已完成的条目保留编号并标注完成日期。

## 1. 执行顺序（配对组）

同一组内的条目互相影响或需要连带改业务侧，必须一起做、一起验证。

| 组 | 条目 | 为什么放一起 |
|---|---|---|
| G1 日志 | K1、K2 | 同一个 `libs/logger.js`，一次改动、一次测试 |
| G2 下载与安装 | K4、K5、K6、K10、K11 | 都动 `capability/update` / `libs/download`；K11 会重构 K4、K10 的落点，顺序 K4/K5/K6 → K10 → K11 |
| G3 存储 | K3、P1 | 上游开放 sync 别名后，业务侧的追加绕行必须同步删除 |
| G4 序列化 | K8、两个项目核对 IPC 消费面 | 改变 IPC 实际类型，两个项目需确认不依赖旧行为 |
| G5 构建信息 | F1、F2、P2 | 同一处 build-info；业务侧的 `?? env` 兜底与 frame 兜底重复 |
| G6 版本声明 | F3、P4 | 对齐 Node 版本后，业务侧 `parallel: false` 的绕行是否保留一起定 |
| G7 preload 路径 | K12、F5、P5 | 跨 frame / toolkit / 项目，必须一起改 |
| G8 Linux | K13、K14、F8、F11 | 同一批 Linux / 龙芯验证，一起改一起测 |
| G9 独立项 | K7、K9、K17、K18、F4、F6、F7、P3、P6、P9、P10、P11 | 无跨仓库耦合，可单独排（K15 已并入 §5） |
| G10 包操作统一 | K16、F9、P8 | 复查发现整合客户端进不了首页（`issue()` 引用未定义变量、下载后的包没有入口）；根因是包的查找、转换散落在 toolkit 与三处业务代码，一起重构 |

## 2. toolkit 条目

| # | 优先级 | 状态 | 问题 | 方案 | 验证 |
|---|---|---|---|---|---|
| K1 | P0 | 已完成（2026-11-19） | logger 只用 `instanceof Error` 识别错误，跨上下文（iframe / vm / 另一 realm）的 Error 被记成 `{}`，message 与 stack 全丢 | 判定改为 `arg instanceof Error \|\| Object.prototype.toString.call(arg) === '[object Error]'`；其余分支不变 | 补 `vm.runInNewContext` 单测；问卷 `tests/main/logger-cross-context-error.test.js` 由已知失败转为通过 |
| K2 | P0 | 已完成（2026-11-19） | 日志轮转写死 100K × 20（约 2 MB，实测考场密度下留存约 4 小时），业务无法覆盖 | 默认改 500K × 10；新增 `main/libs/loggerConfig` 的 `setLoggerConfig`（须在 require logger 之前调用，时序同 `setPathConfig`） | 默认值与覆盖的单测；README 更新 |
| K3 | P0 | 已完成（2026-11-19） | `capability/store` 只给 `get` / `getFile` 开 sync；`setFile` / `removeFile` 无同步别名，写后立即读大概率读到旧值；文件头"其余五个"的理由对异步实现不成立 | `sync` 增加 `setFile`、`removeFile`；文件头按「同步实现 / 异步实现」分开写清代价 | schema 单测；G3 业务侧绕行删除后回归 |
| K4 | P0 | 已完成（2026-11-19） | `downloadPkg` 走 Chromium HTTP 缓存且不传 headers，同一地址覆盖发布的包可能取到旧内容 | 默认带 `Cache-Control: no-cache`；新增 `headers` 选项供覆盖，透传给 `startDownload` | 单测断言默认头与覆盖 |
| K5 | P0 | 已完成（2026-11-19） | `installApp` 退出用 `logger.shutdown()` + 盲等 500ms + `app.exit`，丢掉 shutdown 的 Promise，升级路径日志最易丢，且跳过 `will-quit` | `quitApp` 改为 `await logger.shutdown()` 再 `app.exit(1)`；调用点补 `await` | 单测：shutdown 未完成时不退出 |
| K6 | P0 | 已完成（2026-11-19） | `log4js` / `electron-store` 声明 optional 但顶层 require，实际必装；`semver` 同理，只用 `installApp` 的消费者也被迫安装 | `log4js`、`electron-store`、`semver` 三个库都去掉 `optional`（顶层 require 即必装），只保留 `@vscode/sudo-prompt` 为 optional | 未安装 semver 时仅调用 `installApp` 可用；`npm ls` 无 invalid |
| K7 | P0 | 已完成（2026-11-21） | preload 取 schema 时主端漏 init：实测 `sendSync` 不抛异常，阻塞到主进程 GC（约 2–8 秒）后返回 `{ error: 'reply was never sent' }`；toolkit 随后抛出无信息的错误，渲染层拿到 `undefined`，且 appNotice 一起装不上 | `shared/metaChannel` 把「抛异常 / 非信封应答」判为未 init：对应 bridge 降级（Service 空对象、Notice 只留顶层 API 且调用即报原因）+ `console.warn`；`init()` 两个 bridge 各自装配；保留 opt-out（阻塞无法在 preload 侧避免）；改正 `architecture.md` §2.5 | 单测（未 init 两种形态、互不连累）；Electron 22.3.1 实测两侧都未 init、只 init Notice 两种场景 |
| K8 | P0 | 已完成（2026-11-19） | `serializeForIpc` 把 Date / RegExp / Map / Set / BigInt / NaN / ±Infinity 降级成字符串或普通对象，且无解码路径（`NaN` 最隐蔽：普通运算结果过 IPC 即变字符串） | 不加选项：IPC 路径按 structured clone 语义透传原生类型，Map / Set 保留类型并逐项处理（复查补全 `280922b`）；`safeStringify`（日志）保持现状；Error 的成对编解码不动 | 单测改为 structured-clone 语义；G4 两个项目确认消费面 |
| K9 | P0 | 已完成（2026-11-21） | `os` / `singleInstance` 缺用法文档（`logger` / `store` / `shortcut` 已有）；`setPathConfig` 的时序约束不在 README | README 补 `os`、`singleInstance` 两节（含 `lsb_release` 同步执行、提前返回等注意点），`/main/paths` 一行补时序约束；不给 `/main` 加 libs 入口（保持包边界） | 文档 |
| K10 | P1 | 已完成（2026-11-19） | `libs/download` 的 `timeoutMs` 只覆盖等响应头阶段，body 传输阶段无任何超时或 stall 检测，服务端卡住时 promise 永不 settle | 增加 `idleTimeoutMs`（默认 60s）：两次数据间隔超时即 abort；`timeoutMs` 保持原语义。复查补全（`b73f341`）：停顿与取消统一中止网络请求 | 单测模拟卡住的流，断言 abort 与 `DOWNLOAD_TIMEOUT` |
| K11 | P1 | 已完成（2026-11-19） | `capability/download` 把编排、存储根、renderer 契约焊死，业务主进程无法复用；无「已存在且完整性匹配则跳过」语义 | 编排下沉 `libs/download` 批量入口（`files`、`skipIfValid`、并发、文件级回调）；`capability/download` 退为薄适配层。复查补全（`4ee6db9`）：`startBatch` 取消覆盖全部进行中任务，未开始的记为 cancelled，校验复用 `libs/integrity` | 单测 + 业务侧复用后删掉重写的编排 |
| K12 | P1 | 已完成（2026-11-19） | `BaseWindow` 不提供 preload 路径默认值，每个项目重写同一段绝对路径 | 与 F5 配对：由 frame 导出产物路径常量，toolkit 不内置默认（保持不依赖 frame 的边界） | 两个项目改用后编译与运行通过 |
| K13 | P2 | 待确认 | Linux `dpkg -i` 无 `--force-overwrite`，文件冲突时安装直接失败且几乎不可排查 | `installApp` 增加可配置 dpkg 选项（如 `{ dpkgForce: ['overwrite'] }`），默认关闭；`installByDpkg` 与 `installByOpenShell` 两处都改 | Linux 验证 |
| K14 | P2 | 待确认 | Linux 安装两处偏差：`installByOpenShell` 丢了「安装完成」提示与 `sleep 3`（xterm 一闪而过）；`!err && !stderr` 把成功时的 stderr 警告判为失败 | 补提示与 `sleep`，经 `sh -c` 执行，安装包路径作为参数（`$1`）传入，不拼进命令字符串；失败判定统一只看退出码，stderr 交给 logger | Linux / 龙芯验证 |
| K15 | P2 | 已并入 §5（2026-11-21） | Linux / 龙芯安装与 dpkg 流程缺少自动化与真机验证记录 | 不单独做，由 §5 验证矩阵的 Linux 行覆盖（含 dpkg 安装步骤与记录模板） | 见 §5 |
| K17 | P1 | 已完成（2026-11-21） | `os` 的 `linuxArch` / `linuxCore` / `lsbRelease` 注释写返回 string，实际返回带末尾换行的 Buffer，`env.getSystemDesc()` 拼出的描述每段夹着换行；注释示例 `Ubuntu 20.04` 也不对（`lsb_release -i -s` 只有发行版名） | 统一经 `execSync(cmd, { encoding: 'utf8' }).trim()`，失败记日志返回空串；改正 `env` 注释 | 单测（K9 中发现） |
| K18 | P1 | 已完成（2026-11-21） | `singleInstance` 抢锁失败只调用异步的 `app.quit()`、无返回值，调用方后面的代码在退出前继续执行（问卷：第二实例抢走截屏热键、启动服务发现） | 返回是否拿到锁（boolean），README 写明用法；业务侧改用见 P11 | 单测（K9 中发现） |
| K16 | P0 | 已完成（2026-11-20） | 包操作分散在 `pkgSource` 与 update 能力：返回结构不统一、入口要调用方自己拼、下载后只返回路径，调用方只能再找一遍 | 新增 `main/libs/pkg`（`get` / `download` / `removeOtherVersions` / `parseDevSources`），包信息统一为 `{ name, version, env, source, main, renderer, update? }`；devServer 只配 `url`、读 dev server 上的描述文件；`shared` 导出 `PKG_SOURCE`；删除 `pkgSource`，update 能力只保留安装包（含删除 `getUpdatePkgList` / `getNewestPkg` / `stageLocalPkg` 与下载的整体超时 race）。设计见 `pkg-source.md` | 单测；两个项目打包运行与本地调试实测 |

## 3. frame 条目

| # | 优先级 | 状态 | 问题 | 方案 | 验证 |
|---|---|---|---|---|---|
| F1 | P0 | 已完成（2026-11-19） | `BC_ENV_NAME` 无兜底、缺失时完全静默，`__BC_BUILD__.envName` 键直接不存在 | 缺失时回退为 `env` 的值，并输出一条构建警告（无法凭空推断展示名，回退值即为提示） | frame 单测；G5 业务侧 `?? env` 删除后回归 |
| F2 | P0 | 已完成（2026-11-19） | 整体引用 `__BC_BUILD__` 会带入 `buildTime`，破坏产物 hash 稳定性与可复现性 | `buildTime` 不进 `__BC_BUILD__`，单独注入为 `__BC_BUILD_TIME__`；包描述文件仍写 `buildTime` | 单测：整体对象不含 `buildTime`；两个项目 `appInfo` 改读 `__BC_BUILD_TIME__`（P7） |
| F3 | P0 | 已完成（2026-11-19） | `engines` 声明 Node ≥ 18.12，但实际 Node 16 可跑；同时 `css-minimizer-webpack-plugin` 8 官方要求 Node ≥ 20.9，两个项目靠 `parallel: false` 规避 | 核实真实下限并对齐 `engines`；README 明确区分「构建 Node 版本」与「Electron 内置 Node 版本」 | Node 20 / 22 下全量测试 |
| F4 | P0 | 已完成（2026-11-21，问题不成立） | 怀疑通用替换未覆盖 `typeof process.env.BC_xxx` | 实测已覆盖：webpack 的 typeof 钩子未处理时会把参数当成员链交给插件，未声明的变为 `typeof undefined` 并警告；补回归单测，README 写明（frame `a3455e7`） | frame 单测 |
| F5 | P1 | 已完成（2026-11-19） | 生产项目需要自行拼 preload / 产物路径 | frame 导出路径常量（如 `@base-client/frame/paths`），与 K12 配对 | 两个项目改用后编译与运行通过 |
| F6 | P1 | 待确认 | webpack 预设未规整（main 不处理资源、共用配置未抽取） | 结构整理，产物行为不变 | 产物对比 |
| F7 | P1 | 待确认 | 与历史 base-client.bake 的行为差异未系统盘点 | 逐项梳理成文档，能对齐的对齐 | 文档 |
| F8 | P2 | 待确认 | 龙芯（loong64）打包需自备 Electron 镜像源，frame 不内置 | 写入 README；是否内置镜像配置待定 | 龙芯验证 |
| F9 | P0 | 已完成（2026-11-20） | 布局收敛不彻底（打包、过滤、复制、加密、项目代码中仍有写死的目录名）；启动页由业务各自配置；描述文件的 `renderer` 是目录、页面名靠调用方写死；devServer 来源靠手配 `main` + `url` | `paths.js` 单一布局表，构建期 `createLayout`、运行期 `resolveLayout` 同源（替代 `resolvePreload`）；启动页规范（`src/renderer/update/`，frame 自动加入）；描述文件写 `main` / `renderer` / `update` 三个入口文件；`dev:app` 在 dev server 根地址提供同格式描述文件。复查补全：与 toolkit 约定的目录名、描述文件名集中定义，README 列出，两边单测断言（frame `8ff35c4`、toolkit `df19dc2`） | 单测；两个项目打包与本地调试实测 |
| F10 | P0 | 已完成（2026-11-20） | 构建 Node 版本无运行时检查（`engines` 只是声明）；主进程代码在 Electron 22 内置 Node 16.17 上的兼容性无保障 | 命令入口按 `engines` 检查构建 Node 版本；两个项目加 `.nvmrc`；整合客户端主进程与 frame `paths.js` 按 Node 16.17 做 lint | frame `e2dcdb2`，整合 `c7bd6c6`，问卷 `3ed5d7f5` |
| F11 | P2 | 待确认 | 仓库无 `.gitattributes`，在 Windows 上发布时 `bin/base-client.js` 首行带 `
| F12 | P1 | 待确认 | Linux x64 安装包文件名的架构段是 `amd64`（如 `专项数据采集系统_linux_amd64_release_v2.7.2.deb`），与 `--arch x64` 及 Windows / mac 的 `x64` 不一致，很多人不认识 amd64。原因：electron-builder 的 `getArtifactArchName` 对 deb 把 x64 映射为 Debian 架构名；包内 `Architecture` 字段由另一个函数 `toLinuxArchString` 决定，与文件名无关 | frame 合并配置后，Linux 且 x64 时把 artifactName 中的 `${arch}` 换成 `x64` 写入 `deb.artifactName`（优先级高于顶层），项目配置不动；包内 Architecture 仍为 amd64。已排查：toolkit 安装只校验扩展名 `.deb`，两个项目下载安装包后用随机名落盘，仓库内无按原文件名查找 / 上传的代码；问卷 `技术约定.md` 需同步。待确认：是否顺带把龙芯 `loongarch64` 统一为 `loong64`；仓库外上传 / 归档流程是否依赖原文件名 | frame 单测（linux x64 → x64，arm64 / loong64 / win / mac 不变）；打 deb 后 `dpkg-deb -f` 确认 Architecture 为 amd64 |
`，Linux / mac 上 `#!/usr/bin/env node
` 无法执行 | 加 `.gitattributes` 固定 `bin` 等脚本为 LF（toolkit 一并加）；发布前检查 | Linux / mac 上执行 `base-client` |

## 4. 业务侧连带清理（底座修完后执行）

| # | 状态 | 内容 | 对应上游 |
|---|---|---|---|
| P1 | 已完成（2026-11-19，问卷 `02fff48f`） | 两个宿主在注册 `store` 时追加 `setFile` / `removeFile` 同步别名的绕行代码删除 | K3 |
| P2 | 已完成（2026-11-19） | 两个项目 `appInfo` 中 `envName: __BC_BUILD__.envName ?? __BC_BUILD__.env` 的兜底删除 | F1 |
| P3 | 已完成（2026-11-21，问卷 `9db663c3`） | 问卷 `installDownloaded` 中前置的日志 flush 删除（`installApp` 会自己等），toolkit 安装过程的日志不再丢失；打包实测通过（日志出现 toolkit「执行大版本安装文件」后应用退出）；升级页过时注释 `0395802e` | K5 |
| P4 | 已完成（2026-11-19） | 两个项目 `bc.config.js` 的 `parallel: false` 绕行是否保留，随 F3 的结论定 | F3 |
| P5 | 已完成（2026-11-19） | 两个项目改用 frame 导出的路径常量 | K12 / F5 |
| P6 | 已完成（2026-11-20） | 问卷 `docs/base-client/已知问题.md` 的 B 类三条（跨上下文 Error、下载缓存、日志轮转）随上游修复删除 | K1 / K2 / K4 |
| P7 | 已完成（2026-11-19） | 问卷 `appInfo.publishTime` 改读单独注入的 `__BC_BUILD_TIME__`（不属于 `__BC_BUILD__`） | F2 |
| P8 | 已完成（2026-11-20） | 两个项目改用 `libs/pkg` 与新包信息：启动页始终用随客户端下发的包（宿主版本）打开、显示宿主版本；删除「上次启动版本」记录与据此重启的逻辑；整合客户端 `update` 改为 `getPkg` / `downloadPkg` / `launch`（修复进不了首页），进入失败与下载的包不符时显示 `loadingError`；问卷保留「本地最新的包、失败回落内置包」规则 | K16 / F9 |
| P9 | 已完成（2026-11-21，问卷 `5ccc0fe7`） | 问卷 `capability/resource` 两处「单地址超时 × 地址数」的 `Promise.race` 整体超时删除：传输停顿 60 秒由 toolkit 中止并换下一个地址，慢速但持续有数据的大文件不再被打断；打包实测：停顿 60.5 秒后中止并断开连接（经登录页资源包路径验证，作答页需真实后台登录，由单测覆盖） | K10 |
| P10 | 已完成（2026-11-21，问卷 `6496ca87`） | 登录页资源包预下载 `downloadPackages` 改用 `startBatch`（无 hash 的资源包仍「存在即跳过」，事件不变）；修复停止时把取消记为失败的 ERROR 日志、全局停止标志被下一批重置导致旧批次继续下载。作答页 `storageFile` 不改（需先查资源包目录、无 hash 存在即用，`startBatch` 表达不了）；打包实测通过：跳过 / 下载 / 校验失败 / 停顿失败 / 无 hash 存在即跳过的事件与界面同原来一致，中途停止不记失败、不再请求后续文件 | K11 |
| P11 | 已完成（2026-11-21，问卷 `b389afef`、整合 `da98f91`） | 两个项目改为 `const gotTheLock = checkSingleInstance()`，`whenReady` 开头 `if (!gotTheLock) return;`：第二实例不再建 host、注册热键、启动服务发现；删除问卷关于失效窗口的注释；打包实测通过：两个项目的第二实例约 1 秒退出，无日志、无请求，第一实例不受影响 | K18 |
| P12 | 已完成（2026-11-21，问卷 `4a904346`） | 问卷 `npm test` 的 `node --test tests/renderer/` 在 Node ≥ 21 下把目录当模块加载而整体失败，改为 `node --test "tests/renderer/*.test.js"`；Node 22 下 jest 29 个 + 渲染层 34 个全部通过 | — |

## 5. 全平台全架构验证矩阵

基线完成前，下列每个组合各跑一遍：打包 → 安装 → 启动 → 更新 → 子应用进入 / 退出。
Linux / 龙芯行同时覆盖 K15：dpkg 安装与 openShell 安装两条路径各跑一遍，按统一模板记录（发行版、架构、Electron 版本、结果、日志位置）。
范围（2026-11-21 确定）：基线**支持**全部 8 个组合；**本期验证**只覆盖业务在用的 5 个。

| 平台 | 架构 | 基线支持 | 本期验证 | 验证环境 | 状态 |
|---|---|---|---|---|---|
| Windows | x64 | ✓ | ✓ | 本机 | 待验证 |
| Windows | ia32 | ✓ | ✓ | 本机（64 位 Windows 运行 32 位包） | 待验证 |
| Windows | arm64 | ✓ | — | 无 | 不验证（业务未使用） |
| Linux | x64 | ✓ | ✓ | 需另备机器（本机受限装不上 WSL） | 待验证 |
| Linux | arm64 | ✓ | ✓ | 需另备机器 | 待验证 |
| Linux | loong64 | ✓ | ✓ | 需另备龙芯机器 | 待验证 |
| macOS | x64 | ✓ | — | 无 | 不验证（业务未使用） |
| macOS | arm64 | ✓ | — | 无 | 不验证（业务未使用） |

「不验证」的组合仍属基线支持范围：代码不得写死平台 / 架构，但本期不做实测。

## 6. 来源文档与维护规则

| 文档 | 角色 |
|---|---|
| 本文件 | **唯一的状态与排期跟踪表**；新增基线问题先在此分配编号 |
| `base-client-toolkit/docs/design/known-limitations.md` | toolkit 条目的详细依据与实测数据；条目状态以本文件为准 |
| `base-client-frame/docs/design/known-limitations.md` | frame 条目的详细依据；条目状态以本文件为准 |
| `questionnaire-answer-v3.0/docs/base-client/已知问题.md` | 业务侧问题；属于底座的条目按编号引用本文件 |

维护规则：

- 条目完成后：本文件标 `已完成（日期）`；对应详细文档删除该条或标注已修，避免两处长期重复。
- 新发现的问题：若属基线范围，先在本文件分配编号，再补详细文档。
- 本文件不写实现细节，避免与详细文档漂移。

## 7. 待决策

1. ~~平台 / 架构矩阵的具体范围（§5）~~：已确定（2026-11-21），全部支持，本期验证 Windows x64 / ia32、Linux x64 / arm64 / loong64；本机只能验证 Windows。
2. F8 龙芯镜像源：仅写文档，还是 frame 内置镜像配置。
3. ~~问卷 `docs/base-client/已知问题.md` 的既有更新提交（`39fcdf98`）保留还是撤销~~：已关闭，保留（2026-11-21）。

## 8. 进度记录（最近一次：2026-11-21）

> 只记录「做到哪了、下一步做什么」，条目状态以上面各表为准。下次开始时先读本节。

### 8.0 2026-11-21 完成

- 业务侧清理完成：P3、P9、P10、P11、P12，Windows 打包实测通过（问卷、整合客户端，本地 Node 模拟后台）。
- G9 的 P0 完成：K7（toolkit `a01a10c`）、F4（问题不成立，frame `a3455e7` 补回归单测）、K9 及其中发现的 K17、K18（toolkit 本次提交）。
- 复查问题 7（清单修正）已确认并改入各表：P1、F10 已完成，K15 并入 §5，§7 第 3 项关闭；新增 F11、P9、P10（待确认）；
  K6、K8、F2 方案按实际落地改写，K10、K11、F9 补记复查补全，K14 补充 `sh -c` + `$1` 传参。
- `known-limitations.md` 删除已修的 12 条，保留 K7、K9、K13、K14。

### 8.1 2026-11-20 完成

对 2026-11-19 的清单与修复做了复查，发现的问题逐个确认后修复（各仓库均已提交、未推送）：

| 复查问题 | 结果 | 提交 |
|---|---|---|
| 1. 整合客户端进不了首页（`issue()` 引用未定义变量、下载后的包没有入口） | 重构为 G10（K16 `libs/pkg`、F9 布局表与启动页规范、P8 业务侧），两个项目打包运行与本地调试实测通过 | toolkit `e0588ca` 等，frame `ee8b544`，整合 `42bd878`，问卷 `ebcfcd54` |
| 2. K8 回归：Map / Set 内含不可克隆值时发送失败 | IPC 路径逐项处理（调研过 `@ungap/structured-clone` 等库，行为不一致，未引入） | toolkit `280922b` |
| 3. K10 不完整：停顿只销毁读取流、传输中途取消无效 | 停顿与取消统一中止网络请求，Electron 22 实测 | toolkit `b73f341` |
| 4. K11：`startBatch` 并发取消失效、校验重复实现 | 记录全部进行中任务；未开始的记为 cancelled；复用 `libs/integrity` | toolkit `4ee6db9` |
| 5. 构建 Node 版本无运行时检查；主进程代码 Node 16.17 兼容性无保障 | 命令入口检查 `engines`；两个项目加 `.nvmrc`；整合客户端与 frame `paths.js` 按 Node 16.17 做 lint | frame `e2dcdb2`，整合 `c7bd6c6`，问卷 `3ed5d7f5` |
| 6. 布局收敛剩余：`resources` / `packages` / `package.json` 两边各写一份 | 作为两个包之间的约定集中定义，README 列出，两边单测断言 | frame `8ff35c4`，toolkit `df19dc2` |

### 8.2 新发现、尚未编号

（无。原记录的问卷 `npm test` 失败已编号 P12 并修复。）

### 8.3 下一步（建议顺序）

1. 定 F8 后做 G8 Linux 组（K13、K14、F8、F11）的代码与单测；
2. §5 矩阵验证（Windows x64 / ia32、Linux x64 / arm64 / loong64）：用户要求等所有测试机准备好后统一做；
3. F6、F7 定范围后再排；
4. F12（Linux x64 安装包文件名改 x64）：用户要求放在最后处理，届时再按「现状 / 如何修改 / 效果」确认（影响点已排查，见 F12 行）；
5. 收尾（不提前做）：推送；以本分支重置 develop；toolkit / frame 正式发布；之后后台改造。
