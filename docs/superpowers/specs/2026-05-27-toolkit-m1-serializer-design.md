# IPC 数据序列化器设计

**日期**：2026-05-27
**项目**：`@base-client/toolkit`
**目标**：统一处理主进程 / 渲染进程间 IPC 数据传递，避免不可克隆数据导致 Electron 报错；同时提供 logger 友好的序列化工具。

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

## 1. 背景与需求

`@base-client/toolkit` 是一个 Electron 客户端基础库，封装了主进程 ↔ 渲染进程的 IPC 通信（`Service`、`Notice`）。当前实现存在两个痛点：

1. **IPC 报错风险**：业务代码可能在数据对象中无心嵌套不可克隆字段（函数、Symbol、Class 实例、循环引用、Date 等）。一旦发生，Electron 的结构化克隆会抛错，影响业务可用性。开发期可控，但上线后业务侧无兜底机制。
2. **logger 序列化报错**：业务侧基于 log4js 在主进程封装了 logger，调用时参数形态各异，log4js 内部 `JSON.stringify` / `toJSON` 路径可能抛错。渲染进程的 logger 调用通过 IPC 中转，路径上"能否传 + 能否序列化"双重叠加风险。

两个场景的共同诉求：**有一份"对任何输入都安全"的序列化逻辑**，IPC 自动消费它，logger 也能复用它。

## 2. 设计目标

- **IPC 路径**：业务零修改，库内部自动清洗，永不因不可克隆字段而崩。
- **Logger 路径**：导出 `serialize` / `safeStringify` 工具，业务在自己的 log4js 封装里调用，永不因序列化而崩。
- **一份语义两个出口**：IPC 清洗结果和 logger 字符串化输入是同一份 plain 数据，行为一致便于调试。
- **lossy 是预期行为**：业务用不到不可克隆字段，库统一强制清洗，不可逆。
- **开发期可见性**：lossy 转换静默（设计目的），但意外异常（Proxy getter 抛错等）在 `strict` 模式下抛出，让真 bug 在开发期暴露。

## 3. 方案选型

**选定方案**：纯自研轻量 serializer。

横向评估对比过 `safe-stable-stringify`、`fast-safe-stringify`、`flatted`、`@ungap/structured-clone`、`telejson`、`devalue`、`serialize-error`、`util.inspect`、`safe-json-value` 等候选。结论：

- 输出字符串的库（safe-stringify 类、util.inspect、telejson、devalue）不能直接作为 IPC payload。
- 输出"带类型标记的中间格式"的库（`@ungap/structured-clone`、`flatted`）正是用户讨厌的"假 JSON"。
- 输出 plain object 的库只有 `safe-json-value`，但它策略是直接删除不可序列化字段，无可读占位符。

第三方库都需要写胶水才能满足"plain object + 可读占位符 + 一份语义"三件套，自研约 165 行核心代码，避免第三方依赖、preload 体积更小、占位符格式完全可控，胜出。

## 4. 模块结构

```
src/
  shared/
    serializer/
      index.js          - 入口，导出 serialize / safeStringify / configureSerializer
      adapters.js       - 特殊类型 → plain 的转换表
      placeholders.js   - 占位符生成
      limits.js         - 默认上限常量 + 全局配置
      reviveError.js    - 反序列化辅助（preload 端把 main 抛的 Error 还原成 Error 实例）

tests/                    - 测试目录（架构 §10.6）
  shared/
    serializer/
        serializer.test.js
        adapters.test.js
        limits.test.js
        circular.test.js
        never-throw.test.js
        revive-error.test.js
        ipc-integration.test.js
```

serializer 被 M2 / M3 在垂直切片内引用（`src/service/main.js` / `src/service/preload.js` / `src/notice/main.js` / `src/notice/preload.js`），M5 capability 模块按需引用。具体调用点详见 §6 数据流。

**关键决策**：
- serializer 是纯函数，无副作用，不依赖 electron，可在 main / preload / renderer 任何环境运行。
- 移除依赖 `@ungap/structured-clone`（不再使用）和 `lodash.isfunction`（一行 `typeof === 'function'` 替代）。
- preload bundle 体积控制在最小，避免对所有用户的渲染进程造成负担。

## 5. 对外 API

### 5.1 序列化工具（用户面向）

```js
const { serialize, safeStringify, configureSerializer } =
  require('@base-client/toolkit').shared.serializer;
```

#### `serialize(value, opts?) → plain JSON-safe value`

- 入参：任意值
- 出参：plain 对象 / 数组 / 原始值，保证 `JSON.stringify` 永不抛错
- **承诺**：lossy 转换 + 意外异常兜底，根据 strict 模式决定行为
- `opts`（可选，全部有默认）：
  - `maxDepth`：默认 32
  - `maxStringLength`：默认 10240（10KB）
  - `maxArrayLength`：默认 1000
  - `maxKeys`：默认 1000
  - `strict`：默认 `false`（详见架构 §7.2）。如需在开发环境暴露序列化真 bug（Proxy 抛错 / toJSON 抛错等），主动 `configureSerializer({ strict: true })`。`configureSerializer` 全局默认是**每进程独立**的（详见架构 §7.6）。
  - `onError(reason, path)`：意外异常的回调钩子

#### `safeStringify(value, opts?) → string`

等价于 `JSON.stringify(serialize(value, opts))`，便利方法。永不抛错。

#### `configureSerializer(defaults)`

全局配置默认值。库初始化时调一次，之后所有内部 IPC 清洗和工具调用按新默认。业务在 `serialize(value, { ... })` 中传 opts 可临时覆盖。

### 5.2 IPC 自动清洗（无新 API，行为变更）

- M2 Service 内部：handler return 值 / 抛出的 Error 自动 `serialize`
- M3 Notice `broadcast` / `direct` 内部：`data` 自动 `serialize`
- M2 Service preload 端：`appService[ns][handler](...args)` 同步与异步都对 `args` 自动 `serialize`

业务代码零修改。

### 5.3 错误对象处理收编

M2 Service 与 M3 Notice 的元通道及各响应通道统一使用信封 `{ ok, data?, error? }`（详见架构 §7.1）；主端 handler 永不 throw，所有错误经 `serializeForIpc(err)` 装信封返回（详见架构 §3.3 / §7.2）；preload 端用 `reviveError(envelope.error)` 还原为 Error 实例（`reviveError` 三层输入契约详见架构 §7.3）。`reviveError` 从 `shared/serializer.reviveError` 导出，作为 IPC 辅助工具族公开 API（架构 §7.3）。

## 6. 数据流

M2 / M3 主端与 preload 所有 IPC 序列化调用点使用 `serializeForIpc()` 封装（详见架构 §7.2），本节路径中出现的 `serialize` 均指该封装。

四条路径覆盖全部 IPC 场景。每条路径最多两次 `serialize`，分别在不同进程。handler 签名细节（`needsEvent` opt-in / `sync` 列表）详见 M2 §2.1，本节仅展示 serializer 调用点。

### 路径 ① Service 异步（renderer → main → renderer）

```
[renderer 业务] appService.foo.bar(rawArgs)
   │
[preload: service/preload.js]
   const safeArgs = rawArgs.map(a => serializeForIpc(a))   ◄── 清洗点 A：入参
   const envelope = await ipcRenderer.invoke('foo:bar', ...safeArgs)
   if (envelope.ok) return envelope.data
   else throw reviveError(envelope.error)
   │
[main: service/main.js] —— 永不 throw
   try {
     const result = await handler(...safeArgs)
     return { ok: true, data: serializeForIpc(result) }      ◄── 清洗点 B：出参
   } catch (err) {
     return { ok: false, error: serializeForIpc(err) }       ◄── 清洗点 C：错误
   }
```

### 路径 ② Service 同步（`sendSync`）

```
[preload] const safeArgs = rawArgs.map(a => serializeForIpc(a))
          const envelope = ipcRenderer.sendSync(syncChannel, ...safeArgs)
          if (envelope.ok) return envelope.data
          else throw reviveError(envelope.error)
[main]    try {
            const result = await handler(...)
            event.returnValue = { ok: true, data: serializeForIpc(result) }
          } catch (err) {
            event.returnValue = { ok: false, error: serializeForIpc(err) }
          }
```

异步与同步路径**协议同构**——都用 `{ ok, data?, error? }` 信封，preload 端解包逻辑只有一条。

### 路径 ③ Notice 广播（main → renderers）

```
[main] broadcast(event, rawData) / direct(event, winId, rawData)
       const safeData = serializeForIpc(rawData)             ◄── 清洗点 D
       win.webContents.send('notice:event', event, safeData)
```

推送通道**不走信封**——单向流无返回值、无错误回路（详见 M3 §3.2）。

### 路径 ④ schema 元通道查询

```
[main service]  event.returnValue = { ok: true, data: serializeForIpc(getServiceList()) }   ◄── 清洗点 E
[main notice]   event.returnValue = { ok: true, data: serializeForIpc(getSchema()) }
```

元通道与异步 / 同步 handler 通道共用同一信封形态，preload 端 `if (envelope.ok)` 解包路径完全一致。防御性清洗，确保未来 schema 扩展出非 plain 字段时不会崩。

### 不清洗的地方

- handler 内部业务逻辑：handler 拿到的入参已是 plain，handler 之间互相调不走 IPC。
- preload 端拿到的 schema 缓存：只读，不再二次清洗。

## 7. 特殊类型映射表

| 输入类型 | 输出 plain 表示 | 备注 |
|---|---|---|
| `null` / `undefined` | `null` / `undefined`（数组中 `undefined` → `null`） | JSON 一致 |
| `string` | 字符串（超长截断） | `"abc...[truncated 12345 chars]"` |
| `number` | 数字；`NaN`/`±Infinity` → `"[Number: NaN]"` / `"[Number: Infinity]"` / `"[Number: -Infinity]"` | JSON 不支持，转字符串 |
| `boolean` | 原样 | — |
| `bigint` | `"[BigInt: 12345]"` | JSON 不支持，转字符串 |
| `symbol` | `"[Symbol(desc)]"` 或 `"[Symbol]"` | 带 description |
| `function` | `"[Function: fnName]"` 或 `"[Function: anonymous]"` | 用 `fn.name` |
| 普通对象 | 深拷贝，键值递归 | 跳过非枚举属性、跳过 Symbol key |
| 数组 / TypedArray | 数组（递归元素） | TypedArray 转 plain array，超长截断追加 `"...[truncated N items]"` |
| `Date` | ISO 字符串 `"2026-05-27T10:00:00.000Z"` | 与 `JSON.stringify` 默认行为一致 |
| `Error`（含子类） | `{ name, message, stack, code?, cause? }` | `cause` 递归 serialize；不加 `__type` |
| `Map` | string-key 时转 plain 对象；含非 string key 时转 entries 数组 `[[k,v],[k,v]]` | 不加 `__type` |
| `Set` | 数组 | — |
| `RegExp` | `{ source, flags }` | 不加 `__type` |
| `Buffer` / `ArrayBuffer` | `"[Buffer: <length> bytes]"` | 绝不打印内容，防 logger 爆炸 |
| `Promise` / thenable | `"[Promise]"` | 无法同步解析 |
| `WeakMap` / `WeakSet` | `"[WeakMap]"` / `"[WeakSet]"` | 无法枚举 |
| DOM 节点 / Window | `"[DOM: <tagName>]"` / `"[Window]"` | renderer 端入参兜底 |
| Class 实例 | plain copy 自身可枚举属性 | **不加 `__type`**，业务用不到 |
| 循环引用 | `"[Circular: $.a.b]"` | WeakMap 记录已访问对象 + 路径 |
| 超深度（> maxDepth） | `"[MaxDepth]"` | — |
| 超键数（> maxKeys） | 保留前 N 个，追加 `"__truncated": "N more keys"` | — |
| Proxy / getter 抛错 | `"[Unserializable: <error.message>]"` | try/catch 每次属性访问 |
| 其他兜底 | `"[Unserializable: <typeof>]"` | 防御未来奇怪类型 |

### `toJSON` 约定

- 对象若实现 `toJSON()`，**先调用** `toJSON()` 取返回值再递归 serialize（与 `JSON.stringify` 默认一致）
- `toJSON()` 抛错时，回退到普通对象路径，并**跳过 `toJSON` 键本身**——否则 `toJSON` 函数会被列为 `[Function: toJSON]` 留在输出里，且会在递归时再次触发 `toJSON()` 调用

### 关于循环检测的范围

`seen` 表（用于检测循环引用）只对**容器类型**记录：plain object、array、Map、Set、class 实例。

**leaf-like 类型不参与循环检测**：Date / Error / RegExp / Buffer / ArrayBuffer / TypedArray / Promise / WeakMap / WeakSet / DOM 节点 / Window。这些类型在 walker 中直接转成 plain 表示后返回，本身不会再有子节点导致循环。

实际影响：同一个 leaf 引用在多个字段中出现时**各自正常序列化**，不会被误标为 `[Circular]`。例如：

```js
const d = new Date('2026-01-01T00:00:00.000Z');
serialize({ a: d, b: d })
// → { a: '2026-01-01T00:00:00.000Z', b: '2026-01-01T00:00:00.000Z' }
```

而同一个 plain object 在多个字段中出现时，**第二次仍被标为 `[Circular]`**（保守的防御默认，避免 DAG 退化为指数级遍历）：

```js
const shared = { value: 1 };
serialize({ a: shared, b: shared })
// → { a: { value: 1 }, b: '[Circular: $.a]' }
```

### 关于"无 `__type` 标记"

库的输出不留任何反向追溯类型的辅助字段。业务读到的就是纯 plain 数据。这是基于"业务用不到不可克隆类型"这一前提的简化。如果将来某个业务需要追溯，可由业务层在自己的 logger 封装里加 `Object.prototype.toString.call` 等检测。

## 8. 错误处理与上限策略

### 8.1 "永不抛错"的两层

**第一层：预期 lossy 转换 —— 始终静默**

设计目的本身。Function / Symbol / BigInt / Buffer / Promise / WeakMap / DOM / Class 实例 / 上限触发 / Class 实例 plain copy —— 全部静默转占位符，不报错、不 warn。占位符（`[Function: handleClick]` 等）在 logger 里本身就醒目。

**第二层：意外异常 —— 按 `strict` 配置行为**

| 触发 | 含义 |
|---|---|
| Proxy getter 抛错 | 业务代码或第三方库 bug |
| `toJSON()` 抛错 | 业务代码或第三方库 bug |
| adapter 内部 bug | 库自身 bug |
| 总兜底捕获的未知错误 | 库自身或运行时 bug |

| 模式 | 默认 | 行为 |
|---|---|---|
| `strict: true` | 非默认，需显式开启 | 直接 `throw` |
| `strict: false` | 默认（详见架构 §7.2） | 占位符 `"[Unserializable: <reason>]"` + 调用 `onError(reason, path)` |

### 8.2 关键不变量

- **IPC 路径在生产环境永不抛错** —— 通过 `serializeForIpc()` 封装承担（详见架构 §7.2 / §3.3）。业务代码零手动 `{ strict: false }` 传参。
- **`serialize` / `safeStringify` 工具受全局 strict 影响**：业务自己调用时按全局配置走，开发期 strict 暴露真 bug。
- **lossy 转换永远不触发 `onError`**：只有真正的"代码出 bug"才进 onError 通道。

### 8.3 总兜底

最外层 `try/catch`：
- strict=true：rethrow（开发者看到完整 stack）
- strict=false：返回 `"[SerializeError: <msg>]"` + 触发 `onError`

### 8.4 上限触发行为

| 触发 | 表现 |
|---|---|
| 字符串超 `maxStringLength` | 截断到 N，追加 `"...[truncated N chars]"` |
| 数组超 `maxArrayLength` | 截到前 N 项，第 N+1 项放 `"...[truncated N items]"` |
| 对象超 `maxKeys` | 保留前 N 个 key，追加 `"__truncated": "N more keys"` |
| 递归超 `maxDepth` | 当前位置放 `"[MaxDepth]"` |

**绝不**在上限触发时抛错或 warn。业务想知道是否被截断，自己检测 `__truncated` / `[truncated ...]`。

### 8.5 配置优先级

```
调用 serialize(value, opts)
  → opts.maxDepth ?? globalDefaults.maxDepth ?? 32
```

## 9. 测试用例与完成定义

**完成标准**：所有测试用例通过 `npm test`。代码写完不算完成。

### 9.1 测试框架

引入 **vitest** 作为测试框架。选择理由：
- 原生 ESM 与 CJS 双支持，与 rollup 项目契合
- 启动快、watch 模式好用
- API 与 jest 兼容，迁移零成本

新增到 `devDependencies`：`vitest`。`package.json` 增加 `"test": "vitest run"` 与 `"test:watch": "vitest"`。

### 9.2 测试覆盖范围

按测试文件分块（实际共 11 个）：

#### `limits.test.js`（配置 API）
- `DEFAULTS` 常量
- `configureSerializer` 全局配置变更
- `resolveOpts` 三级回退（per-call > global > default），用 `??` 保护 falsy 值

#### `placeholders.test.js`（占位符生成）
- 16 个占位符函数各覆盖核心分支：fn 匿名、Symbol 有无 description、Buffer 优先 byteLength、circular 默认路径 `$`、Number 的 NaN/Infinity/-Infinity、DOM tagName/nodeName 回退、truncated 三种形式

#### `adapters.test.js`（特殊类型识别 + 转换）
- 8 个 type predicates（含 `isWindowLike` 对 throwing getter 的容错）
- Date → ISO 字符串；Invalid Date → `null`
- Error 含子类（TypeError）→ `{ name, message, stack }`；code 仅在定义时出现；cause 通过 recurse 回调
- Map：string-only-keys 转对象、混合 key 转 entries 数组
- Set → 数组
- RegExp → `{ source, flags }`

#### `serializer.test.js`（核心 walker）
- 基础类型：string / number / boolean / null / undefined / NaN / Infinity 各一个用例
- 普通对象、数组、嵌套结构
- 不可序列化类型：function / symbol / bigint / Promise / WeakMap 转占位符
- 特殊类型端到端：Date、Error+cause、Map、Set、RegExp、Buffer、ArrayBuffer、TypedArray
- toJSON 路径：实现了 toJSON 的对象优先用 toJSON 结果；toJSON 抛错时跳过 `toJSON` 键回退到普通对象路径
- Class 实例 → plain copy（不带 `__type`）
- JSON-safety 兜底：包含各种"以前会崩"字段的对象经 serialize 后 `JSON.stringify` 不抛
- 共享 leaf 引用：同一 Date / Error / RegExp / Buffer 在多个字段中应各自序列化，不被误标为 Circular；同一 plain object 在多个字段中第二次仍被标为 Circular（pinned）

#### `real-world.test.js`（真实复杂值组合）

- 文件路径、超长字符串与深层业务对象组合后仍可 `JSON.stringify`
- Buffer、Date、Error/cause、Map、Set、RegExp、TypedArray 按公开转换契约输出
- function、Symbol、BigInt、Promise、WeakMap 与 class 实例混入同一 payload 时永不使 IPC 编码崩溃
- 直接循环、间接循环和共享引用输出稳定占位符
- 不可克隆字段嵌在数组、Map value、Error cause 等真实位置时仍满足 `serializeForIpc` 永不抛错不变量

#### `circular.test.js`（循环引用）
- 直接自引用：`a.a = a`
- 间接循环：`a.b = b; b.a = a`
- 数组中循环
- 循环路径标识正确
- 循环输出经 `JSON.stringify` 不抛

#### `limits-runtime.test.js`（运行时上限触发）
- 字符串超长：截断 + `[truncated N chars]`
- 数组超长：截断 + `[truncated N items]`
- 对象超键：保留前 N + `__truncated`
- 嵌套超深：`[MaxDepth]`
- 配置可覆盖：`opts` 与 `configureSerializer` 均能改默认值；per-call 仍能覆盖全局

#### `never-throw.test.js`（永不抛错）
- Proxy with throwing getter
- `Object.defineProperty(obj, 'x', { get: () => { throw new Error() } })`
- `toJSON: () => { throw new Error() }`
- 抛错 + 循环 + 超深的组合用例
- strict=false 时：返回占位符，调用 onError；lossy 转换不触发 onError
- strict=true 时：rethrow；lossy 转换仍不抛

#### `revive-error.test.js`（preload 端 Error 还原）
- main 抛 TypeError，reviveError 后 `instanceof TypeError === true`
- name / message / stack / code 字段保留
- cause 递归还原
- 未知 name 回退到 `Error` 但保留 `name` 字段
- 落空字符串 / null 输入 → `new Error(String(input))`

#### `service-main.test.js`（Service main 集成）
- handler return 经 `serialize(..., { strict: false })`，封装为 `{ ok: true, data }` 信封返回
- handler 抛 Error：异步与同步路径均返回 `{ ok: false, error: serialize(err) }` 信封，main 端**永不 throw**
- 元通道 `service:getServiceList` 同样使用信封形态

#### `service-preload.test.js`（Service preload 集成）
- invoke / sendSync 入参经 serialize 兜底
- 收到信封后检 `ok` 字段：`true` 返回 `data`；`false` 用 `reviveError(error)` 还原 Error 实例后 throw
- 异步与同步路径解包逻辑完全一致

#### `notice-main.test.js`（Notice 集成）
- broadcast / direct 的 data 经 serialize 兜底（推送通道直传 plain，不走信封）
- 元通道 `notice:getSchema` 使用信封形态
- 测试用临时挂载的用户 schema（M3 不带内置 schema）

### 9.3 完成定义

实现阶段按 TDD：先编写测试用例，再编写实现，最终 `npm test` 全绿。任何一个用例失败 = 任务未完成。

## 10. 不在本次范围

明确排除以下事项，避免范围蔓延：

- ❌ logger 本身（log4js 封装由业务实现）
- ❌ IPC 调用统计 / metrics / tracing
- ❌ 自定义类型 adapter 注册机制（初版克制；将来按需扩展）
- ❌ 自定义 Error 子类的还原（只还原 name/message/stack/code/cause，不还原原型链）
- ❌ Renderer → Preload 方向的 Notice（当前不存在该路径）

