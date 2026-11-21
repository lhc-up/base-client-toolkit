# Toolkit 已知限制

本文档只记录当前仍成立的限制与演进事项，已解决的问题不在此列。

> 跨仓库基线的**状态与排期**见 `docs/design/baseline-checklist.md`（唯一跟踪表）；本文只保留详细依据与实测数据。

## 已知限制

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

## 已修正的文档问题

- **§2.5 / §8.5 曾把 opt-out 契约的违约后果描述为"永久阻塞渲染进程（Electron 无原生
  timeout）""死锁风险"**，后来又改为"Electron 立即报 `reply was never sent`、渲染进程照常响应"。
  两种说法都不准确。实测（Electron 22.3.1，2026-11-21）：`sendSync` 阻塞 preload 到主进程 GC
  （约 2–8 秒）后返回 `{ error: 'reply was never sent' }`，不抛异常。§2.5 已按实测改写，
  toolkit 同时改为降级 + 警告（基线清单 K7）。
  - 提出方：`questionnaire-answer-v3.0` 迁移项目（2026-10-04）；复核：基线 K7（2026-11-21）。
