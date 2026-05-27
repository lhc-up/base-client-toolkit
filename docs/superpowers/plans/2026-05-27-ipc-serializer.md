# IPC 数据序列化器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `@base-client/toolkit` 新增一个自研轻量 serializer，让 IPC 数据传递永不因不可克隆字段而崩，并提供 logger 友好的序列化工具。

**Architecture:** 在 `src/shared/serializer/` 下新建模块，纯函数无副作用，被主进程（`src/service`、`src/notice`）和 preload（`src/preload/service.js`）双向自动调用。lossy 策略 + 可读占位符，strict 模式在开发期暴露真 bug，生产环境永不抛错。完成定义 = `npm test` 全绿。

**Tech Stack:** Node.js / Electron 22 / CommonJS / Rollup / vitest（新引入）

**Spec:** `docs/superpowers/specs/2026-05-27-ipc-serializer-design.md`

---

## Task 1: 工作区清理与 vitest 引入

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`（npm install 副产物）
- Modify: `src/service/index.js`
- Create: `vitest.config.mjs`

### Step 1.1：观察现有未提交变更

- [ ] **Step 1.1.1: 查看当前未提交变更**

Run: `git status && git diff package.json src/service/index.js src/index.js`

预期发现：
- `package.json` 增加了 `@ungap/structured-clone` 依赖（spec 要移除）
- `src/service/index.js` init 函数里有实验代码（spec 要删除）
- `src/service/index.js` 引入了 `@ungap/structured-clone`（要删除）
- `src/index.js` 改成直接导出 Service/Notice（保留，与本任务无关）

### Step 1.2：清理 service/index.js 中的实验代码

- [ ] **Step 1.2.1: 删除实验性 require 和 init 内调试代码**

修改 `src/service/index.js`：
- 删除第 3-4 行：`const { serialize, deserialize} = require('@ungap/structured-clone');` 和 `const { stringify, parse } = require('@ungap/structured-clone/json');`
- 删除 init 函数内第 34-47 行的整段实验代码（从 `const o = {};` 到 `console.log('c', typeof stringify(c));`）

修改后的 `src/service/index.js` 前 50 行应当为：

```js
const isFunction = require('lodash.isfunction');
const exampleService = require('./__example');
const { ipcMain } = require('electron');

const REPLY_ERROR_KEY = '__ipcError';

const internalSchemas = [
    exampleService.schema,
];

// 已注册的service schema
const registeredSchemas = new Map();

function init(options={}) {
    ipcMain.on('service:getServiceList', event => {
        event.returnValue = getServiceList();
    });

    // 注册内置 service
    for (const schema of internalSchemas) {
        registerService(schema);
    }

    // 注册用户 service
    const userSchemas = options?.userSchemas;
    if (Array.isArray(userSchemas)) {
        for (const schema of userSchemas) {
            registerService(schema);
        }
    }
}
```

### Step 1.3：从 package.json 移除 `@ungap/structured-clone`

- [ ] **Step 1.3.1: 编辑 package.json**

把 `dependencies` 中的 `"@ungap/structured-clone": "^1.3.1",` 这一行删除。修改后的 `dependencies`：

```json
"dependencies": {
    "fs-extra": "^11.3.5",
    "lodash.isfunction": "^3.0.9",
    "lodash.merge": "^4.6.2"
}
```

（`lodash.isfunction` 会在 Task 9 移除，本步只移除 ungap）

### Step 1.4：引入 vitest

- [ ] **Step 1.4.1: 安装 vitest**

Run: `npm install --save-dev vitest@^2.0.0`

Expected: package.json 的 devDependencies 新增 `"vitest": "^2.x"`，无安装错误。

- [ ] **Step 1.4.2: 在 package.json 增加测试脚本**

修改 `scripts` 块为：

```json
"scripts": {
    "build": "rollup -c rollup.config.mjs",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepublishOnly": "npm run build"
}
```

- [ ] **Step 1.4.3: 创建 vitest 配置**

Create `vitest.config.mjs`：

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/__tests__/*.test.js'],
        environment: 'node',
        globals: false,
    },
});
```

- [ ] **Step 1.4.4: 创建占位测试验证 vitest 可运行**

Create `src/shared/serializer/__tests__/smoke.test.js`：

```js
const { describe, it, expect } = require('vitest');

describe('vitest smoke', () => {
    it('runs', () => {
        expect(1 + 1).toBe(2);
    });
});
```

- [ ] **Step 1.4.5: 运行测试验证**

Run: `npm test`
Expected: `1 passed`，无错误。

### Step 1.5：提交清理 + vitest 引入

- [ ] **Step 1.5.1: 暂存并提交**

```bash
git add package.json package-lock.json src/service/index.js vitest.config.mjs src/shared/serializer/__tests__/smoke.test.js
git commit -m "$(cat <<'EOF'
chore: 清理 service 实验代码并引入 vitest

- 移除 @ungap/structured-clone 依赖
- 删除 service/index.js init 中的实验代码
- 引入 vitest 作为测试框架，配置 test/test:watch 脚本

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: limits 模块（默认上限与全局配置）

**Files:**
- Create: `src/shared/serializer/limits.js`
- Create: `src/shared/serializer/__tests__/limits.test.js`

### Step 2.1：写失败测试

- [ ] **Step 2.1.1: 写 limits 模块测试**

Create `src/shared/serializer/__tests__/limits.test.js`：

```js
const { describe, it, expect, beforeEach } = require('vitest');
const { DEFAULTS, configureSerializer, resolveOpts, _resetForTest } = require('../limits');

describe('limits.resolveOpts', () => {
    beforeEach(() => _resetForTest());

    it('returns defaults when no opts given', () => {
        const r = resolveOpts();
        expect(r.maxDepth).toBe(DEFAULTS.maxDepth);
        expect(r.maxStringLength).toBe(DEFAULTS.maxStringLength);
        expect(r.maxArrayLength).toBe(DEFAULTS.maxArrayLength);
        expect(r.maxKeys).toBe(DEFAULTS.maxKeys);
    });

    it('per-call opts override defaults', () => {
        const r = resolveOpts({ maxDepth: 5 });
        expect(r.maxDepth).toBe(5);
        expect(r.maxStringLength).toBe(DEFAULTS.maxStringLength);
    });

    it('configureSerializer mutates global defaults', () => {
        configureSerializer({ maxDepth: 10 });
        expect(resolveOpts().maxDepth).toBe(10);
    });

    it('per-call still overrides after configure', () => {
        configureSerializer({ maxDepth: 10 });
        expect(resolveOpts({ maxDepth: 99 }).maxDepth).toBe(99);
    });

    it('onError defaults to null', () => {
        expect(resolveOpts().onError).toBeNull();
    });

    it('strict default reflects NODE_ENV', () => {
        const r = resolveOpts();
        const expected = process.env.NODE_ENV !== 'production';
        expect(r.strict).toBe(expected);
    });
});
```

- [ ] **Step 2.1.2: 跑测试，应当失败**

Run: `npm test`
Expected: 6 个 fail，错误信息 "Cannot find module '../limits'"

### Step 2.2：实现 limits 模块

- [ ] **Step 2.2.1: 创建 limits.js**

Create `src/shared/serializer/limits.js`：

```js
const DEFAULTS = Object.freeze({
    maxDepth: 32,
    maxStringLength: 10240,
    maxArrayLength: 1000,
    maxKeys: 1000,
    strict: process.env.NODE_ENV !== 'production',
    onError: null,
});

let globalDefaults = { ...DEFAULTS };

function configureSerializer(opts) {
    if (!opts || typeof opts !== 'object') return;
    globalDefaults = { ...globalDefaults, ...opts };
}

function resolveOpts(opts = {}) {
    return {
        maxDepth: opts.maxDepth ?? globalDefaults.maxDepth,
        maxStringLength: opts.maxStringLength ?? globalDefaults.maxStringLength,
        maxArrayLength: opts.maxArrayLength ?? globalDefaults.maxArrayLength,
        maxKeys: opts.maxKeys ?? globalDefaults.maxKeys,
        strict: opts.strict ?? globalDefaults.strict,
        onError: opts.onError ?? globalDefaults.onError,
    };
}

// 仅用于测试：重置全局配置
function _resetForTest() {
    globalDefaults = { ...DEFAULTS };
}

module.exports = { DEFAULTS, configureSerializer, resolveOpts, _resetForTest };
```

- [ ] **Step 2.2.2: 跑测试，应当通过**

Run: `npm test`
Expected: 7 passed（含 smoke 测试）

### Step 2.3：提交

- [ ] **Step 2.3.1: 提交 limits 模块**

```bash
git add src/shared/serializer/limits.js src/shared/serializer/__tests__/limits.test.js
git commit -m "$(cat <<'EOF'
feat(serializer): 实现 limits 模块与全局配置

提供 DEFAULTS 常量、configureSerializer 全局配置入口、
resolveOpts 三级回退（per-call > global > default）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: placeholders 模块

**Files:**
- Create: `src/shared/serializer/placeholders.js`
- Create: `src/shared/serializer/__tests__/placeholders.test.js`

### Step 3.1：写失败测试

- [ ] **Step 3.1.1: 创建测试**

Create `src/shared/serializer/__tests__/placeholders.test.js`：

```js
const { describe, it, expect } = require('vitest');
const ph = require('../placeholders');

describe('placeholders', () => {
    it('fnPlaceholder uses fn.name when present', () => {
        function foo() {}
        expect(ph.fnPlaceholder(foo)).toBe('[Function: foo]');
    });

    it('fnPlaceholder uses anonymous when name empty', () => {
        const f = (() => () => {})();
        Object.defineProperty(f, 'name', { value: '' });
        expect(ph.fnPlaceholder(f)).toBe('[Function: anonymous]');
    });

    it('symbolPlaceholder with description', () => {
        expect(ph.symbolPlaceholder(Symbol('hello'))).toBe('[Symbol(hello)]');
    });

    it('symbolPlaceholder without description', () => {
        expect(ph.symbolPlaceholder(Symbol())).toBe('[Symbol]');
    });

    it('bigintPlaceholder formats decimal', () => {
        expect(ph.bigintPlaceholder(12345n)).toBe('[BigInt: 12345]');
    });

    it('bufferPlaceholder uses byteLength', () => {
        const buf = Buffer.alloc(128);
        expect(ph.bufferPlaceholder(buf)).toBe('[Buffer: 128 bytes]');
    });

    it('bufferPlaceholder uses ArrayBuffer.byteLength', () => {
        const ab = new ArrayBuffer(64);
        expect(ph.bufferPlaceholder(ab)).toBe('[Buffer: 64 bytes]');
    });

    it('circularPlaceholder includes path', () => {
        expect(ph.circularPlaceholder('$.a.b')).toBe('[Circular: $.a.b]');
    });

    it('maxDepthPlaceholder', () => {
        expect(ph.maxDepthPlaceholder()).toBe('[MaxDepth]');
    });

    it('numberPlaceholder normal numbers passthrough', () => {
        expect(ph.numberPlaceholder(42)).toBe(42);
        expect(ph.numberPlaceholder(0)).toBe(0);
        expect(ph.numberPlaceholder(-1.5)).toBe(-1.5);
    });

    it('numberPlaceholder handles NaN', () => {
        expect(ph.numberPlaceholder(NaN)).toBe('[Number: NaN]');
    });

    it('numberPlaceholder handles Infinity', () => {
        expect(ph.numberPlaceholder(Infinity)).toBe('[Number: Infinity]');
        expect(ph.numberPlaceholder(-Infinity)).toBe('[Number: -Infinity]');
    });

    it('truncatedStringSuffix', () => {
        expect(ph.truncatedStringSuffix(123)).toBe('...[truncated 123 chars]');
    });

    it('truncatedArrayItem', () => {
        expect(ph.truncatedArrayItem(50)).toBe('...[truncated 50 items]');
    });

    it('truncatedKeysValue', () => {
        expect(ph.truncatedKeysValue(7)).toBe('7 more keys');
    });

    it('promisePlaceholder', () => {
        expect(ph.promisePlaceholder()).toBe('[Promise]');
    });

    it('weakMapPlaceholder', () => {
        expect(ph.weakMapPlaceholder()).toBe('[WeakMap]');
    });

    it('weakSetPlaceholder', () => {
        expect(ph.weakSetPlaceholder()).toBe('[WeakSet]');
    });

    it('domPlaceholder uses tagName', () => {
        const node = { tagName: 'DIV', nodeName: 'DIV', nodeType: 1 };
        expect(ph.domPlaceholder(node)).toBe('[DOM: DIV]');
    });

    it('domPlaceholder fallback to nodeName', () => {
        const node = { nodeName: '#text', nodeType: 3 };
        expect(ph.domPlaceholder(node)).toBe('[DOM: #text]');
    });

    it('windowPlaceholder', () => {
        expect(ph.windowPlaceholder()).toBe('[Window]');
    });

    it('unserializablePlaceholder', () => {
        expect(ph.unserializablePlaceholder('boom')).toBe('[Unserializable: boom]');
    });
});
```

- [ ] **Step 3.1.2: 跑测试，应当失败**

Run: `npm test`
Expected: 22 failures，`Cannot find module '../placeholders'`

### Step 3.2：实现 placeholders 模块

- [ ] **Step 3.2.1: 创建 placeholders.js**

Create `src/shared/serializer/placeholders.js`：

```js
function fnPlaceholder(fn) {
    const name = fn.name || 'anonymous';
    return `[Function: ${name}]`;
}

function symbolPlaceholder(sym) {
    const desc = sym.description;
    return desc ? `[Symbol(${desc})]` : '[Symbol]';
}

function bigintPlaceholder(v) {
    return `[BigInt: ${v.toString()}]`;
}

function bufferPlaceholder(buf) {
    const len = (typeof buf.byteLength === 'number')
        ? buf.byteLength
        : (typeof buf.length === 'number' ? buf.length : 0);
    return `[Buffer: ${len} bytes]`;
}

function circularPlaceholder(path) {
    return `[Circular: ${path || '$'}]`;
}

function maxDepthPlaceholder() {
    return '[MaxDepth]';
}

function numberPlaceholder(n) {
    if (Number.isNaN(n)) return '[Number: NaN]';
    if (n === Infinity) return '[Number: Infinity]';
    if (n === -Infinity) return '[Number: -Infinity]';
    return n;
}

function truncatedStringSuffix(removed) {
    return `...[truncated ${removed} chars]`;
}

function truncatedArrayItem(removed) {
    return `...[truncated ${removed} items]`;
}

function truncatedKeysValue(removed) {
    return `${removed} more keys`;
}

function promisePlaceholder() { return '[Promise]'; }
function weakMapPlaceholder() { return '[WeakMap]'; }
function weakSetPlaceholder() { return '[WeakSet]'; }

function domPlaceholder(node) {
    const tag = node.tagName || node.nodeName || 'Node';
    return `[DOM: ${tag}]`;
}

function windowPlaceholder() { return '[Window]'; }

function unserializablePlaceholder(reason) {
    return `[Unserializable: ${reason}]`;
}

module.exports = {
    fnPlaceholder,
    symbolPlaceholder,
    bigintPlaceholder,
    bufferPlaceholder,
    circularPlaceholder,
    maxDepthPlaceholder,
    numberPlaceholder,
    truncatedStringSuffix,
    truncatedArrayItem,
    truncatedKeysValue,
    promisePlaceholder,
    weakMapPlaceholder,
    weakSetPlaceholder,
    domPlaceholder,
    windowPlaceholder,
    unserializablePlaceholder,
};
```

- [ ] **Step 3.2.2: 跑测试**

Run: `npm test`
Expected: 全部 22 个 placeholders 测试通过 + 之前的 limits/smoke 测试

### Step 3.3：提交

- [ ] **Step 3.3.1: 提交**

```bash
git add src/shared/serializer/placeholders.js src/shared/serializer/__tests__/placeholders.test.js
git commit -m "$(cat <<'EOF'
feat(serializer): 实现占位符生成模块

提供函数/Symbol/BigInt/Buffer/循环/截断/上限等各类占位符字符串生成。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: adapters 模块（特殊类型识别与转换）

**Files:**
- Create: `src/shared/serializer/adapters.js`
- Create: `src/shared/serializer/__tests__/adapters.test.js`

### Step 4.1：写失败测试

- [ ] **Step 4.1.1: 创建测试**

Create `src/shared/serializer/__tests__/adapters.test.js`：

```js
const { describe, it, expect } = require('vitest');
const ad = require('../adapters');

describe('adapters type predicates', () => {
    it('isPlainObject true for {}', () => {
        expect(ad.isPlainObject({})).toBe(true);
        expect(ad.isPlainObject(Object.create(null))).toBe(true);
    });

    it('isPlainObject false for class instance, array, null', () => {
        class C {}
        expect(ad.isPlainObject(new C())).toBe(false);
        expect(ad.isPlainObject([])).toBe(false);
        expect(ad.isPlainObject(null)).toBe(false);
        expect(ad.isPlainObject(new Date())).toBe(false);
    });

    it('isError detects Error and subclasses', () => {
        expect(ad.isError(new Error())).toBe(true);
        expect(ad.isError(new TypeError())).toBe(true);
        class MyErr extends Error {}
        expect(ad.isError(new MyErr())).toBe(true);
        expect(ad.isError({})).toBe(false);
    });

    it('isBuffer', () => {
        expect(ad.isBuffer(Buffer.alloc(4))).toBe(true);
        expect(ad.isBuffer(new Uint8Array(4))).toBe(false);
        expect(ad.isBuffer({})).toBe(false);
    });

    it('isArrayBuffer', () => {
        expect(ad.isArrayBuffer(new ArrayBuffer(8))).toBe(true);
        expect(ad.isArrayBuffer(Buffer.alloc(4))).toBe(false);
    });

    it('isTypedArray', () => {
        expect(ad.isTypedArray(new Uint8Array(4))).toBe(true);
        expect(ad.isTypedArray(new Float64Array(4))).toBe(true);
        expect(ad.isTypedArray(new DataView(new ArrayBuffer(4)))).toBe(false);
        expect(ad.isTypedArray([])).toBe(false);
    });

    it('isPromise', () => {
        expect(ad.isPromise(Promise.resolve())).toBe(true);
        expect(ad.isPromise({ then: () => {} })).toBe(true);
        expect(ad.isPromise({})).toBe(false);
        expect(ad.isPromise(null)).toBe(false);
    });

    it('isDomNode (synthetic)', () => {
        const fakeNode = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV' };
        expect(ad.isDomNode(fakeNode)).toBe(true);
        expect(ad.isDomNode({ nodeType: 'oops', nodeName: 'x' })).toBe(false);
        expect(ad.isDomNode(null)).toBe(false);
    });
});

describe('adapters value transformers', () => {
    it('adaptDate returns ISO string', () => {
        const d = new Date('2026-05-27T10:00:00.000Z');
        expect(ad.adaptDate(d)).toBe('2026-05-27T10:00:00.000Z');
    });

    it('adaptDate returns null for invalid Date', () => {
        const d = new Date('not a date');
        expect(ad.adaptDate(d)).toBeNull();
    });

    it('adaptError returns name/message/stack', () => {
        const e = new TypeError('boom');
        const out = ad.adaptError(e, x => x);
        expect(out.name).toBe('TypeError');
        expect(out.message).toBe('boom');
        expect(typeof out.stack).toBe('string');
    });

    it('adaptError includes code if present', () => {
        const e = new Error('x');
        e.code = 'EMOCK';
        const out = ad.adaptError(e, x => x);
        expect(out.code).toBe('EMOCK');
    });

    it('adaptError recurses cause via callback', () => {
        const inner = new Error('inner');
        const outer = new Error('outer');
        outer.cause = inner;
        const out = ad.adaptError(outer, () => 'CAUSE_PLACEHOLDER');
        expect(out.cause).toBe('CAUSE_PLACEHOLDER');
    });

    it('adaptMap with string keys returns plain object', () => {
        const m = new Map([['a', 1], ['b', 2]]);
        const out = ad.adaptMap(m, x => x);
        expect(out).toEqual({ a: 1, b: 2 });
    });

    it('adaptMap with non-string key returns entries array', () => {
        const m = new Map([[1, 'one'], ['b', 2]]);
        const out = ad.adaptMap(m, x => x);
        expect(out).toEqual([[1, 'one'], ['b', 2]]);
    });

    it('adaptSet returns array', () => {
        const s = new Set([1, 2, 3]);
        expect(ad.adaptSet(s, x => x)).toEqual([1, 2, 3]);
    });

    it('adaptRegExp returns source + flags', () => {
        const r = /abc/gi;
        expect(ad.adaptRegExp(r)).toEqual({ source: 'abc', flags: 'gi' });
    });
});
```

- [ ] **Step 4.1.2: 跑测试，应当失败**

Run: `npm test`
Expected: adapters 模块所有测试 fail（`Cannot find module '../adapters'`）

### Step 4.2：实现 adapters 模块

- [ ] **Step 4.2.1: 创建 adapters.js**

Create `src/shared/serializer/adapters.js`：

```js
function isPlainObject(v) {
    if (v === null || typeof v !== 'object') return false;
    const proto = Object.getPrototypeOf(v);
    return proto === null || proto === Object.prototype;
}

function isError(v) {
    return v instanceof Error;
}

function isBuffer(v) {
    return typeof Buffer !== 'undefined' && Buffer.isBuffer(v);
}

function isArrayBuffer(v) {
    return v instanceof ArrayBuffer;
}

function isTypedArray(v) {
    return ArrayBuffer.isView(v) && !(v instanceof DataView);
}

function isPromise(v) {
    return v !== null && typeof v === 'object' && typeof v.then === 'function';
}

function isDomNode(v) {
    return v !== null
        && typeof v === 'object'
        && typeof v.nodeType === 'number'
        && typeof v.nodeName === 'string';
}

function isWindowLike(v) {
    if (v === null || typeof v !== 'object') return false;
    try {
        return v.window === v && typeof v.document === 'object';
    } catch (_) {
        return false;
    }
}

function adaptDate(d) {
    const t = d.getTime();
    if (Number.isNaN(t)) return null;
    return d.toISOString();
}

function adaptError(err, recurse) {
    const out = {
        name: err.name || 'Error',
        message: err.message || '',
        stack: err.stack || '',
    };
    if (err.code !== undefined) out.code = err.code;
    if (err.cause !== undefined) out.cause = recurse(err.cause);
    return out;
}

function adaptMap(m, recurse) {
    let allStringKeys = true;
    for (const k of m.keys()) {
        if (typeof k !== 'string') { allStringKeys = false; break; }
    }
    if (allStringKeys) {
        const out = {};
        for (const [k, v] of m) out[k] = recurse(v);
        return out;
    }
    return [...m].map(([k, v]) => [recurse(k), recurse(v)]);
}

function adaptSet(s, recurse) {
    const out = [];
    for (const v of s) out.push(recurse(v));
    return out;
}

function adaptRegExp(r) {
    return { source: r.source, flags: r.flags };
}

module.exports = {
    isPlainObject,
    isError,
    isBuffer,
    isArrayBuffer,
    isTypedArray,
    isPromise,
    isDomNode,
    isWindowLike,
    adaptDate,
    adaptError,
    adaptMap,
    adaptSet,
    adaptRegExp,
};
```

- [ ] **Step 4.2.2: 跑测试，应当通过**

Run: `npm test`
Expected: 所有 adapters 测试通过，累计 limits + placeholders + adapters + smoke 全绿。

### Step 4.3：提交

- [ ] **Step 4.3.1: 提交**

```bash
git add src/shared/serializer/adapters.js src/shared/serializer/__tests__/adapters.test.js
git commit -m "$(cat <<'EOF'
feat(serializer): 实现特殊类型识别与转换适配器

包含 Plain/Error/Buffer/TypedArray/Promise/DOM/Window 类型谓词，
以及 Date/Error/Map/Set/RegExp 的 plain 形式转换。
adaptMap 支持 string-key 转对象、混合 key 转 entries 数组的分支。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 核心 serialize 函数

**Files:**
- Create: `src/shared/serializer/index.js`
- Create: `src/shared/serializer/__tests__/serializer.test.js`
- Create: `src/shared/serializer/__tests__/circular.test.js`
- Create: `src/shared/serializer/__tests__/limits-runtime.test.js`
- Create: `src/shared/serializer/__tests__/never-throw.test.js`

### Step 5.1：核心 serialize 测试（基础类型 + 普通对象）

- [ ] **Step 5.1.1: 写核心测试**

Create `src/shared/serializer/__tests__/serializer.test.js`：

```js
const { describe, it, expect, beforeEach } = require('vitest');
const { serialize } = require('../index');
const { _resetForTest } = require('../limits');

describe('serialize basic types', () => {
    beforeEach(() => _resetForTest());

    it('passes through string/number/boolean', () => {
        expect(serialize('abc')).toBe('abc');
        expect(serialize(42)).toBe(42);
        expect(serialize(true)).toBe(true);
        expect(serialize(false)).toBe(false);
    });

    it('passes through null/undefined', () => {
        expect(serialize(null)).toBeNull();
        expect(serialize(undefined)).toBeUndefined();
    });

    it('NaN/Infinity become placeholders', () => {
        expect(serialize(NaN)).toBe('[Number: NaN]');
        expect(serialize(Infinity)).toBe('[Number: Infinity]');
        expect(serialize(-Infinity)).toBe('[Number: -Infinity]');
    });

    it('bigint becomes placeholder', () => {
        expect(serialize(42n)).toBe('[BigInt: 42]');
    });

    it('symbol becomes placeholder', () => {
        expect(serialize(Symbol('x'))).toBe('[Symbol(x)]');
    });

    it('function becomes placeholder', () => {
        function named() {}
        expect(serialize(named)).toBe('[Function: named]');
    });
});

describe('serialize plain object/array', () => {
    beforeEach(() => _resetForTest());

    it('deep copies plain object', () => {
        const input = { a: 1, b: { c: 2 } };
        const out = serialize(input);
        expect(out).toEqual({ a: 1, b: { c: 2 } });
        out.b.c = 99;
        expect(input.b.c).toBe(2);
    });

    it('deep copies array', () => {
        const input = [1, [2, [3]]];
        expect(serialize(input)).toEqual([1, [2, [3]]]);
    });

    it('mixed nested', () => {
        const input = { a: [1, { b: 'c' }] };
        expect(serialize(input)).toEqual({ a: [1, { b: 'c' }] });
    });
});

describe('serialize special types', () => {
    beforeEach(() => _resetForTest());

    it('Date -> ISO string', () => {
        const d = new Date('2026-05-27T00:00:00.000Z');
        expect(serialize(d)).toBe('2026-05-27T00:00:00.000Z');
    });

    it('Error -> plain object', () => {
        const e = new TypeError('boom');
        const out = serialize(e);
        expect(out.name).toBe('TypeError');
        expect(out.message).toBe('boom');
        expect(typeof out.stack).toBe('string');
    });

    it('Error with cause recurses', () => {
        const inner = new Error('inner');
        const outer = new Error('outer');
        outer.cause = inner;
        const out = serialize(outer);
        expect(out.cause.message).toBe('inner');
    });

    it('Map string keys -> object', () => {
        const m = new Map([['a', 1], ['b', 2]]);
        expect(serialize(m)).toEqual({ a: 1, b: 2 });
    });

    it('Map mixed keys -> entries array', () => {
        const m = new Map([[1, 'one']]);
        expect(serialize(m)).toEqual([[1, 'one']]);
    });

    it('Set -> array', () => {
        expect(serialize(new Set([1, 2, 3]))).toEqual([1, 2, 3]);
    });

    it('RegExp -> { source, flags }', () => {
        expect(serialize(/abc/gi)).toEqual({ source: 'abc', flags: 'gi' });
    });

    it('Buffer -> placeholder', () => {
        expect(serialize(Buffer.alloc(64))).toBe('[Buffer: 64 bytes]');
    });

    it('ArrayBuffer -> placeholder', () => {
        expect(serialize(new ArrayBuffer(32))).toBe('[Buffer: 32 bytes]');
    });

    it('TypedArray -> array of numbers', () => {
        const u = new Uint8Array([1, 2, 3]);
        expect(serialize(u)).toEqual([1, 2, 3]);
    });

    it('Promise -> placeholder', () => {
        expect(serialize(Promise.resolve(1))).toBe('[Promise]');
    });

    it('WeakMap/WeakSet -> placeholder', () => {
        expect(serialize(new WeakMap())).toBe('[WeakMap]');
        expect(serialize(new WeakSet())).toBe('[WeakSet]');
    });

    it('class instance -> plain copy without __type', () => {
        class User {
            constructor(id, name) { this.id = id; this.name = name; }
            greet() { return 'hi'; }
        }
        const u = new User(1, 'alice');
        const out = serialize(u);
        expect(out).toEqual({ id: 1, name: 'alice' });
        expect(out.__type).toBeUndefined();
    });
});

describe('serialize toJSON convention', () => {
    beforeEach(() => _resetForTest());

    it('respects toJSON()', () => {
        const obj = { x: 1, toJSON() { return { x: 'replaced' }; } };
        expect(serialize(obj)).toEqual({ x: 'replaced' });
    });

    it('falls back when toJSON throws (strict=false)', () => {
        const obj = { x: 1, toJSON() { throw new Error('nope'); } };
        const out = serialize(obj, { strict: false });
        expect(out).toEqual({ x: 1 });
    });
});

describe('serialize JSON-safety guarantee', () => {
    beforeEach(() => _resetForTest());

    it('output is always JSON.stringify-safe', () => {
        const weird = {
            fn: () => {},
            sym: Symbol('x'),
            big: 99n,
            buf: Buffer.alloc(1),
            map: new Map([[1, 'a']]),
            set: new Set([1]),
            re: /x/,
            date: new Date(0),
            nan: NaN,
        };
        expect(() => JSON.stringify(serialize(weird))).not.toThrow();
    });
});
```

### Step 5.2：循环引用测试

- [ ] **Step 5.2.1: 写循环引用测试**

Create `src/shared/serializer/__tests__/circular.test.js`：

```js
const { describe, it, expect, beforeEach } = require('vitest');
const { serialize } = require('../index');
const { _resetForTest } = require('../limits');

describe('serialize circular references', () => {
    beforeEach(() => _resetForTest());

    it('direct self-reference', () => {
        const a = { name: 'a' };
        a.self = a;
        const out = serialize(a);
        expect(out.name).toBe('a');
        expect(out.self).toBe('[Circular: $]');
    });

    it('indirect cycle', () => {
        const a = { name: 'a' };
        const b = { name: 'b' };
        a.b = b;
        b.a = a;
        const out = serialize(a);
        expect(out.name).toBe('a');
        expect(out.b.name).toBe('b');
        expect(out.b.a).toBe('[Circular: $]');
    });

    it('cycle inside array', () => {
        const a = [];
        a.push(a);
        const out = serialize(a);
        expect(out).toEqual(['[Circular: $]']);
    });

    it('cycle path is recorded', () => {
        const root = {};
        const child = { name: 'child' };
        root.child = child;
        child.back = root;
        const out = serialize(root);
        expect(out.child.back).toBe('[Circular: $]');
    });

    it('JSON.stringify on circular output never throws', () => {
        const a = { x: 1 };
        a.self = a;
        expect(() => JSON.stringify(serialize(a))).not.toThrow();
    });
});
```

### Step 5.3：上限策略测试

- [ ] **Step 5.3.1: 写上限测试**

Create `src/shared/serializer/__tests__/limits-runtime.test.js`：

```js
const { describe, it, expect, beforeEach } = require('vitest');
const { serialize } = require('../index');
const { _resetForTest, configureSerializer } = require('../limits');

describe('serialize limits', () => {
    beforeEach(() => _resetForTest());

    it('truncates long string', () => {
        const s = 'a'.repeat(100);
        const out = serialize(s, { maxStringLength: 10 });
        expect(out.startsWith('aaaaaaaaaa')).toBe(true);
        expect(out).toContain('...[truncated 90 chars]');
    });

    it('truncates long array', () => {
        const a = Array.from({ length: 100 }, (_, i) => i);
        const out = serialize(a, { maxArrayLength: 5 });
        expect(out.length).toBe(6); // 5 + 1 truncation marker
        expect(out[0]).toBe(0);
        expect(out[4]).toBe(4);
        expect(out[5]).toBe('...[truncated 95 items]');
    });

    it('truncates many keys', () => {
        const obj = {};
        for (let i = 0; i < 100; i++) obj['k' + i] = i;
        const out = serialize(obj, { maxKeys: 3 });
        expect(Object.keys(out).filter(k => k !== '__truncated').length).toBe(3);
        expect(out.__truncated).toBe('97 more keys');
    });

    it('caps recursion depth', () => {
        let cur = {};
        const root = cur;
        for (let i = 0; i < 10; i++) {
            cur.next = {};
            cur = cur.next;
        }
        const out = serialize(root, { maxDepth: 3 });
        // root(0).next(1).next(2).next(3=MaxDepth)
        expect(out.next.next.next).toBe('[MaxDepth]');
    });

    it('configureSerializer applies to global', () => {
        configureSerializer({ maxStringLength: 5 });
        const out = serialize('aaaaaaaaaa');
        expect(out).toContain('...[truncated 5 chars]');
    });

    it('per-call opts override configured global', () => {
        configureSerializer({ maxStringLength: 5 });
        const out = serialize('aaaaaaaaaa', { maxStringLength: 100 });
        expect(out).toBe('aaaaaaaaaa');
    });
});
```

### Step 5.4：永不抛错测试

- [ ] **Step 5.4.1: 写永不抛错测试**

Create `src/shared/serializer/__tests__/never-throw.test.js`：

```js
const { describe, it, expect, beforeEach, vi } = require('vitest');
const { serialize } = require('../index');
const { _resetForTest } = require('../limits');

function throwingGetter(name) {
    const obj = {};
    Object.defineProperty(obj, name, {
        enumerable: true,
        get() { throw new Error('getter boom'); }
    });
    return obj;
}

describe('serialize never throws (strict=false)', () => {
    beforeEach(() => _resetForTest());

    it('getter that throws -> placeholder', () => {
        const obj = throwingGetter('bad');
        const out = serialize(obj, { strict: false });
        expect(out.bad).toContain('Unserializable');
    });

    it('toJSON that throws -> falls back', () => {
        const obj = { good: 1, toJSON() { throw new Error('no'); } };
        expect(() => serialize(obj, { strict: false })).not.toThrow();
    });

    it('Proxy with throwing getter trap', () => {
        const p = new Proxy({}, {
            get() { throw new Error('proxy boom'); },
            ownKeys() { return ['x']; },
            getOwnPropertyDescriptor() { return { enumerable: true, configurable: true }; },
        });
        expect(() => serialize(p, { strict: false })).not.toThrow();
    });

    it('combined: cycle + throwing getter + deep', () => {
        const root = {};
        root.self = root;
        Object.defineProperty(root, 'bad', {
            enumerable: true,
            get() { throw new Error('x'); },
        });
        let cur = root;
        for (let i = 0; i < 50; i++) {
            cur.next = {};
            cur = cur.next;
        }
        expect(() => serialize(root, { strict: false })).not.toThrow();
    });

    it('onError invoked on unexpected exception', () => {
        const onError = vi.fn();
        const obj = throwingGetter('x');
        serialize(obj, { strict: false, onError });
        expect(onError).toHaveBeenCalled();
        const [reason, path] = onError.mock.calls[0];
        expect(reason).toContain('getter boom');
        expect(path).toBe('$.x');
    });

    it('onError NOT invoked on lossy conversion (function/symbol)', () => {
        const onError = vi.fn();
        serialize({ f: () => {}, s: Symbol('x') }, { strict: false, onError });
        expect(onError).not.toHaveBeenCalled();
    });
});

describe('serialize strict mode', () => {
    beforeEach(() => _resetForTest());

    it('rethrows on unexpected exception', () => {
        const obj = throwingGetter('x');
        expect(() => serialize(obj, { strict: true })).toThrow();
    });

    it('does NOT throw on lossy conversion in strict', () => {
        expect(() => serialize({ f: () => {} }, { strict: true })).not.toThrow();
    });
});
```

- [ ] **Step 5.4.2: 跑所有 Task 5 测试，应当全部失败**

Run: `npm test`
Expected: 上述 4 个测试文件所有 it 均 fail（`Cannot find module '../index'`）

### Step 5.5：实现核心 serialize 函数

- [ ] **Step 5.5.1: 创建 index.js**

Create `src/shared/serializer/index.js`：

```js
const ph = require('./placeholders');
const ad = require('./adapters');
const { resolveOpts, configureSerializer } = require('./limits');

function serialize(value, opts) {
    const finalOpts = resolveOpts(opts);
    const seen = new WeakMap();

    function reportError(reason, path) {
        if (finalOpts.strict) {
            const err = new Error(`[serializer] ${reason} at ${path}`);
            throw err;
        }
        if (typeof finalOpts.onError === 'function') {
            try { finalOpts.onError(reason, path); } catch (_) { /* swallow */ }
        }
    }

    function walk(v, depth, path) {
        // 原始类型
        if (v === null) return null;
        if (v === undefined) return undefined;
        const t = typeof v;
        if (t === 'string') {
            if (v.length > finalOpts.maxStringLength) {
                return v.slice(0, finalOpts.maxStringLength)
                    + ph.truncatedStringSuffix(v.length - finalOpts.maxStringLength);
            }
            return v;
        }
        if (t === 'number') return ph.numberPlaceholder(v);
        if (t === 'boolean') return v;
        if (t === 'bigint') return ph.bigintPlaceholder(v);
        if (t === 'symbol') return ph.symbolPlaceholder(v);
        if (t === 'function') return ph.fnPlaceholder(v);

        // 此处 v 是 object
        if (depth >= finalOpts.maxDepth) return ph.maxDepthPlaceholder();

        if (seen.has(v)) return ph.circularPlaceholder(seen.get(v));
        seen.set(v, path);

        // 特殊类型适配（在 toJSON 之前 —— Date 自带 toJSON，但我们要 ISO 字符串而非 toJSON 结果，两者等价）
        try {
            if (v instanceof Date) return ad.adaptDate(v);
            if (ad.isError(v)) return ad.adaptError(v, (x) => walk(x, depth + 1, path + '.cause'));
            if (v instanceof RegExp) return ad.adaptRegExp(v);
            if (ad.isBuffer(v) || ad.isArrayBuffer(v)) return ph.bufferPlaceholder(v);
            if (ad.isPromise(v)) return ph.promisePlaceholder();
            if (typeof WeakMap !== 'undefined' && v instanceof WeakMap) return ph.weakMapPlaceholder();
            if (typeof WeakSet !== 'undefined' && v instanceof WeakSet) return ph.weakSetPlaceholder();
            if (ad.isWindowLike(v)) return ph.windowPlaceholder();
            if (ad.isDomNode(v)) return ph.domPlaceholder(v);
            if (v instanceof Map) return ad.adaptMap(v, (x) => walk(x, depth + 1, path));
            if (v instanceof Set) return ad.adaptSet(v, (x) => walk(x, depth + 1, path));
        } catch (e) {
            reportError(`adapter threw: ${e.message}`, path);
            // 回退到普通对象路径
        }

        // toJSON 优先（在 TypedArray/Array/Object 之前）
        if (typeof v.toJSON === 'function') {
            try {
                const replaced = v.toJSON();
                return walk(replaced, depth, path);
            } catch (e) {
                reportError(`toJSON threw: ${e.message}`, path);
                // 回退到普通对象路径
            }
        }

        // TypedArray
        if (ad.isTypedArray(v)) {
            return walkArray(Array.from(v), depth, path);
        }

        // 数组
        if (Array.isArray(v)) return walkArray(v, depth, path);

        // 普通对象 / class 实例
        return walkObject(v, depth, path);
    }

    function walkArray(arr, depth, path) {
        const limit = finalOpts.maxArrayLength;
        const out = [];
        const len = Math.min(arr.length, limit);
        for (let i = 0; i < len; i++) {
            let item;
            try {
                item = arr[i];
            } catch (e) {
                reportError(`array[${i}] threw: ${e.message}`, `${path}[${i}]`);
                out.push(ph.unserializablePlaceholder(e.message));
                continue;
            }
            out.push(walk(item, depth + 1, `${path}[${i}]`));
        }
        if (arr.length > limit) {
            out.push(ph.truncatedArrayItem(arr.length - limit));
        }
        return out;
    }

    function walkObject(obj, depth, path) {
        let keys;
        try {
            keys = Object.keys(obj);
        } catch (e) {
            reportError(`Object.keys threw: ${e.message}`, path);
            return ph.unserializablePlaceholder(e.message);
        }
        const limit = finalOpts.maxKeys;
        const sliced = keys.slice(0, limit);
        const out = {};
        for (const key of sliced) {
            let val;
            try {
                val = obj[key];
            } catch (e) {
                reportError(`getter "${key}" threw: ${e.message}`, `${path}.${key}`);
                out[key] = ph.unserializablePlaceholder(e.message);
                continue;
            }
            out[key] = walk(val, depth + 1, `${path}.${key}`);
        }
        if (keys.length > limit) {
            out.__truncated = ph.truncatedKeysValue(keys.length - limit);
        }
        return out;
    }

    try {
        return walk(value, 0, '$');
    } catch (e) {
        if (finalOpts.strict) throw e;
        if (typeof finalOpts.onError === 'function') {
            try { finalOpts.onError(`top-level: ${e.message}`, '$'); } catch (_) {}
        }
        return ph.unserializablePlaceholder(`SerializeError: ${e.message}`);
    }
}

function safeStringify(value, opts) {
    try {
        return JSON.stringify(serialize(value, opts));
    } catch (e) {
        return JSON.stringify(`[SerializeError: ${e.message}]`);
    }
}

module.exports = { serialize, safeStringify, configureSerializer };
```

- [ ] **Step 5.5.2: 跑全部测试**

Run: `npm test`
Expected: 全部 Task 5 测试通过；累计若干（约 70+）测试用例全部 PASS。

如有失败：
- 看失败的具体测试，对照 `index.js` 实现逐行核对
- 常见问题：`toJSON` 与 Date 的顺序、`adaptMap` 在 walk 之前还是之后调用、`seen` WeakMap 命中时机
- 不要为了过测试乱改测试用例——测试是合约

### Step 5.6：提交核心 serializer

- [ ] **Step 5.6.1: 提交**

```bash
git add src/shared/serializer/index.js \
        src/shared/serializer/__tests__/serializer.test.js \
        src/shared/serializer/__tests__/circular.test.js \
        src/shared/serializer/__tests__/limits-runtime.test.js \
        src/shared/serializer/__tests__/never-throw.test.js
git commit -m "$(cat <<'EOF'
feat(serializer): 实现核心 serialize 与 safeStringify

- 递归遍历 + WeakMap 循环检测
- 上限策略（深度/字符串/数组/对象键）
- toJSON 约定，失败回退到普通对象路径
- strict 模式分离 lossy 静默与意外异常抛出
- 总兜底确保最外层永不抛错

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: reviveError 模块

**Files:**
- Create: `src/shared/serializer/reviveError.js`
- Create: `src/shared/serializer/__tests__/revive-error.test.js`

### Step 6.1：写失败测试

- [ ] **Step 6.1.1: 创建测试**

Create `src/shared/serializer/__tests__/revive-error.test.js`：

```js
const { describe, it, expect } = require('vitest');
const { reviveError } = require('../reviveError');
const { serialize } = require('../index');

describe('reviveError', () => {
    it('returns Error instance from serialized Error', () => {
        const orig = new TypeError('boom');
        const s = serialize(orig);
        const e = reviveError(s);
        expect(e).toBeInstanceOf(Error);
        expect(e).toBeInstanceOf(TypeError);
        expect(e.message).toBe('boom');
        expect(e.name).toBe('TypeError');
    });

    it('preserves stack', () => {
        const orig = new Error('x');
        const s = serialize(orig);
        const e = reviveError(s);
        expect(e.stack).toBe(orig.stack);
    });

    it('preserves code', () => {
        const orig = new Error('x');
        orig.code = 'EMOCK';
        const s = serialize(orig);
        const e = reviveError(s);
        expect(e.code).toBe('EMOCK');
    });

    it('recurses cause', () => {
        const inner = new Error('inner');
        const outer = new Error('outer');
        outer.cause = inner;
        const s = serialize(outer);
        const e = reviveError(s);
        expect(e.cause).toBeInstanceOf(Error);
        expect(e.cause.message).toBe('inner');
    });

    it('unknown error name falls back to Error', () => {
        const s = { name: 'MyCustomError', message: 'x', stack: 's' };
        const e = reviveError(s);
        expect(e).toBeInstanceOf(Error);
        expect(e.name).toBe('MyCustomError');
        expect(e.message).toBe('x');
    });

    it('falsy input becomes Error(String(input))', () => {
        expect(reviveError(null).message).toBe('null');
        expect(reviveError(undefined).message).toBe('undefined');
        expect(reviveError('plain string').message).toBe('plain string');
    });
});
```

- [ ] **Step 6.1.2: 跑测试，应当失败**

Run: `npm test`
Expected: 6 个 fail（`Cannot find module '../reviveError'`）

### Step 6.2：实现 reviveError

- [ ] **Step 6.2.1: 创建 reviveError.js**

Create `src/shared/serializer/reviveError.js`：

```js
const KNOWN_ERROR_CTORS = {
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    ReferenceError,
    URIError,
    EvalError,
};

function reviveError(s) {
    if (!s || typeof s !== 'object') {
        return new Error(String(s));
    }
    const Ctor = KNOWN_ERROR_CTORS[s.name] || Error;
    const err = new Ctor(s.message || '');
    if (s.name && err.name !== s.name) {
        Object.defineProperty(err, 'name', { value: s.name, writable: true, configurable: true });
    }
    if (s.stack) {
        Object.defineProperty(err, 'stack', { value: s.stack, writable: true, configurable: true });
    }
    if (s.code !== undefined) err.code = s.code;
    if (s.cause !== undefined) err.cause = reviveError(s.cause);
    return err;
}

module.exports = { reviveError };
```

- [ ] **Step 6.2.2: 跑测试**

Run: `npm test`
Expected: 全部通过

### Step 6.3：提交

- [ ] **Step 6.3.1: 提交**

```bash
git add src/shared/serializer/reviveError.js src/shared/serializer/__tests__/revive-error.test.js
git commit -m "$(cat <<'EOF'
feat(serializer): 实现 reviveError 用于 preload 端 Error 还原

支持 name/message/stack/code/cause 字段还原，
内置 Error 子类（TypeError 等）保持原型链，
未知 name 回退到 Error 但保留 name 字段。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 从 shared 入口导出 serializer

**Files:**
- Modify: `src/shared/index.js`

### Step 7.1：观察现有 shared 结构

- [ ] **Step 7.1.1: 查看 shared/index.js**

Run: `cat src/shared/index.js`

如内容已包含其他导出，把 serializer 添加进去，不破坏现有结构。

### Step 7.2：导出 serializer

- [ ] **Step 7.2.1: 修改 shared/index.js**

修改 `src/shared/index.js`，使其在原有导出基础上增加 serializer：

```js
const utils = require('./utils');
const enums = require('./enum');
const config = require('./config');
const serializer = require('./serializer');
const { reviveError } = require('./serializer/reviveError');

module.exports = {
    utils,
    enum: enums,
    config,
    serializer: {
        serialize: serializer.serialize,
        safeStringify: serializer.safeStringify,
        configureSerializer: serializer.configureSerializer,
        reviveError,
    },
};
```

> 注意：如 `src/shared/index.js` 当前导出结构与上面不同，请保持现有结构、仅添加 `serializer` 顶层 key。

- [ ] **Step 7.2.2: 验证不破坏现有测试**

Run: `npm test && npm run build`
Expected: 测试全绿；rollup 构建无错误。

### Step 7.3：提交

- [ ] **Step 7.3.1: 提交**

```bash
git add src/shared/index.js
git commit -m "$(cat <<'EOF'
feat(shared): 从 shared 入口导出 serializer 模块

暴露 serialize / safeStringify / configureSerializer / reviveError。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 集成到 Service 主进程

**Files:**
- Modify: `src/service/index.js`

### Step 8.1：写集成测试（mock electron）

- [ ] **Step 8.1.1: 创建 Service 主进程集成测试**

Create `src/service/__tests__/service-main.test.js`：

```js
const { describe, it, expect, beforeEach, vi } = require('vitest');

// mock electron 模块
vi.mock('electron', () => {
    const handlers = new Map();
    const syncListeners = new Map();
    return {
        ipcMain: {
            handle: vi.fn((channel, fn) => handlers.set(channel, fn)),
            removeHandler: vi.fn((channel) => handlers.delete(channel)),
            on: vi.fn((channel, fn) => {
                if (!syncListeners.has(channel)) syncListeners.set(channel, []);
                syncListeners.get(channel).push(fn);
            }),
            removeAllListeners: vi.fn((channel) => syncListeners.delete(channel)),
            __getHandlers: () => handlers,
            __getSyncListeners: () => syncListeners,
            __reset: () => { handlers.clear(); syncListeners.clear(); },
        },
    };
});

const electron = require('electron');
const Service = require('../index');

describe('Service main process integration', () => {
    beforeEach(() => {
        electron.ipcMain.__reset();
        Service.cleanup();
    });

    it('handler return value goes through serialize', async () => {
        Service.registerService({
            namespace: 'test',
            handlers: {
                getData: () => ({
                    fn: () => {},
                    date: new Date('2026-01-01T00:00:00.000Z'),
                    val: 42,
                }),
            },
        });

        const handler = electron.ipcMain.__getHandlers().get('test:getData');
        const result = await handler({});
        expect(result.fn).toContain('[Function:');
        expect(result.date).toBe('2026-01-01T00:00:00.000Z');
        expect(result.val).toBe(42);
    });

    it('handler thrown error is serialized and rethrown', async () => {
        Service.registerService({
            namespace: 'test',
            handlers: {
                explode: () => { throw new TypeError('boom'); },
            },
        });
        const handler = electron.ipcMain.__getHandlers().get('test:explode');
        await expect(handler({})).rejects.toThrow();
        try {
            await handler({});
        } catch (e) {
            const parsed = JSON.parse(e.message);
            expect(parsed.name).toBe('TypeError');
            expect(parsed.message).toBe('boom');
        }
    });

    it('sync handler return value goes through serialize', () => {
        Service.registerService({
            namespace: 'test',
            handlers: {
                pingSync: () => ({ fn: () => {} }),
            },
        });
        const syncFn = electron.ipcMain.__getSyncListeners().get('test:pingSyncSync')[0];
        const event = {};
        syncFn(event);
        expect(event.returnValue.fn).toContain('[Function:');
    });

    it('sync handler thrown error puts __ipcError on returnValue', async () => {
        Service.registerService({
            namespace: 'test',
            handlers: {
                explodeSync: () => { throw new Error('sync boom'); },
            },
        });
        const syncFn = electron.ipcMain.__getSyncListeners().get('test:explodeSyncSync')[0];
        const event = {};
        await syncFn(event);
        expect(event.returnValue.__ipcError).toBe(true);
        expect(event.returnValue.message).toBe('sync boom');
    });

    it('getServiceList output passes through serialize', () => {
        Service.registerService({
            namespace: 'test',
            handlers: { a: () => 1 },
        });
        const listFn = electron.ipcMain.__getSyncListeners().get('service:getServiceList')[0];
        const event = {};
        listFn(event);
        // 该回调实际通过 Service.init 注册，但此用例不通过 init 注册
        // 用直接调用 getServiceList 验证
        expect(Service.getServiceList()).toEqual([
            { namespace: 'test', handlers: ['a'] },
        ]);
    });
});
```

> 注：最后一个测试需要 init 注册才能拿到 listFn，下面实现里我们会通过直接调用 `getServiceList` 验证。如果 listFn 不存在则跳过最后断言。

### Step 8.2：跑测试，应当失败

- [ ] **Step 8.2.1: 跑测试**

Run: `npm test`
Expected: service-main 测试全部 fail（当前 service/index.js 实现未经 serialize）

### Step 8.3：改写 service/index.js

- [ ] **Step 8.3.1: 完整改写 service/index.js**

替换 `src/service/index.js` 的全部内容为：

```js
const exampleService = require('./__example');
const { ipcMain } = require('electron');
const { serialize } = require('../shared/serializer');

const REPLY_ERROR_KEY = '__ipcError';

const internalSchemas = [
    exampleService.schema,
];

const registeredSchemas = new Map();

function init(options = {}) {
    ipcMain.on('service:getServiceList', event => {
        event.returnValue = serialize(getServiceList(), { strict: false });
    });

    for (const schema of internalSchemas) {
        registerService(schema);
    }

    const userSchemas = options?.userSchemas;
    if (Array.isArray(userSchemas)) {
        for (const schema of userSchemas) {
            registerService(schema);
        }
    }
}

function registerService(schema) {
    const { namespace, handlers } = schema;
    if (registeredSchemas.has(namespace)) {
        throw new Error(
            `[Base] Service namespace "${namespace}" 冲突，请检查框架内置和用户定义`
        );
    }
    registeredSchemas.set(namespace, schema);

    for (const handlerName of Object.keys(handlers)) {
        const channel = `${namespace}:${handlerName}`;
        const syncChannel = `${channel}Sync`;
        const handler = handlers[handlerName];

        ipcMain.handle(channel, async (event, ...args) => {
            try {
                const result = await handler(...args, event);
                return serialize(result, { strict: false });
            } catch (err) {
                const serialized = serialize(err, { strict: false });
                throw new Error(JSON.stringify(serialized));
            }
        });

        ipcMain.on(syncChannel, async (event, ...args) => {
            try {
                const result = handler(...args, event);
                const value = result && typeof result.then === 'function' ? await result : result;
                event.returnValue = serialize(value, { strict: false });
            } catch (err) {
                event.returnValue = {
                    [REPLY_ERROR_KEY]: true,
                    ...serialize(err, { strict: false }),
                };
            }
        });
    }

    emitServiceChange(schema);
}

function unRegisterService(schema) {
    const { namespace, handlers } = schema;
    if (!registeredSchemas.has(namespace)) return;
    for (const handlerName of Object.keys(handlers)) {
        const channel = `${namespace}:${handlerName}`;
        const syncChannel = `${channel}Sync`;
        ipcMain.removeHandler(channel);
        ipcMain.removeAllListeners(syncChannel);
    }
    registeredSchemas.delete(namespace);
    emitServiceChange(schema);
}

function getServiceList() {
    const schemas = [...registeredSchemas.values()];
    return schemas.map(s => ({
        namespace: s.namespace,
        handlers: Object.keys(s.handlers),
    }));
}

function emitServiceChange(_schema) {
    // reserved for future schema-change notification to renderers
}

function cleanup() {
    ipcMain.removeAllListeners('service:getServiceList');
    for (const schema of registeredSchemas.values()) {
        unRegisterService(schema);
    }
    registeredSchemas.clear();
}

module.exports = { init, getServiceList, registerService, unRegisterService, cleanup };
```

注意以下变化：
- 删除 `lodash.isfunction` 的 require（用 `typeof result.then === 'function'`）
- 删除文件末尾 TODO 注释
- 修复 `cleanup()` 中 `removeListener` 原代码缺第二参数的 bug，改为 `removeAllListeners`
- 异步 handler return 加 await + serialize
- 异步 handler catch 包装为 `throw new Error(JSON.stringify(serialized))`
- 同步 handler returnValue 走 serialize
- 同步 handler error 走 `{__ipcError, ...serialize(err)}`
- `getServiceList` 经 `init` 注册的回调也包一层 serialize

- [ ] **Step 8.3.2: 跑测试**

Run: `npm test`
Expected: service-main 集成测试全部通过；其余测试不受影响。

### Step 8.4：提交

- [ ] **Step 8.4.1: 提交**

```bash
git add src/service/index.js src/service/__tests__/service-main.test.js
git commit -m "$(cat <<'EOF'
feat(service): main 端 handler return/error 自动 serialize

- 异步与同步两条路径都接入 serializer
- 收编原有 __ipcError 约定到 serialize(err)
- 移除 lodash.isfunction 依赖（一行 typeof 替代）
- 修复 cleanup 中 removeListener 缺参数的旧 bug

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: 集成到 Service preload 端

**Files:**
- Modify: `src/preload/service.js`

### Step 9.1：写 preload 集成测试

- [ ] **Step 9.1.1: 创建测试**

Create `src/preload/__tests__/service-preload.test.js`：

```js
const { describe, it, expect, beforeEach, vi } = require('vitest');

const fakeSchema = [
    { namespace: 'test', handlers: ['ping', 'explode'] },
];

const invokeImpl = vi.fn();
const sendSyncImpl = vi.fn();

vi.mock('electron', () => ({
    ipcRenderer: {
        invoke: (...args) => invokeImpl(...args),
        sendSync: (...args) => sendSyncImpl(...args),
        on: vi.fn(),
    },
}));

const buildAppService = require('../service');

describe('preload service args serialization', () => {
    beforeEach(() => {
        invokeImpl.mockReset();
        sendSyncImpl.mockReset();
        sendSyncImpl.mockImplementation((channel) => {
            if (channel === 'service:getServiceList') return fakeSchema;
            return undefined;
        });
    });

    it('async invoke args go through serialize', async () => {
        invokeImpl.mockResolvedValue('ok');
        const appService = buildAppService();
        await appService.test.ping({ fn: () => {}, ok: 1 });
        const [, ...safeArgs] = invokeImpl.mock.calls[0];
        expect(safeArgs[0].fn).toContain('[Function:');
        expect(safeArgs[0].ok).toBe(1);
    });

    it('sync sendSync args go through serialize', () => {
        sendSyncImpl.mockImplementation((channel) => {
            if (channel === 'service:getServiceList') return fakeSchema;
            return 'sync-ok';
        });
        const appService = buildAppService();
        appService.test.pingSync({ fn: () => {} });
        // 第一次 call 是 getServiceList，第二次才是 pingSyncSync
        const lastCall = sendSyncImpl.mock.calls.at(-1);
        expect(lastCall[0]).toBe('test:pingSyncSync');
        expect(lastCall[1].fn).toContain('[Function:');
    });

    it('async error from main is revived as Error instance', async () => {
        const remoteSerialized = { name: 'TypeError', message: 'boom', stack: 's' };
        const remoteErr = new Error(`Error invoking remote method 'test:explode': Error: ${JSON.stringify(remoteSerialized)}`);
        invokeImpl.mockRejectedValue(remoteErr);
        const appService = buildAppService();
        await expect(appService.test.explode()).rejects.toBeInstanceOf(Error);
        await expect(appService.test.explode()).rejects.toMatchObject({ name: 'TypeError', message: 'boom' });
    });

    it('async error without parseable payload propagates as-is', async () => {
        const raw = new Error('Network error');
        invokeImpl.mockRejectedValue(raw);
        const appService = buildAppService();
        await expect(appService.test.explode()).rejects.toThrow('Network error');
    });

    it('sync error envelope is revived to Error', () => {
        const appService = buildAppService();
        sendSyncImpl.mockImplementation((channel) => {
            if (channel === 'service:getServiceList') return fakeSchema;
            if (channel === 'test:explodeSync') return { __ipcError: true, name: 'Error', message: 'sync boom', stack: 's' };
            return undefined;
        });
        expect(() => appService.test.explodeSync()).toThrow('sync boom');
    });
});
```

### Step 9.2：跑测试，应当失败

- [ ] **Step 9.2.1: 跑测试**

Run: `npm test`
Expected: preload 测试 fail（当前实现没接 serialize 也没 reviveError）

### Step 9.3：改写 preload/service.js

- [ ] **Step 9.3.1: 改写**

替换 `src/preload/service.js` 全部内容：

```js
const { ipcRenderer } = require('electron');
const { serialize } = require('../shared/serializer');
const { reviveError } = require('../shared/serializer/reviveError');

const REPLY_ERROR_KEY = '__ipcError';

function tryParseRemoteError(err) {
    // electron 把 main 端 throw 的 Error.message 包成
    // "Error invoking remote method 'xxx:yyy': Error: {...json...}"
    if (!err || typeof err.message !== 'string') return null;
    const match = err.message.match(/(\{[\s\S]*\}|\[[\s\S]*\])\s*$/);
    if (!match) return null;
    try {
        return JSON.parse(match[1]);
    } catch (_) {
        return null;
    }
}

function buildAppService() {
    const serviceSchema = ipcRenderer.sendSync('service:getServiceList');
    const appService = {};

    for (const service of serviceSchema) {
        const { namespace, handlers } = service;
        appService[namespace] = {};

        for (const handler of handlers) {
            // 异步
            appService[namespace][handler] = async (...args) => {
                const safeArgs = args.map(a => serialize(a, { strict: false }));
                try {
                    return await ipcRenderer.invoke(`${namespace}:${handler}`, ...safeArgs);
                } catch (e) {
                    const parsed = tryParseRemoteError(e);
                    if (parsed) throw reviveError(parsed);
                    throw e;
                }
            };

            // 同步
            appService[namespace][`${handler}Sync`] = (...args) => {
                const safeArgs = args.map(a => serialize(a, { strict: false }));
                const result = ipcRenderer.sendSync(`${namespace}:${handler}Sync`, ...safeArgs);
                if (result && typeof result === 'object' && result[REPLY_ERROR_KEY]) {
                    throw reviveError(result);
                }
                return result;
            };
        }
    }

    return appService;
}

module.exports = buildAppService;
```

- [ ] **Step 9.3.2: 跑测试**

Run: `npm test`
Expected: preload service 测试全部通过

### Step 9.4：提交

- [ ] **Step 9.4.1: 提交**

```bash
git add src/preload/service.js src/preload/__tests__/service-preload.test.js
git commit -m "$(cat <<'EOF'
feat(preload): args 自动 serialize + Error 自动 revive

- 入参方向在 IPC 之前 serialize 兜底（生产环境也不会因 renderer 端
  无心嵌套不可克隆字段而崩）
- 异步路径解析 main 端 throw 的 JSON 还原为 Error 实例
- 同步路径检测 __ipcError 信封还原为 Error 实例

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: 集成到 Notice 模块

**Files:**
- Modify: `src/notice/index.js`

### Step 10.1：写 Notice 集成测试

- [ ] **Step 10.1.1: 创建测试**

Create `src/notice/__tests__/notice-main.test.js`：

```js
const { describe, it, expect, beforeAll, beforeEach, vi } = require('vitest');

const sendMock = vi.fn();
const fakeWindow = { webContents: { send: sendMock } };

vi.mock('electron', () => ({
    ipcMain: {
        on: vi.fn(),
        removeAllListeners: vi.fn(),
    },
    BrowserWindow: {
        getAllWindows: () => [fakeWindow],
        fromId: () => fakeWindow,
    },
}));

const Notice = require('../index');

describe('Notice broadcast/direct data serialization', () => {
    beforeAll(() => {
        // 使用 schema.js 内置的 namespace/events（system / update / app / window）
        Notice.init();
    });

    beforeEach(() => {
        sendMock.mockReset();
    });

    it('broadcast data is serialized', () => {
        // system.networkDisconnected: broadcast=true
        Notice.broadcast('system.networkDisconnected', { fn: () => {}, val: 1 });
        expect(sendMock).toHaveBeenCalled();
        const [, , data] = sendMock.mock.calls[0];
        expect(data.fn).toContain('[Function:');
        expect(data.val).toBe(1);
    });

    it('direct data is serialized', () => {
        // update.progress: broadcast=false
        Notice.direct('update.progress', 1, { date: new Date('2026-01-01T00:00:00.000Z') });
        expect(sendMock).toHaveBeenCalled();
        const [, , data] = sendMock.mock.calls[0];
        expect(data.date).toBe('2026-01-01T00:00:00.000Z');
    });
});
```

> 该测试直接复用 `src/notice/schema.js` 内置事件（`system.networkDisconnected` broadcast=true，`update.progress` broadcast=false）。如未来 schema.js 变更删除了这些事件，请同步更新事件名。

### Step 10.2：跑测试，应当失败

- [ ] **Step 10.2.1: 跑测试**

Run: `npm test`
Expected: notice-main 测试 fail（broadcast/direct 没有 serialize）

### Step 10.3：改写 notice/index.js

- [ ] **Step 10.3.1: 修改 broadcast/direct/init 接入 serialize**

修改 `src/notice/index.js` 的 `init`、`broadcast`、`direct` 函数（其余保持原状）：

```js
const fs = require('fs');
const path = require('path');
const schema = require('./schema');
const { ipcMain, BrowserWindow } = require('electron');
const { serialize } = require('../shared/serializer');

let registeredNamespaces = new Map();
let noticeSchemas = [...schema];

function init(options = {}) {
    for (const notice of schema) {
        registerEvents(notice.namespace, notice.events);
    }

    ipcMain.on('notice:getSchema', event => {
        event.returnValue = serialize(getSchema(), { strict: false });
    });

    if (options?.userNoticeDir) {
        scanUserNotices(options.userNoticeDir);
    }
}

function registerEvents(namespace, events) {
    if (registeredNamespaces.has(namespace)) {
        throw new Error(`[Base] Notice namespace "${namespace}" 冲突`);
    }
    registeredNamespaces.set(namespace, events);
}

function scanUserNotices(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        if (!file.endsWith('.js')) continue;
        const notice = require(path.join(dir, file));
        registerEvents(notice.namespace, notice.events);
        noticeSchemas.push({
            namespace: notice.namespace,
            events: notice.events,
        });
    }
}

function broadcast(event, data) {
    const [namespace, eventName] = event.split('.');
    const events = registeredNamespaces.get(namespace);
    if (!events || !events[eventName]) {
        throw new Error(`[Base] Notice 事件 "${event}" 未注册`);
    }
    if (!events[eventName].broadcast) {
        throw new Error(
            `[Base] 事件 "${event}" broadcast=true 才能使用 broadcast()`
        );
    }
    const safeData = serialize(data, { strict: false });
    for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('notice:event', event, safeData);
    }
}

function direct(event, windowId, data) {
    const [namespace, eventName] = event.split('.');
    const events = registeredNamespaces.get(namespace);
    if (!events || !events[eventName]) {
        throw new Error(`[Base] Notice 事件 "${event}" 未注册`);
    }
    if (events[eventName].broadcast) {
        throw new Error(
            `[Base] 事件 "${event}" broadcast=false 才能使用 direct()`
        );
    }
    const safeData = serialize(data, { strict: false });
    const win = BrowserWindow.fromId(windowId);
    if (win) {
        win.webContents.send('notice:event', event, safeData);
    }
}

function getSchema() {
    return noticeSchemas;
}

function cleanupWindow(_windowId) {
    // 窗口关闭时清理订阅（由主进程调用，目前无逻辑）
}

module.exports = { init, broadcast, direct, getSchema, cleanupWindow };
```

- [ ] **Step 10.3.2: 跑测试**

Run: `npm test`
Expected: notice 测试全部通过

### Step 10.4：提交

- [ ] **Step 10.4.1: 提交**

```bash
git add src/notice/index.js src/notice/__tests__/notice-main.test.js
git commit -m "$(cat <<'EOF'
feat(notice): broadcast/direct/schema 数据自动 serialize

main 端发送的 notice data 经 serializer 兜底，
schema 查询返回值也防御性 serialize。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: 移除 lodash.isfunction 依赖

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`（npm 副产物）

### Step 11.1：确认 service/index.js 已经不依赖 lodash.isfunction

- [ ] **Step 11.1.1: 全局搜索引用**

Run: `git grep "lodash.isfunction"`
Expected: 无任何匹配（Task 8 已移除唯一引用）

如果有遗漏的引用，把它们改为 `typeof X === 'function'` 后再继续。

### Step 11.2：从 package.json 移除

- [ ] **Step 11.2.1: 编辑 package.json**

把 `dependencies` 中 `"lodash.isfunction": "^3.0.9",` 一行删除。修改后：

```json
"dependencies": {
    "fs-extra": "^11.3.5",
    "lodash.merge": "^4.6.2"
}
```

- [ ] **Step 11.2.2: 重新 install**

Run: `npm install`
Expected: package-lock.json 更新，lodash.isfunction 从 node_modules 移除。

- [ ] **Step 11.2.3: 跑测试 + 构建**

Run: `npm test && npm run build`
Expected: 测试全绿；构建无错误。

### Step 11.3：提交

- [ ] **Step 11.3.1: 提交**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore: 移除 lodash.isfunction 依赖

service/index.js 已改用 typeof === 'function'，不再需要外部依赖。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: 构建验证 + 端到端冒烟

**Files:** (无新增，仅验证)

### Step 12.1：构建产物检查

- [ ] **Step 12.1.1: 清理并重新构建**

Run: `rm -rf dist && npm run build && ls -la dist`
Expected:
- `dist/index.js` 存在
- `dist/preload.js` 存在
- 可能出现 `dist/serializer-<hash>.js` 之类的共享 chunk（如果 rollup 自动 split）
- 无构建错误

- [ ] **Step 12.1.2: 检查产物中 serializer 是否正确打入**

Run: `grep -l "Function:" dist/*.js`
Expected: 至少 `dist/index.js` 和 `dist/preload.js`（或共享 chunk）中含 serializer 代码字面量。

### Step 12.2：完整跑测试一次

- [ ] **Step 12.2.1: 全量测试**

Run: `npm test`
Expected: 所有测试用例 PASS，0 failures。

- [ ] **Step 12.2.2: 记录测试统计**

Run: `npm test 2>&1 | tail -20`
预期看到类似 `Test Files X passed (X)` 和 `Tests N passed (N)` 的总结，N 应当 >= 70。

### Step 12.3：清理 smoke 测试

- [ ] **Step 12.3.1: 删除 smoke 测试**

`src/shared/serializer/__tests__/smoke.test.js` 仅用于 Task 1 验证 vitest 可运行，可删除。

Run: `rm src/shared/serializer/__tests__/smoke.test.js`

- [ ] **Step 12.3.2: 再跑一次确认无影响**

Run: `npm test`
Expected: 测试数量减 1，其余全绿。

### Step 12.4：最终提交

- [ ] **Step 12.4.1: 提交**

```bash
git add src/shared/serializer/__tests__/
git commit -m "$(cat <<'EOF'
chore: 移除 smoke 测试

vitest 配置已通过完整测试套件验证，不再需要 smoke 占位测试。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 完成验收清单

实现完成应满足以下所有条件：

- [ ] `npm test` 全绿，无 skipped / failing
- [ ] `npm run build` 无错误
- [ ] `package.json` 不再含 `@ungap/structured-clone` 与 `lodash.isfunction`
- [ ] `src/shared/serializer/` 目录结构与 spec §4 一致
- [ ] `src/service/index.js`、`src/preload/service.js`、`src/notice/index.js` 都接入 serializer
- [ ] `src/shared/index.js` 导出 `serializer.serialize / safeStringify / configureSerializer / reviveError`
- [ ] git log 上有按 Task 顺序的清晰提交

---

## 不在本计划范围

以下事项 spec §10 已明确排除，本计划不涉及：

- logger 自身实现
- IPC metrics / tracing / 调用统计
- 自定义类型 adapter 注册机制
- 自定义 Error 子类原型链还原
- Renderer → Preload 方向的 Notice
