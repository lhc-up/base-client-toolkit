# Toolkit M5：capability 命名空间接入约定 + 参考示例

> 所属：[Toolkit 总设计](./2026-06-03-toolkit-overview-design.md) 的 M5 模块。

## 一、定位

M5 是 toolkit 的 **capability 命名空间标准接入约定**——定义主端能力模块的物理结构、导出形态、命名约定、副作用约束、挂载路径，并附一份最小可参照的参考示例（`capability/example/`）。后续具体能力（logger / store / system / os 等）按本约定接入 `capability/` 命名空间。

M5 本身**不含 IPC 桥接逻辑**——它复用 M2 Service 与 M3 Notice 的 protocol：capability 模块的 `serviceSchema` 形态由 M2 protocol 定义，`noticeSchema` 形态由 M3 protocol 定义。capability 实现者无须了解 IPC 通道命名等内部细节，只需遵循 M2 / M3 暴露的 schema 形态。

## 二、契约

### 2.1 物理结构

每个 capability 模块以**目录形态**组织：

```
src/capability/<name>/
└── index.js              # 入口（强制）
```

- 入口固定为 `index.js`，subpath export 形态为 `./capability/<name>` → `dist/capability/<name>/index.js`
- 内部其他文件（utils、tests、子模块）由 capability 实现者按需添加，不对外暴露
- 目录名 `<name>` 与该 capability 的 schema namespace **应当一致**（toolkit 不强制运行时校验，但偏离会让用户接触面失去直觉对齐）

### 2.2 标准导出形态

`index.js` 必须导出一个对象，形态如下：

```js
module.exports = {
    // —— 直接 API 方法（任意多个）—— 供主端直接调用 ——
    methodA,
    methodB,
    ...

    // —— 可选 schema 字段 —— 供用户 mount 到 Service / Notice ——
    serviceSchema: {            // 形态由 M2 Service 定义（§2.1）
        namespace: '<name>',
        handlers: { ... },
        sync?: [...],
        needsEvent?: [...],
    },
    noticeSchema: {             // 形态由 M3 Notice 定义（§2.1）
        namespace: '<name>',
        events: [...],
    },
};
```

**约束**：

- `serviceSchema` 与 `noticeSchema` **应至少存在一个**（M5 文档级约束，运行时不强制校验）——否则该 capability 无法暴露给渲染端，沦为纯主端工具，正确归宿应是 `enhance/` 而非 `capability/`
- 若两个 schema 都定义，二者 `namespace` 应当一致
- `serviceSchema.handlers` 中的函数引用**应与顶层 API 方法引用同一份函数**（"一份函数实现，三种用法"——主端直接调用 / 经 Service 暴露给渲染端 async / 经 Service 暴露给渲染端 sync）
- 保留字 `serviceSchema` / `noticeSchema` **不可作为 API 方法名**

### 2.3 命名约定

- 目录名（subpath name）= `serviceSchema.namespace` = `noticeSchema.namespace` 三者保持一致
- 入口文件遵循总设计的命名约定：单侧入口模块用 `index.js`（与 `shared/serializer/` 一致）

### 2.4 副作用约束（`require` 零副作用）

capability 模块在被 `require()` 时**不得产生任何副作用**：

- 不得读写文件系统
- 不得发起网络请求
- 不得注册 IPC channel
- 不得修改全局状态
- 不得 `require` Service / Notice

所有副作用必须在用户**显式调用 API 方法或 `Service.init` / `Notice.init` 挂载 schema** 时才发生。

→ 这意味着 capability 模块**零依赖** Service / Notice：它们只导出 schema **描述对象**（plain data + function references），不持有 Service / Notice 的引用。是否真注册由用户决定。

### 2.5 与 M2 / M3 protocol 的关系

`serviceSchema` 字段形态、可选 opt-in 列表（`sync` / `needsEvent`）、handler 调用语义——全部由 [M2 Service 详细设计](./2026-06-03-toolkit-m2-service-design.md) 定义，M5 不重复。

`noticeSchema` 字段形态、事件命名规则——全部由 [M3 Notice 详细设计](./2026-06-03-toolkit-m3-notice-design.md) 定义，M5 不重复。

capability 实现者写 schema 时**直接对照 M2 / M3 spec**。

## 三、用户接触面

### 3.1 主端直接使用（API 方法）

```js
const example = require('@base-client/toolkit/capability/example');

console.log(example.echo('hello'));   // 'hello'
```

### 3.2 主端挂载 schema 到 Service / Notice

**单 capability**：

```js
const Service = require('@base-client/toolkit/service');
const Notice  = require('@base-client/toolkit/notice');
const example = require('@base-client/toolkit/capability/example');

Service.init({ userSchemas: [example.serviceSchema] });
Notice.init({  userSchemas: [example.noticeSchema] });
```

**多 capability（推荐写法）**：

```js
const example = require('@base-client/toolkit/capability/example');
const logger  = require('@base-client/toolkit/capability/logger');   // 未来
const store   = require('@base-client/toolkit/capability/store');    // 未来

const capabilities = [example, logger, store];

Service.init({ userSchemas: capabilities.map(c => c.serviceSchema).filter(Boolean) });
Notice.init({  userSchemas: capabilities.map(c => c.noticeSchema).filter(Boolean)  });
```

`filter(Boolean)` 自动跳过 capability 中未定义的 schema（仅有 service 或仅有 notice 的情况）。

### 3.3 Preload 装配（同 M2 / M3）

```js
require('@base-client/toolkit/preload').init();
```

聚合入口装配 `appService` / `appNotice`——capability 已挂载的 schema 自动出现在这两个对象上，无须额外配置。

### 3.4 渲染端访问

```js
// service schema 暴露的方法
const result = await window.appService.example.echo('hello');
const sync   = window.appService.example.echoSync('hello');

// notice schema 暴露的事件
const off = window.appNotice.example.tick.on(data => {
    console.log('tick at', data.ts);
});
```

接触面的具体语义（async / sync 通道、信封解包、on/once/off）由 M2 / M3 决定，capability 仅提供 schema 描述。

## 四、参考示例（`capability/example`）

### 4.1 完整代码

```js
// src/capability/example/index.js

// —— API 实现 ——
const echo = (message) => message;

// —— Schema 声明 ——
const serviceSchema = {
    namespace: 'example',
    handlers: {
        echo,            // 与顶层 API 同一份函数引用
    },
    sync: ['echo'],      // echo 同时支持 sync 调用
};

const noticeSchema = {
    namespace: 'example',
    events: ['tick'],
};

module.exports = {
    echo,                // 直接 API
    serviceSchema,       // 供 Service 挂载
    noticeSchema,        // 供 Notice 挂载
};
```

要点：

- **`echo` 在三处出现**——顶层导出（主端直接用）、`serviceSchema.handlers.echo`（IPC 异步通道）、`sync: ['echo']`（IPC 同步通道）。三处指向**同一份函数引用**。
- **零副作用** —— `require` 该模块只产生上述对象，不触发任何 IPC 注册 / IO。
- **零依赖 Service / Notice** —— 文件顶部无 `require('@base-client/toolkit/service')` 等。

### 4.2 接入示例（主端）

```js
const Service = require('@base-client/toolkit/service');
const Notice  = require('@base-client/toolkit/notice');
const example = require('@base-client/toolkit/capability/example');

Service.init({ userSchemas: [example.serviceSchema] });
Notice.init({  userSchemas: [example.noticeSchema]  });

// 主端直接调用
console.log(example.echo('main side'));   // 'main side'

// 主端推送 notice 事件（在业务合适时机）
Notice.broadcast('example.tick', { ts: Date.now() });
```

### 4.3 接入示例（渲染端）

```js
// 异步通道
const text = await window.appService.example.echo('renderer side');

// 同步通道（由 schema 的 sync: ['echo'] 启用）
const sync = window.appService.example.echoSync('renderer side');

// 订阅 notice 事件
const off = window.appNotice.example.tick.on(data => {
    console.log('tick at', data.ts);
});
```

## 五、模块边界

### 5.1 契约接口（capability 实现者 vs M5）

| 方向 | 接口 | 说明 |
|---|---|---|
| capability 实现者 → M5 | 按 §2.2 形态导出对象 | 物理结构 / 命名 / 副作用约束三件套 |
| 用户消费者 → M5 | `require('@base-client/toolkit/capability/<name>')` | 取得 capability 导出对象 |
| 用户消费者 → M2 / M3 | `Service.init({ userSchemas: [cap.serviceSchema] })` 等 | 挂载到桥接机制 |

### 5.2 capability 模块的依赖约束

capability 模块自身**可以依赖**：

- Node 内建模块（`fs` / `path` / 等）
- Electron API（按业务需要）
- 第三方包
- 视情况依赖 M1 `shared/serializer`（如内部需要某种序列化，通常不需要）

capability 模块**不得依赖**：

- M2 Service
- M3 Notice
- 其它 capability 模块

### 5.3 M5 不负责

- **IPC channel 注册 / 编解码** —— 属 M2 / M3 在用户挂载 schema 时处理
- **渲染端 API 动态构建** —— 属 M2 / M3 preload 端处理
- **capability 模块的内部组织** —— 实现者自定，M5 仅约束对外契约
- **capability 之间的关系协调** —— capability 互相独立，相互间通过用户主端业务代码协调

## 六、文件结构

```
src/capability/
└── example/
    └── index.js          # 参考示例（见 §4.1）

# 未来 capability 按相同结构追加：
# ├── logger/
# │   └── index.js
# ├── store/
# │   └── index.js
# └── ...
```

`src/capability/` 下**不设 `index.js` 聚合入口**——每个 capability 通过 subpath 独立 require，符合"严格按需引入"。
