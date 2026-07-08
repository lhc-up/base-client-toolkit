# Toolkit 接入迭代设计

**日期**：2026-07-08
**项目**:`@base-client/toolkit`
**性质**：因 `client-project` 沙盘接入触发的迭代活文档

> 本文档不是 toolkit 的整体架构真理源（那是 `2026-07-03-toolkit-architecture-design.md`），而是**因本次沙盘接入探索识别到的迭代项清单**。每一项都标注触发来源、归属目录、后续 spec 触发时机。

---

## §1 定位

### 1.1 触发背景

同 `frame` 迭代文档 §1.1。`client-project` 是本次接入 `business-project` 前的探索沙盘。

### 1.2 关联包引入：`@base-client/crypto`

同 `frame` 迭代文档 §1.2。toolkit 中 `update` capability（T-08）依赖 `crypto` 做解密。

### 1.3 定位边界不变

toolkit 仍然只提供：

- **基础能力**（`capability/*`）
- **桥架**（`service` / `notice` / `enhance/BaseWindow`）
- **共享底层**（`shared/*`）

**不提供业务范式基类**：三级缓存、下载队列、答案缓存、监管等**不作为 toolkit 内置模块**，由业务侧组合基础能力实现。

判据（用户提出）：**通用性 + 兼容性 + 业务无关性**。三者都满足才提升为 toolkit 能力；任一不满足则归业务侧。

---

## §2 迭代项 A 档：接入必备（全部归 `capability/`）

### T-01 logger

| 项 | 内容 |
|---|---|
| 归属 | `capability/logger` |
| 触发阶段 | 阶段 3 起步前 |
| 定性 | 主进程日志能力（分级、输出到文件/控制台、shutdown flush） |
| 参考 | `base-client.bake` `src/main/libs/logUtil.js` |
| 使用方 | 主进程业务、toolkit 其他 capability |

### T-02 os

| 项 | 内容 |
|---|---|
| 归属 | `capability/os` |
| 触发阶段 | 阶段 3 起步前 |
| 定性 | 系统信息只读能力：架构 / 内核 / 发行版信息 + `isLinux` / `isLoongnix` / `isWindows` / `isMac` 探测 |
| 参考 | `base-client.bake` `src/main/libs/os.js` |
| 使用方 | T-08 update（多平台安装分支）、业务侧 |

### T-03 shortcut

| 项 | 内容 |
|---|---|
| 归属 | `capability/shortcut` |
| 触发阶段 | 阶段 3 起步前 |
| 定性 | 全局快捷键注册 / 注销 pattern |
| 参考 | `base-client.bake` `src/main/libs/shortcut.js` |

### T-04 screenCapture

| 项 | 内容 |
|---|---|
| 归属 | `capability/screenCapture` |
| 触发阶段 | 阶段 3 起步前 |
| 定性 | 截屏能力模板：`desktopCapturer.getSources` → toDataURL 的封装 |

### T-05 singleInstance

| 项 | 内容 |
|---|---|
| 归属 | `capability/singleInstance` |
| 触发阶段 | 阶段 3 起步前 |
| 定性 | 单实例检查 + 第二实例激活（默认策略：聚焦已有窗口 / 从最小化还原） |
| 参考 | `base-client.bake` `src/main/libs/app.js#checkSingleInstance` |

### T-06 downloader

| 项 | 内容 |
|---|---|
| 归属 | `capability/downloader` |
| 触发阶段 | 阶段 3 起步前 |
| 定性 | 通用下载能力：URL → 目标路径 + MD5 校验 + 进度回调 + 断点续传（若基础库支持） |
| 使用方 | T-08 update（下载步骤）、业务侧组合三级缓存/下载队列 |

### T-07 store

| 项 | 内容 |
|---|---|
| 归属 | `capability/store` |
| 触发阶段 | 阶段 3 起步前 |
| 定性 | 类 localStorage 语义的持久化能力：两级 API - `set/get/remove`（KV）+ `setFile/getFile/removeFile`（以 key 为文件名的文件形式 KV） |
| 参考 | `base-client.bake` `src/main/libs/store.js` |
| 使用方 | 业务侧组合答案缓存、配置持久化等 |

### T-08 update

| 项 | 内容 |
|---|---|
| 归属 | `capability/update` |
| 触发阶段 | 阶段 5 起步前 |
| 定性 | **合并** `base-client.bake` `src/main/libs/package.js` 与 `src/main/libs/app.js#installApp` 的能力：<br>- 更新包扫描（含 semver 版本比较）<br>- 增量包（asax → asar）下载与落盘<br>- wwwroot 决策（`global.wwwroot` 指向最新版本目录）<br>- 全量安装包多平台安装（Linux xterm / xdg-open / dpkg + 龙芯特化 / Windows shell.openPath / mac 兜底） |
| 依赖 | T-06 downloader、T-02 os、`@base-client/crypto`（可选，用户注入 decrypt hook） |
| 不含 | 加解密核心（业务用户 init 时注入 decrypt 函数） |
| 参考 | `base-client.bake` `src/main/libs/package.js` + `src/main/libs/app.js` |

### T-09 preload 侧回调参数 channel 化

| 项 | 内容 |
|---|---|
| 归属 | `service` 模块增强（非新 capability） |
| 触发阶段 | 阶段 3 起步前 |
| 定性 | preload sdk 侧遍历 args；对象参数中的 function 字段自动替换为动态 channel，主进程通过 `event.sender.send(channel, data)` 触发回调。适用如 `download({ onProgress: fn })` 场景 |
| 参考 | `base-client.bake` `src/preload/service/index.js:11-25` `replaceCallbacksWithChannels` |
| 兼容影响 | Service schema 语法保持不变；preload 生成逻辑增强 |

---

## §3 迭代项 B 档：验证/待讨论

### T-10 `shared/serializer` 覆盖度验证

| 项 | 内容 |
|---|---|
| 触发阶段 | 阶段 3 |
| 定性 | 用 business 主进程真实返回值 case（大文件路径、Buffer、Error、循环引用、Date、Map 等）覆盖现有 serializer；发现遗漏再补 |

### T-11 Notice 保留 broadcast 现状

- `base-client.bake` 用"渲染 sub → 主进程按订阅推送"模式（有状态，需处理窗口销毁清理订阅）
- toolkit 用"主进程 broadcast → 渲染分发"模式（无状态）
- 从用户视角功能一致，架构上后者更简单
- **本轮结论：保留 toolkit 现状，不改**

### T-12 业务范式的"组合参考"

- 三级缓存、下载队列、答案缓存、作答监管等
- 用 T-01~T-09 组合实现
- **不提升到 toolkit**（判据：通用性 + 兼容性 + 业务无关性）
- 组合参考写在**接入方案文档 §5 recipe** 章节，不进 toolkit 代码
- 后续若发现某组合频繁重复且完全无业务耦合，再论证是否内建

---

## §4 迭代项与接入阶段的映射矩阵

| 阶段 | T-01 | T-02 | T-03 | T-04 | T-05 | T-06 | T-07 | T-08 | T-09 | T-10 |
|---|---|---|---|---|---|---|---|---|---|---|
| 阶段 0 | — | — | — | — | — | — | — | — | — | — |
| 阶段 1 | — | — | — | — | — | — | — | — | — | — |
| 阶段 2 | — | — | — | — | — | — | — | — | — | — |
| 阶段 3 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| 阶段 4 | 用 | 用 | 用 | 用 | 用 | 用 | 用 | — | 用 | 用 |
| 阶段 5 | 用 | 用 | 用 | — | — | 用 | 用 | ✓ | 用 | — |

✓ = 该阶段起步前需完成 spec；"用" = 该阶段消费但不新增。

---

## §5 每项 spec 触发时机汇总

| 项 | 触发时机 | 阻塞对象 |
|---|---|---|
| T-01 ~ T-07, T-09, T-10 | 阶段 3 起步前 | 阶段 3 |
| T-08 update | 阶段 5 起步前 | 阶段 5 |
| T-11 | 无需 spec，本文档定性即结论 | — |
| T-12 | 每次 recipe 落地时写入接入方案文档 §5 | — |

---

## §6 与 `TODOs.md` 的合并规则

toolkit 现有 `TODOs.md` 只有一条 M3 Notice 待讨论项，与本次接入无直接冲突。

合并规则：

- 本文档 A 档项目在 `TODOs.md` 也列一行，加前缀 `[T-XX 接入]` 标注来源
- 每阶段结束时，反馈 DoD 产生的新 T-XX 项按此规则同步
- M3 Notice 现有 TODO 不阻塞本次接入，独立推进

---

## §7 未来拆包演化方向

toolkit 后续会拆包。本节记录判据、候选顺序、拆包时的兼容策略。**本轮不落地拆包动作**，只留白说明。

### 7.1 何时拆的判据

- 模块稳定 3 个月无破坏性变更
- 有明确的独立版本节奏诉求（其他项目单独使用）

### 7.2 候选拆包顺序（初步）

1. `@base-client/service`（IPC 通信基础，最独立）
2. `@base-client/notice`
3. `@base-client/update`（与 `crypto` 强绑，可能与 `crypto` 一起演化）
4. `capability/*` 中稳定项按需拆

### 7.3 拆包时的兼容策略

- toolkit 主包保留 subpath 别名（`require('@base-client/toolkit/service')`）
- subpath 内部代理到独立包
- 使用方零改动过渡；主包发新版仅调整依赖

---

## §8 参考项目 `base-client.bake` 吸收清单

`base-client.bake` 是 `business-project` 优化后的干净基座（已剥离业务），本次迭代参考的能力实现：

| 迭代项 | bake 参考路径 | 吸收方式 |
|---|---|---|
| T-01 logger | `src/main/libs/logUtil.js` | 结构参考 |
| T-02 os | `src/main/libs/os.js` | 结构参考 |
| T-03 shortcut | `src/main/libs/shortcut.js` | 结构参考 |
| T-05 singleInstance | `src/main/libs/app.js#checkSingleInstance` | 结构参考 |
| T-07 store | `src/main/libs/store.js` | 语义参考（KV + 文件形式的 KV 两级 API） |
| T-08 update | `src/main/libs/package.js` + `src/main/libs/app.js#installApp` | **合并两者能力** |
| T-09 preload 回调 channel 化 | `src/preload/service/index.js:11-25` | 模式直接吸收 |
| Service schema 对齐 | `src/main/service/index.js` | 与现有 toolkit Service 对齐验证（T-10 相关） |

**吸收原则**：不 copy 代码，只吸收架构模式；具体实现按 toolkit 架构原则（零副作用、显式 init、渲染进程零本地 IO 等）重写。

---

## §9 反馈回填约定

沙盘接入过程中如发现 toolkit 新的迭代点：

- 立即在本文档 §2 或 §3 增补新的 T-XX 条目
- 在 `TODOs.md` 同步一行前缀 `[T-XX 接入]`
- 对应接入方案文档 §6 反馈闭环机制中记录

**注意**：只记录能力/接口层面的问题，不记录业务实现细节（后者归接入方案文档 §5 recipe）。
