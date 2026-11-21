# Toolkit 已知限制

本文档只记录当前仍成立的限制与演进事项，已解决的问题不在此列。

> 跨仓库基线的**状态与排期**见 `docs/design/baseline-checklist.md`（唯一跟踪表）；本文只保留详细依据与实测数据。

## 已知限制

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
