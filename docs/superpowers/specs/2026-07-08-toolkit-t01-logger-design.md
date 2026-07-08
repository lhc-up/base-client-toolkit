# Toolkit T-01：capability/logger 设计

> 触发来源：[Toolkit 接入迭代设计](./2026-07-08-toolkit-integration-iteration-design.md) §T-01
> 上位约束：[M5 capability 契约](./2026-06-03-toolkit-m5-capability-contract-design.md)
> 参考实现：`base-client.bake/src/main/libs/logUtil.js`（结构参考，非 copy）

## §1 定位与范围

T-01 logger 是 toolkit `capability/` 命名空间下的一个能力模块，遵循 M5 capability 契约。

- **落地位置**：`src/capability/logger/index.js`（subpath `./capability/logger`）
- **能力形态**：主进程日志能力——分级、控制台+文件双写、按日期滚动、自动压缩、shutdown flush；同时提供 `serviceSchema` 让渲染端通过 Service 桥接调用
- **不做的事**：
  - 不含渲染端本地日志（渲染端错误由业务侧决定是否推到主进程）
  - 不含 remote 日志上报（业务侧组合 downloader / http 自行实现）
  - 不含 multi-category（每个 toolkit 用户只有一个 default logger；如需分文件由业务侧自行 wrap）

## §2 文件结构与导出契约

### 2.1 目录结构

```
src/capability/logger/
└── index.js              # 唯一入口，subpath: ./capability/logger
```

M5 §2.1：capability 以目录组织，`index.js` 强制入口，其他文件按需私有。当前 T-01 只需 `index.js`，无需拆子模块。

### 2.2 导出对象形态

```js
module.exports = {
    // —— 生命周期 ——
    init,           // (opts?) => void
    shutdown,       // () => void

    // —— 6 级日志方法（与 serviceSchema.handlers 引用同一份函数）——
    trace,
    debug,
    info,
    warn,
    error,
    fatal,

    // —— Schema 声明（供 Service.init 挂载）——
    serviceSchema,
};
```

### 2.3 副作用契约

- `require('.../capability/logger')` **零副作用**——不 configure log4js、不写文件、不注册 IPC（M5 §2.4）
- 顶层 `let state = null`（模块内私有状态），init 前 6 级方法访问 state 触发 throw
- log4js 的 `require` 也**延迟到 init 时刻**（`init` 内部 `const log4js = require('log4js')`），避免模块加载即 fail-fast——这样 peerDep 未装时错误在 init 时才抛，语义清晰

### 2.4 M5 契约对齐

- 目录名 `logger` = `serviceSchema.namespace = 'logger'`（M5 §2.3）
- `serviceSchema.handlers.info === module.exports.info`（同一份函数引用；M5 §2.2 "一份实现三种用法"）
- 无 `noticeSchema`（logger 无需渲染端订阅事件；M5 §2.2 允许 service/notice 只存在一个）
- 保留字 `serviceSchema` 未被作为 API 方法名占用（M5 §2.2）

## §3 init 语义与配置项

### 3.1 签名

```js
Logger.init(opts?: { logDir?: string }): void
```

**opts 字段（本轮仅此一项）**：

| 字段 | 类型 | 必填 | 默认 | 语义 |
|---|---|---|---|---|
| `logDir` | string | 否 | `path.join(app.getPath('userData'), 'Logs')` | 日志文件落盘目录（绝对路径） |

其它 log4js 细节（滚动大小、backup 数、pattern 等）本轮**不开放为 opts**——用 §7 的固定默认值。将来若业务确有需求，向后兼容加字段即可。

### 3.2 init 内部行为

1. `require('log4js')`——peerDep 未装则此时抛 `Cannot find module 'log4js'`，语义清晰
2. `require('electron').app.getPath('userData')` 解析默认 `logDir`（当 opts 未传时）
3. `fs.mkdirSync(logDir, { recursive: true })` 确保目录存在（不引 fs-extra 新依赖，用 Node 内建 fs）
4. `log4js.configure({...})` 用 §7 默认配置装载 console + dateFile 双 appender
5. 内部 state 从 `null` 变为 `{ log4js, logger: log4js.getLogger(), isDev }`

### 3.3 生命周期规则

| 场景 | 行为 |
|---|---|
| 首次 init | 正常配置，state 从 null 变为对象 |
| 重复 init | throw `'[toolkit/logger] Logger already initialized'`。业务应保证生命周期只 init 一次；避免运行中静默重配导致的日志目录漂移 |
| init 前调用 6 级方法 | throw `'[toolkit/logger] Logger not initialized'` |
| init 前调用 shutdown | throw `'[toolkit/logger] Logger not initialized'` |
| shutdown() | 内部调用 `log4js.shutdown()` flush，同步返回。**不重置 state**——shutdown 后再次 init 仍抛 already initialized |
| shutdown 后调用 6 级方法 | 不额外拦截，透传给 log4js（其行为由 log4js 决定，一般是 no-op 或写不进）；业务侧不应在 shutdown 后继续调用 |

若业务真需要"关闭并重开"，未来加 `Logger.reinit(opts)` 而不放松 already initialized 检查（本轮 YAGNI）。

### 3.4 错误信息约定

`Error` 实例的 `message` 全部以 `[toolkit/logger] ` 前缀开头，便于定位。此约定仅限 T-01 使用，不形成公共规则。

## §4 API 规格

### 4.1 6 级方法签名

```js
Logger.trace(msg, ...args): void
Logger.debug(msg, ...args): void
Logger.info (msg, ...args): void
Logger.warn (msg, ...args): void
Logger.error(msg, ...args): void
Logger.fatal(msg, ...args): void
```

- 均返回 `void`
- init 前调用 → throw `'[toolkit/logger] Logger not initialized'`（§3.3）

### 4.2 dev 门控（trace/debug 专属）

- `trace` / `debug` 内部：`if (state.isDev) state.logger.trace/debug(...)`；非 dev 时直接 `return`
- **`isDev` 在 init 时快照一次**：`state.isDev = process.env.NODE_ENV === 'development'`（与 bake `const isDev = ...` 顶层求值等价语义）
- 运行时改 `NODE_ENV` 不生效——业务侧对此有明确约定；如需运行时切换将来加 `Logger.setLevel(level)`（本轮 YAGNI）

### 4.3 参数预处理（内部私有 `serialize(...args)` 函数，6 级方法共用）

处理流程作用于每个方法的所有实参（含 `msg`）：

1. **Error 展开**：
   - `err.stack` 已含 `err.message` → 只 push `stack`
   - 否则 push `message` 再 push `stack`
2. **Object 序列化**：
   - 优先 `JSON.stringify(v)`
   - 循环引用等抛错时 fallback 到 `util.inspect(v, { depth: 4, breakLength: Infinity })`
3. **其他类型**：透传

> **fallback 相较 bake 的改进**：bake 的 fallback 是 `return v`——直接传给 log4js 变 `[object Object]`，可读性差。`util.inspect` 是 Node 内置，能处理循环引用、Buffer、Map，无新依赖。

### 4.4 shutdown

```js
Logger.shutdown(): void
```

- 内部 `state.log4js.shutdown()`，同步返回
- log4js 的 shutdown 会 flush 所有 pending 写入（dateFile appender 的 buffer）
- init 前调用 → throw（§3.3）

## §5 serviceSchema 定义

```js
const serviceSchema = {
    namespace: 'logger',
    handlers: {
        trace,
        debug,
        info,
        warn,
        error,
        fatal,
    },
    // 无 sync：写日志不需要返回值，全部 async
    // 无 needsEvent：logger 方法不需要感知调用来源窗口
};
```

### 5.1 约束对齐

- `handlers.info === module.exports.info`（同一份函数引用；M5 §2.2 "一份实现三种用法"）
- `namespace: 'logger'` 与目录名一致（M5 §2.3）
- 无 sync：写日志不需要返回值，全 async 走 M2 Service 的 async 通道
- 无 needsEvent：logger 方法不需要感知调用来源窗口

### 5.2 渲染端接触面

用户在业务侧 `Service.init({ userSchemas: [logger.serviceSchema] })` 后自动可用：

```js
window.appService.logger.info('user clicked', { userId: 42 });
window.appService.logger.error('render failed', new Error('...'));
```

### 5.3 跨进程语义

- 渲染端 `info(msg, ...args)` → M1 serializer 序列化 → IPC → 主进程 handler 收到 revive 后的原生对象（Error 实例、object 等）
- 主进程 handler 内部再走 §4.3 预处理 → log4js 写入
- **同一份 `info` 函数**在主进程直接调用、在渲染端经 IPC 调用，行为一致——Error 展开 / object 序列化都发生在主进程侧
- 未初始化时渲染端调用：主进程 handler throw → M2 Service 通过 `serialize(err)` 回传信封 `{ ok: false, error: ... }` → 渲染端 `await` 抛错。行为符合 M2 契约。

### 5.4 无 noticeSchema

logger 无需要广播的事件；M5 §2.2 允许 service/notice 只存在一个。

## §6 依赖策略（仅对 T-01 生效，不作为公共规则）

### 6.1 package.json 变更

```jsonc
{
    "peerDependencies": {
        "electron": ">=15.0.0",
        "log4js": ">=6 <7"
    },
    "peerDependenciesMeta": {
        "log4js": { "optional": true }
    }
}
```

- **peerDependency**：版本控制权归业务侧，避免 toolkit 锁死影响 Electron/Node 兼容
- **optional: true**：使用 logger 的业务需显式装 log4js；不用 logger 的业务不受影响、无警告噪音
- **范围 `>=6 <7`**：log4js 6.x 已稳定 3 年+；toolkit 代码只用 6.x 稳定 API 面（`configure` / `getLogger` / `shutdown`），不追逐 7.x 未来重构

### 6.2 版本兼容说明

- log4js 6.x 要求 Node ≥ 8，为**纯 JavaScript 包**（无 native 模块 → 不会因 Electron 版本触发 rebuild）
- Electron 12+ 内置 Node 14+ 均满足，覆盖当前所有主流 Electron 版本
- 若业务未来需切换 winston / pino，toolkit 不阻塞——但需业务侧自行 fork logger capability 或不用 logger 走自建

### 6.3 未装 log4js 时的错误路径

- `require('.../capability/logger')` 本身**成功**（模块顶层不 require log4js，符合 M5 §2.4 副作用约束）
- `Logger.init()` 内部 `require('log4js')` 时抛 Node 原生错误 `Cannot find module 'log4js'`
- toolkit 不额外包装此错误——Node 原生信息已能明确指引业务侧 `npm i log4js`

### 6.4 与迭代文档 §7 的关系

若未来 log4js peerDep 演化产生显著独立版本节奏，或 logger 稳定 3 个月+ 有独立发布诉求，触发迭代文档 §7 拆包——彼时 `@base-client/toolkit-logger` 或 `@base-client/logger` 独立发包，toolkit 主包保留 subpath 别名代理（迭代文档 §7.3 兼容策略）。**本轮不落地拆包动作**。

## §7 log4js 底层默认配置

### 7.1 configure 内容（照搬 bake，仅 filename 参数化）

```js
log4js.configure({
    appenders: {
        console: {
            type: 'console',
            layout: {
                type: 'pattern',
                pattern: '[%[%d{yyyy-MM-dd hh:mm:ss}%]] [%[%p%]] - %m%n',
            },
        },
        logs: {
            type: 'dateFile',
            filename: path.join(logDir, 'log'),   // ← 唯一动态参数
            fileNameSep: '-',
            pattern: 'yyyy-MM-dd.log',
            alwaysIncludePattern: true,
            layout: {
                type: 'pattern',
                pattern: '[%d{yyyy-MM-dd hh:mm:ss.SSS}] [%p] - %m',
            },
            compress: true,
            maxLogSize: '100K',
            numBackups: 20,
        },
    },
    categories: {
        default: {
            appenders: ['console', 'logs'],
            level: 'trace',
        },
    },
});
```

### 7.2 配置项来源

| 配置项 | 值 | 来源 |
|---|---|---|
| console.layout.pattern | `[%[%d{yyyy-MM-dd hh:mm:ss}%]] [%[%p%]] - %m%n` | 照搬 bake（`%[...%]` 是 log4js 的颜色标记） |
| logs.filename | `<logDir>/log` | `logDir` 由 §3 决定，其余照搬 bake 的 `getLogPath('log')` |
| logs.pattern | `yyyy-MM-dd.log` | 照搬 bake |
| logs.maxLogSize | `100K` | 照搬 bake（**注**：偏小，业务量大时会频繁滚动；本轮不改，将来若业务反馈可加 `opts.maxLogSize`） |
| logs.numBackups | `20` | 照搬 bake |
| logs.compress | `true` | 照搬 bake |
| categories.default.level | `'trace'` | 照搬 bake；toolkit 侧 trace/debug 的 dev 门控在 §4.2 的方法内 `if (isDev)` 完成，log4js 层 level 全开 |

### 7.3 不作为 opts 暴露的原因

pattern / rotation / backup 等细节本轮不开放 opts——保持 API 表面最小，避免过度设计。若将来业务反馈某项确有配置需求，向后兼容加字段即可。

## §8 测试策略

### 8.1 测试栈 & 布局

- 沿用现有 vitest（`package.json` scripts.test）
- 测试文件位置：`tests/capability/logger/*.test.js`（对齐 `tests/capability/example/` 布局）

### 8.2 测试分文件

| 测试文件 | 覆盖点 |
|---|---|
| `subpath-export.test.js` | `require('@base-client/toolkit/capability/logger')` 能通（通过本地路径解析） |
| `exports.test.js` | 顶层导出对象含 `init` / `shutdown` / `trace` / `debug` / `info` / `warn` / `error` / `fatal` / `serviceSchema`；均为对应类型 |
| `no-side-effects.test.js` | 顶层 `require` 时**不**触发 `log4js.configure`、**不**触发 `fs` 写入、**不**触发 `electron.app` 访问（用 spy 验证） |
| `schema-shape.test.js` | `serviceSchema.namespace === 'logger'`；`handlers` 键集合 = 6 级方法；`handlers.info === exports.info`（同一份引用）；不定义 sync / needsEvent；无 noticeSchema。可 delegate 到 M2 `validateServiceSchema` |
| `init-lifecycle.test.js` | init 前 6 级方法 throw；init 前 shutdown throw；init 成功后可调；**重复 init throw**；shutdown 后不重置 state（再 init 仍 throw） |
| `init-config.test.js` | 未传 opts 使用 `<userData>/Logs`（mock `electron.app.getPath`）；传 `{ logDir }` 使用指定路径；`fs.mkdirSync` 被以 recursive 调用 |
| `serialize.test.js` | Error（stack 含 message → 只 push stack；stack 不含 → push message + stack）；plain object → JSON.stringify；循环引用 → fallback `util.inspect`；string / number / boolean / undefined 透传 |
| `dev-gating.test.js` | `NODE_ENV=development` 时 trace/debug 调 log4js；非 dev 时 trace/debug 静默（log4js spy 无调用）；**isDev 在 init 时快照**（init 后改 `process.env.NODE_ENV` 不生效） |

### 8.3 mock 策略

- **electron**：`vi.mock('electron', () => ({ app: { getPath: vi.fn() } }))`
- **log4js**：`vi.mock('log4js', () => ({ configure: vi.fn(), getLogger: vi.fn(() => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() })), shutdown: vi.fn() }))`
- **fs**：不 mock 整个 fs，仅 spy `fs.mkdirSync`

### 8.4 不做的测试

- log4js 自身滚动 / 压缩 / dateFile 行为——属 log4js 上游测试范围，toolkit 只验"配置对象被正确构造并传入 configure"
- peerDep 未装的错误路径——集成层已足够清晰（`Cannot find module 'log4js'` 是 Node 原生错误），单测 mock 无意义
- 真实文件系统写入——测试环境用 mkdirSync mock 验证调用即可

## §9 与其他 spec 的关系

### 9.1 上游引用

| 依赖 | 引用点 | 说明 |
|---|---|---|
| M5 capability 契约（`2026-06-03-toolkit-m5-capability-contract-design.md`） | 全篇结构约束 | 目录 / 入口 / 导出形态 / 副作用零依赖等 |
| M2 Service（`2026-06-03-toolkit-m2-service-design.md`） | §5 serviceSchema 形态 | `namespace` / `handlers` / async 通道语义均由 M2 定义 |
| 迭代文档（`2026-07-08-toolkit-integration-iteration-design.md`）§T-01 | §1 触发来源 | 本 spec 的立项来源与产物归属 |
| 参考项目 `base-client.bake` `src/main/libs/logUtil.js` | §4 / §7 | 结构参考，非 copy |

### 9.2 下游影响

- **T-02 ~ T-07 其他 capability spec**：可参照本文的结构（§1 定位 / §2 导出契约 / §3 init 语义 / §4 API / §5 schema / §6 依赖 / §7 底层配置 / §8 测试）作为模板。**但依赖策略部分（§6）不作为公共规则**——每个 capability 单独判断（本 spec 已明确写入 §6.1）。
- **迭代文档 §7 拆包演化**：若 log4js / logger 未来独立发包，本 spec 的 §6 是拆包决策的直接输入。
- **`TODOs.md`**：按迭代文档 §6 合并规则，追加一行：`[T-01 接入] logger capability spec 已完成，plan 待启动`。

### 9.3 未来待观察（未列入本轮实现，仅记录）

- `maxLogSize: 100K` 偏小，业务量大时高频滚动——若接入沙盘反馈，加 `opts.maxLogSize`
- shutdown 后 reinit 需求——若真实业务需要，加 `Logger.reinit(opts)`，不放松 §3.3 的 already initialized 检查
- 多 category（`getLogger('name')`）需求——若多个业务子系统需分文件，考虑向后兼容加 `Logger.getLogger(category)`；本轮不做
- 渲染端调用未 init 的 logger 错误呈现——现设计走 M2 Service 的 error 信封回传，业务侧需 `try { await window.appService.logger.info(...) } catch { ... }`；是否加"init 前渲染端调用静默丢弃"的宽松策略，观察沙盘反馈
