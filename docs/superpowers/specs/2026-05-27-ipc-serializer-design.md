# IPC 数据序列化器设计

**日期**：2026-05-27
**项目**：`@base-client/toolkit`
**目标**：统一处理主进程 / 渲染进程间 IPC 数据传递，避免不可克隆数据导致 Electron 报错；同时提供 logger 友好的序列化工具。

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
      __tests__/
        serializer.test.js
        adapters.test.js
        limits.test.js
        circular.test.js
        never-throw.test.js
        revive-error.test.js
        ipc-integration.test.js
  service/index.js      - 主进程，handler return 值和抛错经 serialize
  notice/index.js       - 主进程，broadcast/direct 的 data 经 serialize
  preload/service.js    - invoke / sendSync 的 args 经 serialize
  preload/notice.js     - 目前仅接收，暂无清洗点（保留位置以备扩展）
```

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
  - `strict`：默认 `process.env.NODE_ENV !== 'production'`
  - `onError(reason, path)`：意外异常的回调钩子

#### `safeStringify(value, opts?) → string`

等价于 `JSON.stringify(serialize(value, opts))`，便利方法。永不抛错。

#### `configureSerializer(defaults)`

全局配置默认值。库初始化时调一次，之后所有内部 IPC 清洗和工具调用按新默认。业务在 `serialize(value, { ... })` 中传 opts 可临时覆盖。

### 5.2 IPC 自动清洗（无新 API，行为变更）

- `Service.registerService` 内部：handler return 值 / 抛出的 Error 自动 `serialize`
- `Notice.broadcast` / `Notice.direct` 内部：`data` 自动 `serialize`
- `appService[ns][handler](...args)` 同步与异步：`args` 自动 `serialize`

业务代码零修改。

### 5.3 错误对象处理收编

替换 `service/index.js` 当前手写的 `__ipcError` 逻辑：

- main 端 handler 抛错时，统一走 `serialize(err)` 产生 `{ name, message, stack, code?, cause? }`
- 异步路径：包成新 Error 抛出（message 是 JSON.stringify 后的 serialized err）
- 同步路径：`event.returnValue = { __ipcError: true, ...serialized }`
- preload 端通过 `reviveError(serialized)` 把数据还原为 Error 实例
- 渲染进程业务侧 `catch` 拿到的是真正的 Error 实例

## 6. 数据流

四条路径覆盖全部 IPC 场景。每条路径最多两次 `serialize`，分别在不同进程。

### 路径 ① Service 异步（renderer → main → renderer）

```
[renderer 业务] appService.foo.bar(rawArgs)
   │
[preload/service.js]
   const safeArgs = serialize(rawArgs)         ◄── 清洗点 A：入参
   ipcRenderer.invoke('foo:bar', ...safeArgs)
   │
[main: service/index.js]
   try { result = await handler(...safeArgs, event) }
     └── return serialize(result)              ◄── 清洗点 B：出参
   catch (err) { throw new Error(JSON.stringify(serialize(err))) }
                                                ◄── 清洗点 C：错误
   │
[renderer] invoke promise resolve / reject (reviveError)
```

### 路径 ② Service 同步（`sendSync`）

```
[preload] const safeArgs = serialize(rawArgs)
          ipcRenderer.sendSync(syncChannel, ...safeArgs)
[main]    try { result = handler(...) }
            ├── event.returnValue = serialize(result)
          catch (err)
            └── event.returnValue = { __ipcError: true, ...serialize(err) }
[preload] 收到后检查 __ipcError，命中则 reviveError + throw
```

### 路径 ③ Notice 广播（main → renderers）

```
[main] broadcast(event, rawData) / direct(event, winId, rawData)
       const safeData = serialize(rawData)     ◄── 清洗点 D
       win.webContents.send('notice:event', event, safeData)
```

### 路径 ④ schema 查询

```
[main] event.returnValue = serialize(getServiceList())  ◄── 清洗点 E
       event.returnValue = serialize(getSchema())        ◄── notice 端同理
```

防御性清洗，确保未来 schema 扩展出非 plain 字段时不会崩。

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
- `toJSON()` 抛错时，回退到普通对象路径，不让一次抛错污染整个序列化

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
| `strict: true` | 开发期默认（`NODE_ENV !== 'production'`） | 直接 `throw` |
| `strict: false` | 生产期默认 | 占位符 `"[Unserializable: <reason>]"` + 调用 `onError(reason, path)` |

### 8.2 关键不变量

- **IPC 路径在生产环境永不抛错**：库内部调用 serializer 时硬编码 `strict: false`，不受全局 strict 配置影响。生产环境无论怎样不会因序列化失败让 IPC 崩。
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

按测试文件分块：

#### `serializer.test.js`（核心）
- 基础类型：string / number / boolean / null / undefined / NaN / Infinity 各一个用例
- 普通对象、数组、嵌套结构
- 不可序列化类型：function / symbol / bigint / Promise / WeakMap 转占位符
- toJSON 路径：实现了 toJSON 的对象优先用 toJSON 结果
- 深拷贝隔离：修改输出不影响输入

#### `adapters.test.js`（特殊类型）
- Date → ISO 字符串
- Error 含子类（TypeError、RangeError）→ `{ name, message, stack }`
- Error.cause 递归 serialize
- Map：string-key 转对象、混合 key 转 entries 数组
- Set → 数组
- RegExp → `{ source, flags }`
- Buffer / ArrayBuffer / TypedArray → 长度字符串（不打印内容）
- Class 实例 → plain copy（不带 __type）
- DOM 节点（renderer 端用 jsdom 环境验证）

#### `limits.test.js`（防御上限）
- 字符串超长：截断 + `[truncated N chars]`
- 数组超长：截断 + `[truncated N items]`
- 对象超键：保留前 N + `__truncated`
- 嵌套超深：`[MaxDepth]`
- 配置可覆盖：通过 `opts` 和 `configureSerializer` 均能改默认值

#### `circular.test.js`（循环引用）
- 直接自引用：`a.a = a`
- 间接循环：`a.b = b; b.a = a`
- 数组中循环
- 循环路径标识正确：`[Circular: $.a.b]`

#### `never-throw.test.js`（永不抛错）
- Proxy with throwing getter
- `Object.defineProperty(obj, 'x', { get: () => { throw new Error() } })`
- `toJSON: () => { throw new Error() }`
- 抛错 + 循环 + 超深的组合用例
- strict=false 时：返回占位符，调用 onError
- strict=true 时：rethrow

#### `revive-error.test.js`（错误还原）
- main 抛 TypeError，preload reviveError 后 `instanceof Error === true`
- name / message / stack / code 字段保留
- cause 嵌套还原

#### `ipc-integration.test.js`（集成）
- mock `ipcMain.handle` / `ipcRenderer.invoke`
- handler return 各种"以前会崩"的值（含函数、循环、Date、Map），渲染端收到 plain 数据
- handler 抛 Error，渲染端 reviveError 拿到 Error 实例
- `broadcast(data)` 中包含不可克隆字段时不抛、渲染端收到清洗后数据
- 同步路径（sendSync）覆盖

### 9.3 完成定义

实现阶段按 TDD：先编写测试用例，再编写实现，最终 `npm test` 全绿。任何一个用例失败 = 任务未完成。

## 10. 不在本次范围

明确排除以下事项，避免范围蔓延：

- ❌ logger 本身（log4js 封装由业务实现）
- ❌ IPC 调用统计 / metrics / tracing
- ❌ 自定义类型 adapter 注册机制（初版克制；将来按需扩展）
- ❌ 自定义 Error 子类的还原（只还原 name/message/stack/code/cause，不还原原型链）
- ❌ Renderer → Preload 方向的 Notice（当前不存在该路径）

## 11. 迁移影响

### 11.1 删除的依赖

- `@ungap/structured-clone` —— 不再使用
- `lodash.isfunction` —— 一行 `typeof === 'function'` 替代

### 11.2 修改的代码

- `src/service/index.js`：
  - 删除当前 init 函数里的实验代码（39-47 行的 `serialize` 调试）
  - 在 `ipcMain.handle` 和 `ipcMain.on(syncChannel)` 包装层加 serialize
  - 收编 `__ipcError` 生成逻辑到统一序列化
- `src/preload/service.js`：在 invoke / sendSync 调用前 serialize args；增加 reviveError 处理
- `src/notice/index.js`：在 `broadcast` / `direct` 中 serialize data；schema 查询返回前 serialize
- `src/preload/notice.js`：暂无修改（仅接收数据）
- `src/shared/index.js`：导出 serializer 模块
- `package.json`：删除两个旧依赖，新增 vitest 到 devDependencies；新增 test 脚本
- `rollup.config.mjs`：无需修改。rollup 已配置 `chunkFileNames`，当 main 和 preload 同时引用 serializer 时会自动产出共享 chunk

### 11.3 API 兼容

`@base-client/toolkit` 当前 `version: 0.0.1`，未发布，无外部使用者。本次变更不需要兼容旧 API。
