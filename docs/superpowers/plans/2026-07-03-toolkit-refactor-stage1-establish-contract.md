# Toolkit 架构改造 阶段 1：立契约 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提交本轮架构改造第一阶段 PR —— 立总架构 spec 契约、删除已过时的 overview 与 M1-M5 plans，保持代码不动。

**Architecture:** 阶段 1 是"文档层立契约"—— 架构 spec 已在准备阶段写入 `docs/superpowers/specs/2026-07-03-toolkit-architecture-design.md`；旧 6 份文档（1 份 overview + 5 份 plans）已删除。本 plan 承载最后的**验证 + 提交 + review checklist**动作，让阶段 1 PR 上线独立完整（不含代码改动），为阶段 2 立好契约基线。

**Tech Stack:** Markdown, git。

**Spec 依据：** `docs/superpowers/specs/2026-07-03-toolkit-architecture-design.md` 全篇。

**前置条件：** 架构 spec 与旧文档处置已在当前工作目录完成（准备阶段），未提交。

---

## File Structure

阶段 1 涉及的文件：

**新增（已完成，未提交）：**
- `docs/superpowers/specs/2026-07-03-toolkit-architecture-design.md`
- `docs/superpowers/plans/2026-07-03-toolkit-refactor-stage1-establish-contract.md`（本文件）
- `docs/superpowers/plans/2026-07-03-toolkit-refactor-stage2-code-fulfillment.md`
- `docs/superpowers/plans/2026-07-03-toolkit-refactor-stage3-mspec-trim.md`

**删除（已完成，未提交）：**
- `docs/superpowers/specs/2026-06-03-toolkit-overview-design.md`
- `docs/superpowers/plans/2026-06-04-toolkit-m1-serializer.md`
- `docs/superpowers/plans/2026-06-04-toolkit-m2-service.md`
- `docs/superpowers/plans/2026-06-04-toolkit-m3-notice.md`
- `docs/superpowers/plans/2026-06-04-toolkit-m4-base-window.md`
- `docs/superpowers/plans/2026-06-04-toolkit-m5-capability-contract.md`

**保留不动：** M1-M5 五份模块 spec 保留至阶段 3 处理；`src/` 与 `tests/` 均不变。

---

## Tasks

### Task 1: 验证架构 spec 存在与完整性

**Files:**
- Verify: `docs/superpowers/specs/2026-07-03-toolkit-architecture-design.md`

- [ ] **Step 1: 验证文件存在**

```bash
ls -la docs/superpowers/specs/2026-07-03-toolkit-architecture-design.md
```

Expected: 文件存在，大小约 29-32 KB。

- [ ] **Step 2: 验证 11 章齐全**

```bash
grep -c '^## §' docs/superpowers/specs/2026-07-03-toolkit-architecture-design.md
```

Expected: `11`。

- [ ] **Step 3: 每章篇幅 ≤ 6KB 硬红线（§11.1）**

```bash
awk '/^## §/{if(section){print section": "bytes" bytes"} section=$0; bytes=0; next} {bytes+=length($0)+1} END{print section": "bytes" bytes"}' docs/superpowers/specs/2026-07-03-toolkit-architecture-design.md
```

Expected: 每行显示的 bytes 值均 ≤ 6144（6KB）。若任一超标，触发 §11.1 红线，返回架构 spec 就地压缩后重新验证。

- [ ] **Step 4: 无占位符扫描**

```bash
grep -nE 'TBD|TODO|FIXME|\bXXX\b' docs/superpowers/specs/2026-07-03-toolkit-architecture-design.md
```

Expected: 无输出。若有输出，就地修复后重新扫描。

---

### Task 2: 验证旧 6 份文档已从工作目录删除

**Files:**
- Verify (absent): `docs/superpowers/specs/2026-06-03-toolkit-overview-design.md`
- Verify (absent): `docs/superpowers/plans/2026-06-04-toolkit-m{1,2,3,4,5}-*.md`

- [ ] **Step 1: overview 已删除**

```bash
ls docs/superpowers/specs/2026-06-03-toolkit-overview-design.md 2>&1
```

Expected: `No such file or directory`。

- [ ] **Step 2: 5 份旧 plans 已删除**

```bash
ls docs/superpowers/plans/
```

Expected: 目录为空（`total 0` 或只显示 `.` / `..`）。

- [ ] **Step 3: M1-M5 五份模块 spec 保留**

```bash
ls docs/superpowers/specs/ | sort
```

Expected: 输出恰好 6 行 —
```
2026-05-27-toolkit-m1-serializer-design.md
2026-06-03-toolkit-m2-service-design.md
2026-06-03-toolkit-m3-notice-design.md
2026-06-03-toolkit-m4-base-window-design.md
2026-06-03-toolkit-m5-capability-contract-design.md
2026-07-03-toolkit-architecture-design.md
```

---

### Task 3: 验证 src/ 与 tests/ 未在本阶段被修改

**Files:**
- Verify: git status

- [ ] **Step 1: 查看 git status 全貌**

```bash
git status
```

Expected: 只有 `docs/superpowers/` 下的文件变化（1 新增 + 6 删除），`src/` / `package.json` / `scripts/` / `vitest.config.mjs` 等**无变化**。

- [ ] **Step 2: 若 status 显示代码文件变更，退回修正**

若 `git status` 显示 `src/**` / `package.json` / 其它代码类文件被修改：
- 说明本阶段范围被误扩
- 用 `git checkout -- <path>` 恢复这些文件到 HEAD 版本
- 重新跑 Step 1 直到只剩文档层变更

Expected: 最终 status 只有 `docs/superpowers/**` 变更。

---

### Task 4: 提交阶段 1 变更

**Files:**
- 待提交：`docs/superpowers/specs/2026-07-03-toolkit-architecture-design.md`（新增）+ 6 份旧文档（删除）

- [ ] **Step 1: 检查工作目录处于合适分支**

```bash
git branch --show-current
```

Expected: 显示当前分支名。若在 `main` / `master` 直接提交不合适，先切到 feature 分支：

```bash
git checkout -b refactor/toolkit-architecture-stage1
```

- [ ] **Step 2: 精确 stage 阶段 1 涉及的文件**

```bash
# 新增：架构 spec + 三份 stage plans
git add docs/superpowers/specs/2026-07-03-toolkit-architecture-design.md
git add docs/superpowers/plans/2026-07-03-toolkit-refactor-stage1-establish-contract.md
git add docs/superpowers/plans/2026-07-03-toolkit-refactor-stage2-code-fulfillment.md
git add docs/superpowers/plans/2026-07-03-toolkit-refactor-stage3-mspec-trim.md

# 删除：旧 overview + 5 份旧 plans
git add docs/superpowers/specs/2026-06-03-toolkit-overview-design.md
git add docs/superpowers/plans/2026-06-04-toolkit-m1-serializer.md
git add docs/superpowers/plans/2026-06-04-toolkit-m2-service.md
git add docs/superpowers/plans/2026-06-04-toolkit-m3-notice.md
git add docs/superpowers/plans/2026-06-04-toolkit-m4-base-window.md
git add docs/superpowers/plans/2026-06-04-toolkit-m5-capability-contract.md
```

（对于已删除的文件，`git add` 会捕捉删除操作。）

- [ ] **Step 3: 验证 staged 内容**

```bash
git status
```

Expected：
- Changes to be committed 区域显示：
  - `new file: docs/superpowers/specs/2026-07-03-toolkit-architecture-design.md`
  - `new file: docs/superpowers/plans/2026-07-03-toolkit-refactor-stage1-establish-contract.md`
  - `new file: docs/superpowers/plans/2026-07-03-toolkit-refactor-stage2-code-fulfillment.md`
  - `new file: docs/superpowers/plans/2026-07-03-toolkit-refactor-stage3-mspec-trim.md`
  - `deleted: docs/superpowers/specs/2026-06-03-toolkit-overview-design.md`
  - `deleted: docs/superpowers/plans/2026-06-04-toolkit-m1-serializer.md`
  - `deleted: docs/superpowers/plans/2026-06-04-toolkit-m2-service.md`
  - `deleted: docs/superpowers/plans/2026-06-04-toolkit-m3-notice.md`
  - `deleted: docs/superpowers/plans/2026-06-04-toolkit-m4-base-window.md`
  - `deleted: docs/superpowers/plans/2026-06-04-toolkit-m5-capability-contract.md`
- 没有其他文件

- [ ] **Step 4: 提交**

```bash
git commit -m "$(cat <<'EOF'
docs(architecture): 立总架构 spec 契约，删除已过时的 overview 与 M1-M5 plans

- 新增 docs/superpowers/specs/2026-07-03-toolkit-architecture-design.md
  作为跨模块契约、共享基础设施、核心不变量、目录组织、发布形态、
  文档治理规则的唯一真理源
- 删除 2026-06-03-toolkit-overview-design.md（内容被架构 spec 完全覆盖）
- 删除 5 份 M1-M5 plans（TDD 步骤已完成执行，不再作为"待办"保留）

阶段 1 只动文档，src/ 与 tests/ 保持不变。阶段 2 按新架构 spec 兑现代码。
EOF
)"
```

Expected: 提交成功，pre-commit hook 若存在则通过。

- [ ] **Step 5: 验证提交**

```bash
git log -1 --stat
```

Expected: 提交显示 1 file changed (added) + 6 files deleted，其余无变化。

---

### Task 5: 阶段 1 PR review checklist

**Files:**
- （无文件改动，纯 review 步骤）

阶段 1 PR 提交给 review 时按以下清单对照，逐条打钩：

- [ ] **Step 1: 架构 spec 已写入且通过篇幅红线**

- [ ] 11 章齐全（§1–§11）
- [ ] 每章 ≤ 6KB（§11.1 硬红线）
- [ ] 无 TBD / TODO 占位

- [ ] **Step 2: 32 项决策全部体现**

在架构 spec 中定位并勾选：
- [ ] 骨架 C 结构 + §11.1 篇幅上限 + §11.2 R1 划分（结构类 3 项）
- [ ] §7.1 envelope 位置 `shared/envelope.js` + §7.2 serializeForIpc + §7.3 reviveError 三层契约 + §7.4 命名口径 + §7.7 protocol.js 归属（跨模块契约 5 项）
- [ ] §5 shared/ 目录树只列 serializer + envelope + naming（shared/ 遗留全删的隐含）
- [ ] §3.1-3.7 七条核心不变量 + §8 四条 shared/ 准入规则 + §9.1 决策树 + §11.6 双向登记
- [ ] §11.3 M spec 改写规则 + §11.4 M6+ 编写顺序 + §11.5 spec ↔ 代码映射
- [ ] §10.2 无 build + §10.6 tests/ 目录 + §10.3 peer 反推 + §10.4 JSDoc + §11.7 TDD + §11.8 Mock 分域
- [ ] §7.2 strict 默认 false + §7.6 configureSerializer 每进程独立 + §3.7/§7.4 命名正则 `/^[A-Za-z_][A-Za-z0-9_]*$/` + §7.5 validateServiceSchema/validateNoticeSchema + §9.3 capability 至少一个 schema

- [ ] **Step 3: 旧文档已从当前 HEAD 中消失**

```bash
git log --oneline -1 -- docs/superpowers/specs/2026-06-03-toolkit-overview-design.md
```

若返回该文件最近的一次涉及（应该是**本次的删除**），说明它已从 HEAD 移除。

- [ ] **Step 4: 代码目录未在本阶段被误改**

```bash
git diff HEAD~1 HEAD -- src/ package.json vitest.config.mjs scripts/
```

Expected: 无输出（阶段 1 不动代码；若有输出，说明范围被误扩，退回修正后重新提交）。

- [ ] **Step 5: 阶段 2 前置条件已就绪**

- [ ] `docs/superpowers/plans/2026-07-03-toolkit-refactor-stage2-code-fulfillment.md` 已生成（本 plan 的姊妹）
- [ ] `docs/superpowers/plans/2026-07-03-toolkit-refactor-stage3-mspec-trim.md` 已生成（本 plan 的姊妹）
- [ ] 阶段 2 计划在 review 通过阶段 1 PR 后启动

---

## Self-Review

**Spec 覆盖：** 本 plan 不实现任何 spec 条款 —— 阶段 1 的使命是**把架构 spec 本身当作产出物提交**。所以 spec 覆盖靠 Task 5 的 review checklist 逐条对照。

**关键前置：** 阶段 2 / 3 plan 假设阶段 1 PR 已合入 —— 架构 spec 已存在于 `docs/superpowers/specs/` 且旧 6 份文档已消失。

**范围检查：** 阶段 1 严格只动 `docs/superpowers/**`。任何 `src/` / `package.json` / `vitest.config.mjs` 改动都属于阶段 2 范围，本 plan 用 Task 3 主动拦截。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-03-toolkit-refactor-stage1-establish-contract.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch with checkpoints.

Which approach?
