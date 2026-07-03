# Toolkit 架构改造 阶段 2：代码兑现 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按已合入的架构 spec 兑现代码 —— envelope 上收 shared/envelope.js、命名规则集中 shared/naming.js、strict 默认改 false、serializeForIpc 封装、validate schema 抽取导出、命名正则收紧、shared/ 遗留清理、测试迁 tests/、发布转为无 build 直发 src/、peer 版本反推 `>=15.0.0`、卸 fs-extra、JSDoc 补齐公开 API。

**Architecture:** 依赖顺序：先造基础层（shared/envelope + shared/naming + serializer 内加 serializeForIpc + strict 默认改 false），再改各模块（M2 / M3 抽 validate 出来、替换 IPC 序列化、引 shared 常量），然后迁测试目录、更新构建/发布配置、补 JSDoc、最后收口验证。TDD 全程 —— 每条改动先写测试、跑失败、实现、跑通过、提交。

**Tech Stack:** Node.js CJS, Vitest, git。无第三方依赖新增；卸 fs-extra；peerDep 收敛到 `"electron": ">=15.0.0"`。

**Spec 依据：** `docs/superpowers/specs/2026-07-03-toolkit-architecture-design.md` §3 / §5 / §7 / §8 / §10 / §11。

**前置条件：** 阶段 1 PR 已合入（架构 spec 存在于 specs/，旧 6 份文档已删）。

---

## File Structure

**新增：**
- `src/shared/envelope.js` — IPC envelope 单一定义（§7.1）
- `src/shared/naming.js` — 命名规则单一定义（§7.4）
- `src/shared/__tests__/envelope.test.js` → 稍后迁 `tests/shared/envelope.test.js`
- `src/shared/__tests__/naming.test.js` → 稍后迁 `tests/shared/naming.test.js`
- `src/shared/serializer/__tests__/serialize-for-ipc.test.js` → 稍后迁 `tests/shared/serializer/serialize-for-ipc.test.js`
- `.npmignore`（若需要防未来 src 内其他非发布内容）

**修改：**
- `src/shared/serializer/limits.js` — strict 默认改硬编码 false
- `src/shared/serializer/index.js` — 新增 `serializeForIpc` 导出
- `src/shared/index.js` — 去掉 enum/utils 引用，加 envelope / naming / serializeForIpc
- `src/service/protocol.js` — 移除 envelope helpers（上收 shared/envelope）
- `src/service/main.js` — 引 shared/envelope + serializeForIpc + shared/naming；抽取导出 `validateServiceSchema`
- `src/service/preload.js` — 用 shared/envelope + serializeForIpc
- `src/notice/protocol.js` — 移除 envelope helpers
- `src/notice/main.js` — 引 shared/envelope + serializeForIpc + shared/naming；抽取导出 `validateNoticeSchema`；命名 regex 收紧
- `src/notice/preload.js` — 引 shared/envelope
- `vitest.config.mjs` — include pattern 改到 `tests/**/*.test.js`
- `package.json` — 无 build / files:src / peer >=15.0 / 卸 fs-extra / prepublishOnly: test

**删除：**
- `src/shared/config/` 整目录
- `src/shared/enum/` 整目录
- `src/shared/utils/` 整目录
- `src/shared/constant/` 空目录
- `src/**/__tests__/`（全部；测试文件先迁至 tests/）
- `scripts/build.mjs`
- `scripts/`（若空）
- `dist/`
- `dist-test/`

**测试目录整移（Task 14）：**
- `src/__tests__/preload-aggregator.test.js` → `tests/preload-aggregator.test.js`
- `src/service/__tests__/*.test.js` → `tests/service/*.test.js`
- `src/notice/__tests__/*.test.js` → `tests/notice/*.test.js`
- `src/enhance/__tests__/_electron-mock.js` → `tests/enhance/_electron-mock.js`
- `src/enhance/__tests__/*.test.js` → `tests/enhance/*.test.js`
- `src/shared/serializer/__tests__/*.test.js` → `tests/shared/serializer/*.test.js`
- `src/capability/example/__tests__/*.test.js` → `tests/capability/example/*.test.js`
- `src/shared/__tests__/{envelope,naming,...}.test.js` → `tests/shared/*.test.js`

---

## Tasks

### Task 1: 基线验证 + 切分支

**Files:**
- Verify: `package.json`, 现有 `npm test` 全绿

- [ ] **Step 1: 切阶段 2 feature 分支**

```bash
git branch --show-current
```

若在 main / master 或阶段 1 分支，切新分支：

```bash
git checkout -b refactor/toolkit-architecture-stage2
```

- [ ] **Step 2: 跑现有 vitest 建立 baseline**

```bash
npm test
```

Expected: 全部测试通过（阶段 2 前代码未变，测试应全绿）。若有失败测试，先修复或记录已知失败清单，本阶段结束前需回归到全绿。

- [ ] **Step 3: 记录当前测试数**

```bash
npm test 2>&1 | grep -E 'Test Files|Tests' | tail -5
```

记下 Test Files 数量与 Tests 数量作为基线；阶段 2 结束时 Tests 数应 ≥ 基线（新增 envelope / naming / serialize-for-ipc / validate 测试）。

---

### Task 2: 创建 `shared/envelope.js`

**Files:**
- Create: `src/shared/__tests__/envelope.test.js`
- Create: `src/shared/envelope.js`

架构 §7.1 —— envelope 的单一物理定义。

- [ ] **Step 1: 建 shared/__tests__ 目录**

```bash
mkdir -p src/shared/__tests__
```

- [ ] **Step 2: Write failing test**

Create `src/shared/__tests__/envelope.test.js`:

```js
const { describe, it, expect } = require('vitest');
const { okEnvelope, errorEnvelope } = require('../envelope');

describe('shared/envelope', () => {
    describe('okEnvelope', () => {
        it('wraps data with ok:true', () => {
            expect(okEnvelope({ a: 1 })).toEqual({ ok: true, data: { a: 1 } });
        });
        it('preserves undefined data', () => {
            const env = okEnvelope(undefined);
            expect(env.ok).toBe(true);
            expect(env.data).toBeUndefined();
        });
        it('preserves null data', () => {
            expect(okEnvelope(null)).toEqual({ ok: true, data: null });
        });
        it('accepts primitive data', () => {
            expect(okEnvelope(42)).toEqual({ ok: true, data: 42 });
            expect(okEnvelope('str')).toEqual({ ok: true, data: 'str' });
        });
    });
    describe('errorEnvelope', () => {
        it('wraps error with ok:false', () => {
            expect(errorEnvelope('boom')).toEqual({ ok: false, error: 'boom' });
        });
        it('preserves serialized Error shape', () => {
            const err = { name: 'TypeError', message: 'x', stack: 's' };
            expect(errorEnvelope(err)).toEqual({ ok: false, error: err });
        });
    });
});
```

- [ ] **Step 3: 跑测试，验证失败**

```bash
npx vitest run src/shared/__tests__/envelope.test.js
```

Expected: FAIL with `Cannot find module '../envelope'`.

- [ ] **Step 4: 实现 `shared/envelope.js`**

Create `src/shared/envelope.js`:

```js
/**
 * IPC 应答统一信封（详见架构 §7.1）。
 *
 * 所有 IPC 应答必须使用此信封形态：
 * - 成功：{ ok: true, data: <serialize 后的值> }
 * - 失败：{ ok: false, error: <serialize 后的 Error> }
 *
 * 主端 handler 永不 throw（详见架构 §3.3），异常统一封装为 errorEnvelope 返回。
 * preload 端解包路径唯一：if (ok) return data; else throw reviveError(error);
 *
 * Notice 推送通道 `notice:event` 不走信封（单向流无返回值）。
 */

/**
 * 生成成功信封。
 * @param {*} data 已 serialize 过的数据
 * @returns {{ ok: true, data: * }}
 */
function okEnvelope(data) {
    return { ok: true, data };
}

/**
 * 生成失败信封。
 * @param {*} error 已 serialize 过的 Error（形态 `{ name?, message?, stack?, code?, cause? }`）
 * @returns {{ ok: false, error: * }}
 */
function errorEnvelope(error) {
    return { ok: false, error };
}

module.exports = { okEnvelope, errorEnvelope };
```

- [ ] **Step 5: 跑测试，验证通过**

```bash
npx vitest run src/shared/__tests__/envelope.test.js
```

Expected: PASS (6 tests).

- [ ] **Step 6: 提交**

```bash
git add src/shared/envelope.js src/shared/__tests__/envelope.test.js
git commit -m "feat(shared): 建立 shared/envelope.js 作为 IPC 信封单一真理源（架构 §7.1）"
```

---

### Task 3: 创建 `shared/naming.js`

**Files:**
- Create: `src/shared/__tests__/naming.test.js`
- Create: `src/shared/naming.js`

架构 §7.4 —— namespace / handler / event 命名的单一正则真理源。

- [ ] **Step 1: Write failing test**

Create `src/shared/__tests__/naming.test.js`:

```js
const { describe, it, expect } = require('vitest');
const { IDENTIFIER_RE, isValidIdentifier } = require('../naming');

describe('shared/naming', () => {
    describe('IDENTIFIER_RE', () => {
        it('accepts letter-start alphanumeric with underscore', () => {
            expect(IDENTIFIER_RE.test('foo')).toBe(true);
            expect(IDENTIFIER_RE.test('foo123')).toBe(true);
            expect(IDENTIFIER_RE.test('some_name')).toBe(true);
            expect(IDENTIFIER_RE.test('X')).toBe(true);
        });
        it('accepts underscore-start', () => {
            expect(IDENTIFIER_RE.test('_bar')).toBe(true);
            expect(IDENTIFIER_RE.test('_')).toBe(true);
        });
        it('rejects digit-start', () => {
            expect(IDENTIFIER_RE.test('1foo')).toBe(false);
            expect(IDENTIFIER_RE.test('9')).toBe(false);
        });
        it('rejects dash', () => {
            expect(IDENTIFIER_RE.test('foo-bar')).toBe(false);
            expect(IDENTIFIER_RE.test('-foo')).toBe(false);
        });
        it('rejects dot', () => {
            expect(IDENTIFIER_RE.test('foo.bar')).toBe(false);
        });
        it('rejects empty string', () => {
            expect(IDENTIFIER_RE.test('')).toBe(false);
        });
        it('rejects whitespace', () => {
            expect(IDENTIFIER_RE.test('foo bar')).toBe(false);
            expect(IDENTIFIER_RE.test(' foo')).toBe(false);
        });
    });
    describe('isValidIdentifier', () => {
        it('returns true for valid names', () => {
            expect(isValidIdentifier('foo')).toBe(true);
            expect(isValidIdentifier('_bar')).toBe(true);
        });
        it('returns false for non-string', () => {
            expect(isValidIdentifier(null)).toBe(false);
            expect(isValidIdentifier(undefined)).toBe(false);
            expect(isValidIdentifier(123)).toBe(false);
            expect(isValidIdentifier({})).toBe(false);
            expect(isValidIdentifier([])).toBe(false);
        });
        it('returns false for invalid names', () => {
            expect(isValidIdentifier('1foo')).toBe(false);
            expect(isValidIdentifier('foo-bar')).toBe(false);
            expect(isValidIdentifier('')).toBe(false);
        });
    });
});
```

- [ ] **Step 2: 跑测试，验证失败**

```bash
npx vitest run src/shared/__tests__/naming.test.js
```

Expected: FAIL with `Cannot find module '../naming'`.

- [ ] **Step 3: 实现 `shared/naming.js`**

Create `src/shared/naming.js`:

```js
/**
 * 命名规则的单一真理源（详见架构 §7.4）。
 *
 * namespace / handler 名 / event 名三者均须符合合法 JS 标识符规则，
 * 保证它们作为渲染端 API 属性名参与 dot access（如 appService.foo.bar）
 * 时无一例外用 dot 语法。
 *
 * M2 / M3 registerService / registerSchema 内部通过 validateServiceSchema /
 * validateNoticeSchema 使用此正则；capability 相关测试也 delegate 到这里，
 * 避免正则散在多处漂移。
 */

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * 判断字符串是否为合法 JS 标识符。
 * @param {*} s 任意值（非字符串一律 false）
 * @returns {boolean}
 */
function isValidIdentifier(s) {
    return typeof s === 'string' && IDENTIFIER_RE.test(s);
}

module.exports = { IDENTIFIER_RE, isValidIdentifier };
```

- [ ] **Step 4: 跑测试，验证通过**

```bash
npx vitest run src/shared/__tests__/naming.test.js
```

Expected: PASS (13 tests).

- [ ] **Step 5: 提交**

```bash
git add src/shared/naming.js src/shared/__tests__/naming.test.js
git commit -m "feat(shared): 建立 shared/naming.js 作为命名规则单一真理源（架构 §7.4）"
```

---

### Task 4: `shared/serializer/limits.js` — strict 默认改硬编码 false

**Files:**
- Modify: `src/shared/serializer/limits.js`
- Modify: `src/shared/serializer/__tests__/limits.test.js`（移除依赖 NODE_ENV 的测试）

架构 §3.4 shared 进程无关 + §7.2 strict 默认硬编码 false。

- [ ] **Step 1: 修改 `src/shared/serializer/limits.js`**

打开 `src/shared/serializer/limits.js`，将 `DEFAULTS` 中的 `strict` 字段：

Before（`limits.js:1-8`）:
```js
const DEFAULTS = Object.freeze({
    maxDepth: 32,
    maxStringLength: 10240,
    maxArrayLength: 1000,
    maxKeys: 1000,
    strict: process.env.NODE_ENV !== 'production',
    onError: null,
});
```

After:
```js
/**
 * serialize 默认配置（详见架构 §7.2 / §7.6）。
 *
 * strict: false 是硬编码 —— 默认更安全，用户忘配置也不会在生产崩溃。
 * 开发环境用户若想暴露序列化 Proxy / toJSON 抛错等真 bug，主动 opt-in：
 *
 *     if (process.env.NODE_ENV !== 'production') {
 *         configureSerializer({ strict: true });
 *     }
 *
 * 注意：globalDefaults 是**模块级私有变量**，每进程一份 —— 主进程 configureSerializer
 * 只影响主进程默认；渲染进程若直接调 serialize 需在渲染进程再配一次。
 */
const DEFAULTS = Object.freeze({
    maxDepth: 32,
    maxStringLength: 10240,
    maxArrayLength: 1000,
    maxKeys: 1000,
    strict: false,
    onError: null,
});
```

- [ ] **Step 2: 修改现有 limits 测试，去掉 NODE_ENV 依赖**

打开 `src/shared/serializer/__tests__/limits.test.js`。找到断言 `strict default reflects NODE_ENV` 的测试块（约在 `limits.test.js:37-40`），替换为断言默认 `false` 的新测试：

Before（约 `limits.test.js:37-40`）:
```js
    it('strict default reflects NODE_ENV', () => {
        const r = resolveOpts({});
        const expected = process.env.NODE_ENV !== 'production';
        expect(r.strict).toBe(expected);
    });
```

After:
```js
    it('strict default is hardcoded false (§7.2)', () => {
        const r = resolveOpts({});
        expect(r.strict).toBe(false);
    });
    it('strict default is not affected by NODE_ENV', () => {
        const original = process.env.NODE_ENV;
        try {
            process.env.NODE_ENV = 'development';
            expect(resolveOpts({}).strict).toBe(false);
            process.env.NODE_ENV = 'production';
            expect(resolveOpts({}).strict).toBe(false);
        } finally {
            process.env.NODE_ENV = original;
        }
    });
```

- [ ] **Step 3: 跑 limits 测试，验证通过**

```bash
npx vitest run src/shared/serializer/__tests__/limits.test.js
```

Expected: PASS（含新的两条断言 + 原有其他 limits 测试）。

- [ ] **Step 4: 跑整个 serializer 测试套件确保无回归**

```bash
npx vitest run src/shared/serializer/
```

Expected: 全部 PASS。若 `never-throw.test.js` 或其他文件里依赖旧的 dev-strict 默认，需要同步改为显式 `{ strict: true }` 传参。

- [ ] **Step 5: 提交**

```bash
git add src/shared/serializer/limits.js src/shared/serializer/__tests__/limits.test.js
git commit -m "feat(serializer): strict 默认改硬编码 false，去除 NODE_ENV 读取（架构 §3.4 / §7.2）"
```

---

### Task 5: 新增 `serializeForIpc()` 到 `shared/serializer/index.js`

**Files:**
- Create: `src/shared/serializer/__tests__/serialize-for-ipc.test.js`
- Modify: `src/shared/serializer/index.js`

架构 §7.2 —— IPC 路径序列化封装。

- [ ] **Step 1: Write failing test**

Create `src/shared/serializer/__tests__/serialize-for-ipc.test.js`:

```js
const { describe, it, expect } = require('vitest');
const { serializeForIpc } = require('../index');

describe('serializeForIpc', () => {
    it('is exported from serializer index', () => {
        expect(typeof serializeForIpc).toBe('function');
    });

    it('serializes plain data identically to serialize', () => {
        expect(serializeForIpc({ a: 1, b: 'x' })).toEqual({ a: 1, b: 'x' });
    });

    it('does NOT throw on Proxy getter that throws (strict:false enforced)', () => {
        const obj = {};
        Object.defineProperty(obj, 'x', {
            get() { throw new Error('boom'); },
            enumerable: true,
        });
        // If strict were true, this would throw; serializeForIpc hardcodes false.
        expect(() => serializeForIpc(obj)).not.toThrow();
    });

    it('does NOT throw on toJSON throwing', () => {
        const obj = {
            x: 1,
            toJSON() { throw new Error('boom'); },
        };
        expect(() => serializeForIpc(obj)).not.toThrow();
    });

    it('does NOT throw on function/symbol/bigint (lossy conversion)', () => {
        expect(() => serializeForIpc({ f: () => {}, s: Symbol('x'), b: 1n })).not.toThrow();
    });

    it('result is JSON-safe', () => {
        const weird = {
            fn: () => {},
            sym: Symbol(),
            big: 99n,
            nan: NaN,
        };
        expect(() => JSON.stringify(serializeForIpc(weird))).not.toThrow();
    });

    it('handles circular references without throwing', () => {
        const a = {};
        a.self = a;
        expect(() => serializeForIpc(a)).not.toThrow();
    });
});
```

- [ ] **Step 2: 跑测试，验证失败**

```bash
npx vitest run src/shared/serializer/__tests__/serialize-for-ipc.test.js
```

Expected: FAIL with `serializeForIpc is not a function`.

- [ ] **Step 3: 在 `shared/serializer/index.js` 加实现 + 导出**

打开 `src/shared/serializer/index.js`。在 `safeStringify` 之后、`module.exports` 之前，添加 `serializeForIpc` 函数；并把它加入 exports。

Before（约 `index.js:145-153` 末尾）:
```js
function safeStringify(value, opts) {
    try {
        return JSON.stringify(serialize(value, opts));
    } catch (e) {
        return JSON.stringify(`[SerializeError: ${e.message}]`);
    }
}

module.exports = { serialize, safeStringify, configureSerializer };
```

After:
```js
function safeStringify(value, opts) {
    try {
        return JSON.stringify(serialize(value, opts));
    } catch (e) {
        return JSON.stringify(`[SerializeError: ${e.message}]`);
    }
}

/**
 * IPC 专用序列化封装（详见架构 §7.2）。
 *
 * 硬编码 strict: false —— 生产环境 IPC 路径永不抛错的落地承诺。
 * M2 / M3 主端与 preload 所有序列化调用点必须使用此函数，
 * 业务代码不应手动传 { strict: false }。
 *
 * @param {*} value 任意值
 * @returns {*} plain 数据（JSON-safe）
 */
function serializeForIpc(value) {
    return serialize(value, { strict: false });
}

module.exports = { serialize, safeStringify, configureSerializer, serializeForIpc };
```

- [ ] **Step 4: 跑测试，验证通过**

```bash
npx vitest run src/shared/serializer/__tests__/serialize-for-ipc.test.js
```

Expected: PASS (7 tests).

- [ ] **Step 5: 提交**

```bash
git add src/shared/serializer/index.js src/shared/serializer/__tests__/serialize-for-ipc.test.js
git commit -m "feat(serializer): 新增 serializeForIpc 封装（架构 §7.2）"
```

---

### Task 6: 更新 `src/shared/index.js` 导出

**Files:**
- Modify: `src/shared/index.js`

架构 §7.1 / §7.3 / §7.4 —— shared 命名空间聚合入口。

- [ ] **Step 1: 替换 shared/index.js 全内容**

打开 `src/shared/index.js`。替换为：

```js
/**
 * shared 命名空间聚合入口。
 *
 * 导出跨模块共享基础设施（详见架构 §5、§8）：
 * - serializer: IPC 安全序列化 + reviveError + serializeForIpc（§7.2 / §7.3）
 * - envelope: IPC 应答信封（§7.1）
 * - naming: 命名规则（§7.4）
 *
 * shared/config、shared/enum、shared/utils、shared/constant 已删除
 * （违反 §8 shared/ 准入规则）。
 */

const serializer = require('./serializer');
const { reviveError } = require('./serializer/reviveError');
const envelope = require('./envelope');
const naming = require('./naming');

module.exports = {
    serializer: {
        serialize: serializer.serialize,
        safeStringify: serializer.safeStringify,
        configureSerializer: serializer.configureSerializer,
        serializeForIpc: serializer.serializeForIpc,
        reviveError,
    },
    envelope,
    naming,
};
```

- [ ] **Step 2: 跑 vitest 全套确认无回归**

```bash
npm test
```

Expected: 全部通过。若失败，检查是否有测试或代码 require 了 `shared.enum` / `shared.utils` —— 那些需要在 Task 7 之前先脱钩（或先删除相关测试代码）。

- [ ] **Step 3: 提交**

```bash
git add src/shared/index.js
git commit -m "refactor(shared): 更新聚合出口，加入 envelope / naming / serializeForIpc（架构 §5）"
```

---

### Task 7: 删除 `shared/` 遗留（config / enum / utils / constant）

**Files:**
- Delete: `src/shared/config/`
- Delete: `src/shared/enum/`
- Delete: `src/shared/utils/`
- Delete: `src/shared/constant/`

架构 §8 shared/ 准入规则（§3.4 进程无关性 + 规则 2 无业务 domain）。

- [ ] **Step 1: 确认无代码引用（`src/` 内不得再 require 这四个目录）**

```bash
grep -rEn "require\(['\"](\.\.?/)+shared/(config|enum|utils|constant)" src/ || true
```

Expected: 无输出（Task 6 已把 shared/index.js 的 enum/utils 引用去掉；若此处仍有引用，先修复引用方后再进入 Step 2）。

- [ ] **Step 2: 删除四个目录**

```bash
rm -rf src/shared/config
rm -rf src/shared/enum
rm -rf src/shared/utils
rm -rf src/shared/constant
```

- [ ] **Step 3: 验证 shared/ 目录只剩 serializer / envelope.js / naming.js / index.js / __tests__**

```bash
ls src/shared/
```

Expected 输出（顺序不定）:
```
__tests__
envelope.js
index.js
naming.js
serializer
```

- [ ] **Step 4: 跑 vitest 全套确认无回归**

```bash
npm test
```

Expected: 全部通过。

- [ ] **Step 5: 提交**

```bash
git add -A src/shared/
git commit -m "chore(shared): 删除违反准入规则的 config/enum/utils/constant（架构 §8）"
```

---

### Task 8: `service/protocol.js` — 移除 envelope helpers

**Files:**
- Modify: `src/service/protocol.js`
- Modify: `src/service/__tests__/protocol.test.js`（如有 envelope 相关测试，去掉）

架构 §7.7 —— protocol.js 只承载模块私有 channel 命名。

- [ ] **Step 1: 替换 `src/service/protocol.js` 全内容**

```js
/**
 * Service 模块私有协议：channel 命名。
 *
 * envelope 定义已上收到 shared/envelope（详见架构 §7.1 / §7.7），
 * 本文件只承载 Service 模块内部使用的 channel 命名规则。
 * M2 主端与 preload 直接 require shared/envelope。
 */

const META_LIST_CHANNEL = 'service:getServiceList';

/**
 * 异步通道名。
 * @param {string} ns
 * @param {string} name
 * @returns {string}
 */
const asyncChannel = (ns, name) => `${ns}:${name}`;

/**
 * 同步通道名（在 async 通道名后附 "Sync"）。
 * @param {string} ns
 * @param {string} name
 * @returns {string}
 */
const syncChannel  = (ns, name) => `${ns}:${name}Sync`;

module.exports = {
    META_LIST_CHANNEL,
    asyncChannel,
    syncChannel,
};
```

- [ ] **Step 2: 修改 `src/service/__tests__/protocol.test.js`**

打开 `src/service/__tests__/protocol.test.js`。**删除**其中断言 `okEnvelope` / `errorEnvelope` 从 `protocol` 导出的整段 `describe('envelope helpers', ...)`。envelope 测试已在 Task 2 的 shared/envelope 独立覆盖。

保留 `META_LIST_CHANNEL` / `asyncChannel` / `syncChannel` 相关的 describe 块。

- [ ] **Step 3: 跑 protocol 测试**

```bash
npx vitest run src/service/__tests__/protocol.test.js
```

Expected: PASS（只剩 channel 命名相关断言）。

- [ ] **Step 4: 提交**

```bash
git add src/service/protocol.js src/service/__tests__/protocol.test.js
git commit -m "refactor(service): protocol.js 只保留 channel 命名，envelope 上收 shared/envelope（架构 §7.7）"
```

---

### Task 9: `service/main.js` — 抽取 `validateServiceSchema`、用 serializeForIpc、引 shared/envelope + shared/naming

**Files:**
- Modify: `src/service/main.js`
- Modify: `src/service/__tests__/main-init.test.js`（新增 namespace / handler 名 regex 校验用例）

架构 §7.2 + §7.4 + §7.5 —— 抽 validate + 用 serializeForIpc + 收紧命名。

- [ ] **Step 1: Write failing tests（新增 regex 校验）**

在 `src/service/__tests__/main-init.test.js` 的 `describe('init: schema validation', ...)` 块中追加以下测试用例：

```js
    it('namespace with dash rejected (must be valid JS identifier)', () => {
        expect(() => Service.init({
            userSchemas: [{ namespace: 'foo-bar', handlers: { a() {} } }],
        })).toThrow(/namespace.*invalid/i);
    });
    it('namespace starting with digit rejected', () => {
        expect(() => Service.init({
            userSchemas: [{ namespace: '1foo', handlers: { a() {} } }],
        })).toThrow(/namespace.*invalid/i);
    });
    it('handler name with dash rejected', () => {
        expect(() => Service.init({
            userSchemas: [{ namespace: 'foo', handlers: { 'bad-name'() {} } }],
        })).toThrow(/handler name.*invalid/i);
    });
    it('handler name starting with digit rejected', () => {
        expect(() => Service.init({
            userSchemas: [{ namespace: 'foo', handlers: { '1bad'() {} } }],
        })).toThrow(/handler name.*invalid/i);
    });
    it('handler value must be a function', () => {
        expect(() => Service.init({
            userSchemas: [{ namespace: 'foo', handlers: { notFn: 'string' } }],
        })).toThrow(/must be function/i);
    });

    it('validateServiceSchema is exported and callable', () => {
        const { validateServiceSchema } = require('../main');
        expect(typeof validateServiceSchema).toBe('function');
        expect(() => validateServiceSchema({ namespace: 'foo', handlers: { a() {} } })).not.toThrow();
        expect(() => validateServiceSchema({ namespace: 'foo-bad', handlers: { a() {} } })).toThrow();
    });
```

- [ ] **Step 2: 跑测试，验证部分失败**

```bash
npx vitest run src/service/__tests__/main-init.test.js
```

Expected: 新增 6 条测试 FAIL（现有实现无 regex 校验，不导出 validateServiceSchema）。

- [ ] **Step 3: 替换 `src/service/main.js` 全内容**

```js
const { ipcMain } = require('electron');
const { serializeForIpc } = require('../shared/serializer');
const { okEnvelope, errorEnvelope } = require('../shared/envelope');
const { isValidIdentifier } = require('../shared/naming');
const {
    META_LIST_CHANNEL,
    asyncChannel,
    syncChannel,
} = require('./protocol');

const registeredSchemas = new Map();

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 校验 Service schema 的形态与命名合规（详见架构 §7.5）。
 * 抛错则 schema 不合规；无返回值。
 *
 * @param {Object} schema
 * @param {string} schema.namespace 合法 JS 标识符
 * @param {Object<string, Function>} schema.handlers 键为 handler 名（合法 JS 标识符），值为函数
 * @param {string[]} [schema.sync] handler 名列表，声明支持 sync 通道
 * @param {string[]} [schema.needsEvent] handler 名列表，声明接收 event 作为末参
 * @throws {Error} 任何不合规抛错
 */
function validateServiceSchema(schema) {
    if (!isPlainObject(schema)) {
        throw new Error('Service schema must be an object');
    }
    const { namespace, handlers } = schema;
    const sync       = schema.sync       || [];
    const needsEvent = schema.needsEvent || [];

    if (!isValidIdentifier(namespace)) {
        throw new Error(
            `Service schema namespace "${namespace}" invalid ` +
            `(must match /^[A-Za-z_][A-Za-z0-9_]*$/)`,
        );
    }
    if (!isPlainObject(handlers)) {
        throw new Error(`Service schema "${namespace}" requires handlers object`);
    }
    const handlerNames = Object.keys(handlers);
    for (const name of handlerNames) {
        if (!isValidIdentifier(name)) {
            throw new Error(
                `Service schema "${namespace}": handler name "${name}" invalid ` +
                `(must match /^[A-Za-z_][A-Za-z0-9_]*$/)`,
            );
        }
        if (typeof handlers[name] !== 'function') {
            throw new Error(
                `Service schema "${namespace}": handler "${name}" must be function`,
            );
        }
    }
    if (!Array.isArray(sync)) {
        throw new Error(`Service schema "${namespace}" sync must be an array`);
    }
    if (!Array.isArray(needsEvent)) {
        throw new Error(`Service schema "${namespace}" needsEvent must be an array`);
    }
    for (const name of sync) {
        if (!handlerNames.includes(name)) {
            throw new Error(
                `Service schema "${namespace}": sync entry "${name}" not in handlers`,
            );
        }
    }
    for (const name of needsEvent) {
        if (!handlerNames.includes(name)) {
            throw new Error(
                `Service schema "${namespace}": needsEvent entry "${name}" not in handlers`,
            );
        }
    }
}

function registerService(schema) {
    validateServiceSchema(schema);
    const { namespace, handlers } = schema;
    const sync       = schema.sync       || [];
    const needsEvent = schema.needsEvent || [];

    if (registeredSchemas.has(namespace)) {
        throw new Error(`Service namespace "${namespace}" conflict`);
    }

    for (const name of Object.keys(handlers)) {
        const fn = handlers[name];
        const wantsEvent = needsEvent.includes(name);

        ipcMain.handle(asyncChannel(namespace, name), async (event, ...args) => {
            try {
                const result = wantsEvent
                    ? await fn(...args, event)
                    : await fn(...args);
                return okEnvelope(serializeForIpc(result));
            } catch (err) {
                return errorEnvelope(serializeForIpc(err));
            }
        });

        if (sync.includes(name)) {
            ipcMain.on(syncChannel(namespace, name), async (event, ...args) => {
                try {
                    const result = await (
                        wantsEvent ? fn(...args, event) : fn(...args)
                    );
                    event.returnValue = okEnvelope(serializeForIpc(result));
                } catch (err) {
                    event.returnValue = errorEnvelope(serializeForIpc(err));
                }
            });
        }
    }

    registeredSchemas.set(namespace, schema);
}

function handleGetServiceList(event) {
    try {
        const list = [...registeredSchemas.values()].map(s => ({
            namespace: s.namespace,
            handlers:  Object.keys(s.handlers),
            sync:      s.sync || [],
        }));
        event.returnValue = okEnvelope(serializeForIpc(list));
    } catch (err) {
        event.returnValue = errorEnvelope(serializeForIpc(err));
    }
}

/**
 * 初始化 Service，注册 schema 列表并挂载元通道 listener。
 * 详见架构 §3.5 preload 一次性 init 的对应约束。
 *
 * @param {{ userSchemas: Object[] }} opts
 * @throws {Error} opts 缺失、userSchemas 非数组、schema 校验不通过或 namespace 冲突时抛错
 */
function init(opts) {
    if (!opts || !Array.isArray(opts.userSchemas)) {
        throw new Error('Service.init requires { userSchemas: Array }');
    }
    for (const schema of opts.userSchemas) {
        registerService(schema);
    }
    ipcMain.on(META_LIST_CHANNEL, handleGetServiceList);
}

/**
 * 清理所有已注册的 IPC handler / listener。
 * 约定在 app 'will-quit' 中调用；正常运行不需要主动调用。
 */
function cleanup() {
    ipcMain.removeAllListeners(META_LIST_CHANNEL);
    for (const schema of registeredSchemas.values()) {
        const sync = schema.sync || [];
        for (const name of Object.keys(schema.handlers)) {
            ipcMain.removeHandler(asyncChannel(schema.namespace, name));
            if (sync.includes(name)) {
                ipcMain.removeAllListeners(syncChannel(schema.namespace, name));
            }
        }
    }
    registeredSchemas.clear();
}

module.exports = { init, cleanup, validateServiceSchema };
```

- [ ] **Step 4: 跑 M2 全部测试确认通过**

```bash
npx vitest run src/service/
```

Expected: PASS all files。若现有测试期望旧的 `envelope` 从 `./protocol` 导入，Task 8 已经处理；若 main-async / main-sync 测试仍能通过说明 envelope 从 shared/envelope 引入无破坏。

- [ ] **Step 5: 提交**

```bash
git add src/service/main.js src/service/__tests__/main-init.test.js
git commit -m "refactor(service): 抽取 validateServiceSchema、用 serializeForIpc、收紧命名 regex（架构 §7.2 / §7.4 / §7.5）"
```

---

### Task 10: `service/preload.js` — 用 shared/envelope + serializeForIpc

**Files:**
- Modify: `src/service/preload.js`

架构 §7.1 / §7.2 —— envelope 引 shared，序列化用 serializeForIpc。

- [ ] **Step 1: 替换 `src/service/preload.js` 全内容**

```js
const { ipcRenderer } = require('electron');
const { serializeForIpc } = require('../shared/serializer');
const { reviveError } = require('../shared/serializer/reviveError');
const {
    META_LIST_CHANNEL, asyncChannel, syncChannel,
} = require('./protocol');

// envelope 形态由 shared/envelope 定义（架构 §7.1）；preload 只消费不构造。

function buildAsyncCaller(ns, name) {
    return async (...args) => {
        const safeArgs = args.map(a => serializeForIpc(a));
        const envelope = await ipcRenderer.invoke(asyncChannel(ns, name), ...safeArgs);
        if (envelope && envelope.ok) return envelope.data;
        throw reviveError(envelope && envelope.error);
    };
}

function buildSyncCaller(ns, name) {
    return (...args) => {
        const safeArgs = args.map(a => serializeForIpc(a));
        const envelope = ipcRenderer.sendSync(syncChannel(ns, name), ...safeArgs);
        if (envelope && envelope.ok) return envelope.data;
        throw reviveError(envelope && envelope.error);
    };
}

/**
 * 构建渲染端 appService API。preload 加载时调用一次。
 *
 * 返回形态：{ [namespace]: { [handler](...args): Promise<any>, [handler]Sync(...args): any } }
 *
 * 详见架构 §3.5（preload 一次性 init 与 opt-out 契约）。
 *
 * @returns {Object} appService
 * @throws {Error} 元通道 envelope 为 error 或损坏时抛出 revived Error
 */
function buildAppService() {
    const envelope = ipcRenderer.sendSync(META_LIST_CHANNEL);
    if (!envelope || !envelope.ok) {
        throw reviveError(envelope && envelope.error);
    }
    const schemaList = envelope.data || [];

    const appService = {};
    for (const { namespace, handlers, sync } of schemaList) {
        appService[namespace] = {};
        for (const name of handlers) {
            appService[namespace][name] = buildAsyncCaller(namespace, name);
        }
        for (const name of (sync || [])) {
            appService[namespace][`${name}Sync`] = buildSyncCaller(namespace, name);
        }
    }
    return appService;
}

module.exports = buildAppService;
```

- [ ] **Step 2: 跑 M2 preload 相关测试确认通过**

```bash
npx vitest run src/service/__tests__/preload-build.test.js src/service/__tests__/preload-callers.test.js
```

Expected: PASS all。

- [ ] **Step 3: 提交**

```bash
git add src/service/preload.js
git commit -m "refactor(service): preload 用 serializeForIpc + 引 shared/envelope（架构 §7.1 / §7.2）"
```

---

### Task 11: `notice/protocol.js` — 移除 envelope helpers

**Files:**
- Modify: `src/notice/protocol.js`
- Modify: `src/notice/__tests__/protocol.test.js`（如有 envelope 断言，删除）

架构 §7.7。

- [ ] **Step 1: 替换 `src/notice/protocol.js` 全内容**

```js
/**
 * Notice 模块私有协议：channel 命名。
 * envelope 定义已上收到 shared/envelope（详见架构 §7.1 / §7.7）。
 */

const EVENT_CHANNEL = 'notice:event';
const META_GET_SCHEMA_CHANNEL = 'notice:getSchema';

module.exports = {
    EVENT_CHANNEL,
    META_GET_SCHEMA_CHANNEL,
};
```

- [ ] **Step 2: 修改 `src/notice/__tests__/protocol.test.js`**

打开 `src/notice/__tests__/protocol.test.js`。**删除**断言 `okEnvelope` / `errorEnvelope` 从 protocol 导出的 `describe('envelope helpers', ...)` 整块。保留 channel 常量断言。

- [ ] **Step 3: 跑 protocol 测试**

```bash
npx vitest run src/notice/__tests__/protocol.test.js
```

Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add src/notice/protocol.js src/notice/__tests__/protocol.test.js
git commit -m "refactor(notice): protocol.js 只保留 channel 命名，envelope 上收 shared/envelope（架构 §7.7）"
```

---

### Task 12: `notice/main.js` — 抽 `validateNoticeSchema`、收紧命名 regex、用 shared/envelope + serializeForIpc

**Files:**
- Modify: `src/notice/main.js`
- Modify: `src/notice/__tests__/main-init.test.js`（改现有 dash 相关测试，新增合法标识符测试与 validateNoticeSchema 导出测试）

架构 §7.2 + §7.4 + §7.5。

- [ ] **Step 1: 修改 `src/notice/__tests__/main-init.test.js`**

对现有 `describe('init: schema validation', ...)` 块做如下调整：

**替换旧的 "valid event names pass: letters/digits/underscore/dash"**（含 dash）为：

```js
    it('valid event names pass: letters/digits/underscore (no dash)', () => {
        expect(() => Notice.init({
            userSchemas: [{ namespace: 'foo', events: ['abc', 'X', 'event_2', '_underscore'] }],
        })).not.toThrow();
    });
```

**追加**以下测试：

```js
    it('event name with dash rejected (must be valid JS identifier)', () => {
        expect(() => Notice.init({
            userSchemas: [{ namespace: 'foo', events: ['ab-c'] }],
        })).toThrow(/invalid event name/i);
    });
    it('event name starting with digit rejected', () => {
        expect(() => Notice.init({
            userSchemas: [{ namespace: 'foo', events: ['1abc'] }],
        })).toThrow(/invalid event name/i);
    });
    it('namespace with dash rejected', () => {
        expect(() => Notice.init({
            userSchemas: [{ namespace: 'foo-bar', events: ['x'] }],
        })).toThrow(/namespace.*invalid/i);
    });
    it('namespace starting with digit rejected', () => {
        expect(() => Notice.init({
            userSchemas: [{ namespace: '1foo', events: ['x'] }],
        })).toThrow(/namespace.*invalid/i);
    });
    it('validateNoticeSchema is exported and callable', () => {
        const { validateNoticeSchema } = require('../main');
        expect(typeof validateNoticeSchema).toBe('function');
        expect(() => validateNoticeSchema({ namespace: 'foo', events: ['a'] })).not.toThrow();
        expect(() => validateNoticeSchema({ namespace: 'foo-bad', events: ['a'] })).toThrow();
    });
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run src/notice/__tests__/main-init.test.js
```

Expected: 新增 5 条测试 FAIL（现有实现允许 dash / 未导出 validateNoticeSchema）。

- [ ] **Step 3: 替换 `src/notice/main.js` 全内容**

```js
const { ipcMain, BrowserWindow } = require('electron');
const { serializeForIpc } = require('../shared/serializer');
const { okEnvelope, errorEnvelope } = require('../shared/envelope');
const { isValidIdentifier } = require('../shared/naming');
const {
    EVENT_CHANNEL,
    META_GET_SCHEMA_CHANNEL,
} = require('./protocol');

const registeredSchemas = new Map();

/**
 * 校验 Notice schema 的形态与命名合规（详见架构 §7.5）。
 * 抛错则 schema 不合规；无返回值。
 *
 * @param {Object} schema
 * @param {string} schema.namespace 合法 JS 标识符
 * @param {string[]} schema.events 事件名数组，每项须为合法 JS 标识符
 * @throws {Error} 任何不合规抛错
 */
function validateNoticeSchema(schema) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
        throw new Error('Notice schema must be an object');
    }
    const { namespace, events } = schema;
    if (!isValidIdentifier(namespace)) {
        throw new Error(
            `Notice schema namespace "${namespace}" invalid ` +
            `(must match /^[A-Za-z_][A-Za-z0-9_]*$/)`,
        );
    }
    if (!Array.isArray(events)) {
        throw new Error(`Notice schema "${namespace}" requires events array`);
    }
    for (const ev of events) {
        if (!isValidIdentifier(ev)) {
            throw new Error(
                `Notice schema "${namespace}": invalid event name "${ev}" ` +
                `(must match /^[A-Za-z_][A-Za-z0-9_]*$/)`,
            );
        }
    }
}

function registerSchema(schema) {
    validateNoticeSchema(schema);
    const { namespace, events } = schema;
    if (registeredSchemas.has(namespace)) {
        throw new Error(`Notice namespace "${namespace}" conflict`);
    }
    registeredSchemas.set(namespace, [...events]);
}

/**
 * 初始化 Notice，注册 schema 列表并挂载元通道 listener。
 *
 * @param {{ userSchemas: Object[] }} opts
 * @throws {Error} opts 缺失、userSchemas 非数组、schema 校验不通过或 namespace 冲突时抛错
 */
function init(opts) {
    if (!opts || !Array.isArray(opts.userSchemas)) {
        throw new Error('Notice.init requires { userSchemas: Array }');
    }
    for (const schema of opts.userSchemas) {
        registerSchema(schema);
    }
    ipcMain.on(META_GET_SCHEMA_CHANNEL, handleGetSchema);
}

function handleGetSchema(event) {
    try {
        const list = [...registeredSchemas.entries()].map(([namespace, events]) => ({
            namespace,
            events,
        }));
        event.returnValue = okEnvelope(serializeForIpc(list));
    } catch (err) {
        event.returnValue = errorEnvelope(serializeForIpc(err));
    }
}

function parseFullEventName(fullEventName) {
    if (typeof fullEventName !== 'string') {
        throw new Error('Notice event name must be a string');
    }
    const idx = fullEventName.indexOf('.');
    if (idx <= 0 || idx === fullEventName.length - 1) {
        throw new Error(`Notice event "${fullEventName}" malformed (expected "ns.event")`);
    }
    return {
        namespace: fullEventName.slice(0, idx),
        eventName: fullEventName.slice(idx + 1),
    };
}

function assertRegistered(fullEventName) {
    const { namespace, eventName } = parseFullEventName(fullEventName);
    const events = registeredSchemas.get(namespace);
    if (!events || !events.includes(eventName)) {
        throw new Error(`Notice event "${fullEventName}" not registered`);
    }
}

/**
 * 推送事件到所有窗口。
 *
 * @param {string} fullEventName 形如 "namespace.event"
 * @param {*} data 推送 payload；经 serializeForIpc 编码后发送
 * @throws {Error} 事件未注册抛错
 */
function broadcast(fullEventName, data) {
    assertRegistered(fullEventName);
    const safeData = serializeForIpc(data);
    for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(EVENT_CHANNEL, fullEventName, safeData);
    }
}

/**
 * 推送事件到指定窗口。窗口不存在则静默忽略。
 *
 * @param {string} fullEventName 形如 "namespace.event"
 * @param {number} windowId BrowserWindow.id
 * @param {*} data 推送 payload；经 serializeForIpc 编码后发送
 * @throws {Error} 事件未注册抛错
 */
function direct(fullEventName, windowId, data) {
    assertRegistered(fullEventName);
    const win = BrowserWindow.fromId(windowId);
    if (!win) return;
    const safeData = serializeForIpc(data);
    win.webContents.send(EVENT_CHANNEL, fullEventName, safeData);
}

/**
 * 清理元通道 listener 和 namespace 注册表。
 * 约定在 app 'will-quit' 中调用；正常运行不需要主动调用。
 */
function cleanup() {
    ipcMain.removeAllListeners(META_GET_SCHEMA_CHANNEL);
    registeredSchemas.clear();
}

module.exports = { init, broadcast, direct, cleanup, validateNoticeSchema };
```

- [ ] **Step 4: 跑 M3 全部测试确认通过**

```bash
npx vitest run src/notice/
```

Expected: PASS all files。若 broadcast / direct 相关测试用了 dash 事件名，需要相应更新为合法标识符。

- [ ] **Step 5: 检查并更新 broadcast / direct 测试中使用的事件名**

```bash
grep -nE "'[^']*-[^']*'" src/notice/__tests__/main-broadcast.test.js src/notice/__tests__/main-direct.test.js || true
```

若发现测试代码中的事件名含 dash（如 `'foo.ev-A'`），改为合法标识符（如 `'foo.evA'`）。

- [ ] **Step 6: 再跑 M3 全套**

```bash
npx vitest run src/notice/
```

Expected: PASS all。

- [ ] **Step 7: 提交**

```bash
git add src/notice/main.js src/notice/__tests__/
git commit -m "refactor(notice): 抽 validateNoticeSchema、收紧命名 regex、用 serializeForIpc + shared/envelope（架构 §7.2 / §7.4 / §7.5）"
```

---

### Task 13: `notice/preload.js` — 引 shared/envelope

**Files:**
- Modify: `src/notice/preload.js`

架构 §7.1 —— envelope 从 shared 消费。notice preload 本身不序列化推送 payload（推送已由主端 serialize 好），只解 envelope。

- [ ] **Step 1: 替换 `src/notice/preload.js` 全内容**

```js
const { ipcRenderer } = require('electron');
const { reviveError } = require('../shared/serializer/reviveError');
const { EVENT_CHANNEL, META_GET_SCHEMA_CHANNEL } = require('./protocol');

// envelope 形态由 shared/envelope 定义（架构 §7.1）；preload 只消费。

function buildEventApi(fullEventName, listeners) {
    const ensureSet = () => {
        if (!listeners.has(fullEventName)) listeners.set(fullEventName, new Set());
        return listeners.get(fullEventName);
    };
    const unsubscribe = cb => {
        const cbs = listeners.get(fullEventName);
        if (!cbs) return;
        cbs.delete(cb);
        if (cbs.size === 0) listeners.delete(fullEventName);
    };
    return {
        on(cb) {
            ensureSet().add(cb);
            return () => unsubscribe(cb);
        },
        once(cb) {
            const wrapper = data => {
                unsubscribe(wrapper);
                cb(data);
            };
            ensureSet().add(wrapper);
            return () => unsubscribe(wrapper);
        },
        off(cb) {
            if (!cb) listeners.delete(fullEventName);
            else unsubscribe(cb);
        },
    };
}

/**
 * 构建渲染端 appNotice API。preload 加载时调用一次。
 *
 * 返回形态：{ [namespace]: { [event]: { on(cb): () => void, once(cb): () => void, off(cb?): void } } }
 *
 * 详见架构 §3.5（preload 一次性 init 与 opt-out 契约）。
 *
 * @returns {Object} appNotice
 * @throws {Error} 元通道 envelope 为 error 或损坏时抛出 revived Error
 */
function buildAppNotice() {
    const envelope = ipcRenderer.sendSync(META_GET_SCHEMA_CHANNEL);
    if (!envelope || !envelope.ok) {
        throw reviveError(envelope && envelope.error);
    }
    const schemaList = envelope.data || [];

    const listeners = new Map();

    ipcRenderer.on(EVENT_CHANNEL, (_event, fullEventName, data) => {
        const cbs = listeners.get(fullEventName);
        if (!cbs) return;
        // Snapshot so once-wrappers mutating the set don't break iteration
        for (const cb of [...cbs]) cb(data);
    });

    const appNotice = {};
    for (const { namespace, events } of schemaList) {
        appNotice[namespace] = {};
        for (const eventName of events) {
            const fullEventName = `${namespace}.${eventName}`;
            appNotice[namespace][eventName] = buildEventApi(fullEventName, listeners);
        }
    }
    return appNotice;
}

module.exports = buildAppNotice;
```

- [ ] **Step 2: 跑 M3 preload 测试**

```bash
npx vitest run src/notice/__tests__/preload-api.test.js src/notice/__tests__/preload-dispatch.test.js
```

Expected: PASS all。若测试代码用了 dash 事件名，同 Task 12 Step 5 顺便修正。

- [ ] **Step 3: 提交**

```bash
git add src/notice/preload.js src/notice/__tests__/preload-api.test.js src/notice/__tests__/preload-dispatch.test.js
git commit -m "refactor(notice): preload 代码添加 JSDoc；测试事件名收紧到合法标识符"
```

---

### Task 14: 迁移测试目录 `src/**/__tests__/` → `tests/`

**Files:**
- Move (git mv): 所有 `src/**/__tests__/**/*.{test.js,js}` → `tests/**`
- Remove (rmdir): 迁移后所有空的 `src/**/__tests__/` 目录

架构 §10.6 —— 测试目录组织。**注意**：本 task 结束前 vitest 会跑不通（include pattern 尚未改）；Task 15 修 pattern。

- [ ] **Step 1: 建 tests/ 目录树**

```bash
mkdir -p tests/service tests/notice tests/enhance tests/shared/serializer tests/capability/example tests/shared
```

- [ ] **Step 2: 迁移文件（保留 git 历史）**

```bash
git mv src/__tests__/preload-aggregator.test.js tests/preload-aggregator.test.js

git mv src/service/__tests__/protocol.test.js tests/service/protocol.test.js
git mv src/service/__tests__/main-init.test.js tests/service/main-init.test.js
git mv src/service/__tests__/main-async.test.js tests/service/main-async.test.js
git mv src/service/__tests__/main-sync.test.js tests/service/main-sync.test.js
git mv src/service/__tests__/main-meta.test.js tests/service/main-meta.test.js
git mv src/service/__tests__/main-cleanup.test.js tests/service/main-cleanup.test.js
git mv src/service/__tests__/preload-build.test.js tests/service/preload-build.test.js
git mv src/service/__tests__/preload-callers.test.js tests/service/preload-callers.test.js

git mv src/notice/__tests__/protocol.test.js tests/notice/protocol.test.js
git mv src/notice/__tests__/main-init.test.js tests/notice/main-init.test.js
git mv src/notice/__tests__/main-broadcast.test.js tests/notice/main-broadcast.test.js
git mv src/notice/__tests__/main-direct.test.js tests/notice/main-direct.test.js
git mv src/notice/__tests__/main-meta.test.js tests/notice/main-meta.test.js
git mv src/notice/__tests__/main-cleanup.test.js tests/notice/main-cleanup.test.js
git mv src/notice/__tests__/preload-api.test.js tests/notice/preload-api.test.js
git mv src/notice/__tests__/preload-dispatch.test.js tests/notice/preload-dispatch.test.js

git mv src/enhance/__tests__/_electron-mock.js tests/enhance/_electron-mock.js
git mv src/enhance/__tests__/base-window-abstract.test.js tests/enhance/base-window-abstract.test.js
git mv src/enhance/__tests__/base-window-create-options.test.js tests/enhance/base-window-create-options.test.js
git mv src/enhance/__tests__/base-window-create-lifecycle.test.js tests/enhance/base-window-create-lifecycle.test.js
git mv src/enhance/__tests__/base-window-instance-methods.test.js tests/enhance/base-window-instance-methods.test.js
git mv src/enhance/__tests__/base-window-on-closed.test.js tests/enhance/base-window-on-closed.test.js
git mv src/enhance/__tests__/base-window-smoke.test.js tests/enhance/base-window-smoke.test.js

git mv src/shared/serializer/__tests__/*.test.js tests/shared/serializer/

git mv src/capability/example/__tests__/*.test.js tests/capability/example/

git mv src/shared/__tests__/envelope.test.js tests/shared/envelope.test.js
git mv src/shared/__tests__/naming.test.js tests/shared/naming.test.js
```

- [ ] **Step 3: 删除空的 `__tests__/` 目录**

```bash
rmdir src/__tests__
rmdir src/service/__tests__
rmdir src/notice/__tests__
rmdir src/enhance/__tests__
rmdir src/shared/serializer/__tests__
rmdir src/capability/example/__tests__
rmdir src/shared/__tests__
```

若某目录 rmdir 报"not empty"，检查是否有遗漏文件未迁；补齐后再删。

- [ ] **Step 4: 批量更新 tests 内的 require 路径**

迁移后每个 test 文件相对源码的深度变了，`require('../foo')` 需要改为 `require('../../src/xxx/foo')` 之类。规律如下（依据文件迁移前的深度）：

| 迁移前路径 | 迁移后路径 | 原 `require('../foo')` 应变为 |
|---|---|---|
| `src/__tests__/*.test.js` | `tests/*.test.js` | `require('../src/foo')` |
| `src/service/__tests__/*.test.js` | `tests/service/*.test.js` | `require('../../src/service/foo')` |
| `src/notice/__tests__/*.test.js` | `tests/notice/*.test.js` | `require('../../src/notice/foo')` |
| `src/enhance/__tests__/*.{test.js,js}` | `tests/enhance/*.{test.js,js}` | `require('../../src/enhance/foo')` |
| `src/shared/__tests__/*.test.js` | `tests/shared/*.test.js` | `require('../../src/shared/foo')` |
| `src/shared/serializer/__tests__/*.test.js` | `tests/shared/serializer/*.test.js` | `require('../../../src/shared/serializer/foo')` |
| `src/capability/example/__tests__/*.test.js` | `tests/capability/example/*.test.js` | `require('../../../src/capability/example/foo')` |

对每个 tests/ 下的文件按上表**批量替换**。示例命令（针对 tests/service/）：

```bash
# tests/service/*.test.js 中所有 require('../foo') → require('../../src/service/foo')
find tests/service -name '*.test.js' -exec sed -i.bak -E "s|require\(['\"]\\.\\.([/'\"])|require('../../src/service\\1|g" {} \;
find tests/service -name '*.bak' -delete
```

对其他子目录，将命令中的 `tests/service` 与 `src/service` 相应替换（例如 `tests/notice` 与 `src/notice`；`tests/enhance` 与 `src/enhance`；`tests/shared` 与 `src/shared`）。

对 `tests/shared/serializer/` 与 `tests/capability/example/`（深度更深），命令为：

```bash
# tests/shared/serializer/*.test.js
find tests/shared/serializer -name '*.test.js' -exec sed -i.bak -E "s|require\(['\"]\\.\\.([/'\"])|require('../../../src/shared/serializer\\1|g" {} \;
find tests/shared/serializer -name '*.bak' -delete

# tests/capability/example/*.test.js
find tests/capability/example -name '*.test.js' -exec sed -i.bak -E "s|require\(['\"]\\.\\.([/'\"])|require('../../../src/capability/example\\1|g" {} \;
find tests/capability/example -name '*.bak' -delete
```

对 `tests/preload-aggregator.test.js`（在 tests/ 根）：

```bash
sed -i.bak -E "s|require\(['\"]\\.\\.([/'\"])|require('../src\\1|g" tests/preload-aggregator.test.js
rm tests/preload-aggregator.test.js.bak
```

- [ ] **Step 5: 处理 `require` 中的更多层级引用（`../../` 等）**

有些测试文件里可能存在 `require('../../shared/serializer/reviveError')` 这类跨模块引用（例如 M2 preload 测试相对 `src/service/__tests__/`），迁移后需要变成 `require('../../src/shared/serializer/reviveError')`。用类似 sed 处理：

```bash
# 通用：将所有测试文件中出现的 require('../../shared/...') 前缀补 src/
find tests -name '*.test.js' -exec sed -i.bak -E "s|require\(['\"](\\.\\./)+shared/|require('&|g" {} \;
```

上面的模式仅示例；若发现测试真的存在跨模块相对路径，需要按具体行手工确认。

**推荐做法**（更稳）：对每份 tests/ 下的 test 文件**手工过一遍**头部 require，确保它们指向 src/ 里的正确路径。以下命令帮你列出所有 tests/ 里的 require：

```bash
grep -rEn "require\(['\"]\.\." tests/
```

对照上面的映射表，逐行确认。

- [ ] **Step 6: 提交（尚未跑测试；Task 15 修 vitest config 后回归）**

```bash
git add -A tests/ src/
git commit -m "refactor(tests): 测试目录 src/**/__tests__/ 迁移到 tests/ 镜像 src 结构（架构 §10.6）"
```

---

### Task 15: 更新 `vitest.config.mjs`

**Files:**
- Modify: `vitest.config.mjs`

- [ ] **Step 1: 替换 `vitest.config.mjs` 内容**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.test.js'],
        environment: 'node',
        globals: false,
    },
});
```

- [ ] **Step 2: 跑全部测试确认通过**

```bash
npm test
```

Expected: 全部 PASS。若失败，最可能原因是 Task 14 里 require 路径没改全 —— 按报错逐一修 tests/ 里的 require。

- [ ] **Step 3: 提交**

```bash
git add vitest.config.mjs
git commit -m "chore(vitest): include pattern 迁到 tests/**/*.test.js"
```

---

### Task 16: JSDoc 补齐公开 API

**Files:**
- Modify: `src/index.js`
- Modify: `src/preload.js`
- Modify: `src/enhance/BaseWindow.js`
- Modify: `src/capability/example/index.js`
- Verify: 之前任务已补齐的 shared/service/notice 相关 JSDoc

架构 §10.4 —— 公开 API 必须带 JSDoc。

- [ ] **Step 1: 补 `src/index.js` JSDoc**

打开 `src/index.js`，替换全内容为：

```js
/**
 * @base-client/toolkit 根入口（详见架构 §5）。
 *
 * 便利层：聚合各模块的主端导出。用户也可直接通过 subpath 精确 import
 * 各模块（如 require('@base-client/toolkit/service')）。
 *
 * @module @base-client/toolkit
 */

const Service = require('./service/main');
const Notice = require('./notice/main');
const BaseWindow = require('./enhance/BaseWindow');
const shared = require('./shared');

module.exports = {
    Service,
    Notice,
    BaseWindow,
    shared,
    /** toolkit 版本号，来自 package.json */
    VERSION: require('../package.json').version,
};
```

- [ ] **Step 2: 补 `src/preload.js` JSDoc**

打开 `src/preload.js`，替换全内容为：

```js
/**
 * preload 聚合入口（详见架构 §10.5）。
 *
 * 关键契约：若主端未 init Service/Notice，preload 必须在 opts 中 opt-out 对应 bridge，
 * 否则 buildAppService/buildAppNotice 内的 sendSync 元通道因无 listener
 * 而永久阻塞渲染进程（Electron 无原生 timeout）。
 *
 * init() 应只调用一次 —— 同名 exposeInMainWorld 二次调用会抛错；属违规，不做防护。
 */

const { contextBridge } = require('electron');
const buildAppService = require('./service/preload');
const buildAppNotice = require('./notice/preload');

/**
 * 把一个对象暴露到渲染端 window 命名空间。
 *
 * 兼容 contextIsolation：开启时用 contextBridge，未开启时直接挂到 window。
 * 作为公开辅助函数导出，用户暴露自定义 bridge 时可复用。
 *
 * @param {string} name 渲染端访问名（作为 window[name]）
 * @param {*} api 要暴露的对象或值
 */
function exposeAPI(name, api) {
    if (process.contextIsolated) {
        contextBridge.exposeInMainWorld(name, api);
    } else {
        window[name] = api;
    }
}

/**
 * 装配 toolkit 所有 preload 端 bridge。
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.service=true] 是否装配 appService（对应主端 Service.init）
 * @param {boolean} [opts.notice=true] 是否装配 appNotice（对应主端 Notice.init）
 * @throws {Error} 若二次调用触发 contextBridge 冲突抛错（违规不防护）
 */
function init(opts = {}) {
    const { service = true, notice = true } = opts;
    if (service) exposeAPI('appService', buildAppService());
    if (notice) exposeAPI('appNotice', buildAppNotice());
}

module.exports = { init, exposeAPI };
```

- [ ] **Step 3: 补 `src/enhance/BaseWindow.js` JSDoc**

打开 `src/enhance/BaseWindow.js`，替换全内容为：

```js
const { BrowserWindow } = require('electron');
const merge = require('lodash.merge');

/**
 * BrowserWindow 抽象基类（详见架构 §4 / M4 spec）。
 *
 * 模板方法模式：`create()` 是模板方法；子类实现 `getPageUrl()` 抽象方法，
 * 可选 override `getWindowOptions()` / `onCreated(window)` / `onClosed()`。
 * 实例方法（`getWindow` / `getId` / `close` / `isDestroyed` / `send`）
 * 不应被 override。
 *
 * @example
 * class MainWindow extends BaseWindow {
 *     getPageUrl() { return 'app://main.html'; }
 *     getWindowOptions() { return { width: 1200, height: 800 }; }
 *     onCreated(window) { window.once('ready-to-show', () => window.show()); }
 * }
 * const main = new MainWindow();
 * main.create();
 */
class BaseWindow {
    constructor() {
        /** @type {import('electron').BrowserWindow | null} */
        this.browserWindow = null;
    }

    // —— 抽象方法（必须 override） ——

    /**
     * 返回窗口加载的 URL。子类必须实现。
     * @returns {string}
     * @throws {Error} 未 override 时抛错
     */
    getPageUrl() {
        throw new Error('子类必须实现 getPageUrl()');
    }

    // —— 可选 override ——

    /**
     * 返回 BrowserWindow 构造 options。默认为 `{}`。
     * 与内置默认 `{ show: false, backgroundColor: '#ffffff' }` 深合并。
     * @returns {import('electron').BrowserWindowConstructorOptions}
     */
    getWindowOptions() {
        return {};
    }

    /**
     * 窗口创建后、loadURL 前触发。用户在此绑早期事件（如 did-start-loading）。
     * @param {import('electron').BrowserWindow} window 新创建的窗口
     */
    onCreated(/* window */) {
        // no-op
    }

    /**
     * 窗口关闭时触发，`this.browserWindow` 此时已置 null，
     * `this.isDestroyed()` 返回 true。
     */
    onClosed() {
        // no-op
    }

    // —— 模板方法 ——

    /**
     * 创建 BrowserWindow 并绑定生命周期。
     *
     * 流程：读子类 options → 深合并默认 → 构造 BrowserWindow → 绑 'closed' →
     * 触发 onCreated → loadURL。
     *
     * onCreated 严格早于 loadURL，保证用户绑的早期事件不因 loadURL 已触发而漏掉。
     *
     * @returns {import('electron').BrowserWindow}
     */
    create() {
        const userOptions = this.getWindowOptions();
        const mergedOptions = merge(
            { show: false, backgroundColor: '#ffffff' },
            userOptions,
        );
        const window = new BrowserWindow(mergedOptions);
        this.browserWindow = window;

        window.on('closed', () => {
            this.browserWindow = null;
            this.onClosed();
        });

        this.onCreated(window);
        window.loadURL(this.getPageUrl());

        return window;
    }

    // —— 实例方法（不应 override） ——

    /** @returns {import('electron').BrowserWindow | null} */
    getWindow() {
        return this.browserWindow;
    }

    /** @returns {number | undefined} 窗口 id；关闭后返回 undefined */
    getId() {
        return this.browserWindow ? this.browserWindow.id : undefined;
    }

    /** 关闭窗口；null 安全 */
    close() {
        if (this.browserWindow) this.browserWindow.close();
    }

    /** @returns {boolean} 窗口是否已销毁；null 视为已销毁 */
    isDestroyed() {
        if (!this.browserWindow) return true;
        return this.browserWindow.isDestroyed();
    }

    /**
     * escape hatch：直接经 webContents.send 发送。null 安全。
     *
     * 日常主→渲染推送请使用 Notice；本方法仅供 debug / 一次性私下沟通场景。
     *
     * @param {string} channel
     * @param {*} data
     */
    send(channel, data) {
        if (!this.browserWindow) return;
        this.browserWindow.webContents.send(channel, data);
    }
}

module.exports = BaseWindow;
```

- [ ] **Step 4: 补 `src/capability/example/index.js` JSDoc**

打开 `src/capability/example/index.js`，替换全内容为：

```js
/**
 * 参考 capability 模块：示范 M5 契约（详见架构 §4 / M5 spec）。
 *
 * 契约要点：
 * - 顶层导出 echo 方法（主端可直接调用）
 * - serviceSchema：供 Service.init 挂载，暴露给渲染端 async + sync
 * - noticeSchema：供 Notice.init 挂载，定义事件命名空间
 * - echo 在三处出现（顶层 export / serviceSchema.handlers.echo / sync: ['echo']），
 *   三处指向同一份函数引用 —— 一份实现，三种调用路径。
 * - 零副作用：require 该模块只产生上述对象，不触发任何 IPC 注册 / IO（架构 §3.1）
 * - 零依赖 Service / Notice：capability 只导出描述对象，是否真注册由用户 init 时决定
 */

/**
 * 回显 message。用于示范 M2 Service handler 形态。
 * @param {*} message
 * @returns {*}
 */
const echo = message => message;

/** Service schema：暴露给渲染端。命名遵循架构 §7.4 合法 JS 标识符规则。 */
const serviceSchema = {
    namespace: 'example',
    handlers: {
        echo,
    },
    sync: ['echo'],
};

/** Notice schema：定义事件命名空间。 */
const noticeSchema = {
    namespace: 'example',
    events: ['tick'],
};

module.exports = {
    echo,
    serviceSchema,
    noticeSchema,
};
```

- [ ] **Step 5: 跑全套测试确认无回归**

```bash
npm test
```

Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add src/index.js src/preload.js src/enhance/BaseWindow.js src/capability/example/index.js
git commit -m "docs(jsdoc): 补齐公开 API JSDoc 注释（架构 §10.4）"
```

---

### Task 17: `package.json` — 无 build / files:src / peer >=15.0.0 / 卸 fs-extra / prepublishOnly:test

**Files:**
- Modify: `package.json`

架构 §10.1 / §10.2 / §10.3 / §10.7。

- [ ] **Step 1: 替换 `package.json` 全内容**

```json
{
    "name": "@base-client/toolkit",
    "version": "0.0.1",
    "main": "src/index.js",
    "exports": {
        ".": "./src/index.js",
        "./preload": "./src/preload.js",
        "./service": "./src/service/main.js",
        "./service/preload": "./src/service/preload.js",
        "./notice": "./src/notice/main.js",
        "./notice/preload": "./src/notice/preload.js",
        "./capability/*": "./src/capability/*/index.js",
        "./enhance/*": "./src/enhance/*.js"
    },
    "scripts": {
        "test": "vitest run",
        "test:watch": "vitest",
        "prepublishOnly": "npm test"
    },
    "keywords": [],
    "author": "",
    "license": "ISC",
    "description": "",
    "peerDependencies": {
        "electron": ">=15.0.0"
    },
    "devDependencies": {
        "vitest": "^2.1.9"
    },
    "dependencies": {
        "lodash.merge": "^4.6.2"
    },
    "files": [
        "src"
    ]
}
```

- [ ] **Step 2: 卸载 fs-extra**

```bash
npm uninstall fs-extra
```

Expected: 移除 `fs-extra` 依赖；`package-lock.json` 同步更新。

- [ ] **Step 3: 跑测试确认无回归**

```bash
npm test
```

Expected: 全部 PASS。

- [ ] **Step 4: 提交**

```bash
git add package.json package-lock.json
git commit -m "chore(pkg): 无 build 直发 src；peer electron >=15.0.0；卸 fs-extra；prepublishOnly:test（架构 §10.1/§10.2/§10.3）"
```

---

### Task 18: 删除 `scripts/build.mjs` + `dist/` + `dist-test/`

**Files:**
- Delete: `scripts/build.mjs`
- Delete: `scripts/`（若空）
- Delete: `dist/`
- Delete: `dist-test/`

架构 §10.2 —— 无 build。

- [ ] **Step 1: 删除 build 脚本与 dist**

```bash
rm -f scripts/build.mjs
rm -rf dist/
rm -rf dist-test/
```

- [ ] **Step 2: 若 scripts/ 空则删除**

```bash
[ -d scripts ] && rmdir scripts 2>/dev/null || true
ls -la scripts 2>&1 || echo "scripts/ removed"
```

Expected: `scripts/` 被删除，或若有其他文件残留则保留（本轮不动其他脚本）。

- [ ] **Step 3: 更新 `.gitignore`**

```bash
grep -v "^dist$" .gitignore > .gitignore.tmp && mv .gitignore.tmp .gitignore
grep -v "^dist/$" .gitignore > .gitignore.tmp && mv .gitignore.tmp .gitignore
```

打开 `.gitignore` 确认 `dist` / `dist/` 相关条目已移除（如未来无 dist/ 目录，无需 gitignore）。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "chore(cleanup): 删除 scripts/build.mjs 与 dist/ dist-test/（架构 §10.2）"
```

---

### Task 19: 收口验证

**Files:**
- Verify only

- [ ] **Step 1: 跑全套 vitest**

```bash
npm test
```

Expected: 全部 PASS。测试数量应 ≥ Task 1 Step 3 记录的基线 + 新增的 envelope / naming / serialize-for-ipc / 校验测试。

- [ ] **Step 2: 干净 install 验证 peer 与依赖声明**

```bash
rm -rf node_modules
npm ci
```

Expected: 装包成功，无 warning 关于 fs-extra 或 build 脚本缺失。

- [ ] **Step 3: 各 subpath require sanity check**

```bash
node -e "console.log(Object.keys(require('./src/index')).sort());"
node -e "console.log(typeof require('./src/preload').init, typeof require('./src/preload').exposeAPI);"
node -e "console.log(Object.keys(require('./src/service/main')).sort());"
node -e "console.log(typeof require('./src/service/preload'));"
node -e "console.log(Object.keys(require('./src/notice/main')).sort());"
node -e "console.log(typeof require('./src/notice/preload'));"
node -e "console.log(typeof require('./src/enhance/BaseWindow'));"
node -e "console.log(Object.keys(require('./src/capability/example')).sort());"
node -e "console.log(Object.keys(require('./src/shared')).sort());"
node -e "console.log(Object.keys(require('./src/shared/envelope')).sort());"
node -e "console.log(Object.keys(require('./src/shared/naming')).sort());"
node -e "console.log(Object.keys(require('./src/shared/serializer')).sort());"
```

Expected 输出（分别对应）:
- `[ 'BaseWindow', 'Notice', 'Service', 'VERSION', 'shared' ]`
- `function function`
- `[ 'cleanup', 'init', 'validateServiceSchema' ]`
- `function`
- `[ 'broadcast', 'cleanup', 'direct', 'init', 'validateNoticeSchema' ]`
- `function`
- `function`
- `[ 'echo', 'noticeSchema', 'serviceSchema' ]`
- `[ 'envelope', 'naming', 'serializer' ]`
- `[ 'errorEnvelope', 'okEnvelope' ]`
- `[ 'IDENTIFIER_RE', 'isValidIdentifier' ]`
- `[ 'DEFAULTS', 'configureSerializer', 'resolveOpts', 'safeStringify', 'serialize', 'serializeForIpc', '_resetForTest' ]`（末尾键顺序可能略变）

任何一行输出不匹配 → 定位缺失或多余的导出并修正。

- [ ] **Step 4: 验证 npm pack 只包含 src**

```bash
npm pack --dry-run 2>&1 | tail -40
```

Expected: Tarball Contents 只列出 `src/**` + `package.json` + `README*` 等（若有），**不含** `tests/` / `dist/` / `dist-test/` / `scripts/` / `docs/`。

- [ ] **Step 5: 提交（若上述步骤触发了未提交的修正）**

```bash
git status
```

若有未提交改动，提交：

```bash
git add -A
git commit -m "chore(m2-refactor): 阶段 2 收口修正"
```

若无未提交改动，跳过。

---

### Task 20: 阶段 2 提交与 PR review checklist

**Files:**
- （无文件改动，纯 review checklist）

- [ ] **Step 1: 生成 diff 概览**

```bash
git log --oneline main..HEAD
```

Expected: 显示阶段 2 的 15-20 个 commits（Task 2-19 对应）。

- [ ] **Step 2: 对照架构 spec 逐条打钩**

- [ ] `src/shared/envelope.js` 存在，导出 `okEnvelope` / `errorEnvelope`（§7.1）
- [ ] `src/shared/naming.js` 存在，导出 `IDENTIFIER_RE` / `isValidIdentifier`（§7.4）
- [ ] `src/shared/serializer/limits.js` `strict` 默认为硬编码 `false`（§7.2）
- [ ] `src/shared/serializer/index.js` 导出 `serializeForIpc`（§7.2）
- [ ] `src/shared/index.js` 只导出 `serializer` / `envelope` / `naming`；无 `enum` / `utils`（§8）
- [ ] `src/shared/{config,enum,utils,constant}/` 目录不存在
- [ ] `src/service/protocol.js` 仅承载 channel 常量，不含 envelope（§7.7）
- [ ] `src/service/main.js` 用 `serializeForIpc`、引 `shared/envelope`、导出 `validateServiceSchema`（§7.2 / §7.5）
- [ ] `src/service/preload.js` 同上（§7.2 / §7.5）
- [ ] `src/notice/protocol.js` 同 `service/protocol.js`
- [ ] `src/notice/main.js` 抽 `validateNoticeSchema`、event/namespace 用 `isValidIdentifier` 校验（§7.4 / §7.5）
- [ ] `src/notice/preload.js` 已加 JSDoc（§10.4）
- [ ] `tests/` 存在，结构镜像 `src/`；`src/**/__tests__/` 已不存在（§10.6）
- [ ] `vitest.config.mjs` include 为 `tests/**/*.test.js`
- [ ] 公开 API 均有 JSDoc（§10.4）
- [ ] `package.json` main / exports 全部指 `./src/`；`files: ["src"]`；无 `build` script；`peerDependencies.electron: ">=15.0.0"`；`prepublishOnly: npm test`
- [ ] `fs-extra` 已从 devDependencies 移除
- [ ] `scripts/` / `dist/` / `dist-test/` 目录不存在
- [ ] `npm test` 全部通过
- [ ] `npm pack --dry-run` 只包 `src/**`

- [ ] **Step 3: 阶段 3 前置就绪确认**

- [ ] `docs/superpowers/plans/2026-07-03-toolkit-refactor-stage3-mspec-trim.md` 已生成（本 plan 的姊妹）
- [ ] 阶段 3 计划在 review 通过阶段 2 PR 后启动

---

## Self-Review

**Spec 覆盖：**

- §3.1 `require` 零副作用：capability example 保持零副作用（Task 16 Step 4）；本阶段无新增副作用。
- §3.2 渲染进程零本地 I/O：新增 `shared/envelope` `shared/naming` 均无 electron/node 依赖 ✓（Task 2/3 实现无 require electron）。
- §3.3 IPC 路径永不抛错：所有 IPC 序列化调用点改为 `serializeForIpc`（Task 9/10/12）✓。
- §3.4 shared 进程无关：`shared/serializer/limits.js` 去除 `process.env` 读取（Task 4）✓。
- §3.5 preload 一次性 init：本阶段不改 preload.js 行为，只加 JSDoc（Task 16 Step 2）✓。
- §3.6 模块间独立：M2/M3 只依赖 shared（envelope / naming / serializer），不互相 require ✓。
- §3.7 命名口径：namespace/handler/event 命名 regex 统一到 `shared/naming` ✓。
- §7.1 envelope 上收 `shared/envelope.js` ✓。
- §7.2 serializeForIpc ✓ + strict 默认 false ✓。
- §7.3 reviveError 保持公开（未改）✓。
- §7.4 命名规则 shared/naming.js ✓。
- §7.5 validateServiceSchema / validateNoticeSchema 导出 ✓。
- §7.6 configureSerializer 每进程独立（架构 spec 有说明，代码本来就是模块级私有变量，无需改）✓。
- §7.7 protocol.js 只留私有 channel ✓。
- §8 shared/ 准入规则：违反的 config/enum/utils/constant 删除 ✓。
- §10.1 exports 改到 src/ ✓。
- §10.2 无 build ✓。
- §10.3 peer >=15.0.0 ✓。
- §10.4 JSDoc ✓（Task 16）。
- §10.5 preload 聚合契约（未改行为，只加 JSDoc）✓。
- §10.6 tests/ 目录 ✓（Task 14/15）。
- §10.7 devDeps: 卸 fs-extra ✓。
- §11.7 TDD：全部 task TDD 步骤展开 ✓。
- §11.8 Mock 策略：阶段不改测试策略，只随测试文件位置迁移 ✓。

**Placeholder 扫描：** 每步都有具体代码或命令 —— 无 TBD / TODO。

**类型一致性：** `validateServiceSchema` / `validateNoticeSchema` 在 Task 9/12 定义与 Task 20 Step 3 sanity check 一致；`serializeForIpc` 从 M1 导出到 M2/M3 使用签名一致；envelope helpers 从 shared/envelope 导入到 main.js 使用一致。

**已识别风险：**

- Task 14 sed 命令是保守估计。若测试文件的 require 存在跨模块相对路径（如 `../../shared/serializer/reviveError`），sed 可能改错 —— Task 14 Step 5 指示手工过一遍所有 tests/ 内 require。
- Task 12 Step 5 中的 broadcast/direct 测试可能含 dash 事件名，需要与命名收紧同步修正。
- 若 npm ci 报 fs-extra 相关 warning，可能是 `package-lock.json` 未同步更新 —— 手工再跑一次 `npm install` 或 `rm -rf node_modules package-lock.json && npm install`。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-03-toolkit-refactor-stage2-code-fulfillment.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration. 20 tasks 建议分批（Task 1-7 / 8-13 / 14-15 / 16-20 四批），每批结束整体跑 `npm test` 与主观 code review。

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch with checkpoints.

Which approach?
