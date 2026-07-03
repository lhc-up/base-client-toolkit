# Toolkit M4：BaseWindow 模块详细设计

> 所属：[Toolkit 总设计](./2026-06-03-toolkit-overview-design.md) 的 M4 模块。

## 落地文件

- 单类文件：`src/enhance/BaseWindow.js`（文件名即类名，无 `index.js`，无子目录）

## 依赖与被依赖

**依赖：**
- electron —— `BrowserWindow`
- lodash.merge —— 深合并 options

**被依赖：** 无（其他模块与 M4 完全解耦）

## 一、定位

M4 BaseWindow 是 toolkit 的 **`BrowserWindow` 抽象基类**——通过模板方法模式 + 生命周期 hooks，让用户用 subclass 形式声明窗口类型、组织窗口生命周期逻辑。

M4 是**纯主端工具**：

- 仅在主进程使用，无 preload / 渲染端代码
- 不涉及 IPC，无依赖 M1 / M2 / M3

> M4 与 IPC 桥接机制及序列化基础层完全解耦，详见架构 §3.6 模块间独立。

- 不管理多窗口集合
- 不向窗口注入 preload（用户在 `getWindowOptions().webPreferences.preload` 自填）
- 仅依赖 Electron `BrowserWindow` + `lodash.merge`（深合并默认 options）

## 二、用户接触面

### 2.1 subclass 写法

```js
const BaseWindow = require('@base-client/toolkit/enhance/BaseWindow');
const path = require('path');

class MainWindow extends BaseWindow {
    // 抽象方法（必须 override）
    getPageUrl() {
        return 'app://main.html';
    }

    // 可选 override（与默认深合并）
    getWindowOptions() {
        return {
            width: 1200,
            height: 800,
            webPreferences: {
                preload: path.join(__dirname, '../preload/main.js'),
            },
        };
    }

    // 可选 hook
    onCreated(window) {
        window.once('ready-to-show', () => window.show());
        window.webContents.on('did-finish-load', () => { /* ... */ });
    }

    // 可选 hook
    onClosed() {
        console.log('main window closed');
    }
}
```

### 2.2 实例化与使用

```js
const main = new MainWindow();
main.create();             // 返回 BrowserWindow 实例

// 窗口生命周期内调用实例方法
main.getId();              // → BrowserWindow.id
main.getWindow();          // → BrowserWindow | null
main.send('foo', data);    // → webContents.send('foo', data)
main.close();
main.isDestroyed();
```

**约定**：

- `create()` 是模板方法，触发完整生命周期（详见 §三）
- `create()` 调用一次有效；调用两次会创建第二个 BrowserWindow 并覆盖 `this.browserWindow`（spec 视为违规，不做防护）
- 子类**仅应** override §4.1 / §4.2 列出的方法；其它 BaseWindow 方法不应被 override

### 2.3 多窗口

BaseWindow 不维护多窗口集合。多窗口管理由业务侧实现：

```js
const windows = new Map();

const main = new MainWindow();
main.create();
windows.set('main', main);

const login = new LoginWindow();
login.create();
windows.set('login', login);

windows.get('main').close();
```

需要按 id 查 BrowserWindow 时直接用 Electron 原生 `BrowserWindow.fromId(id)`。

## 三、`create()` 模板方法流程

```js
create() {
    // 1. 取子类 options
    const userOptions = this.getWindowOptions();

    // 2. 与默认深合并（lodash.merge）
    const mergedOptions = merge(
        { show: false, backgroundColor: '#ffffff' },
        userOptions,
    );

    // 3. 创建 BrowserWindow
    const window = new BrowserWindow(mergedOptions);
    this.browserWindow = window;

    // 4. 绑生命周期 listener
    window.on('closed', () => {
        this.browserWindow = null;
        this.onClosed();
    });

    // 5. 触发 onCreated（用户在此绑 webContents 事件）
    this.onCreated(window);

    // 6. loadURL（先 hook 后 load，确保用户绑的早期事件可被捕获）
    window.loadURL(this.getPageUrl());

    return window;
}
```

**关键决定**：

- **步骤 5 先于步骤 6**：用户在 `onCreated` 里绑的事件（如 `did-start-loading`）保证不因 loadURL 已触发而漏掉。
- **`onClosed` 在 `browserWindow = null` 后触发**：hook 内访问 `this.browserWindow` 已是 null，反映窗口已销毁的真实状态。
- **返回 `BrowserWindow` 实例**——用户若需 BaseWindow 实例自己持有 `this`（一般在 `new MyWindow()` 已持有）。

## 四、API contract

### 4.1 抽象方法（必须 override）

| 方法 | 返回 | 说明 |
|---|---|---|
| `getPageUrl()` | `string` | 窗口加载的 URL；未 override 抛错 `子类必须实现 getPageUrl()` |

### 4.2 可选 override

| 方法 | 返回 | 默认行为 |
|---|---|---|
| `getWindowOptions()` | `object` | 默认返回 `{}`（无额外 options） |
| `onCreated(window)` | `void` | no-op |
| `onClosed()` | `void` | no-op |

### 4.3 实例方法（不应 override）

| 方法 | 返回 | 行为 |
|---|---|---|
| `create()` | `BrowserWindow` | 模板方法；触发完整生命周期（详见 §三） |
| `getWindow()` | `BrowserWindow \| null` | 取 BrowserWindow 实例；窗口关闭后返回 null |
| `getId()` | `number \| undefined` | `browserWindow?.id`；窗口关闭后返回 undefined |
| `close()` | `void` | `browserWindow?.close()`；null 安全 |
| `isDestroyed()` | `boolean` | `browserWindow?.isDestroyed() ?? true`；null 视为已销毁 |
| `send(channel, data)` | `void` | `browserWindow?.webContents.send(channel, data)`；null 安全 |

**关于 `send`**：仅作为 escape hatch（debug / 一次性私下沟通）。日常主→渲染推送请使用 **M3 Notice**——Notice 有 schema 协议、自动序列化、订阅模型，是为推送场景设计的正路；`send` 绕过这些。日常主→渲染推送请使用 Notice —— Notice 有 schema 协议、自动 `serializeForIpc()` 编码、订阅模型，是为推送场景设计的正路（详见架构 §4 核心能力）。

## 五、默认窗口选项

BaseWindow 在 `getWindowOptions()` 返回值之上深合并两条默认：

```js
{
    show: false,
    backgroundColor: '#ffffff',
}
```

**理由**：

- **`show: false`**：防止窗口在内容加载完成前出现白色闪烁；用户在 `onCreated` 里 `window.once('ready-to-show', () => window.show())`（或别的时机）显式 show
- **`backgroundColor: '#ffffff'`**：防止透明 / 默认黑色背景在加载时露出

**不强加 `webPreferences` 默认**：`contextIsolation` / `nodeIntegration` / `sandbox` / `allowRunningInsecureContent` 全部由用户/项目决定。BaseWindow 不持有 security policy 立场。

## 六、模块边界

### 6.1 对外接口

| 方向 | 接口 | 说明 |
|---|---|---|
| 用户主端 → M4 | `require('@base-client/toolkit/enhance/BaseWindow')` | 取得 BaseWindow 类 |
| 用户子类 → M4 | override `getPageUrl` / `getWindowOptions` / `onCreated` / `onClosed` | 声明窗口类型与行为 |
| 用户主端 → M4 实例 | `new MyWindow().create()` / 实例方法（§4.3） | 实例化、生命周期、状态查询 |

### 6.2 对内依赖

| 方向 | 依赖 | 说明 |
|---|---|---|
| M4 → electron | `BrowserWindow` | 创建实际窗口 |
| M4 → `lodash.merge` | 深合并 | 与 `getWindowOptions()` 返回值合并默认 |

### 6.3 M4 不负责

- **preload 路径解析 / 注入**——由用户在 `getWindowOptions().webPreferences.preload` 自填
- **多窗口管理 / registry**——业务自管理；可直接用 Electron 原生 `BrowserWindow.fromId(id)` / `BrowserWindow.getAllWindows()`
- **IPC 桥接**——属 M2 Service / M3 Notice
- **security policy 决策**——`webPreferences` 完全由用户决定

### 6.4 子类约束

子类**仅应** override §4.1 / §4.2 列出的四个方法。`create()` / `getWindow()` / `getId()` / `close()` / `isDestroyed()` / `send()` 是模板与实例方法，override 会破坏模板语义。

## 七、文件结构

```
src/enhance/
└── BaseWindow.js          # 单类文件（文件名即类名，无 index.js）
```

按总设计的入口文件命名约定：**单类导出的增强模块文件名即类名**。`enhance/` 内部组织自由——简单单类直接放 `enhance/<Name>.js`，复杂模块（多文件）可用子目录。`require('@base-client/toolkit/enhance/BaseWindow')` subpath 直接对应该文件。
