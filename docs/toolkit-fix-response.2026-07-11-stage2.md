# Toolkit 修复回复 · P1 阶段 2 沙盘反馈（第一批）

**日期**：2026-07-11（回复）
**来源**：`base-client-toolkit`
**接收者**：用户 → 转发 `client-project`
**关联**：`toolkit-fix-list.2026-07-11-stage2.md`（下发单）
**分支 / 提交**：`master` / 见本次提交
**测试**：`npx vitest run` 40 files / 374 tests 全绿

---

## 汇总

| 优先级 | FB | 选定方案 | 修改类型 | 破坏性 |
|---|---|---|---|---|
| H1 | FB-022 | 方案 A（文档澄清） | 注释 + spec | 无（行为保持） |
| M1 | FB-021 | 方案 A（新增顶层语法糖） | 代码 + spec + test | 无（并存），但**保留字 `subscribe`/`unsubscribe`/`once` 不可用作 Notice namespace** |

---

## H1 · FB-022 · Service preload `sync: [...]` 语义澄清

**结论**：走文档路线，行为**保持不变**（`sync` 仍是"新增 `${name}Sync` 别名"，原名 `${name}` 仍是 async）。

### 修改点

- `src/service/preload.js` — `buildAppService` JSDoc 顶部追加"sync 语义澄清"段，明确写出：`.foo()` 恒返 Promise、拿同步值必须调 `.fooSync()`、`[object Promise]` 是常见踩点
- `docs/superpowers/specs/2026-06-03-toolkit-m2-service-design.md` §2.1 — 追加约定："`sync` 声明的语义是"新增 `${name}Sync` 别名"，不是"替换原方法为同步""
- 同 spec §2.3 — 渲染端 API 约定处强化"两条通道并存"关系

### 渲染端调用形态（保持不变）

```js
// schema: handlers = { getArgs }, sync = ['getArgs']
await window.appService.host.getArgs();          // ← async 通道，返回 Promise
window.appService.host.getArgsSync();            // ← sync 通道，同步返回值
```

### 沙盘侧动作

- `App.vue` 里 `appService.host.getArgsSync()` 的调用形态**继续保留**——即使 toolkit spec 已澄清，运行时行为不变
- 与本条相关的沙盘 plan Step 5.3 note（"若发现方法名不对，改沙盘调用与 toolkit 侧对齐"）可保留或简化为"确认已澄清于 M2 spec §2.1"
- 沙盘不需要回滚任何调用

---

## M1 · FB-021 · Notice preload 顶层 `subscribe/unsubscribe/once` 语法糖

**结论**：新增顶层语法糖，与既有 `[ns].on/off/once` **并存**且共享同一订阅存储。任选一路均可。

### 新增渲染端 API

```js
// EventEmitter 风格，fullEventName = "namespace.event"
const off = window.appNotice.subscribe('main.ready', payload => { /* ... */ });
off();   // 返回值是取消函数

window.appNotice.unsubscribe('main.ready', cb);   // 精确解绑（cb 必须与订阅时同引用）
window.appNotice.unsubscribe('main.ready');       // 清空该事件全部订阅
window.appNotice.once('config.changed', payload => { /* ... */ });
```

**与既有 `[ns].on/off/once` 完全等价**——顶层 `subscribe('foo.evA', cb)` 内部就是委托到 `appNotice.foo.on('evA', cb)`，共享同一份 listeners 存储。这意味着：

- 顶层订阅可以用 `[ns].off` 拆卸（反之亦然）
- 两种 API 语义完全对齐，业务按偏好选

### 破坏性变更（Notice namespace 保留字）

**namespace 名不得为 `subscribe` / `unsubscribe` / `once`**——这三个名字预留给顶层语法糖，若某 schema 用同名 namespace 会覆盖顶层方法。校验位置：

- `Notice.init()` 阶段 `validateNoticeSchema` 直接抛错（早于 preload 挂载）
- preload 端 `buildAppNotice` 也做二次防御，抛错信息形态一致

若沙盘 / frame / 业务代码里正巧有 `namespace: 'subscribe'` 等，需改名。**当前已知无此使用**。

### 顶层 `unsubscribe` 语义细节（与 `[ns].off` 有一处刻意差异）

`[ns].off()` 无参 = 清空整个 namespace（保留在 `[ns]` 层）；**顶层 `unsubscribe()` 无参不支持**——顶层"清空所有 namespace"过于危险。要清空整个 namespace 请继续用 `appNotice[ns].off()`。

### 修改点

- `src/notice/preload.js` — 加 `parseFullEventName` + 顶层三方法委托 + `TOP_LEVEL_KEYS` 保留字冲突检查（构建阶段抛错）
- `src/notice/main.js` — `validateNoticeSchema` 同步加保留字校验（init 阶段抛错，比 preload 阶段更早）
- `docs/superpowers/specs/2026-06-03-toolkit-m3-notice-design.md`：
  - §2.1 — 补 namespace 不得为保留字的约束
  - §2.4 — 追加"顶层语法糖"小节（含调用示例 + 约定条目）
  - §5.2 — 更新 `buildAppNotice` 代码骨架，含 `TOP_LEVEL_KEYS` 与顶层挂载逻辑
  - §6.1 — 对外接口表补顶层三方法行
  - §7.1 — `preload.js` 文件职责列表补顶层语法糖与 `parseFullEventName`
- 测试：
  - `tests/notice/preload-api.test.js` — 追加 10 条覆盖：顶层 3 方法存在、`subscribe` 派发正确、顶层与 `[ns].off` 共享存储 cross-detach、`unsubscribe(fullName, cb)` / `unsubscribe(fullName)` 两态、`once` 只触发一次、malformed fullName（无 `.`、开头 `.`、结尾 `.`、非字符串）、unknown namespace、undeclared event 委托抛错、保留字 namespace 构建抛错
  - `tests/notice/main-init.test.js` — 追加 3 条（`it.each`）：`namespace: 'subscribe' | 'unsubscribe' | 'once'` 各自触发 `collides with top-level API` 抛错

### 沙盘侧动作

选任一：

1. **继续用 `[ns].on(event, cb)` 形态**——无需改动，运行时行为无变化
2. **切换到顶层 `subscribe(fullName, cb)` 形态**——`App.vue` 相关订阅可改写成更符合 EventEmitter 直觉的 fullName 版本，"参见 toolkit/src/notice/preload.js:33-49" 类注释可删除

---

## 备注

- 两条改动都通过 `npx vitest run`（40 files / 374 tests）全绿
- 无 M2/M3 主端协议改动；沙盘 / frame / preload 装配代码**均无需同步升级**
- FB-022 是纯文档，若未来 spec 演进 v2 可考虑反转 `sync` 语义（方案 B）或加 `mode` 字段（方案 C），本轮保持存量兼容
- FB-021 顶层语法糖是**净新增**表面，`[ns].on/off/once` 完全保留，历史调用形态不受影响
