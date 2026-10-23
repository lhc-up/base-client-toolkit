# Toolkit 已知限制

本文档只记录当前仍成立的限制与演进事项，已解决的问题不在此列。

## 已知限制

- **preload 的 bridge 装配无容错，opt-out 契约把正确性责任交给了两端人工保持一致**：
  `buildAppService()` / `buildAppNotice()` 在 preload 加载时同步 `ipcRenderer.sendSync`
  取 schema 清单（`src/service/preload.js:91`、`src/notice/preload.js:112`）。
  主端漏调 `Service.init` / `Notice.init` 时，该调用无 listener，
  **preload 脚本就地中断**——具体后果见 `architecture.md` §2.5（实测结论，非死锁）。
  问题有三层：
  - **失败点离根因很远**：渲染层拿到的是 `undefined`，要到第一个 `appService.x()` 调用处
    才报 TypeError，报错文本完全不指向"主端漏 init"。
  - **一个失败连累另一个**：`init()` 内 `buildAppService()` 先执行，它抛出后
    `appNotice` 也装不上，即便 Notice 那侧主端已正确 init。
  - **诊断信息在业务默认不观察的位置**：Electron 的
    `called ipcRenderer.sendSync() ... without listeners` 在主进程 stdout，
    `reply was never sent` 要监听 `preload-error` 才能看到。
  - 建议改法：两个 build 函数把 `sendSync` 包进 `try/catch`，捕获后 `console.warn`
    明确提示"主端未 init 对应模块，该 bridge 未装配"并返回空对象。这样
    **可直接废掉 opt-out 契约**（`init()` 不再需要 `{ service: false }` 参数），
    两端不一致从"静默失败"降级为"一条清晰警告 + 功能缺失"，也顺带修掉上面第二层问题。
    *该改法的前提「`sendSync` 无 listener 时抛的是可捕获的 JS 异常」是由
    `preload-error` 事件被触发反推的，提出方未直接验证 try/catch 能接住。*
  - 更彻底的方向（改动较大，需架构 review）：改用
    `webPreferences.additionalArguments` 在建窗口时下发 schema，preload 从 `process.argv`
    同步读取——零 IPC、零阻塞、零时序依赖，但会让 Service/Notice 与窗口创建产生耦合。
  - 是否调整及采用哪种方式属 toolkit 的设计选择，此处只记录缺口。
  - 提出方：`questionnaire-answer-v3.0` 迁移项目（2026-10-04）。

- ~~**`main/libs/logger.js` 的 `shutdown()` 丢掉了 log4js 的完成信号，调用它与完全不调用等效**~~
  **✅ 已修（2026-10-09）**：`shutdown()` 改为返回 Promise，appender 全部结束后 resolve。
  **与下方建议有一处刻意偏差 —— 不 reject**：drain 期间的 appender 错误只走次级通道
  （`console.error`）自报，Promise 照常 resolve。理由是同一轮给本模块定下的
  「六级方法与 `shutdown` 永不抛」契约：调用方在退出路径上，「日志没写全」不是它需要
  分支处理的事，而退出流程不能因此卡住或抛。
  同轮补了 `tests/logger.test.js`（17 例）覆盖该契约。
  **归因已更正**：此前以为「要等 flush」是 Node 异步 I/O 的普遍问题，实测是
  **Electron 退出语义**特有的 —— 纯 Node 只要不主动调 `process.exit()` 就会自然写完。
  且**不等的后果是静默丢失**（零异常、退出码 0），不是报错。
  完整实测数据与「丢的是通知而非一律丢数据」的区分，唯一归属是
  `src/main/libs/logger.js` 的 `shutdown` 注释，此处不复制。
  <br>原文保留如下：

- **`main/libs/logger.js` 的 `shutdown()` 丢掉了 log4js 的完成信号，调用它与完全不调用等效**：
  `log4js.shutdown(callback)` 是异步的，`callback` 在所有 appender 结束后触发
  （`log4js/lib/log4js.js:105` 的签名与 `:99-103` 的 JSDoc；file appender 的实现是
  `writer.end('', 'utf-8', complete)`，见 `log4js/lib/appenders/file.js:114-121`）。
  而本包的封装是 `shutdown() { log4js.shutdown(); }`（`src/main/libs/logger.js:105-107`）
  ——既不接收回调也不返回值，**调用方没有任何办法得知日志是否已落盘**。
  - 实测（Node 16 / log4js 6.8，写 2000 条后立即退出，文件实际落盘行数）：

    | 退出方式 | 落盘 |
    |---|---|
    | 直接 `process.exit(0)` | **0 条** |
    | `log4js.shutdown(() => process.exit(0))` | **2000 条** |
    | `log4js.shutdown(); process.exit(0)`（= 本包封装的用法） | **0 条** |

    最后一行与第一行结果相同，即**经本包封装调用 `shutdown` 不产生任何效果**。
    丢的是 Node `WriteStream` 在进程内存里的待写队列——那些字节从未发起 `write(2)`，
    因此内核无从兜底；已进入内核 page cache 的部分不受进程退出影响。
  - **这个缺口正落在本包自己引导的用法上**：`service/main.js:154` 与 `notice/main.js:147`
    的 cleanup 注释约定"在 app `will-quit` 中调用"，`main/libs/shortcut.js:25` 也以
    `will-quit` 反注册热键。业务沿此引导在 `will-quit` 里关闭日志，写出来就是
    `logger.shutdown()`，而 `will-quit` 的 handler 不等异步操作——除非
    `preventDefault()` 后手动退出，但那需要一个"flush 完成"的信号，本包没有提供。
  - **建议改为返回 Promise**：

    ```js
    shutdown() {
        return new Promise((resolve, reject) => {
            log4js.shutdown(err => (err ? reject(err) : resolve()));
        });
    },
    ```

    相比透传回调，Promise 形态**对现有调用方向后兼容**——不等待的调用方忽略返回值即可，
    行为与现在完全一致；需要等待的用 `await logger.shutdown()`。改动 4 行。
  - 是否调整及采用哪种形态属 toolkit 的设计选择，此处只记录缺口与实测依据。
  - 提出方：`questionnaire-answer-v3.0` 迁移项目（2026-10-04）。

- **`BaseWindow` 不提供 preload 路径的默认值或推导**：`BaseWindow.create()` 的内置默认
  options 只有 `{ show: false, backgroundColor: '#ffffff' }`，业务必须在
  `getWindowOptions()` 里自行给出 `webPreferences.preload` 的绝对路径；
  `main/paths.js` 也只管 userData 下的运行时目录，不含任何产物路径。
  这是 toolkit 不依赖 frame 的**有意边界**（toolkit 不该假定 frame 的 `app/` 输出布局），
  因此不算设计错误；但 frame + toolkit 组合下每个项目都要重写同一段样板
  （frame 的 preload 产物路径是契约，固定为 `app/preload/index.js`）。
  - 若要消除这段样板，更合适的形态可能是**由 frame 侧导出路径常量**，
    而不是 toolkit 内置默认——后者会破坏两个包的独立性。
  - 提出方：`questionnaire-answer-v3.0` 迁移项目（2026-10-04）。

- **`libs/download` 的 `timeoutMs` 只覆盖「等 response header」阶段，body 传输期间没有任何
  超时保护**：`createElectronNetTransport` 在 `request.on('response')` 回调里就调用了
  `cleanup()` 清除 timer（`main/libs/download/index.js:37-45`），随后的
  `pipeline(response.body, progress, createWriteStream(tempPath))` 不再受任何时限约束，
  也没有 stall 检测。**后果**：服务器发完响应头后卡住（弱网、中间代理设备、服务端半挂）
  时，`task.promise` 永不 settle，调用方的 `await` 永久挂起——调用方甚至无法靠超时自救，
  只能依赖外部的 `cancel()`。
  - 这不是"业务多要的功能"：被它替换掉的 npm `download@8`（底层 `got`）的
    `timeout.request` 覆盖的是**整个请求周期**（含 body 传输），迁移后这段行为丢失了。
  - 建议：在 pipeline 阶段加 stall 超时（例如两次 `onProgress` 间隔超过 N 秒即 abort），
    或让 `timeoutMs` 的语义覆盖整个任务而非仅握手段。
  - 业务侧现状：`questionnaire-answer-v3.0-migration` 已用
    `Promise.race([task.promise, 超时后 task.cancel()])` 在自己的 capability 里包了一层，
    上限取 `3min × URL 数`。上游修复后该绕行代码可删除。
  - 提出方：`questionnaire-answer-v3.0` 迁移项目（2026-10-07）。

- **`capability/download` 的编排层与 renderer 契约层没有分离，业务主进程无法复用它的编排**：
  该 capability 把三个关注点焊死在一起——① 下载任务编排（`taskId`、循环 `files`、
  cancel 传导）属**通用**能力；② 存储根与 scope 解析（`index.js:20` 顶层取
  `getFilePathConfig().storageResource` 并写死进工厂）属半通用；③ renderer 契约
  （`download.changed` 的事件名与载荷形状）只对渲染层有意义。业务主进程想复用 ①，
  却被迫接受 ② 与 ③；而 `exports` 只映射 `./main/capability/*` → `*/index.js`、
  **不暴露 `createDownloadCapability`**，连注入 `filePathConfig` 这条路也走不通
  （工厂本身是刻意留了注入点的，见其文件头注释）。
  - **另一项同源缺口**：没有「目标已存在且完整性匹配则跳过下载」的语义
    （`libs/download:111-112` 每次都先 `rm` 再 `rename`），离线/弱网场景的资源缓存
    无法直接复用。
  - 建议：**把编排下沉到 `libs`**——给 `libs/download` 加批量入口（如
    `startBatch({ files: [{ urls, destinationPath, integrity?, skipIfValid? }], onFileChange, concurrency? })`），
    只接收**完整的 destinationPath**、不碰 scope、不发 Notice，文件级生命周期通过回调给出；
    `capability/download` 则退化为薄适配层 = `libs` 批量编排 + scope 解析 + Notice 映射。
    这与架构既定的依赖方向一致（capability 可复用 libs，libs 不得依赖 capability）。
  - 其中「已缓存且完整性匹配则跳过」建议作为 `libs` 能力（上面的 `skipIfValid`）而非业务语义：
    按能力准入六条逐条衡量——普遍性（任何客户端下载缓存都需要）、去业务化（只需 path +
    期望 digest）、契约稳定、可脱离业务测试、不绑业务语义、降低重复，均成立。
  - 实证：业务侧因此重写了「循环 + Notice 推送 + integrity 调用」，与本 capability
    重叠约 30%。按上述方向改造后，这部分可回收。
  - 提出方：`questionnaire-answer-v3.0` 迁移项目（2026-10-07）。

- **可单独引用的 `libs` 模块缺少用法文档，且无法从聚合入口发现**：三件事叠加——
  ① README 的「主进程 libs」表把 `logger` / `os` / `shortcut` / `singleInstance` / `store`
  五个文件类模块挤在一行、说明合计约十个字，其中 **`logger` / `os` / `singleInstance` /
  `store` 四个没有任何用法示例**（而 `download` / `archive` / `update` / `shortcut`
  各有带代码的专门章节）；② `/main` 聚合入口只导出 `capability` / `BaseWindow` / `paths`、
  **不含 libs**（源码注释表明「无根聚合入口」是刻意的包边界），所以 libs 只能靠记深路径；
  ③ 没有类型声明，IDE 不补全，子路径拼错只在运行时暴露。
  - **另有一处时序陷阱未进 README**：`setPathConfig()` 必须在任何 capability 以及
    `libs/logger`、`libs/store` 被 `require` **之前**调用（它们顶层即取值并 `ensureDirSync`），
    晚于它们则无效**且不报错**。该约束目前只写在 `paths.js:9` 与 `logger.js:4` 的源码注释里，
    踩中的代价是日志/缓存已落到默认目录且改不动。
  - 建议：① 给那四个模块各补最小用法（`logger` 至少需要：六级方法 + `print` + `shutdown`、
    落点与轮转策略、`log4js` 这个 optional peer 的安装要求）；② 在 README 的 `/main/paths`
    一行补上述时序约束；③ **可选**——给 `/main` 增加 `libs` 的**懒加载** getter 以便发现式使用
    （必须懒加载：`logger` 顶层会 `log4js.configure`、`paths` 顶层会 `ensureDirSync`，
    饿加载会破坏「严格按需引入」）；若认为「无根聚合入口」是不可让的包边界，则只做 ①②。
  - 提出方：`questionnaire-answer-v3.0` 迁移项目（2026-10-07）。

- ~~**`capability/update` 的 `downloadPkg` 用 npm `download` 包，与自家 `libs/download` 构成两套实现，
  且该包被顶层 require、`optional` 名不副实**~~ ✅ **2026-10-19 已修（按本条建议①）**：
  `downloadPkg` 的下载底座换成自家 `libs/download`、新增 `onProgress` 透传，
  **npm `download` 整个移除**（`peerDependencies` / `peerDependenciesMeta` /
  `devDependencies` 三处都删了）。三个子问题一次全消：① 两套实现收敛成一套；
  ② 那个"名不副实的 optional"随包移除而不存在了；③ 消费方不再为只用 `installApp`
  被迫装 111 个包。`createUpdateCapability` 的注入依赖由 `download` 改为
  `startDownload`（即 `createDownload().start`），测试同步更新并补了一条
  "onProgress 被透传"的用例（全量 **55 文件 / 494 测试通过**）。
  **以下为修复前的原始记录，保留备查**：`capability/update/index.js:8` 是
  `const download = require('download')`，`createUpdateCapability.js:104` 用它下载 `.asax`
  （`await download(url, updatePackageDir, { filename })`）。三个问题叠加：
  - **① 同一件事两套实现**：toolkit 已有 `libs/download`（Electron `net.request` +
    `stream/promises` 的 pipeline，带进度回调、取消、多 URL fallback、临时文件原子晋升），
    `capability/download` 即其薄封装；而 `downloadPkg` 另走 npm `download@8`
    （2019 年的包、底层 `got@9`）。**后者能力更弱——没有进度回调**，
    所以 `downloadPkg` 下载增量包时调用方画不出进度。
  - **② `optional` 名不副实**：`download` 在 `peerDependenciesMeta` 标了 `optional: true`，
    但那是**顶层 require**——不装它，`require('@base-client/toolkit/main/capability/update')`
    加载即抛，整个 capability 不可用。**与下面 `log4js` 那条同型**（Service 直接 require
    logger，只要用 Service 就必装 log4js）。
  - **③ 代价（业务侧实测）**：消费方只用 `installApp`、完全不用 `downloadPkg` 时，
    仍被迫 `npm i download` —— 实测带进 **111 个包**、main 产物 **+0.7 MB**
    （与 `@vscode/sudo-prompt` 合计）、并新增 1 条
    `Critical dependency: the request of a dependency is an expression`
    （已用最小 entry 分别打包归因到该包：`libs/logger` 单独 2 条、npm `download` 单独 1 条、
    `capability/download` 0 条、`capability/update` 3 条 = 2 + 1）。
  - **建议（业务侧首选①）**：① **让 `downloadPkg` 改用自家 `libs/download`**，
    消掉这套重复实现与整个 npm 依赖，顺带把进度回调带给增量包下载；
    ② 若短期保留该包，**至少把那行改成惰性加载** —— `shared/loadOptionalPeer.js` 现成且
    正为此而设（`capability/update` 自己已经用它加载 `@vscode/sudo-prompt`），
    这样只用 `installApp` 的消费者不必安装，同时能消掉那条 Critical dependency warning。
  - 消费方回收动作：上游按 ① 或 ② 改后，从业务 `package.json` 删 `download`，
    复核 main 产物体积与 warning 数。
  - 提出方：`questionnaire-answer-v3.0` 迁移项目（2026-10-16）。

- **`capability/update` 的 `installApp` 自带退出，而它用的 `quitApp()` 违反了 `libs/logger`
  自己写明的契约**：`createUpdateCapability.js:259-262` 是
  `logger.shutdown(); schedule(() => app.exit(1), 500)` —— **丢掉了 `shutdown()` 返回的
  Promise，改用盲等 500 ms**，且 `app.exit` 会跳过 `will-quit`。
  - **证据在 toolkit 内部**：`main/libs/logger.js` 的 `shutdown` 注释给了实测对照表
    （裸调不拦退出 **2/2000**；`preventDefault()` + 等 resolve **2000/2000**），
    并结论「`will-quit` 里必须 `preventDefault()` 并 await 本函数」。
    即 `capability/update` 用了 `libs/logger` 却没遵守它的使用说明。
  - **与已修的 UP-8 同源**：`shutdown` 改返回 Promise 后（`45c02e5`），
    这个调用点**没有跟上**，仍停在旧的盲等写法。
  - **后果**：大版本安装是最需要日志的路径之一（升级失败要排查），却恰好是日志最易丢的路径；
    `app.exit` 还会跳过消费方挂在 `will-quit` 上的全部收尾编排。
  - **建议**：`quitApp` 改为 `await logger.shutdown()` 再 `app.exit`；更好的做法是
    **把退出决定权交给调用方**（如 `installApp(filePath, { quitAfter = true })`），
    让有自己退出编排的业务能走 `app.quit()` 而不是被强制 `exit`。
  - 消费方现状：业务侧已绕行 —— 在调 `installApp` 之前先 `await` 自己的日志 flush。
    但 `installApp` 自身那条「执行大版本安装文件」、以及失败分支
    （`dialog.showErrorBox` + `started:false`）的日志仍进不了文件；
    Linux 的 `installDebOnLinux`（xdg-open → dpkg → Loongnix xterm，最耗时也最易失败）
    整段都在静默区。上游修好后该绕行可回收。
  - 提出方：`questionnaire-answer-v3.0` 迁移项目（2026-10-16）。

- **Linux 的 `dpkg -i` 没有 `--force-overwrite`，文件冲突时安装直接失败，且失败几乎不可排查**：
  `capability/update` 的两处 dpkg 调用都是裸 `dpkg -i <path>` ——
  `installByDpkg`（`createUpdateCapability.js:158`，sudo-prompt 分支）与
  `installByOpenShell`（`:142`，Loongnix 的 xterm 分支）。
  - **场景**：新包要写的文件属于另一个已安装包（换过 `deb.packageName`、装过不同渠道/
    不同打包配置的历史版本、同名文件归属变化等），dpkg 报
    `trying to overwrite '…', which is also in package …` 并中止。
    考场机器长期被反复装过不同版本的客户端，这不是边缘场景。
  - **后果被放大**：这条路上的日志恰好落在静默区
    （`installApp` 自带退出，见本文件上一条 `quitApp` 的问题），
    用户只看到一个错误对话框、没有文件日志可查。
  - **建议做成可配置而不是写死**：强制覆盖会真的改写其他包的文件，是个有风险的决定，
    应该由业务按部署环境决定。例如
    `installApp(filePath, { dpkgForce: ['overwrite'] })`，拼成
    `dpkg -i --force-overwrite <path>`（该选项放在 `-i` 之后可被正确解析）。
    默认保持现状，业务显式开启。
  - **两处都要改**：`installByDpkg` 与 `installByOpenShell`。只改前者的话，
    龙芯那条路（`os.isLoongnix()` 优先命中）拿不到这个能力。
  - 提出方：`questionnaire-answer-v3.0` 迁移项目（2026-10-16）。

- **同一段 Linux 安装代码还有两处与上游参考实现的偏差**（顺带记，便于一次改完）：
  - **① `installByOpenShell` 丢掉了"安装完成"提示与 `sleep`**。参考实现
    （`base-client.bake/src/main/libs/app.js:15`、老项目
    `main/libs/js/ipcMainCommand.js:99`）是
    `xterm -T 安装更新 -e "sudo dpkg -i <path> && echo 安装完成，3s后退出安装程序\n sleep 3"`；
    toolkit 改成参数数组形式（这一步是对的，消掉了 shell 拼接注入面），
    但 `echo` 与 `sleep 3` 没了，**xterm 会一闪而过**。
    而这个流程恰恰依赖终端可见 —— 该函数自己的注释写着「新开的终端退出后才会收到返回值…
    防止用户直接关掉终端导致客户端挂起」，用户得看见结果才知道该不该关。
  - **② `!err && !stderr` 把 stderr 当失败**（`:143` 的 `installByOpenShell`、
    `:150` 的 `installByXdgOpen`）。`dpkg` 与 `xdg-open` 在**成功**时也可能往 stderr
    写警告（dpkg 的 force 警告、某些桌面环境下 xdg-open 的 D-Bus 提示），
    于是装成功却被判为失败 → 走进 `dialog.showErrorBox('自动更新失败…')` + 退出。
    对比 `installByDpkg`（`:158`）只看 `error`，口径不一致。
    建议统一成只判退出码，stderr 交给 logger。
  - 提出方：`questionnaire-answer-v3.0` 迁移项目（2026-10-16）。

- **`serializeForIpc` 仍在降级一批 structured clone 原生支持的类型，与它自己写下的
  原则不一致。** 2026-10-10 修二进制时，`src/shared/serializer/index.js` 的文件头已经
  立好了判据 ——「裁剪与占位是 `safeStringify` 的职责，那是『给人看』的需求，
  **不该出现在数据通道上**」。那次只把这条原则应用到了 `Buffer` / `ArrayBuffer`
  （加 `binaryPassthrough`），**剩下的类型漏了**：

  | 类型 | 当前被改成 | 有解码器吗 |
  |---|---|---|
  | `Date`（`adaptDate`） | ISO 字符串（`Invalid Date` → `null`） | ❌ |
  | `RegExp`（`adaptRegExp`） | `{ source, flags }` | ❌ |
  | `Map`（`adaptMap`） | 全字符串键时变 plain 对象，否则变 entry 数组 | ❌ |
  | `Set`（`adaptSet`） | 数组 | ❌ |
  | `BigInt`（`bigintPlaceholder`） | `"[BigInt: 123]"` 字符串 | ❌ |
  | `NaN` / `±Infinity`（`numberPlaceholder`） | `"[Number: NaN]"` 等字符串 | ❌ |

  **这六类都是纯损失**：Electron 的 structured clone 原生支持它们，而接收端拿到的是
  另一种类型，且没有任何还原路径。`NaN` / `±Infinity` 这条尤其隐蔽 ——
  它不需要业务刻意传特殊类型，**任何一次算出 `NaN` 的普通数值运算**（除零、
  `parseInt` 失败、`undefined` 参与运算）过一趟 IPC 就变成字符串，
  下游的 `typeof === 'number'` / `Number.isNaN()` 判断随之全部失效。

  **`Error` 不在此列，不要顺手一起改**：它走的是 `adaptError` →
  `service/preload.js` 的 `reviveError` **成对的编解码**，接收端拿到的是重建好的
  真 `Error` 实例（`name` / `message` / `stack` / `code` / `cause` 都还原），
  属有意设计而非降级。

  **建议的修法就照 `binaryPassthrough` 的既有范式**：在 `limits.js` 的
  `globalDefaults` 加一个开关（默认 `false`）、`index.js` 的对应分支读它，
  `serializeForIpc` 置 `true`；`safeStringify`（日志路径）**保持现状不动** ——
  那里把 `Date` 变可读字符串正是需求。改完后 IPC 路径只剩「真正不可克隆」的处理
  （函数、DOM、window、Promise、WeakMap、循环引用），与文件头的原则完全自洽。

  **影响面提示**：这会改变 IPC 上的实际类型，消费方若已经依赖「收到的 `Date` 是
  字符串」就会受影响。提出方项目 2026-10-19 已逐一核过自己的消费面
  （所有 capability handler 的返回值、Notice 载荷、渲染层传入的参数）
  —— **当前零暴露**，这六类一个都没真的过 IPC，故对它不构成破坏性变更；
  但其他消费者需各自确认。

  - 提出方：`questionnaire-answer-v3.0` 迁移项目（2026-10-19）。

- **`peerDependenciesMeta.optional` 的五个声明里有四个名不副实，而正确的机制 toolkit
  自己就有、只用在了其中一个上。** 此前 `log4js`（README 依赖表下）与 `download`
  （本文件上一条）各自被单独记过，但那是打地鼠 —— 全量核一遍才看出这是**一条策略问题**：

  | optional peer | 实际加载方式 | 声明是否名副其实 |
  |---|---|---|
  | `log4js` | `main/libs/logger.js:20` **顶层 require**，且 `:30` 顶层 `log4js.configure` | ❌ |
  | `electron-store` | `main/libs/store.js:47` **顶层 require**，且 `:48` 顶层 `new Store` | ❌ |
  | ~~`download`~~ | ~~顶层 require~~ —— **2026-10-19 整包移除**（见上条），本行已不适用 | — |
  | `semver` | `main/capability/update/index.js:7` **顶层 require** | ❌ |
  | `@vscode/sudo-prompt` | `index.js:33` 包成 `loadSudoPrompt`，`createUpdateCapability.js:156` **函数内**才调 | ✅ |

  **四个 ❌ 的后果是一致的**：声明说"可以不装"，而一 `require` 对应模块就直接抛。
  `log4js` 尤其严重 —— `service/main.js:2` 顶层 require 了 `main/libs/logger`，
  **只要用 Service（用 toolkit 几乎必然用）就必须装 log4js**，optional 形同虚设。

  **而第五行就是答案**：`shared/loadOptionalPeer.js` 用 `eval('require')` 绕开打包器
  静态分析，让 optional peer 不进依赖图、未安装的业务也能正常加载模块。
  **机制已经有了，只是只用在了一个包上。**

  **建议按"缺了能不能降级"分两类处理，不要一刀切**：
  - `log4js` / `electron-store` —— 它们托着 logger 与 store 两个**核心能力**，
    缺了就是没有日志、没有存储，不存在有意义的降级。
    建议**去掉 `optional` 标记**（版本范围已有，`electron` 就是这么声明的现成先例），
    让缺失在安装期暴露，而不是运行期抛。
  - ~~`download`~~ / `semver` —— **`download` 已于 2026-10-19 整包移除**，不再是问题；
    `semver` 只服务 `capability/update`，不用这个 capability 的消费者本不该被迫安装，
    建议改走 `loadOptionalPeer`，**保留 `optional` 并让它名副其实**。

  **一个需要上游自己确认的前提**：`loadOptionalPeer` 的 `eval('require')` 在
  **打包后的应用**里能否解析（主进程被 webpack 成单文件、依赖是否随 asar 一起发出去）。
  `@vscode/sudo-prompt` 既然已在用这条路，应有现成答案；提出方未验证这一点，
  故上面第二类建议的可行性以上游的结论为准。

  - 提出方：`questionnaire-answer-v3.0` 迁移项目（2026-10-19）。

- **`main/libs/logger.js` 的日志轮转参数写死为 `100K × 20`，业务侧无法覆盖，
  现场留存量不足以覆盖一次考试**：

  ```js
  // src/main/libs/logger.js:30  顶层即 configure，模块无 init
  log4js.configure({
      appenders: { logs: { type: 'dateFile', /* ... */
          maxLogSize: '100K',   // :50
          numBackups: 20,       // :51
      }},
  });
  ```

  **不可覆盖是三点叠加的结果**，缺一都还有救：
  - `log4js.configure` 在**模块顶层**执行，`require` 进来就已经定死。
  - `module.exports`（`:116`）只导出六级方法 + `print` + `shutdown`，**没有 configure 入口**。
  - 现有的 `setPathConfig()` 只覆盖 `log` 这个**目录**字段，不碰轮转参数。

  **后果是可量化的现场风险，不是接口洁癖。** `100K × 20` ≈ 2 MB 留存。
  实测（提出方 2026-10-20，在 `--dir --env test` 打包产物上走完整业务流：
  启动 → 登录 → 单份问卷作答 → 提交）：**这一遍就把日志滚了一轮** ——
  `UserData/Logs/` 留下 `log-2026-10-20.log`（13,967 B，当前）
  + `log-2026-10-20.log-1.gz`（19,878 B，即被压缩掉的那 100 K），
  **单次作答原始日志量 ≈ 114 KB**。

  | | 配置 | 留存 | 够几次作答 |
  |---|---|---|---|
  | toolkit 当前 | `100K × 20` | ≈ 2 MB | **约 18 次** |
  | 该业务迁移前的老实现 | `500K × 10` | ≈ 5 MB | 约 45 次 |

  业务场景是**考场一台机器连续多人作答**，18 次约等于一个上午 ——
  等到现场反馈问题再去捞日志，出问题的时段大概率已经被滚掉。
  而"现场可排查性"正是业务侧接 toolkit logger 的全部动机。

  **建议改法（两条，第一条是主要诉求）**：
  - **① 默认值直接改成 `maxLogSize: '500K'` / `numBackups: 10`。**
    同为 ≈5 MB 量级，但单文件大 5 倍 —— 对"捞一个时段的完整上下文"这件事，
    **少而大的文件远好于多而小的**（一次事故的日志不会被切成七八段跨文件）。
    这是改一行、对所有消费者都更合理的默认，不需要等接口设计。
  - **② 顺带开一个覆盖入口**，照搬 `paths.js` 已有的形状即可，
    无需放弃"顶层 configure 无 init"的现状 —— 只要允许在首次 require 前覆盖：

    ```js
    setLoggerConfig({ maxLogSize: '500K', numBackups: 10 });  // 须在 require logger 前调用
    ```

    时序约束与 `setPathConfig` 完全一致（"必须在任何 capability 被 require 之前"），
    文档一句话能说清。替代形态有两个，都可接受但各有代价：把这两项并入
    `setPathConfig` 的配置对象（改动最小，但 path 管轮转参数名实不符）；
    或给 logger 补显式 `init()`（最干净，但属破坏性变更，所有消费者都要改）。

  **只做 ① 就能解掉提出方的问题**；② 是给轮转策略不同的消费者留的口子，
  优先级低于 ①。

  **与 optional peer 那条的关系**：本条说的是"参数改不了"，
  上一条（`log4js` 的 `optional` 名不副实 / 双实例）说的是"业务侧连自己
  `require('log4js')` 兜底都兜不住" —— **后者是前者没有绕行方案的原因**，
  但两条可以各自独立修，不互为前置。

  - 提出方：`questionnaire-answer-v3.0` 迁移项目（2026-10-23，实测数据采于 2026-10-20）。

## 已修正的文档问题

- **§2.5 / §8.5 曾把 opt-out 契约的违约后果描述为"永久阻塞渲染进程（Electron 无原生
  timeout）""死锁风险"**。实测（Electron 22）不成立：渲染进程照常响应，
  Electron 立即报 `reply was never sent`。该断言会把排查引向"为什么挂死"，
  而真实现象是"bridge 是 undefined"。两处已改为实测结论。
  - 提出方：`questionnaire-answer-v3.0` 迁移项目（2026-10-04）。
