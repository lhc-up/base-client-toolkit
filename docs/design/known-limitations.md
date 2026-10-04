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
