# Toolkit 架构改造 阶段 3：M spec 裁剪 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 M1-M5 五份模块 spec 里的跨模块段落改为"参见架构 §X"引用；每份 spec 头部加 `## 落地文件` 与 `## 依赖与被依赖` 小节。M spec 只保留模块私有内容，架构层内容一律引用总文档。

**Architecture:** 阶段 3 是**纯文档编辑**，不动代码。5 份 M spec 逐一处理：先加两个头部小节（落地文件 + 依赖登记），再按裁剪规则改写跨模块段落。裁剪规则遵循架构 §11.3 —— 保留**一句概述**加"（详见架构 §X）"，禁止复述原完整段落。

**Tech Stack:** Markdown, git。无代码改动。

**Spec 依据：** `docs/superpowers/specs/2026-07-03-toolkit-architecture-design.md` §11.3 / §11.5 / §11.6。

**前置条件：** 阶段 1 与阶段 2 PR 均已合入。

---

## File Structure

**修改（5 份）：**
- `docs/superpowers/specs/2026-05-27-toolkit-m1-serializer-design.md`
- `docs/superpowers/specs/2026-06-03-toolkit-m2-service-design.md`
- `docs/superpowers/specs/2026-06-03-toolkit-m3-notice-design.md`
- `docs/superpowers/specs/2026-06-03-toolkit-m4-base-window-design.md`
- `docs/superpowers/specs/2026-06-03-toolkit-m5-capability-contract-design.md`

**不动：** 架构 spec、`src/`、`tests/`、`package.json` 等。

---

## 通用改写规则（每 Task 内均适用）

**架构 §11.3 一句概述 + 引用**：M spec 里所有涉及 ≥2 个模块的段落，改写为：

> [一句概述] + "（详见架构 §X）"

**禁止**：保留原完整段落 + 加"single source"标签。允许复述 = 允许漂移，违背改造精神。

**头部两小节**：每份 M spec 在标题下、原有正文（`## 一、定位`）**之前**插入两个新章节：

1. `## 落地文件` —— 列该模块关键源文件路径（架构 §11.5）
2. `## 依赖与被依赖` —— 显式登记 依赖 / 被依赖 列表（架构 §11.6）

**引用格式**：架构 spec 章节引用统一写为 `架构 §7.1`（不写"总文档"、"总设计"等旧称）；架构 spec 完整路径 `docs/superpowers/specs/2026-07-03-toolkit-architecture-design.md`。

---

## Tasks

### Task 1: M1 serializer spec 裁剪

**Files:**
- Modify: `docs/superpowers/specs/2026-05-27-toolkit-m1-serializer-design.md`

- [ ] **Step 1: 在标题下插入头部两小节**

打开 `docs/superpowers/specs/2026-05-27-toolkit-m1-serializer-design.md`。找到文首（第一行 `# IPC 数据序列化器设计` 之后、`## 1. 背景与需求` 之前的空行位置），插入：

```markdown

## 落地文件

- 入口：`src/shared/serializer/index.js`
- 特殊类型适配：`src/shared/serializer/adapters.js`
- 占位符生成：`src/shared/serializer/placeholders.js`
- 上限配置：`src/shared/serializer/limits.js`
- Error 还原：`src/shared/serializer/reviveError.js`

## 依赖与被依赖

**依赖：** 无（M1 是基础层）

**被依赖：**
- M2 Service（`src/service/main.js` / `src/service/preload.js`）—— 使用 `serialize` / `serializeForIpc` / `reviveError`
- M3 Notice（`src/notice/main.js` / `src/notice/preload.js`）—— 使用 `serialize` / `serializeForIpc` / `reviveError`
- 用户主端 / 渲染端业务代码（可选，logger 类场景）—— 使用 `serialize` / `safeStringify` / `configureSerializer`

```

- [ ] **Step 2: 更新 §5.1 strict 默认表述**

找到 M1 §5.1 中描述 `strict` 默认值的段落（原文包含"默认 `process.env.NODE_ENV !== 'production'`"或类似）。将该项改为：

> `strict`：默认 `false`（详见架构 §7.2）。如需在开发环境暴露序列化真 bug（Proxy 抛错 / toJSON 抛错等），主动 `configureSerializer({ strict: true })`。`configureSerializer` 全局默认是**每进程独立**的（详见架构 §7.6）。

- [ ] **Step 3: 更新 §5.3 错误对象处理收编**

找到 M1 §5.3 中"信封协议 `{ ok, data?, error? }`"及主端永不 throw 的描述段落。改为一段概述：

> M2 Service 与 M3 Notice 的元通道及各响应通道统一使用信封 `{ ok, data?, error? }`（详见架构 §7.1）；主端 handler 永不 throw，所有错误经 `serializeForIpc(err)` 装信封返回（详见架构 §3.3 / §7.2）；preload 端用 `reviveError(envelope.error)` 还原为 Error 实例（`reviveError` 三层输入契约详见架构 §7.3）。

**同时**：将 `reviveError` 作为公开 API 的说明保留在 M1（因为它是 M1 导出的 API），补一句 "从 `shared/serializer.reviveError` 导出（架构 §7.3）"。

- [ ] **Step 4: 更新 §6 数据流**

找到 M1 §6 的四条路径描述。将每条路径中"清洗点 A/B/C/D/E" 涉及的具体 `serialize(x, { strict: false })` 调用统一改为 `serializeForIpc(x)`；并在 §6 章首加一句：

> M2 / M3 主端与 preload 所有 IPC 序列化调用点使用 `serializeForIpc()` 封装（详见架构 §7.2），本节路径中出现的 `serialize` 均指该封装。

保留数据流图本身（哪里清洗、清洗点位置），因为这些是 M1 视角的完整数据流叙述。

- [ ] **Step 5: 更新 §8.1 / §8.2 IPC 永不抛错的表述**

找到 §8.2 关键不变量中"IPC 路径在生产环境永不抛错：库内部调用 serializer 时硬编码 `strict: false`"。改为：

> IPC 路径在生产环境永不抛错 —— 通过 `serializeForIpc()` 封装承担（详见架构 §7.2 / §3.3）。业务代码零手动 `{ strict: false }` 传参。

- [ ] **Step 6: 更新 §9 测试文件位置引用**

找到 §9 测试文件路径列表（如 `src/shared/serializer/__tests__/...`），把测试目录基路径改为 `tests/shared/serializer/`（架构 §10.6）。列表内的文件名保留。

- [ ] **Step 7: 校验**

```bash
grep -nE "strict.*NODE_ENV|process\.env\.NODE_ENV" docs/superpowers/specs/2026-05-27-toolkit-m1-serializer-design.md
```

Expected: 无输出（NODE_ENV 相关旧描述已清）。

```bash
grep -c "架构 §" docs/superpowers/specs/2026-05-27-toolkit-m1-serializer-design.md
```

Expected: 至少 6 处引用（Step 2-5 各处 + 头部两处 + 其他隐含）。

- [ ] **Step 8: 提交**

```bash
git add docs/superpowers/specs/2026-05-27-toolkit-m1-serializer-design.md
git commit -m "docs(m1): 裁剪跨模块段落，加落地文件与依赖登记（架构 §11.3 / §11.5 / §11.6）"
```

---

### Task 2: M2 service spec 裁剪

**Files:**
- Modify: `docs/superpowers/specs/2026-06-03-toolkit-m2-service-design.md`

- [ ] **Step 1: 在标题下插入头部两小节**

打开 M2 spec。在文首（`# Toolkit M2：Service 模块详细设计` 及 `> 所属：...` 引用行之后、`## 一、定位` 之前）插入：

```markdown

## 落地文件

- 主端入口：`src/service/main.js`
- preload 入口：`src/service/preload.js`
- 私有协议：`src/service/protocol.js`（channel 命名等模块私有常量；envelope 已上收 `shared/envelope`，详见架构 §7.7）

## 依赖与被依赖

**依赖：**
- M1 shared/serializer —— `serialize` / `serializeForIpc` / `reviveError`
- shared/envelope（架构 §7.1）—— `okEnvelope` / `errorEnvelope`
- shared/naming（架构 §7.4）—— `isValidIdentifier`
- electron —— `ipcMain` (main) / `ipcRenderer` (preload)

**被依赖：**
- M5 capability 契约（文档级）—— 引用 `serviceSchema` 形态与 `validateServiceSchema`

```

- [ ] **Step 2: 更新 §一 定位表述**

在 §一 定位末尾（"唯一同向依赖：M1 `shared/serializer`" 那句附近），补充：

> 及 `shared/envelope`（架构 §7.1）、`shared/naming`（架构 §7.4）。

- [ ] **Step 3: 更新 §2.1 schema 约定**

找到 §2.1 关于 "同一 namespace 在所有挂载的 schema 中全局唯一" 的段落。改为：

> 同一 namespace 在所有挂载的 Service schema 中全局唯一，冲突时 `init` 抛错。命名口径与 handler 名字符规则详见架构 §3.7 / §7.4（namespace / handler 名 / event 名统一须为合法 JS 标识符 `/^[A-Za-z_][A-Za-z0-9_]*$/`；由 `validateServiceSchema` 承担运行时校验，详见架构 §7.5）。

- [ ] **Step 4: 更新 §3.2 统一信封**

找到 §3.2 整节（"统一信封"）。改为一段概述：

> Service 的异步 / 同步 / 元通道响应均使用统一信封 `{ ok, data?, error? }`（详见架构 §7.1）。`data` / `error` 字段均经 `serializeForIpc()` 编码（详见架构 §7.2）。主端 handler 永不 throw —— 详见架构 §3.3。

- [ ] **Step 5: 更新 §4.2 registerService**

找到 §4.2 内联的手写校验步骤（"校验 namespace / handlers / sync / needsEvent" 那些段落）。改为：

> `registerService(schema)` 内部调用 `validateServiceSchema(schema)`（M2 公开导出，详见架构 §7.5）完成 schema 形态与命名校验；校验通过后再检查 namespace 冲突（`registeredSchemas` 已存在则抛错）。校验失败抛错细节由 validateServiceSchema 定义。

保留 §4.2 后续 handler 注册细节（这是 M2 特有的运行时行为）。

- [ ] **Step 6: 更新 §4.2 handler 注册的 serialize 表述**

在 §4.2 handler 注册 code 块中，把所有 `serialize(x, { strict: false })` 改为 `serializeForIpc(x)`。开头加一句：

> IPC 序列化统一经 `serializeForIpc()`（详见架构 §7.2）。

- [ ] **Step 7: 更新 §5.3 / §5.4 / §5.5 preload caller 与参数序列化**

在 §5.3 / §5.4 code 中同样把 `serialize(a, { strict: false })` 改为 `serializeForIpc(a)`；envelope 相关变量注释一句："envelope 形态详见架构 §7.1"。

§5.5 "渲染端参数序列化"整节改为：

> 渲染端参数在 IPC 之前经 `serializeForIpc()` 编码，与主端 handler 返回值的序列化共同构成 IPC 安全闭环（详见架构 §7.2）。

- [ ] **Step 8: 更新 §6.2 对内依赖**

找到 §6.2 对内依赖表。添加两行：
- `M2 主/preload → shared/envelope`：`okEnvelope` / `errorEnvelope`（详见架构 §7.1）
- `M2 主/preload → shared/naming`：`isValidIdentifier`（详见架构 §7.4）

- [ ] **Step 9: 更新 §7 文件结构 与 §7.1 protocol.js 描述**

在 §7 文件结构下（"src/service/" 目录树附近），把 protocol.js 的注释改为：

> `protocol.js` —— channel 命名等模块私有协议（envelope 已上收 `shared/envelope`，详见架构 §7.7）

在 §7.1 各文件职责的 `protocol.js` 描述中，把 `okEnvelope` / `errorEnvelope` 那段删除，仅保留 `META_LIST_CHANNEL` / `asyncChannel` / `syncChannel` 的说明。

- [ ] **Step 10: 校验**

```bash
grep -nE "okEnvelope|errorEnvelope" docs/superpowers/specs/2026-06-03-toolkit-m2-service-design.md
```

Expected: 只有少量提到 envelope 概念的引用行（无 "定义在 protocol.js" 之类的过时表述）。

```bash
grep -nE "serialize\(.*strict: false" docs/superpowers/specs/2026-06-03-toolkit-m2-service-design.md
```

Expected: 无输出（所有 `serialize(x, { strict: false })` 都改成了 `serializeForIpc(x)`）。

- [ ] **Step 11: 提交**

```bash
git add docs/superpowers/specs/2026-06-03-toolkit-m2-service-design.md
git commit -m "docs(m2): 裁剪跨模块段落，加落地文件与依赖登记（架构 §11.3 / §11.5 / §11.6）"
```

---

### Task 3: M3 notice spec 裁剪

**Files:**
- Modify: `docs/superpowers/specs/2026-06-03-toolkit-m3-notice-design.md`

- [ ] **Step 1: 在标题下插入头部两小节**

打开 M3 spec。文首（`# Toolkit M3：Notice 模块详细设计` 及引用行后、`## 一、定位` 前）插入：

```markdown

## 落地文件

- 主端入口：`src/notice/main.js`
- preload 入口：`src/notice/preload.js`
- 私有协议：`src/notice/protocol.js`（channel 命名；envelope 已上收 `shared/envelope`，详见架构 §7.7）

## 依赖与被依赖

**依赖：**
- M1 shared/serializer —— `serialize` / `serializeForIpc` / `reviveError`
- shared/envelope（架构 §7.1）—— `okEnvelope` / `errorEnvelope`
- shared/naming（架构 §7.4）—— `isValidIdentifier`
- electron —— `ipcMain` / `BrowserWindow` (main) / `ipcRenderer` (preload)

**被依赖：**
- M5 capability 契约（文档级）—— 引用 `noticeSchema` 形态与 `validateNoticeSchema`

```

- [ ] **Step 2: 更新 §一 定位表述**

在 §一 定位末尾（"同向依赖：M1 `shared/serializer`" 附近）补：

> 及 `shared/envelope`（架构 §7.1）、`shared/naming`（架构 §7.4）。

- [ ] **Step 3: 更新 §2.1 schema 约定 的命名规则**

找到 §2.1 关于事件名规则的段落（原文含 "`[A-Za-z0-9_-]+`"）。改为：

> 事件名与 namespace 均须为合法 JS 标识符 `/^[A-Za-z_][A-Za-z0-9_]*$/`（详见架构 §3.7 / §7.4），由 `validateNoticeSchema` 承担运行时校验（详见架构 §7.5）。事件名不含点号，避免与 fullEventName 分隔符冲突。同一 namespace 在所有挂载的 Notice schema 中全局唯一，冲突时 `init` 抛错。

**注意**：旧文中若有明确写"允许 dash"或 `_-` 之类的字符范围描述，一并删除。

- [ ] **Step 4: 更新 §3.3 元通道信封**

找到 §3.3 关于元通道信封的段落。改为一段概述：

> 元通道 `notice:getSchema` 使用统一信封 `{ ok, data?, error? }`（详见架构 §7.1）。信封 `data` 与 `error` 字段均经 `serializeForIpc()` 编码（详见架构 §7.2）。

- [ ] **Step 5: 更新 §4.2 registerSchema**

找到 §4.2 手写校验步骤。改为：

> `registerSchema(schema)` 内部调用 `validateNoticeSchema(schema)`（M3 公开导出，详见架构 §7.5）完成 schema 形态与命名校验；校验通过后检查 namespace 冲突。校验失败抛错细节由 validateNoticeSchema 定义。

- [ ] **Step 6: 更新 §4.3 / §4.4 / §4.5 serialize 调用**

在 §4.3 broadcast / §4.4 direct / §4.5 元通道 handler code 中，所有 `serialize(x, { strict: false })` 改为 `serializeForIpc(x)`。§4.3 开头加一句：

> IPC payload 与元通道数据统一经 `serializeForIpc()`（详见架构 §7.2）。

- [ ] **Step 7: 更新 §5.2 buildAppNotice**

在 §5.2 code 附近或前面，加一句：

> preload 端 envelope 解包契约详见架构 §7.1；错误还原 `reviveError` 详见架构 §7.3。

保留 §5.2 描述的具体 dispatcher / listeners 逻辑（M3 私有实现）。

- [ ] **Step 8: 更新 §6.2 对内依赖表**

添加两行：
- `M3 主/preload → shared/envelope`：`okEnvelope` / `errorEnvelope`（详见架构 §7.1）
- `M3 主/preload → shared/naming`：`isValidIdentifier`（详见架构 §7.4）

- [ ] **Step 9: 更新 §7 文件结构与 §7.1 protocol.js 描述**

同 Task 2 Step 9 —— protocol.js 描述去掉 envelope，只保留 channel 常量说明。

- [ ] **Step 10: 校验**

```bash
grep -nE "\[A-Za-z0-9_-\]|allowed:.*_-" docs/superpowers/specs/2026-06-03-toolkit-m3-notice-design.md
```

Expected: 无输出（旧的宽松 regex 表述已清）。

```bash
grep -nE "serialize\(.*strict: false" docs/superpowers/specs/2026-06-03-toolkit-m3-notice-design.md
```

Expected: 无输出。

- [ ] **Step 11: 提交**

```bash
git add docs/superpowers/specs/2026-06-03-toolkit-m3-notice-design.md
git commit -m "docs(m3): 裁剪跨模块段落，加落地文件与依赖登记（架构 §11.3 / §11.5 / §11.6）"
```

---

### Task 4: M4 base-window spec 裁剪

**Files:**
- Modify: `docs/superpowers/specs/2026-06-03-toolkit-m4-base-window-design.md`

M4 天生与 M1/M2/M3 解耦，跨模块段落最少。主要动作是加头部两小节 + 更新测试路径引用。

- [ ] **Step 1: 在标题下插入头部两小节**

打开 M4 spec。文首（`# Toolkit M4：BaseWindow 模块详细设计` 及引用行后、`## 一、定位` 前）插入：

```markdown

## 落地文件

- 单类文件：`src/enhance/BaseWindow.js`（文件名即类名，无 `index.js`，无子目录）

## 依赖与被依赖

**依赖：**
- electron —— `BrowserWindow`
- lodash.merge —— 深合并 options

**被依赖：** 无（其他模块与 M4 完全解耦）

```

- [ ] **Step 2: 更新 §一 定位表述**

在 §一 中"不涉及 IPC，无依赖 M1 / M2 / M3" 句后补一句：

> M4 与 IPC 桥接机制及序列化基础层完全解耦，详见架构 §3.6 模块间独立。

- [ ] **Step 3: 更新 §4.4 send 方法说明**

找到"关于 `send`" 的注解段落。补充一句引用：

> 日常主→渲染推送请使用 Notice —— Notice 有 schema 协议、自动 `serializeForIpc()` 编码、订阅模型，是为推送场景设计的正路（详见架构 §4 核心能力）。

- [ ] **Step 4: 更新 §7 文件结构中测试目录引用（若存在）**

若 §7 提到测试位置 `src/enhance/__tests__/`，改为 `tests/enhance/`（详见架构 §10.6）。

- [ ] **Step 5: 校验**

```bash
grep -n "架构 §" docs/superpowers/specs/2026-06-03-toolkit-m4-base-window-design.md
```

Expected: 至少 3 处引用（头部两小节 + §一 或 §4.4 + 可能的测试路径）。

- [ ] **Step 6: 提交**

```bash
git add docs/superpowers/specs/2026-06-03-toolkit-m4-base-window-design.md
git commit -m "docs(m4): 加落地文件与依赖登记，测试路径迁 tests/（架构 §11.5 / §11.6 / §10.6）"
```

---

### Task 5: M5 capability spec 裁剪

**Files:**
- Modify: `docs/superpowers/specs/2026-06-03-toolkit-m5-capability-contract-design.md`

- [ ] **Step 1: 在标题下插入头部两小节**

打开 M5 spec。文首（`# Toolkit M5：capability 命名空间接入约定 + 参考示例` 及引用行后、`## 一、定位` 前）插入：

```markdown

## 落地文件

- 参考示例入口：`src/capability/example/index.js`

## 依赖与被依赖

**依赖：** 无（capability 模块契约上不得依赖 M2 Service / M3 Notice 或其他 capability，详见架构 §3.6）

**被依赖：** 无（capability 模块之间互不依赖）

**文档级引用：**
- 引用 M2 spec 的 `serviceSchema` 形态与 `validateServiceSchema`（详见架构 §7.5）
- 引用 M3 spec 的 `noticeSchema` 形态与 `validateNoticeSchema`（详见架构 §7.5）

```

- [ ] **Step 2: 更新 §一 定位表述**

在 §一 末尾（"capability 实现者无须了解 IPC 通道命名等内部细节"附近），补充：

> capability 实现者只需遵循 M2 / M3 的 schema 形态；schema 命名规则详见架构 §7.4；schema 运行时校验由 M2 / M3 的 `validateServiceSchema` / `validateNoticeSchema` 承担，详见架构 §7.5。

- [ ] **Step 3: 更新 §2.3 命名约定**

找到 §2.3 命名约定段落。补充命名规则来源：

> 目录名（subpath name）= `serviceSchema.namespace` = `noticeSchema.namespace` 三者保持一致（详见架构 §3.7 / §7.4）。三者均须为合法 JS 标识符 `/^[A-Za-z_][A-Za-z0-9_]*$/`。

- [ ] **Step 4: 更新 §2.4 副作用约束**

在 §2.4 段首加一句引用：

> capability 模块在被 `require()` 时不得产生任何副作用（详见架构 §3.1 `require` 零副作用）。

保留后续具体禁令列表（不得读写 fs 等），这些细化在 M5 场景下有独立价值。

- [ ] **Step 5: 更新 §2.5 与 M2 / M3 protocol 的关系**

将 §2.5 整节改为一段：

> `serviceSchema` 字段形态、可选 opt-in 列表（`sync` / `needsEvent`）、handler 调用语义、运行时校验函数 `validateServiceSchema` —— 由 M2 Service spec 定义（详见架构 §7.5 引用规则）。`noticeSchema` 字段形态、事件命名规则、运行时校验函数 `validateNoticeSchema` —— 由 M3 Notice spec 定义。capability 实现者写 schema 时直接对照 M2 / M3 spec 与架构 §7.4 命名规则。

- [ ] **Step 6: 更新 §5.2 capability 依赖约束**

在 §5.2 依赖约束段首加一句：

> 依赖方向严格按架构 §3.6 模块间独立：capability 模块不得依赖 M2 Service / M3 Notice 或其他 capability。

保留后续"可以依赖 / 不得依赖"具体列表。

- [ ] **Step 7: 更新 §四 参考示例（capability example schema-shape 测试位置）**

若 §四 或其他节提到测试位置 `src/capability/example/__tests__/`，改为 `tests/capability/example/`（详见架构 §10.6）。

- [ ] **Step 8: 补一句 schema 校验 delegate 说明**

在 §四 参考示例后（"接入示例（主端）"前后），补充：

> capability 的 schema shape 测试若需运行时校验，直接 delegate 到 M2 `validateServiceSchema` / M3 `validateNoticeSchema`（详见架构 §7.5），避免命名 regex 散在多处漂移。

- [ ] **Step 9: 校验**

```bash
grep -nE "\[A-Za-z0-9_-\]" docs/superpowers/specs/2026-06-03-toolkit-m5-capability-contract-design.md
```

Expected: 无输出（旧的宽松 regex 表述已清）。

```bash
grep -c "架构 §" docs/superpowers/specs/2026-06-03-toolkit-m5-capability-contract-design.md
```

Expected: 至少 6 处引用（头部两小节 + §一 / §2.3 / §2.4 / §2.5 / §5.2 各处）。

- [ ] **Step 10: 提交**

```bash
git add docs/superpowers/specs/2026-06-03-toolkit-m5-capability-contract-design.md
git commit -m "docs(m5): 裁剪跨模块段落，加落地文件与依赖登记（架构 §11.3 / §11.5 / §11.6）"
```

---

### Task 6: 阶段 3 收口 + PR review checklist

**Files:**
- （无文件改动，纯 review checklist）

- [ ] **Step 1: 全局扫描 —— 各 M spec 引用架构 §X 的次数**

```bash
for f in docs/superpowers/specs/2026-05-27-toolkit-m1-serializer-design.md \
         docs/superpowers/specs/2026-06-03-toolkit-m2-service-design.md \
         docs/superpowers/specs/2026-06-03-toolkit-m3-notice-design.md \
         docs/superpowers/specs/2026-06-03-toolkit-m4-base-window-design.md \
         docs/superpowers/specs/2026-06-03-toolkit-m5-capability-contract-design.md; do
    count=$(grep -c "架构 §" "$f")
    echo "$f: $count 处引用"
done
```

Expected: M1 ≥ 6；M2 ≥ 8；M3 ≥ 7；M4 ≥ 3；M5 ≥ 6。

- [ ] **Step 2: 各 M spec 头部两小节存在性**

```bash
for f in docs/superpowers/specs/2026-05-27-toolkit-m1-serializer-design.md \
         docs/superpowers/specs/2026-06-03-toolkit-m2-service-design.md \
         docs/superpowers/specs/2026-06-03-toolkit-m3-notice-design.md \
         docs/superpowers/specs/2026-06-03-toolkit-m4-base-window-design.md \
         docs/superpowers/specs/2026-06-03-toolkit-m5-capability-contract-design.md; do
    landing=$(grep -c "^## 落地文件$" "$f")
    deps=$(grep -c "^## 依赖与被依赖$" "$f")
    echo "$f: 落地文件=$landing, 依赖与被依赖=$deps"
done
```

Expected: 每份 spec 两个都是 `1`。

- [ ] **Step 3: 无过时 `strict: false` / `[A-Za-z0-9_-]` 表述残留**

```bash
grep -rnE "serialize\([^)]*strict: false" docs/superpowers/specs/ | grep -v "2026-07-03"
```

Expected: 无输出（M spec 里所有 `serialize(x, { strict: false })` 都已改为 `serializeForIpc(x)`；架构 spec 里可能有描述性说明，不算过时）。

```bash
grep -rnE "\[A-Za-z0-9_-\]\+" docs/superpowers/specs/ | grep -v "2026-07-03"
```

Expected: 无输出（M spec 里没有旧的宽松 regex 描述）。

- [ ] **Step 4: 无遗留 "总文档" 旧称**

```bash
grep -rn "总文档" docs/superpowers/specs/
```

Expected: 无输出。M spec 内所有对架构 spec 的引用都用"架构 §X"格式；架构 spec 自身也不用"总文档"。

- [ ] **Step 5: 代码目录未在本阶段被修改**

```bash
git diff HEAD~5 HEAD -- src/ tests/ package.json vitest.config.mjs
```

Expected: 无输出（阶段 3 只动 M spec；`HEAD~5` 数字按本阶段的实际 commits 数调整）。

- [ ] **Step 6: 阶段 3 PR review checklist**

- [ ] 5 份 M spec 均有 `## 落地文件` + `## 依赖与被依赖` 头部小节
- [ ] M1 §5.1 strict 表述改为默认 false + 引用架构 §7.2
- [ ] M1 §5.3 信封 + reviveError 引用架构 §7.1 / §7.3
- [ ] M1 §6 数据流 serialize 调用改为 serializeForIpc + 引用架构 §7.2
- [ ] M2 §2.1 命名口径改为引用架构 §3.7 / §7.4
- [ ] M2 §3.2 统一信封改为引用架构 §7.1
- [ ] M2 §4.2 registerService 抽 validateServiceSchema + 引用架构 §7.5
- [ ] M2 §4.2 / §5.3-5.5 serialize 调用改为 serializeForIpc
- [ ] M2 §7 protocol.js 描述去掉 envelope
- [ ] M3 §2.1 命名 regex 收紧到合法 JS 标识符 + 引用架构 §7.4
- [ ] M3 §3.3 元通道信封引用架构 §7.1
- [ ] M3 §4.2 registerSchema 抽 validateNoticeSchema + 引用架构 §7.5
- [ ] M3 §4.3-4.5 serialize 调用改为 serializeForIpc
- [ ] M3 §7 protocol.js 描述去掉 envelope
- [ ] M4 §一 声明与 M1/M2/M3 解耦并引用架构 §3.6
- [ ] M4 §4.4 send 说明补 Notice 是正路的引用
- [ ] M4 §7 测试路径迁 tests/enhance/（若原文提及）
- [ ] M5 §2.3 命名口径引用架构 §3.7 / §7.4
- [ ] M5 §2.4 副作用约束引用架构 §3.1
- [ ] M5 §2.5 M2 / M3 protocol 引用改为 §7.5
- [ ] M5 §5.2 依赖约束引用架构 §3.6
- [ ] M5 §四 或相关节 补 delegate 到 validateServiceSchema / validateNoticeSchema 的说明
- [ ] 无 "总文档" 旧称残留
- [ ] 无过时 `serialize(x, { strict: false })` / `[A-Za-z0-9_-]` 表述残留

---

## Self-Review

**Spec 覆盖：** 阶段 3 的使命是把 M1-M5 里的**跨模块段落**改写为引用。Task 1-5 逐份处理；Task 6 全局校验。

**架构 §11.3 一句概述 + 引用规则**：Task 1 Step 3-5、Task 2 Step 4-7、Task 3 Step 4-7、Task 5 Step 5 均严格按 "[一句概述] + '（详见架构 §X）'" 格式改写；禁止复述原完整段落。

**架构 §11.5 落地文件 + §11.6 依赖登记**：Task 1-5 Step 1 各自插入两个头部小节；Task 6 Step 2 全局校验存在性。

**类型一致性：** `serializeForIpc` / `validateServiceSchema` / `validateNoticeSchema` / `isValidIdentifier` 等在架构 spec 与本阶段插入的引用文本中命名完全一致；架构章节号引用（§3.1 / §3.3 / §3.6 / §3.7 / §7.1-§7.5 / §7.7 / §10.6）均对应架构 spec 现有章节。

**Placeholder 扫描：** 每步都有具体改写指令（找哪段、改成什么）—— 无 TBD / TODO。sed 校验命令给了具体的 pattern。

**已识别风险：**

- Task 1-5 的 "找到 §X 段落" 步骤依赖 subagent 阅读理解 M spec 现有段落。若 spec 结构与本 plan 描述有 minor 差异（章节编号或段落顺序），需按上下文推断，不要机械匹配。
- 各 M spec 篇幅在 7-19KB，subagent 应一次完整 Read 后再改，避免部分改动漏段。
- 部分校验命令（如 grep 出现次数）是 minimum 值；实际引用可能更多，不算异常。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-03-toolkit-refactor-stage3-mspec-trim.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration. 每份 M spec 一个 subagent（Task 1-5 各一），Task 6 单独 subagent 或人工 review。

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch with checkpoints.

Which approach?
