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
| G4 序列化 | K8、P2 | 改变 IPC 实际类型，两个项目需确认不依赖旧行为 |
| G5 构建信息 | F1、F2、P3 | 同一处 build-info；业务侧的 `?? env` 兜底与 frame 兜底重复 |
| G6 版本声明 | F3、P4 | 对齐 Node 版本后，业务侧 `parallel: false` 的绕行是否保留一起定 |
| G7 preload 路径 | K12、F5、P5 | 跨 frame / toolkit / 项目，必须一起改 |
| G8 Linux | K13、K14、F8 | 同一批 Linux / 龙芯验证，一起改一起测 |
| G9 独立项 | K7、K9、K15、F4、F6、F7 | 无跨仓库耦合，可单独排 |

## 2. toolkit 条目

| # | 优先级 | 状态 | 问题 | 方案 | 验证 |
|---|---|---|---|---|---|
| K1 | P0 | 待确认 | logger 只用 `instanceof Error` 识别错误，跨上下文（iframe / vm / 另一 realm）的 Error 被记成 `{}`，message 与 stack 全丢 | 判定改为 `arg instanceof Error \|\| Object.prototype.toString.call(arg) === '[object Error]'`；其余分支不变 | 补 `vm.runInNewContext` 单测；问卷 `tests/main/logger-cross-context-error.test.js` 由已知失败转为通过 |
| K2 | P0 | 待确认 | 日志轮转写死 100K × 20（约 2 MB，实测考场密度下留存约 4 小时），业务无法覆盖 | 默认改 500K × 10；新增 `main/libs/loggerConfig` 的 `setLoggerConfig`（须在 require logger 之前调用，时序同 `setPathConfig`） | 默认值与覆盖的单测；README 更新 |
| K3 | P0 | 待确认 | `capability/store` 只给 `get` / `getFile` 开 sync；`setFile` / `removeFile` 无同步别名，写后立即读大概率读到旧值；文件头"其余五个"的理由对异步实现不成立 | `sync` 增加 `setFile`、`removeFile`；文件头按「同步实现 / 异步实现」分开写清代价 | schema 单测；G3 业务侧绕行删除后回归 |
| K4 | P0 | 待确认 | `downloadPkg` 走 Chromium HTTP 缓存且不传 headers，同一地址覆盖发布的包可能取到旧内容 | 默认带 `Cache-Control: no-cache`；新增 `headers` 选项供覆盖，透传给 `startDownload` | 单测断言默认头与覆盖 |
| K5 | P0 | 待确认 | `installApp` 退出用 `logger.shutdown()` + 盲等 500ms + `app.exit`，丢掉 shutdown 的 Promise，升级路径日志最易丢，且跳过 `will-quit` | `quitApp` 改为 `await logger.shutdown()` 再 `app.exit(1)`；调用点补 `await` | 单测：shutdown 未完成时不退出 |
| K6 | P0 | 待确认 | `log4js` / `electron-store` 声明 optional 但顶层 require，实际必装；`semver` 同理，只用 `installApp` 的消费者也被迫安装 | `log4js`、`electron-store` 去掉 `optional`；`semver` 改走 `loadOptionalPeer` 惰性加载 | 未安装 semver 时仅调用 `installApp` 可用；`npm ls` 无 invalid |
| K7 | P0 | 待确认 | preload 取 schema 时主端漏 init：`sendSync` 无 listener，preload 中断，渲染层拿到 `undefined`，且 appNotice 一起装不上 | `sendSync` 包 try/catch：返回 undefined 或抛异常时降级（Service 返回空对象、Notice 保留顶层 API）+ `console.warn` 明确提示 | 单测覆盖 undefined / 抛异常两种 |
| K8 | P0 | 待确认 | `serializeForIpc` 把 Date / RegExp / Map / Set / BigInt / NaN / ±Infinity 降级成字符串或普通对象，且无解码路径（`NaN` 最隐蔽：普通运算结果过 IPC 即变字符串） | 新增 `structuredPassthrough`（默认 `false`），`serializeForIpc` 置 `true`；`safeStringify`（日志）保持现状；Error 的成对编解码不动 | 单测改为 structured-clone 语义；G4 两个项目确认消费面 |
| K9 | P0 | 待确认 | `os` / `shortcut` / `singleInstance` 缺用法文档 | README 补最小示例与「`isLoongnix()` 会执行 `lsb_release`」等注意点 | 文档 |
| K10 | P1 | 待确认 | `libs/download` 的 `timeoutMs` 只覆盖等响应头阶段，body 传输阶段无任何超时或 stall 检测，服务端卡住时 promise 永不 settle | 增加 `idleTimeoutMs`（默认 60s）：两次数据间隔超时即 abort；`timeoutMs` 保持原语义 | 单测模拟卡住的流，断言 abort 与 `DOWNLOAD_TIMEOUT` |
| K11 | P1 | 待确认 | `capability/download` 把编排、存储根、renderer 契约焊死，业务主进程无法复用；无「已存在且完整性匹配则跳过」语义 | 编排下沉 `libs/download` 批量入口（`files`、`skipIfValid`、并发、文件级回调）；`capability/download` 退为薄适配层 | 单测 + 业务侧复用后删掉重写的编排 |
| K12 | P1 | 待确认 | `BaseWindow` 不提供 preload 路径默认值，每个项目重写同一段绝对路径 | 与 F5 配对：由 frame 导出产物路径常量，toolkit 不内置默认（保持不依赖 frame 的边界） | 两个项目改用后编译与运行通过 |
| K13 | P2 | 待确认 | Linux `dpkg -i` 无 `--force-overwrite`，文件冲突时安装直接失败且几乎不可排查 | `installApp` 增加可配置 dpkg 选项（如 `{ dpkgForce: ['overwrite'] }`），默认关闭；`installByDpkg` 与 `installByOpenShell` 两处都改 | Linux 验证 |
| K14 | P2 | 待确认 | Linux 安装两处偏差：`installByOpenShell` 丢了「安装完成」提示与 `sleep 3`（xterm 一闪而过）；`!err && !stderr` 把成功时的 stderr 警告判为失败 | 补提示与 `sleep`；失败判定统一只看退出码，stderr 交给 logger | Linux / 龙芯验证 |
| K15 | P2 | 待确认 | Linux / 龙芯安装与 dpkg 流程缺少自动化与真机验证记录 | 与 F8 一起：建立 Linux 安装验证步骤与记录模板 | 真机记录 |

## 3. frame 条目

| # | 优先级 | 状态 | 问题 | 方案 | 验证 |
|---|---|---|---|---|---|
| F1 | P0 | 待确认 | `BC_ENV_NAME` 无兜底、缺失时完全静默，`__BC_BUILD__.envName` 键直接不存在 | 缺失时回退为 `env` 的值，并输出一条构建警告（无法凭空推断展示名，回退值即为提示） | frame 单测；G5 业务侧 `?? env` 删除后回归 |
| F2 | P0 | 待确认 | 整体引用 `__BC_BUILD__` 会带入 `buildTime`，破坏产物 hash 稳定性与可复现性 | 整体对象定义（用于 `typeof` 判断）排除 `buildTime`；逐字段定义保留 | 单测：整体对象不含 `buildTime`；两个项目 `appInfo` 不受影响 |
| F3 | P0 | 待确认 | `engines` 声明 Node ≥ 18.12，但实际 Node 16 可跑；同时 `css-minimizer-webpack-plugin` 8 官方要求 Node ≥ 20.9，两个项目靠 `parallel: false` 规避 | 核实真实下限并对齐 `engines`；README 明确区分「构建 Node 版本」与「Electron 内置 Node 版本」 | Node 20 / 22 下全量测试 |
| F4 | P0 | 待确认 | 通用替换未覆盖 `typeof process.env.BC_xxx`：未声明时不会被替换为 `undefined` | 插件同时拦截 `typeof` 写法；若不可行，在 README「变量」一节写明该限制 | frame 单测 |
| F5 | P1 | 待确认 | 生产项目需要自行拼 preload / 产物路径 | frame 导出路径常量（如 `@base-client/frame/paths`），与 K12 配对 | 两个项目改用后编译与运行通过 |
| F6 | P1 | 待确认 | webpack 预设未规整（main 不处理资源、共用配置未抽取） | 结构整理，产物行为不变 | 产物对比 |
| F7 | P1 | 待确认 | 与历史 base-client.bake 的行为差异未系统盘点 | 逐项梳理成文档，能对齐的对齐 | 文档 |
| F8 | P2 | 待确认 | 龙芯（loong64）打包需自备 Electron 镜像源，frame 不内置 | 写入 README；是否内置镜像配置待定 | 龙芯验证 |

## 4. 业务侧连带清理（底座修完后执行）

| # | 状态 | 内容 | 对应上游 |
|---|---|---|---|
| P1 | 待确认 | 两个宿主在注册 `store` 时追加 `setFile` / `removeFile` 同步别名的绕行代码删除 | K3 |
| P2 | 待确认 | 两个项目 `appInfo` 中 `envName: __BC_BUILD__.envName ?? __BC_BUILD__.env` 的兜底删除 | F1 |
| P3 | 待确认 | 问卷 `installDownloaded` 中前置的日志 flush 删除（`installApp` 会自己等） | K5 |
| P4 | 待确认 | 两个项目 `bc.config.js` 的 `parallel: false` 绕行是否保留，随 F3 的结论定 | F3 |
| P5 | 待确认 | 两个项目改用 frame 导出的路径常量 | K12 / F5 |
| P6 | 待确认 | 问卷 `docs/base-client/已知问题.md` 的 B 类三条（跨上下文 Error、下载缓存、日志轮转）随上游修复删除 | K1 / K2 / K4 |

## 5. 全平台全架构验证矩阵

基线完成前，下列每个组合各跑一遍：打包 → 安装 → 启动 → 更新 → 子应用进入 / 退出。
**矩阵范围待确认**：

| 平台 | 架构 |
|---|---|
| Windows | ia32 / x64 / arm64（范围待确认） |
| Linux | x64 / arm64 / loong64（范围待确认） |
| macOS | x64 / arm64（范围待确认） |

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

1. 平台 / 架构矩阵的具体范围（§5）。
2. F8 龙芯镜像源：仅写文档，还是 frame 内置镜像配置。
3. 问卷 `docs/base-client/已知问题.md` 的既有更新提交（`39fcdf98`，删除了已解决项）保留还是撤销。
