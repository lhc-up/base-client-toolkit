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

## 已修正的文档问题

- **§2.5 / §8.5 曾把 opt-out 契约的违约后果描述为"永久阻塞渲染进程（Electron 无原生
  timeout）""死锁风险"**。实测（Electron 22）不成立：渲染进程照常响应，
  Electron 立即报 `reply was never sent`。该断言会把排查引向"为什么挂死"，
  而真实现象是"bridge 是 undefined"。两处已改为实测结论。
  - 提出方：`questionnaire-answer-v3.0` 迁移项目（2026-10-04）。
