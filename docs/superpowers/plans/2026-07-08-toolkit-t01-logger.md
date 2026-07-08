# Toolkit T-01 Logger Capability 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `src/capability/logger/` 下实现符合 M5 契约的主进程日志能力：6 级日志方法 + init/shutdown 生命周期 + serviceSchema 暴露给渲染端；底层封装 log4js（作为 optional peerDependency）。

**Architecture:** 单文件 `index.js` 顶层导出 `init/shutdown/6 级方法/serviceSchema`；模块级私有 `let state = null`，init 前 6 级方法访问触发 throw；log4js 与 electron 均延迟到 `init` 内 `require`（保 M5 §2.4 副作用零依赖）；serviceSchema.handlers 与顶层方法引用同一份函数。

**Tech Stack:** JavaScript (Node CommonJS)、log4js 6.x（peerDep）、Electron `app.getPath('userData')`、Vitest（`npm test` → `vitest run`）。

**参考 spec：** `docs/superpowers/specs/2026-07-08-toolkit-t01-logger-design.md`

**参考模板：** `src/capability/example/index.js` + `tests/capability/example/*.test.js`

---

## 文件结构

**创建：**
- `src/capability/logger/index.js` — logger capability 唯一实现文件
- `tests/capability/logger/subpath-export.test.js` — subpath 与目录物理结构
- `tests/capability/logger/exports.test.js` — 顶层导出形态
- `tests/capability/logger/no-side-effects.test.js` — M5 §2.4 副作用契约
- `tests/capability/logger/schema-shape.test.js` — serviceSchema 形态 + 无 noticeSchema
- `tests/capability/logger/init-lifecycle.test.js` — init/shutdown 生命周期
- `tests/capability/logger/init-config.test.js` — logDir 默认与自定义
- `tests/capability/logger/serialize.test.js` — 参数预处理（Error/object/循环引用）
- `tests/capability/logger/dev-gating.test.js` — trace/debug 的 isDev 门控

**修改：**
- `package.json` — 加 log4js 到 `peerDependencies` + `peerDependenciesMeta.optional` + `devDependencies`
- `TODOs.md` — T-01 状态从 "spec 已完成" 更新为 "实现完成"

**不改：**
- `src/capability/example/`（参考模板，不动）
- 其它 M1-M5 现有代码

---

## Task 1: package.json 加 log4js peerDep 与 devDep

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 修改 package.json**

用 Edit 工具替换以下段落。

将：

```json
    "peerDependencies": {
        "electron": ">=15.0.0"
    },
    "devDependencies": {
        "vitest": "^2.1.9"
    },
```

替换为：

```json
    "peerDependencies": {
        "electron": ">=15.0.0",
        "log4js": ">=6 <7"
    },
    "peerDependenciesMeta": {
        "log4js": { "optional": true }
    },
    "devDependencies": {
        "log4js": "^6.9.1",
        "vitest": "^2.1.9"
    },
```

- [ ] **Step 2: 安装依赖**

Run:
```bash
cd D:/Desktop/npm/base-client-toolkit && npm install
```
Expected: `added N packages`；无 error；`node_modules/log4js/` 已存在。

- [ ] **Step 3: 验证 log4js 已装且可 require**

Run:
```bash
cd D:/Desktop/npm/base-client-toolkit && node -e "console.log(require('log4js').VERSION || 'loaded')"
```
Expected: 打印 `loaded`（log4js 6.x 无导出 VERSION 时走 fallback）；无 module not found 错误。

- [ ] **Step 4: 全量测试确认未污染现有 M1-M5**

Run:
```bash
cd D:/Desktop/npm/base-client-toolkit && npm test
```
Expected: 现有测试全绿；仅期望新增依赖后 npm audit 若有 warning 不影响 vitest。

- [ ] **Step 5: Commit**

```bash
cd D:/Desktop/npm/base-client-toolkit && git add package.json package-lock.json && git commit -m "chore(t01): add log4js as optional peerDep for logger capability"
```

---

## Task 2: 目录骨架 + subpath-export.test.js

**Files:**
- Create: `tests/capability/logger/subpath-export.test.js`
- Create: `src/capability/logger/index.js`

- [ ] **Step 1: 写 subpath-export.test.js（先跑失败）**

创建 `tests/capability/logger/subpath-export.test.js`，内容：

```javascript
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fs = require('fs');

describe('capability/logger: subpath export wiring', () => {
    it('physical structure matches M5 §2.1 (directory + index.js)', () => {
        const dir = path.resolve(__dirname, '../../../src/capability/logger');
        expect(fs.statSync(dir).isDirectory()).toBe(true);
        const entry = path.join(dir, 'index.js');
        expect(fs.existsSync(entry)).toBe(true);
        expect(fs.statSync(entry).isFile()).toBe(true);
        expect(path.basename(dir)).toBe('logger');
    });

    it('directory name equals serviceSchema.namespace', () => {
        const dir = path.resolve(__dirname, '../../../src/capability/logger');
        const dirName = path.basename(dir);
        const logger = require('../../../src/capability/logger/index');
        expect(logger.serviceSchema.namespace).toBe(dirName);
    });

    it('logger has no noticeSchema (per T-01 spec §5.4)', () => {
        const logger = require('../../../src/capability/logger/index');
        expect(logger.noticeSchema).toBeUndefined();
    });

    it('package.json declares ./capability/* wildcard export pointing into src', () => {
        const pkgPath = path.resolve(__dirname, '../../../package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        expect(pkg.exports).toBeTruthy();
        const cap = pkg.exports['./capability/*'];
        expect(cap).toBeTruthy();
        const target = typeof cap === 'string' ? cap : cap.default;
        expect(target).toMatch(/\.\/src\/capability\/\*\/index\.js$/);
    });

    it('relative require and absolute require yield the same module object', () => {
        const directRequire = require('../../../src/capability/logger/index');
        const viaPath = require(path.resolve(__dirname, '../../../src/capability/logger/index.js'));
        expect(viaPath).toBe(directRequire);
        expect(Object.keys(viaPath).sort()).toEqual(
            ['debug', 'error', 'fatal', 'info', 'init', 'serviceSchema', 'shutdown', 'trace', 'warn'],
        );
    });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run:
```bash
cd D:/Desktop/npm/base-client-toolkit && npx vitest run tests/capability/logger/subpath-export.test.js
```
Expected: FAIL — `Cannot find module` 或 `no such file or directory`（源文件不存在）。

- [ ] **Step 3: 创建 index.js 骨架**

创建 `src/capability/logger/index.js`，内容（骨架：8 项导出 + serviceSchema 占位；实现代码由后续任务逐步替换）：

```javascript
/**
 * Toolkit T-01: capability/logger
 *
 * M5 契约要点：
 * - 顶层导出 init / shutdown / 6 级日志方法 / serviceSchema
 * - init 前调用 6 级方法或 shutdown 触发 throw
 * - log4js 与 electron 延迟到 init 时 require，保 require 零副作用
 * - serviceSchema.handlers 与顶层方法引用同一份函数
 *
 * 详见 docs/superpowers/specs/2026-07-08-toolkit-t01-logger-design.md
 */

let state = null;

function assertInitialized() {
    if (!state) {
        throw new Error('[toolkit/logger] Logger not initialized');
    }
}

function init(opts) {
    throw new Error('[toolkit/logger] init not yet implemented');
}

function shutdown() {
    assertInitialized();
    throw new Error('[toolkit/logger] shutdown not yet implemented');
}

function trace(msg, ...args) {
    assertInitialized();
}

function debug(msg, ...args) {
    assertInitialized();
}

function info(msg, ...args) {
    assertInitialized();
}

function warn(msg, ...args) {
    assertInitialized();
}

function error(msg, ...args) {
    assertInitialized();
}

function fatal(msg, ...args) {
    assertInitialized();
}

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
};

module.exports = {
    init,
    shutdown,
    trace,
    debug,
    info,
    warn,
    error,
    fatal,
    serviceSchema,
};
```

- [ ] **Step 4: 运行测试验证通过**

Run:
```bash
cd D:/Desktop/npm/base-client-toolkit && npx vitest run tests/capability/logger/subpath-export.test.js
```
Expected: PASS 5 assertions。

- [ ] **Step 5: Commit**

```bash
cd D:/Desktop/npm/base-client-toolkit && git add src/capability/logger/index.js tests/capability/logger/subpath-export.test.js && git commit -m "feat(t01): scaffold logger capability + subpath wiring test"
```

---

## Task 3: exports.test.js（顶层导出形态）

**Files:**
- Create: `tests/capability/logger/exports.test.js`

- [ ] **Step 1: 写 exports.test.js**

创建 `tests/capability/logger/exports.test.js`，内容：

```javascript
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const logger = require('../../../src/capability/logger/index');

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

describe('capability/logger: export shape', () => {
    it('exports an object', () => {
        expect(logger).not.toBeNull();
        expect(typeof logger).toBe('object');
    });

    it('exposes init and shutdown as functions', () => {
        expect(typeof logger.init).toBe('function');
        expect(typeof logger.shutdown).toBe('function');
    });

    it.each(LEVELS)('exposes %s as a function', (level) => {
        expect(typeof logger[level]).toBe('function');
    });

    it('exposes a serviceSchema object', () => {
        expect(logger.serviceSchema).not.toBeNull();
        expect(typeof logger.serviceSchema).toBe('object');
    });

    it('does NOT expose a noticeSchema', () => {
        expect(logger.noticeSchema).toBeUndefined();
    });

    it('serviceSchema is not a function', () => {
        expect(typeof logger.serviceSchema).not.toBe('function');
    });
});

describe('capability/logger: identity between top-level methods and serviceSchema.handlers', () => {
    it.each(LEVELS)('serviceSchema.handlers.%s IS the same function reference as top-level', (level) => {
        expect(Object.is(logger.serviceSchema.handlers[level], logger[level])).toBe(true);
    });

    it('serviceSchema.namespace is "logger"', () => {
        expect(logger.serviceSchema.namespace).toBe('logger');
    });
});
```

- [ ] **Step 2: 运行测试验证通过**

Run:
```bash
cd D:/Desktop/npm/base-client-toolkit && npx vitest run tests/capability/logger/exports.test.js
```
Expected: PASS（骨架已满足所有断言）。

- [ ] **Step 3: Commit**

```bash
cd D:/Desktop/npm/base-client-toolkit && git add tests/capability/logger/exports.test.js && git commit -m "test(t01): assert logger top-level export shape and handler identity"
```

---

## Task 4: schema-shape.test.js（serviceSchema 形态）

**Files:**
- Create: `tests/capability/logger/schema-shape.test.js`

- [ ] **Step 1: 写 schema-shape.test.js**

创建 `tests/capability/logger/schema-shape.test.js`，内容：

```javascript
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const logger = require('../../../src/capability/logger/index');

const NAMESPACE_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const HANDLER_NAME_RE = /^[A-Za-z0-9_-]+$/;
const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

describe('serviceSchema shape (M2 protocol form)', () => {
    const { serviceSchema } = logger;

    it('namespace is "logger" and matches allowed pattern', () => {
        expect(typeof serviceSchema.namespace).toBe('string');
        expect(serviceSchema.namespace).toBe('logger');
        expect(NAMESPACE_RE.test(serviceSchema.namespace)).toBe(true);
    });

    it('handlers is a non-null object', () => {
        expect(serviceSchema.handlers).not.toBeNull();
        expect(typeof serviceSchema.handlers).toBe('object');
    });

    it('handlers contains exactly the 6 log levels', () => {
        const keys = Object.keys(serviceSchema.handlers).sort();
        expect(keys).toEqual([...LEVELS].sort());
    });

    it.each(LEVELS)('handlers.%s is a function with valid name', (level) => {
        expect(typeof serviceSchema.handlers[level]).toBe('function');
        expect(HANDLER_NAME_RE.test(level)).toBe(true);
    });

    it('does NOT define sync (all methods are async)', () => {
        expect(serviceSchema.sync).toBeUndefined();
    });

    it('does NOT define needsEvent', () => {
        expect(serviceSchema.needsEvent).toBeUndefined();
    });
});

describe('contract: no noticeSchema for logger (per T-01 spec §5.4)', () => {
    it('logger.noticeSchema is undefined', () => {
        expect(logger.noticeSchema).toBeUndefined();
    });

    it('at least one schema present (M5 §2.2 约束) — serviceSchema satisfies', () => {
        expect(logger.serviceSchema || logger.noticeSchema).toBeTruthy();
    });
});
```

- [ ] **Step 2: 运行测试验证通过**

Run:
```bash
cd D:/Desktop/npm/base-client-toolkit && npx vitest run tests/capability/logger/schema-shape.test.js
```
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
cd D:/Desktop/npm/base-client-toolkit && git add tests/capability/logger/schema-shape.test.js && git commit -m "test(t01): assert logger serviceSchema shape and absence of noticeSchema"
```

---

## Task 5: no-side-effects.test.js（M5 §2.4 副作用契约）

**Files:**
- Create: `tests/capability/logger/no-side-effects.test.js`

- [ ] **Step 1: 写 no-side-effects.test.js**

创建 `tests/capability/logger/no-side-effects.test.js`，内容：

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const modulePath = require.resolve('../../../src/capability/logger/index');
const fs = require('fs');

describe('capability/logger: zero side effects on require', () => {
    beforeEach(() => {
        delete require.cache[modulePath];
    });

    afterEach(() => {
        delete require.cache[modulePath];
    });

    it('require() does not throw', () => {
        expect(() => require('../../../src/capability/logger/index')).not.toThrow();
    });

    it('module source contains no top-level require of electron / log4js / service / notice', () => {
        // 文本扫描：M5 §2.4 副作用约束的最直接可断言形式。
        // T-01 spec §2.3 / §3.2 明确要求 log4js 与 electron 延迟到 init 时刻 require；
        // 这里断言模块顶层没有这两者的 require 语句。
        const source = fs.readFileSync(modulePath, 'utf8');
        // 顶层无 electron require
        expect(source).not.toMatch(/^\s*(?:const|let|var)?\s*[^\n]*require\(['"]electron['"]\)/m);
        // 顶层无 log4js require
        expect(source).not.toMatch(/^\s*(?:const|let|var)?\s*[^\n]*require\(['"]log4js['"]\)/m);
        // 无 service / notice 依赖
        expect(source).not.toMatch(/require\(['"][^'"]*\/service['"]\)/);
        expect(source).not.toMatch(/require\(['"][^'"]*\/notice['"]\)/);
        // 允许在 init 内部 require —— 用 "init" 函数体内的 require 是允许的
        // 断言方式：electron 与 log4js 的 require 若存在，必须出现在 "function init" 之后
        const initIdx = source.indexOf('function init');
        expect(initIdx).toBeGreaterThan(-1);
        const electronReqIdx = source.search(/require\(['"]electron['"]\)/);
        const log4jsReqIdx = source.search(/require\(['"]log4js['"]\)/);
        if (electronReqIdx > -1) expect(electronReqIdx).toBeGreaterThan(initIdx);
        if (log4jsReqIdx > -1) expect(log4jsReqIdx).toBeGreaterThan(initIdx);
    });

    it('require() does not mutate global state', () => {
        const before = Object.keys(globalThis).sort().join(',');
        require('../../../src/capability/logger/index');
        const after = Object.keys(globalThis).sort().join(',');
        expect(after).toBe(before);
    });

    it('handler identity holds within a single load', () => {
        const mod = require('../../../src/capability/logger/index');
        for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
            expect(Object.is(mod.serviceSchema.handlers[level], mod[level])).toBe(true);
        }
    });
});
```

- [ ] **Step 2: 运行测试验证通过**

Run:
```bash
cd D:/Desktop/npm/base-client-toolkit && npx vitest run tests/capability/logger/no-side-effects.test.js
```
Expected: PASS（骨架不 require electron/log4js/service/notice；无 global 修改）。

- [ ] **Step 3: Commit**

```bash
cd D:/Desktop/npm/base-client-toolkit && git add tests/capability/logger/no-side-effects.test.js && git commit -m "test(t01): assert M5 §2.4 zero-side-effects contract for logger"
```

---

## Task 6: init/shutdown 生命周期实现 + 测试

**Files:**
- Create: `tests/capability/logger/init-lifecycle.test.js`
- Modify: `src/capability/logger/index.js`

- [ ] **Step 1: 写 init-lifecycle.test.js（先跑失败）**

创建 `tests/capability/logger/init-lifecycle.test.js`，内容：

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const modulePath = require.resolve('../../../src/capability/logger/index');

// Mock log4js
function buildLog4jsMock() {
    const loggerInstance = {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
    };
    return {
        configure: vi.fn(),
        getLogger: vi.fn(() => loggerInstance),
        shutdown: vi.fn(),
        __loggerInstance: loggerInstance,
    };
}

// Mock electron
function buildElectronMock() {
    return {
        app: {
            getPath: vi.fn((name) => {
                if (name === 'userData') return '/tmp/mock-user-data';
                return '/tmp';
            }),
        },
    };
}

let log4jsMock;
let electronMock;

beforeEach(() => {
    delete require.cache[modulePath];

    log4jsMock = buildLog4jsMock();
    const log4jsPath = require.resolve('log4js');
    require.cache[log4jsPath] = {
        id: log4jsPath, filename: log4jsPath, loaded: true,
        exports: log4jsMock, children: [], paths: [],
    };

    electronMock = buildElectronMock();
    const electronPath = require.resolve('electron');
    require.cache[electronPath] = {
        id: electronPath, filename: electronPath, loaded: true,
        exports: electronMock, children: [], paths: [],
    };
});

describe('capability/logger: init/shutdown lifecycle', () => {
    it('before init: every level method throws "not initialized"', () => {
        const logger = require('../../../src/capability/logger/index');
        for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
            expect(() => logger[level]('msg')).toThrow(/not initialized/i);
        }
    });

    it('before init: shutdown throws "not initialized"', () => {
        const logger = require('../../../src/capability/logger/index');
        expect(() => logger.shutdown()).toThrow(/not initialized/i);
    });

    it('init() with default opts configures log4js and does not throw', () => {
        const logger = require('../../../src/capability/logger/index');
        expect(() => logger.init()).not.toThrow();
        expect(log4jsMock.configure).toHaveBeenCalledTimes(1);
        expect(log4jsMock.getLogger).toHaveBeenCalledTimes(1);
    });

    it('after init: info() forwards to log4js.getLogger().info', () => {
        const logger = require('../../../src/capability/logger/index');
        logger.init();
        logger.info('hello');
        expect(log4jsMock.__loggerInstance.info).toHaveBeenCalledTimes(1);
    });

    it('calling init a second time throws "already initialized"', () => {
        const logger = require('../../../src/capability/logger/index');
        logger.init();
        expect(() => logger.init()).toThrow(/already initialized/i);
    });

    it('shutdown() after init calls log4js.shutdown', () => {
        const logger = require('../../../src/capability/logger/index');
        logger.init();
        logger.shutdown();
        expect(log4jsMock.shutdown).toHaveBeenCalledTimes(1);
    });

    it('shutdown does NOT reset state — re-init still throws already initialized', () => {
        const logger = require('../../../src/capability/logger/index');
        logger.init();
        logger.shutdown();
        expect(() => logger.init()).toThrow(/already initialized/i);
    });

    it('error message uses [toolkit/logger] prefix', () => {
        const logger = require('../../../src/capability/logger/index');
        expect(() => logger.info('x')).toThrow(/\[toolkit\/logger\]/);
    });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run:
```bash
cd D:/Desktop/npm/base-client-toolkit && npx vitest run tests/capability/logger/init-lifecycle.test.js
```
Expected: FAIL — 至少 `init not yet implemented` 相关断言失败。

- [ ] **Step 3: 实现 init/shutdown + 6 级方法转发**

用 Edit 工具修改 `src/capability/logger/index.js`。

替换整个文件内容为：

```javascript
/**
 * Toolkit T-01: capability/logger
 *
 * M5 契约要点：
 * - 顶层导出 init / shutdown / 6 级日志方法 / serviceSchema
 * - init 前调用 6 级方法或 shutdown 触发 throw
 * - log4js 与 electron 延迟到 init 时 require，保 require 零副作用
 * - serviceSchema.handlers 与顶层方法引用同一份函数
 *
 * 详见 docs/superpowers/specs/2026-07-08-toolkit-t01-logger-design.md
 */

const fs = require('fs');
const path = require('path');

let state = null;

function assertInitialized() {
    if (!state) {
        throw new Error('[toolkit/logger] Logger not initialized');
    }
}

function init(opts) {
    if (state) {
        throw new Error('[toolkit/logger] Logger already initialized');
    }
    const log4js = require('log4js');
    const { app } = require('electron');

    const logDir = (opts && opts.logDir)
        || path.join(app.getPath('userData'), 'Logs');

    fs.mkdirSync(logDir, { recursive: true });

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
                filename: path.join(logDir, 'log'),
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

    state = {
        log4js,
        logger: log4js.getLogger(),
        isDev: process.env.NODE_ENV === 'development',
    };
}

function shutdown() {
    assertInitialized();
    state.log4js.shutdown();
}

function trace(msg, ...args) {
    assertInitialized();
    state.logger.trace(msg, ...args);
}

function debug(msg, ...args) {
    assertInitialized();
    state.logger.debug(msg, ...args);
}

function info(msg, ...args) {
    assertInitialized();
    state.logger.info(msg, ...args);
}

function warn(msg, ...args) {
    assertInitialized();
    state.logger.warn(msg, ...args);
}

function error(msg, ...args) {
    assertInitialized();
    state.logger.error(msg, ...args);
}

function fatal(msg, ...args) {
    assertInitialized();
    state.logger.fatal(msg, ...args);
}

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
};

module.exports = {
    init,
    shutdown,
    trace,
    debug,
    info,
    warn,
    error,
    fatal,
    serviceSchema,
};
```

- [ ] **Step 4: 运行测试验证通过**

Run:
```bash
cd D:/Desktop/npm/base-client-toolkit && npx vitest run tests/capability/logger/init-lifecycle.test.js tests/capability/logger/subpath-export.test.js tests/capability/logger/exports.test.js tests/capability/logger/schema-shape.test.js tests/capability/logger/no-side-effects.test.js
```
Expected: 5 个测试文件全绿。**关键**：no-side-effects 里的"electron/log4js require 位置必须在 init 之后"断言仍应通过（当前 index.js 顶层无 electron/log4js require；两者都在 init 函数体内）。

- [ ] **Step 5: Commit**

```bash
cd D:/Desktop/npm/base-client-toolkit && git add src/capability/logger/index.js tests/capability/logger/init-lifecycle.test.js && git commit -m "feat(t01): implement init/shutdown lifecycle + level method forwarding"
```

---

## Task 7: init 配置测试（logDir 默认与自定义 + mkdirSync）

**Files:**
- Create: `tests/capability/logger/init-config.test.js`

- [ ] **Step 1: 写 init-config.test.js**

创建 `tests/capability/logger/init-config.test.js`，内容：

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const modulePath = require.resolve('../../../src/capability/logger/index');

function buildLog4jsMock() {
    return {
        configure: vi.fn(),
        getLogger: vi.fn(() => ({
            trace: vi.fn(), debug: vi.fn(), info: vi.fn(),
            warn: vi.fn(), error: vi.fn(), fatal: vi.fn(),
        })),
        shutdown: vi.fn(),
    };
}

function buildElectronMock(userDataPath = '/tmp/mock-user-data') {
    return {
        app: {
            getPath: vi.fn((name) => {
                if (name === 'userData') return userDataPath;
                return '/tmp';
            }),
        },
    };
}

let log4jsMock;
let electronMock;
let mkdirSpy;
let fs;

beforeEach(async () => {
    delete require.cache[modulePath];

    log4jsMock = buildLog4jsMock();
    const log4jsPath = require.resolve('log4js');
    require.cache[log4jsPath] = {
        id: log4jsPath, filename: log4jsPath, loaded: true,
        exports: log4jsMock, children: [], paths: [],
    };

    electronMock = buildElectronMock();
    const electronPath = require.resolve('electron');
    require.cache[electronPath] = {
        id: electronPath, filename: electronPath, loaded: true,
        exports: electronMock, children: [], paths: [],
    };

    fs = require('fs');
    mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
});

describe('capability/logger: init opts.logDir handling', () => {
    it('when opts is omitted, uses <userData>/Logs', () => {
        const logger = require('../../../src/capability/logger/index');
        logger.init();
        expect(electronMock.app.getPath).toHaveBeenCalledWith('userData');
        expect(mkdirSpy).toHaveBeenCalledTimes(1);
        const [dirArg, optsArg] = mkdirSpy.mock.calls[0];
        // 路径分隔符统一：仅断言尾段与 recursive 选项
        expect(String(dirArg)).toMatch(/mock-user-data[\\/]Logs$/);
        expect(optsArg).toEqual({ recursive: true });
    });

    it('when opts.logDir is provided, uses it verbatim and does NOT call app.getPath', () => {
        const logger = require('../../../src/capability/logger/index');
        logger.init({ logDir: '/custom/log/path' });
        expect(electronMock.app.getPath).not.toHaveBeenCalled();
        expect(mkdirSpy).toHaveBeenCalledWith('/custom/log/path', { recursive: true });
    });

    it('log4js.configure receives filename under the resolved logDir', () => {
        const logger = require('../../../src/capability/logger/index');
        logger.init({ logDir: '/custom/log/path' });
        expect(log4jsMock.configure).toHaveBeenCalledTimes(1);
        const cfg = log4jsMock.configure.mock.calls[0][0];
        expect(cfg.appenders.logs.filename).toMatch(/^\/custom\/log\/path[\\/]log$/);
    });

    it('log4js.configure passes照搬 spec §7.1 的默认值', () => {
        const logger = require('../../../src/capability/logger/index');
        logger.init({ logDir: '/tmp/x' });
        const cfg = log4jsMock.configure.mock.calls[0][0];
        expect(cfg.appenders.console.type).toBe('console');
        expect(cfg.appenders.logs.type).toBe('dateFile');
        expect(cfg.appenders.logs.pattern).toBe('yyyy-MM-dd.log');
        expect(cfg.appenders.logs.maxLogSize).toBe('100K');
        expect(cfg.appenders.logs.numBackups).toBe(20);
        expect(cfg.appenders.logs.compress).toBe(true);
        expect(cfg.appenders.logs.alwaysIncludePattern).toBe(true);
        expect(cfg.categories.default.appenders).toEqual(['console', 'logs']);
        expect(cfg.categories.default.level).toBe('trace');
    });
});
```

- [ ] **Step 2: 运行测试验证通过**

Run:
```bash
cd D:/Desktop/npm/base-client-toolkit && npx vitest run tests/capability/logger/init-config.test.js
```
Expected: 4 个断言全绿。（Task 6 已经实现了 init 的所有逻辑，本任务只补测试覆盖。）

- [ ] **Step 3: Commit**

```bash
cd D:/Desktop/npm/base-client-toolkit && git add tests/capability/logger/init-config.test.js && git commit -m "test(t01): cover logDir default/override and log4js configure params"
```

---

## Task 8: serialize 参数预处理实现 + 测试

**Files:**
- Create: `tests/capability/logger/serialize.test.js`
- Modify: `src/capability/logger/index.js`

- [ ] **Step 1: 写 serialize.test.js（先跑失败）**

创建 `tests/capability/logger/serialize.test.js`，内容：

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const modulePath = require.resolve('../../../src/capability/logger/index');

function buildLog4jsMock() {
    const loggerInstance = {
        trace: vi.fn(), debug: vi.fn(), info: vi.fn(),
        warn: vi.fn(), error: vi.fn(), fatal: vi.fn(),
    };
    return {
        configure: vi.fn(),
        getLogger: vi.fn(() => loggerInstance),
        shutdown: vi.fn(),
        __loggerInstance: loggerInstance,
    };
}

function buildElectronMock() {
    return {
        app: {
            getPath: vi.fn(() => '/tmp/x'),
        },
    };
}

let log4jsMock;

beforeEach(() => {
    delete require.cache[modulePath];

    log4jsMock = buildLog4jsMock();
    const log4jsPath = require.resolve('log4js');
    require.cache[log4jsPath] = {
        id: log4jsPath, filename: log4jsPath, loaded: true,
        exports: log4jsMock, children: [], paths: [],
    };

    const electronPath = require.resolve('electron');
    require.cache[electronPath] = {
        id: electronPath, filename: electronPath, loaded: true,
        exports: buildElectronMock(), children: [], paths: [],
    };

    const fs = require('fs');
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
});

function withLogger(fn) {
    const logger = require('../../../src/capability/logger/index');
    logger.init({ logDir: '/tmp/x' });
    return fn(logger);
}

describe('serialize: primitives pass through', () => {
    it('string / number / boolean / null / undefined pass through', () => {
        withLogger((logger) => {
            logger.info('hello', 42, true, null, undefined);
            const args = log4jsMock.__loggerInstance.info.mock.calls[0];
            expect(args).toEqual(['hello', 42, true, null, undefined]);
        });
    });
});

describe('serialize: Error expansion', () => {
    it('Error whose stack contains message → pushes stack only', () => {
        withLogger((logger) => {
            const err = new Error('boom');
            // Node 生成的 stack 通常以 "Error: boom\n    at ..." 开头，包含 message
            expect(err.stack.includes(err.message)).toBe(true);
            logger.info('prefix', err);
            const args = log4jsMock.__loggerInstance.info.mock.calls[0];
            expect(args).toEqual(['prefix', err.stack]);
        });
    });

    it('Error whose stack does NOT contain message → pushes message then stack', () => {
        withLogger((logger) => {
            const err = new Error('boom');
            // 手动构造一个 stack 不含 message 的场景
            err.stack = 'at foo (a.js:1:1)\nat bar (b.js:2:2)';
            expect(err.stack.includes(err.message)).toBe(false);
            logger.info(err);
            const args = log4jsMock.__loggerInstance.info.mock.calls[0];
            expect(args).toEqual(['boom', err.stack]);
        });
    });
});

describe('serialize: object serialization', () => {
    it('plain object → JSON.stringify', () => {
        withLogger((logger) => {
            logger.info({ a: 1, b: 'x' });
            const args = log4jsMock.__loggerInstance.info.mock.calls[0];
            expect(args).toEqual(['{"a":1,"b":"x"}']);
        });
    });

    it('array → JSON.stringify', () => {
        withLogger((logger) => {
            logger.info([1, 2, 3]);
            const args = log4jsMock.__loggerInstance.info.mock.calls[0];
            expect(args).toEqual(['[1,2,3]']);
        });
    });

    it('circular reference → falls back to util.inspect (contains [Circular])', () => {
        withLogger((logger) => {
            const obj = { a: 1 };
            obj.self = obj;
            logger.info(obj);
            const args = log4jsMock.__loggerInstance.info.mock.calls[0];
            expect(typeof args[0]).toBe('string');
            expect(args[0]).toMatch(/Circular/);
            expect(args[0]).toMatch(/a:\s*1/);
        });
    });
});

describe('serialize: mixed args', () => {
    it('mix of string + Error + object works', () => {
        withLogger((logger) => {
            const err = new Error('bad');
            logger.error('failed at', err, { userId: 7 });
            const args = log4jsMock.__loggerInstance.error.mock.calls[0];
            // 'failed at' passthrough, err → stack (contains msg), {userId:7} → JSON.stringify
            expect(args[0]).toBe('failed at');
            expect(args[1]).toBe(err.stack);
            expect(args[2]).toBe('{"userId":7}');
        });
    });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run:
```bash
cd D:/Desktop/npm/base-client-toolkit && npx vitest run tests/capability/logger/serialize.test.js
```
Expected: FAIL — 例如 `logger.info({ a: 1 })` 目前直接传原对象，测试期望的是 `'{"a":1}'` 字符串。

- [ ] **Step 3: 在 index.js 里加 serialize 函数并接入 6 级方法**

用 Edit 工具修改 `src/capability/logger/index.js`。

**改动 1**：在 `const fs = require('fs');` 那行的下一行加 util 引入。

将：

```javascript
const fs = require('fs');
const path = require('path');
```

替换为：

```javascript
const fs = require('fs');
const path = require('path');
const util = require('util');
```

**改动 2**：在 `assertInitialized` 函数之后追加 `serialize` 函数。

将：

```javascript
function assertInitialized() {
    if (!state) {
        throw new Error('[toolkit/logger] Logger not initialized');
    }
}

function init(opts) {
```

替换为：

```javascript
function assertInitialized() {
    if (!state) {
        throw new Error('[toolkit/logger] Logger not initialized');
    }
}

/**
 * 参数预处理（T-01 spec §4.3）：
 * 1. Error → stack 若含 message 只 push stack；否则 push message + stack
 * 2. Object → JSON.stringify，循环引用等失败 fallback util.inspect
 * 3. 其他类型透传
 */
function serialize(args) {
    const expanded = [];
    for (const arg of args) {
        if (arg instanceof Error) {
            const { message, stack } = arg;
            if (stack && stack.includes(message)) {
                expanded.push(stack);
            } else {
                expanded.push(message, stack);
            }
        } else {
            expanded.push(arg);
        }
    }
    return expanded.map((v) => {
        if (v === null) return v;
        if (typeof v !== 'object') return v;
        try {
            return JSON.stringify(v);
        } catch (_) {
            return util.inspect(v, { depth: 4, breakLength: Infinity });
        }
    });
}

function init(opts) {
```

**改动 3**：把 6 级方法的实现改为经过 `serialize`。

将：

```javascript
function trace(msg, ...args) {
    assertInitialized();
    state.logger.trace(msg, ...args);
}

function debug(msg, ...args) {
    assertInitialized();
    state.logger.debug(msg, ...args);
}

function info(msg, ...args) {
    assertInitialized();
    state.logger.info(msg, ...args);
}

function warn(msg, ...args) {
    assertInitialized();
    state.logger.warn(msg, ...args);
}

function error(msg, ...args) {
    assertInitialized();
    state.logger.error(msg, ...args);
}

function fatal(msg, ...args) {
    assertInitialized();
    state.logger.fatal(msg, ...args);
}
```

替换为：

```javascript
function trace(msg, ...args) {
    assertInitialized();
    state.logger.trace(...serialize([msg, ...args]));
}

function debug(msg, ...args) {
    assertInitialized();
    state.logger.debug(...serialize([msg, ...args]));
}

function info(msg, ...args) {
    assertInitialized();
    state.logger.info(...serialize([msg, ...args]));
}

function warn(msg, ...args) {
    assertInitialized();
    state.logger.warn(...serialize([msg, ...args]));
}

function error(msg, ...args) {
    assertInitialized();
    state.logger.error(...serialize([msg, ...args]));
}

function fatal(msg, ...args) {
    assertInitialized();
    state.logger.fatal(...serialize([msg, ...args]));
}
```

- [ ] **Step 4: 运行测试验证通过**

Run:
```bash
cd D:/Desktop/npm/base-client-toolkit && npx vitest run tests/capability/logger/serialize.test.js tests/capability/logger/init-lifecycle.test.js
```
Expected: 全绿。init-lifecycle 里的 `logger.info('hello')` 断言（仅验证被调用次数）与 serialize 后行为兼容。

- [ ] **Step 5: Commit**

```bash
cd D:/Desktop/npm/base-client-toolkit && git add src/capability/logger/index.js tests/capability/logger/serialize.test.js && git commit -m "feat(t01): add param serialize (Error expand + JSON stringify + util.inspect fallback)"
```

---

## Task 9: dev 门控实现 + 测试

**Files:**
- Create: `tests/capability/logger/dev-gating.test.js`
- Modify: `src/capability/logger/index.js`

- [ ] **Step 1: 写 dev-gating.test.js（先跑失败）**

创建 `tests/capability/logger/dev-gating.test.js`，内容：

```javascript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const modulePath = require.resolve('../../../src/capability/logger/index');

function buildLog4jsMock() {
    const loggerInstance = {
        trace: vi.fn(), debug: vi.fn(), info: vi.fn(),
        warn: vi.fn(), error: vi.fn(), fatal: vi.fn(),
    };
    return {
        configure: vi.fn(),
        getLogger: vi.fn(() => loggerInstance),
        shutdown: vi.fn(),
        __loggerInstance: loggerInstance,
    };
}

function buildElectronMock() {
    return { app: { getPath: vi.fn(() => '/tmp/x') } };
}

let log4jsMock;
const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
    delete require.cache[modulePath];

    log4jsMock = buildLog4jsMock();
    const log4jsPath = require.resolve('log4js');
    require.cache[log4jsPath] = {
        id: log4jsPath, filename: log4jsPath, loaded: true,
        exports: log4jsMock, children: [], paths: [],
    };

    const electronPath = require.resolve('electron');
    require.cache[electronPath] = {
        id: electronPath, filename: electronPath, loaded: true,
        exports: buildElectronMock(), children: [], paths: [],
    };

    const fs = require('fs');
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
});

afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
});

describe('capability/logger: dev gating for trace/debug', () => {
    it('NODE_ENV=development: trace and debug DO forward to log4js', () => {
        process.env.NODE_ENV = 'development';
        const logger = require('../../../src/capability/logger/index');
        logger.init({ logDir: '/tmp/x' });

        logger.trace('t');
        logger.debug('d');

        expect(log4jsMock.__loggerInstance.trace).toHaveBeenCalledTimes(1);
        expect(log4jsMock.__loggerInstance.debug).toHaveBeenCalledTimes(1);
    });

    it('NODE_ENV=production: trace and debug are silent', () => {
        process.env.NODE_ENV = 'production';
        const logger = require('../../../src/capability/logger/index');
        logger.init({ logDir: '/tmp/x' });

        logger.trace('t');
        logger.debug('d');

        expect(log4jsMock.__loggerInstance.trace).not.toHaveBeenCalled();
        expect(log4jsMock.__loggerInstance.debug).not.toHaveBeenCalled();
    });

    it('info/warn/error/fatal are NOT gated by NODE_ENV', () => {
        process.env.NODE_ENV = 'production';
        const logger = require('../../../src/capability/logger/index');
        logger.init({ logDir: '/tmp/x' });

        logger.info('i');
        logger.warn('w');
        logger.error('e');
        logger.fatal('f');

        expect(log4jsMock.__loggerInstance.info).toHaveBeenCalledTimes(1);
        expect(log4jsMock.__loggerInstance.warn).toHaveBeenCalledTimes(1);
        expect(log4jsMock.__loggerInstance.error).toHaveBeenCalledTimes(1);
        expect(log4jsMock.__loggerInstance.fatal).toHaveBeenCalledTimes(1);
    });

    it('isDev is snapshotted at init: changing NODE_ENV afterwards has no effect', () => {
        process.env.NODE_ENV = 'production';
        const logger = require('../../../src/capability/logger/index');
        logger.init({ logDir: '/tmp/x' });

        // Change env after init — should have no effect
        process.env.NODE_ENV = 'development';
        logger.trace('t');
        logger.debug('d');

        expect(log4jsMock.__loggerInstance.trace).not.toHaveBeenCalled();
        expect(log4jsMock.__loggerInstance.debug).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run:
```bash
cd D:/Desktop/npm/base-client-toolkit && npx vitest run tests/capability/logger/dev-gating.test.js
```
Expected: FAIL — 生产环境下 trace/debug 目前仍会调 log4js（当前实现无门控）。

- [ ] **Step 3: 在 trace/debug 内加 isDev 门控**

用 Edit 工具修改 `src/capability/logger/index.js`。

将：

```javascript
function trace(msg, ...args) {
    assertInitialized();
    state.logger.trace(...serialize([msg, ...args]));
}

function debug(msg, ...args) {
    assertInitialized();
    state.logger.debug(...serialize([msg, ...args]));
}
```

替换为：

```javascript
function trace(msg, ...args) {
    assertInitialized();
    if (!state.isDev) return;
    state.logger.trace(...serialize([msg, ...args]));
}

function debug(msg, ...args) {
    assertInitialized();
    if (!state.isDev) return;
    state.logger.debug(...serialize([msg, ...args]));
}
```

- [ ] **Step 4: 运行测试验证通过**

Run:
```bash
cd D:/Desktop/npm/base-client-toolkit && npx vitest run tests/capability/logger/dev-gating.test.js tests/capability/logger/serialize.test.js tests/capability/logger/init-lifecycle.test.js
```
Expected: 全绿。

**关键**：serialize.test.js 中每处 `logger.info(...)` / `logger.error(...)` 用的是 info/error 级别，不受 isDev 影响，无回归。

- [ ] **Step 5: Commit**

```bash
cd D:/Desktop/npm/base-client-toolkit && git add src/capability/logger/index.js tests/capability/logger/dev-gating.test.js && git commit -m "feat(t01): gate trace/debug behind isDev snapshotted at init"
```

---

## Task 10: 全测试套件验证 + TODOs 状态更新

**Files:**
- Modify: `TODOs.md`

- [ ] **Step 1: 运行全测试套件确认无回归**

Run:
```bash
cd D:/Desktop/npm/base-client-toolkit && npm test
```
Expected: 所有测试文件全绿（M1-M5 现有 + logger 8 个新测试文件）。

- [ ] **Step 2: 用 Edit 工具更新 TODOs.md**

将：

```markdown
- [ ] [T-01 接入] logger capability spec 已完成（docs/superpowers/specs/2026-07-08-toolkit-t01-logger-design.md），plan 待启动。
```

替换为：

```markdown
- [x] [T-01 接入] logger capability 完成：spec `docs/superpowers/specs/2026-07-08-toolkit-t01-logger-design.md`，plan `docs/superpowers/plans/2026-07-08-toolkit-t01-logger.md`，实现 `src/capability/logger/`。
```

- [ ] **Step 3: Commit**

```bash
cd D:/Desktop/npm/base-client-toolkit && git add TODOs.md && git commit -m "chore(t01): mark logger capability as done in TODOs"
```

---

## Self-Review 结果

### 1. Spec 覆盖检查

| Spec 章节 | 覆盖任务 |
|---|---|
| §1 定位与范围 | Task 2（目录 + subpath） |
| §2 文件结构与导出契约 | Task 2（骨架）+ Task 3（exports 断言）+ Task 5（无副作用） |
| §3 init 语义与配置项 | Task 6（生命周期） + Task 7（logDir/mkdir） |
| §4 API 规格（6 级 + dev 门控 + serialize + shutdown） | Task 6（转发） + Task 8（serialize） + Task 9（dev 门控） |
| §5 serviceSchema 定义 | Task 3（handler identity）+ Task 4（形态） |
| §6 依赖策略 | Task 1（package.json） |
| §7 log4js 底层配置 | Task 7（配置断言） |
| §8 测试策略 | Task 2-9（8 个测试文件全部对齐） |
| §9 与其他 spec 的关系 | Task 10（TODOs 状态更新） |

**结论**：全部覆盖，无遗漏。

### 2. Placeholder 扫描

- 无 "TBD" / "TODO" / "implement later"
- 无 "similar to Task N" —— 代码在每步中完整给出
- 无 "add appropriate handling" —— 所有 error/edge 情形有明确 assert
- 无未定义的类型/方法引用

### 3. 类型/命名一致性

- 6 级方法名（`trace/debug/info/warn/error/fatal`）在 Task 2/3/4/6/8/9 各处一致
- state 结构 `{ log4js, logger, isDev }` 在 Task 6 定义、Task 9 消费一致
- `serialize([msg, ...args])` 调用形态在 Task 8 定义、Task 9 沿用一致
- `serviceSchema.handlers` 键集合与顶层导出保持严格一致（Task 3/4/6 三处相互验证）

---

## 附录：完整最终 index.js 参考

Task 9 完成后，`src/capability/logger/index.js` 的最终形态：

```javascript
/**
 * Toolkit T-01: capability/logger
 *
 * M5 契约要点：
 * - 顶层导出 init / shutdown / 6 级日志方法 / serviceSchema
 * - init 前调用 6 级方法或 shutdown 触发 throw
 * - log4js 与 electron 延迟到 init 时 require,保 require 零副作用
 * - serviceSchema.handlers 与顶层方法引用同一份函数
 *
 * 详见 docs/superpowers/specs/2026-07-08-toolkit-t01-logger-design.md
 */

const fs = require('fs');
const path = require('path');
const util = require('util');

let state = null;

function assertInitialized() {
    if (!state) {
        throw new Error('[toolkit/logger] Logger not initialized');
    }
}

function serialize(args) {
    const expanded = [];
    for (const arg of args) {
        if (arg instanceof Error) {
            const { message, stack } = arg;
            if (stack && stack.includes(message)) {
                expanded.push(stack);
            } else {
                expanded.push(message, stack);
            }
        } else {
            expanded.push(arg);
        }
    }
    return expanded.map((v) => {
        if (v === null) return v;
        if (typeof v !== 'object') return v;
        try {
            return JSON.stringify(v);
        } catch (_) {
            return util.inspect(v, { depth: 4, breakLength: Infinity });
        }
    });
}

function init(opts) {
    if (state) {
        throw new Error('[toolkit/logger] Logger already initialized');
    }
    const log4js = require('log4js');
    const { app } = require('electron');

    const logDir = (opts && opts.logDir)
        || path.join(app.getPath('userData'), 'Logs');

    fs.mkdirSync(logDir, { recursive: true });

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
                filename: path.join(logDir, 'log'),
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

    state = {
        log4js,
        logger: log4js.getLogger(),
        isDev: process.env.NODE_ENV === 'development',
    };
}

function shutdown() {
    assertInitialized();
    state.log4js.shutdown();
}

function trace(msg, ...args) {
    assertInitialized();
    if (!state.isDev) return;
    state.logger.trace(...serialize([msg, ...args]));
}

function debug(msg, ...args) {
    assertInitialized();
    if (!state.isDev) return;
    state.logger.debug(...serialize([msg, ...args]));
}

function info(msg, ...args) {
    assertInitialized();
    state.logger.info(...serialize([msg, ...args]));
}

function warn(msg, ...args) {
    assertInitialized();
    state.logger.warn(...serialize([msg, ...args]));
}

function error(msg, ...args) {
    assertInitialized();
    state.logger.error(...serialize([msg, ...args]));
}

function fatal(msg, ...args) {
    assertInitialized();
    state.logger.fatal(...serialize([msg, ...args]));
}

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
};

module.exports = {
    init,
    shutdown,
    trace,
    debug,
    info,
    warn,
    error,
    fatal,
    serviceSchema,
};
```

（此附录仅供实现者参考对齐，Task 2/6/8/9 已按增量步骤生成同样代码。）
