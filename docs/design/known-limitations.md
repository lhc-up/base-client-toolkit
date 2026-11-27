# Toolkit 已知限制

本文档只记录当前仍成立的限制与演进事项，已解决的问题不在此列。

> 跨仓库基线的**状态与排期**见 `docs/design/baseline-checklist.md`（唯一跟踪表）；本文只保留详细依据与实测数据。

## 已知限制

- **Linux 大版本安装不提供强制覆盖（`--force-overwrite`）**：安装交给 `@base-client/deb-installer`（系统安装器 → 终端 → 静默安装）。
  文件冲突的根源（不同客户端共用 deb 包名、安装目录）在打包侧解决：包名按客户端区分、安装目录 `/opt/<appId>`、旧包名用 `Replaces` 接管同名文件
  （见 baseline-checklist K13）。强制覆盖会改写其他包的文件，不提供。原先记录的 xterm 一闪而过、把 stderr 当失败两处偏差随旧实现一起删除。

## 已修正的文档问题

- **§2.5 / §8.5 曾把 opt-out 契约的违约后果描述为"永久阻塞渲染进程（Electron 无原生
  timeout）""死锁风险"**，后来又改为"Electron 立即报 `reply was never sent`、渲染进程照常响应"。
  两种说法都不准确。实测（Electron 22.3.1，2026-11-21）：`sendSync` 阻塞 preload 到主进程 GC
  （约 2–8 秒）后返回 `{ error: 'reply was never sent' }`，不抛异常。§2.5 已按实测改写，
  toolkit 同时改为降级 + 警告（基线清单 K7）。
  - 提出方：`questionnaire-answer-v3.0` 迁移项目（2026-10-04）；复核：基线 K7（2026-11-21）。
