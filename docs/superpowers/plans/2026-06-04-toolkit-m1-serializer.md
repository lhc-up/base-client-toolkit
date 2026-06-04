# Toolkit M1 Serializer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement IPC-safe and logger-friendly serializer module per `docs/superpowers/specs/2026-05-27-toolkit-m1-serializer-design.md`.

**Architecture:** Pure-function serializer split into 5 files under `src/shared/serializer/`: entry (`index.js`), special type adapters (`adapters.js`), placeholder string generators (`placeholders.js`), limits & config (`limits.js`), and Error revival utility (`reviveError.js`). All operations are sync, no Electron dependencies. Wire-level envelope (`{ok, data?, error?}`) handling lives in M2/M3—M1 only provides the raw `serialize` primitive used by both sides.

**Tech Stack:** Node.js CJS, Vitest, Rollup. No third-party serialization libraries.

**Spec sections referenced:** §5 (API), §7 (type mapping), §8 (error handling & limits), §9 (test list). Integration tests touching M2 (`service-main.test.js`, `service-preload.test.js`) and M3 (`notice-main.test.js`) listed in spec §9.2 are **out of M1 plan scope** and belong to M2/M3 plans.

---

## File Structure

All paths relative to repo root `base-client-toolkit/`.

**Source files:**
- `src/shared/serializer/index.js` — entry; hosts core walker. Exports `serialize`, `safeStringify`, `configureSerializer`, `DEFAULTS`.
- `src/shared/serializer/limits.js` — `DEFAULTS` constants, `configureSerializer` setter, `resolveOpts` 3-tier merge.
- `src/shared/serializer/placeholders.js` — placeholder string generators.
- `src/shared/serializer/adapters.js` — type predicates + plain conversion for special types (Date/Error/Map/Set/RegExp/Buffer/ArrayBuffer/TypedArray/DOM-Window).
- `src/shared/serializer/reviveError.js` — preload-side Error reconstruction from serialized form.

**Test files (vitest):**
- `src/shared/serializer/__tests__/limits.test.js`
- `src/shared/serializer/__tests__/placeholders.test.js`
- `src/shared/serializer/__tests__/adapters.test.js`
- `src/shared/serializer/__tests__/serializer.test.js`
- `src/shared/serializer/__tests__/circular.test.js`
- `src/shared/serializer/__tests__/limits-runtime.test.js`
- `src/shared/serializer/__tests__/never-throw.test.js`
- `src/shared/serializer/__tests__/revive-error.test.js`

**Configuration:**
- `package.json` — verify `vitest` in `devDependencies`; ensure `"test": "vitest run"` and `"test:watch": "vitest"` scripts.

---

## Tasks

### Task 1: Project setup verification

**Files:**
- Verify: `package.json`

- [ ] **Step 1: Verify package.json serializer prerequisites**

Open `package.json` and confirm:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^2.x or later"
  }
}
```

Also confirm `dependencies` does NOT contain `@ungap/structured-clone` or `lodash.isfunction`. If found, uninstall:

```bash
npm uninstall @ungap/structured-clone lodash.isfunction
```

- [ ] **Step 2: Run baseline test suite**

```bash
npm test
```

Expected: vitest runs and exits 0 (any existing tests pass, or "no test files found"—both acceptable as baseline).

- [ ] **Step 3: Commit any cleanup**

If any uninstall happened:

```bash
git add package.json package-lock.json
git commit -m "chore(m1): clean obsolete serializer deps"
```

Otherwise skip.

---

### Task 2: Limits & config module

**Files:**
- Create: `src/shared/serializer/limits.js`
- Create: `src/shared/serializer/__tests__/limits.test.js`

Spec: §5.1 default values, §8.5 配置优先级.

- [ ] **Step 1: Write failing tests**

Create `src/shared/serializer/__tests__/limits.test.js`:

```js
const { describe, it, expect, beforeEach } = require('vitest');
const { DEFAULTS, configureSerializer, resolveOpts } = require('../limits');

describe('DEFAULTS', () => {
    it('exposes documented defaults', () => {
        expect(DEFAULTS.maxDepth).toBe(32);
        expect(DEFAULTS.maxStringLength).toBe(10240);
        expect(DEFAULTS.maxArrayLength).toBe(1000);
        expect(DEFAULTS.maxKeys).toBe(1000);
        expect(typeof DEFAULTS.strict).toBe('boolean');
    });
});

describe('configureSerializer & resolveOpts', () => {
    beforeEach(() => {
        configureSerializer({
            maxDepth: 32,
            maxStringLength: 10240,
            maxArrayLength: 1000,
            maxKeys: 1000,
            strict: false,
        });
    });

    it('per-call overrides global', () => {
        configureSerializer({ maxDepth: 8 });
        expect(resolveOpts({ maxDepth: 2 }).maxDepth).toBe(2);
    });

    it('global overrides default when no per-call', () => {
        configureSerializer({ maxDepth: 16 });
        expect(resolveOpts({}).maxDepth).toBe(16);
    });

    it('defaults apply when neither set', () => {
        expect(resolveOpts({}).maxStringLength).toBe(10240);
    });

    it('uses ?? (preserves falsy 0)', () => {
        expect(resolveOpts({ maxDepth: 0 }).maxDepth).toBe(0);
    });

    it('ignores unknown keys', () => {
        configureSerializer({ unknownField: 'x' });
        expect(resolveOpts({})).not.toHaveProperty('unknownField');
    });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
npx vitest run src/shared/serializer/__tests__/limits.test.js
```

Expected: FAIL with `Cannot find module '../limits'`.

- [ ] **Step 3: Implement `limits.js`**

Create `src/shared/serializer/limits.js`:

```js
const DEFAULTS = Object.freeze({
    maxDepth: 32,
    maxStringLength: 10240,
    maxArrayLength: 1000,
    maxKeys: 1000,
    strict: process.env.NODE_ENV !== 'production',
});

let globalDefaults = { ...DEFAULTS };

function configureSerializer(opts = {}) {
    for (const key of Object.keys(DEFAULTS)) {
        if (opts[key] !== undefined) globalDefaults[key] = opts[key];
    }
}

function resolveOpts(opts = {}) {
    return {
        maxDepth:        opts.maxDepth        ?? globalDefaults.maxDepth,
        maxStringLength: opts.maxStringLength ?? globalDefaults.maxStringLength,
        maxArrayLength:  opts.maxArrayLength  ?? globalDefaults.maxArrayLength,
        maxKeys:         opts.maxKeys         ?? globalDefaults.maxKeys,
        strict:          opts.strict          ?? globalDefaults.strict,
        onError:         opts.onError,
    };
}

module.exports = { DEFAULTS, configureSerializer, resolveOpts };
```

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run src/shared/serializer/__tests__/limits.test.js
```

Expected: PASS (all 7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/serializer/limits.js src/shared/serializer/__tests__/limits.test.js
git commit -m "feat(m1): limits and config module"
```

---

### Task 3: Placeholder string generators

**Files:**
- Create: `src/shared/serializer/placeholders.js`
- Create: `src/shared/serializer/__tests__/placeholders.test.js`

Spec: §7 type mapping (placeholder column), §8.4 上限触发.

- [ ] **Step 1: Write failing tests**

Create `src/shared/serializer/__tests__/placeholders.test.js`:

```js
const { describe, it, expect } = require('vitest');
const P = require('../placeholders');

describe('placeholders', () => {
    it('Function named', () => {
        function foo() {}
        expect(P.placeholderFunction(foo)).toBe('[Function: foo]');
    });
    it('Function anonymous', () => {
        const anon = function () {};
        Object.defineProperty(anon, 'name', { value: '' });
        expect(P.placeholderFunction(anon)).toBe('[Function: anonymous]');
    });
    it('Symbol with description', () => {
        expect(P.placeholderSymbol(Symbol('xyz'))).toBe('[Symbol(xyz)]');
    });
    it('Symbol without description', () => {
        expect(P.placeholderSymbol(Symbol())).toBe('[Symbol]');
    });
    it('BigInt', () => {
        expect(P.placeholderBigInt(123n)).toBe('[BigInt: 123]');
    });
    it('Buffer (Node Buffer)', () => {
        expect(P.placeholderBuffer(Buffer.from('hello'))).toBe('[Buffer: 5 bytes]');
    });
    it('Buffer (ArrayBuffer)', () => {
        expect(P.placeholderBuffer(new ArrayBuffer(8))).toBe('[Buffer: 8 bytes]');
    });
    it('Promise', () => {
        expect(P.placeholderPromise()).toBe('[Promise]');
    });
    it('WeakMap / WeakSet', () => {
        expect(P.placeholderWeakMap()).toBe('[WeakMap]');
        expect(P.placeholderWeakSet()).toBe('[WeakSet]');
    });
    it('DOM uses tagName then nodeName', () => {
        expect(P.placeholderDOM({ tagName: 'DIV' })).toBe('[DOM: DIV]');
        expect(P.placeholderDOM({ nodeName: '#text' })).toBe('[DOM: #text]');
    });
    it('Window', () => {
        expect(P.placeholderWindow()).toBe('[Window]');
    });
    it('Circular default + with path', () => {
        expect(P.placeholderCircular()).toBe('[Circular: $]');
        expect(P.placeholderCircular('$.a.b')).toBe('[Circular: $.a.b]');
    });
    it('MaxDepth', () => {
        expect(P.placeholderMaxDepth()).toBe('[MaxDepth]');
    });
    it('Number non-finite', () => {
        expect(P.placeholderNumber(NaN)).toBe('[Number: NaN]');
        expect(P.placeholderNumber(Infinity)).toBe('[Number: Infinity]');
        expect(P.placeholderNumber(-Infinity)).toBe('[Number: -Infinity]');
    });
    it('Unserializable & SerializeError', () => {
        expect(P.placeholderUnserializable('function')).toBe('[Unserializable: function]');
        expect(P.placeholderSerializeError('boom')).toBe('[SerializeError: boom]');
    });
    it('truncated formatters', () => {
        expect(P.truncatedString(5)).toBe('...[truncated 5 chars]');
        expect(P.truncatedArray(7)).toBe('...[truncated 7 items]');
    });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
npx vitest run src/shared/serializer/__tests__/placeholders.test.js
```

Expected: FAIL with module not found.

- [ ] **Step 3: Implement `placeholders.js`**

Create `src/shared/serializer/placeholders.js`:

```js
function placeholderFunction(fn) {
    const name = fn.name || 'anonymous';
    return `[Function: ${name}]`;
}

function placeholderSymbol(sym) {
    const desc = sym.description;
    return desc ? `[Symbol(${desc})]` : '[Symbol]';
}

function placeholderBigInt(big) {
    return `[BigInt: ${big.toString()}]`;
}

function placeholderBuffer(buf) {
    const size = buf.byteLength ?? buf.length ?? 0;
    return `[Buffer: ${size} bytes]`;
}

function placeholderPromise() { return '[Promise]'; }
function placeholderWeakMap() { return '[WeakMap]'; }
function placeholderWeakSet() { return '[WeakSet]'; }

function placeholderDOM(node) {
    const tag = node.tagName || node.nodeName || 'Node';
    return `[DOM: ${tag}]`;
}

function placeholderWindow() { return '[Window]'; }

function placeholderCircular(path) {
    return `[Circular: ${path || '$'}]`;
}

function placeholderMaxDepth() { return '[MaxDepth]'; }

function placeholderNumber(n) {
    if (Number.isNaN(n))  return '[Number: NaN]';
    if (n === Infinity)   return '[Number: Infinity]';
    if (n === -Infinity)  return '[Number: -Infinity]';
    return String(n);
}

function placeholderUnserializable(reason) {
    return `[Unserializable: ${reason}]`;
}

function placeholderSerializeError(msg) {
    return `[SerializeError: ${msg}]`;
}

function truncatedString(n) { return `...[truncated ${n} chars]`; }
function truncatedArray(n)  { return `...[truncated ${n} items]`; }

module.exports = {
    placeholderFunction,
    placeholderSymbol,
    placeholderBigInt,
    placeholderBuffer,
    placeholderPromise,
    placeholderWeakMap,
    placeholderWeakSet,
    placeholderDOM,
    placeholderWindow,
    placeholderCircular,
    placeholderMaxDepth,
    placeholderNumber,
    placeholderUnserializable,
    placeholderSerializeError,
    truncatedString,
    truncatedArray,
};
```

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run src/shared/serializer/__tests__/placeholders.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/serializer/placeholders.js src/shared/serializer/__tests__/placeholders.test.js
git commit -m "feat(m1): placeholder string generators"
```

---

### Task 4: Type adapters

**Files:**
- Create: `src/shared/serializer/adapters.js`
- Create: `src/shared/serializer/__tests__/adapters.test.js`

Spec: §7 type mapping table.

- [ ] **Step 1: Write failing tests**

Create `src/shared/serializer/__tests__/adapters.test.js`:

```js
const { describe, it, expect } = require('vitest');
const A = require('../adapters');

describe('predicates', () => {
    it('isDate', () => {
        expect(A.isDate(new Date())).toBe(true);
        expect(A.isDate({})).toBe(false);
    });
    it('isError covers subclasses', () => {
        expect(A.isError(new Error())).toBe(true);
        expect(A.isError(new TypeError())).toBe(true);
        expect(A.isError({})).toBe(false);
    });
    it('isMap / isSet', () => {
        expect(A.isMap(new Map())).toBe(true);
        expect(A.isSet(new Set())).toBe(true);
    });
    it('isRegExp', () => {
        expect(A.isRegExp(/x/)).toBe(true);
    });
    it('isBuffer / isArrayBuffer / isTypedArray', () => {
        expect(A.isBuffer(Buffer.from('x'))).toBe(true);
        expect(A.isArrayBuffer(new ArrayBuffer(1))).toBe(true);
        expect(A.isTypedArray(new Uint8Array([1, 2]))).toBe(true);
    });
    it('isPromise (thenable)', () => {
        expect(A.isPromise(Promise.resolve())).toBe(true);
        expect(A.isPromise({ then: () => {} })).toBe(true);
    });
    it('isWindowLike tolerates throwing getter', () => {
        const obj = {};
        Object.defineProperty(obj, 'window', {
            get() { throw new Error('boom'); }
        });
        expect(() => A.isWindowLike(obj)).not.toThrow();
    });
});

describe('conversions', () => {
    it('dateToPlain', () => {
        const d = new Date('2026-05-27T10:00:00.000Z');
        expect(A.dateToPlain(d)).toBe('2026-05-27T10:00:00.000Z');
    });
    it('dateToPlain invalid Date', () => {
        expect(A.dateToPlain(new Date('not a date'))).toBe(null);
    });
    it('errorToPlain basic', () => {
        const e = new TypeError('boom');
        const p = A.errorToPlain(e, (v) => v);
        expect(p.name).toBe('TypeError');
        expect(p.message).toBe('boom');
        expect(typeof p.stack).toBe('string');
        expect(p).not.toHaveProperty('code');
    });
    it('errorToPlain with code & cause', () => {
        const inner = new Error('inner');
        const outer = new Error('outer', { cause: inner });
        outer.code = 'E_BOOM';
        const recurseId = v => v;   // identity for test
        const p = A.errorToPlain(outer, recurseId);
        expect(p.code).toBe('E_BOOM');
        expect(p.cause).toBe(inner);   // recurse callback gets raw cause
    });
    it('mapToPlain string-only-keys → object', () => {
        const m = new Map([['a', 1], ['b', 2]]);
        const recurseId = v => v;
        expect(A.mapToPlain(m, recurseId)).toEqual({ a: 1, b: 2 });
    });
    it('mapToPlain mixed-keys → entries array', () => {
        const m = new Map([[1, 'a'], ['b', 2]]);
        const recurseId = v => v;
        expect(A.mapToPlain(m, recurseId)).toEqual([[1, 'a'], ['b', 2]]);
    });
    it('setToPlain → array', () => {
        const recurseId = v => v;
        expect(A.setToPlain(new Set([1, 2, 3]), recurseId)).toEqual([1, 2, 3]);
    });
    it('regExpToPlain', () => {
        expect(A.regExpToPlain(/foo/gi)).toEqual({ source: 'foo', flags: 'gi' });
    });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
npx vitest run src/shared/serializer/__tests__/adapters.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `adapters.js`**

Create `src/shared/serializer/adapters.js`:

```js
// —— Predicates ——

const isDate = v => v instanceof Date;
const isError = v => v instanceof Error;
const isMap = v => v instanceof Map;
const isSet = v => v instanceof Set;
const isRegExp = v => v instanceof RegExp;
const isBuffer = v =>
    typeof Buffer !== 'undefined' && Buffer.isBuffer(v);
const isArrayBuffer = v => v instanceof ArrayBuffer;
const isTypedArray = v => ArrayBuffer.isView(v) && !(v instanceof DataView);
const isPromise = v =>
    v != null && typeof v === 'object' && typeof v.then === 'function';

function isWindowLike(v) {
    if (v == null || typeof v !== 'object') return false;
    try {
        return v === v.window && typeof v.document === 'object';
    } catch {
        return false;
    }
}

const isDOMNode = v =>
    v != null && typeof v === 'object' &&
    (typeof v.nodeType === 'number' || typeof v.tagName === 'string');

// —— Conversions ——

function dateToPlain(d) {
    const t = d.getTime();
    if (Number.isNaN(t)) return null;
    return d.toISOString();
}

function errorToPlain(err, recurse) {
    const out = {
        name: err.name,
        message: err.message,
        stack: err.stack,
    };
    if (err.code !== undefined) out.code = err.code;
    if (err.cause !== undefined) out.cause = recurse(err.cause);
    return out;
}

function mapToPlain(m, recurse) {
    let allStringKeys = true;
    for (const k of m.keys()) {
        if (typeof k !== 'string') { allStringKeys = false; break; }
    }
    if (allStringKeys) {
        const obj = {};
        for (const [k, v] of m.entries()) obj[k] = recurse(v);
        return obj;
    }
    const arr = [];
    for (const [k, v] of m.entries()) arr.push([recurse(k), recurse(v)]);
    return arr;
}

function setToPlain(s, recurse) {
    const arr = [];
    for (const v of s.values()) arr.push(recurse(v));
    return arr;
}

function regExpToPlain(r) {
    return { source: r.source, flags: r.flags };
}

module.exports = {
    isDate, isError, isMap, isSet, isRegExp,
    isBuffer, isArrayBuffer, isTypedArray,
    isPromise, isWindowLike, isDOMNode,
    dateToPlain, errorToPlain, mapToPlain, setToPlain, regExpToPlain,
};
```

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run src/shared/serializer/__tests__/adapters.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/serializer/adapters.js src/shared/serializer/__tests__/adapters.test.js
git commit -m "feat(m1): type predicates and special-type adapters"
```

---

### Task 5: Core serializer walker (primitives + objects + arrays)

**Files:**
- Create: `src/shared/serializer/index.js`
- Create: `src/shared/serializer/__tests__/serializer.test.js`

Spec: §7 type mapping (rows for primitives, arrays, objects).

- [ ] **Step 1: Write failing tests (primitives + plain objects)**

Create `src/shared/serializer/__tests__/serializer.test.js`:

```js
const { describe, it, expect } = require('vitest');
const { serialize } = require('../index');

describe('primitives', () => {
    it('string / number / boolean / null', () => {
        expect(serialize('hi')).toBe('hi');
        expect(serialize(42)).toBe(42);
        expect(serialize(true)).toBe(true);
        expect(serialize(null)).toBe(null);
    });
    it('undefined preserved at top level', () => {
        expect(serialize(undefined)).toBe(undefined);
    });
    it('non-finite numbers become placeholders', () => {
        expect(serialize(NaN)).toBe('[Number: NaN]');
        expect(serialize(Infinity)).toBe('[Number: Infinity]');
        expect(serialize(-Infinity)).toBe('[Number: -Infinity]');
    });
    it('non-serializable scalars: function / symbol / bigint', () => {
        expect(serialize(function foo() {})).toBe('[Function: foo]');
        expect(serialize(Symbol('x'))).toBe('[Symbol(x)]');
        expect(serialize(10n)).toBe('[BigInt: 10]');
    });
});

describe('plain objects and arrays', () => {
    it('shallow object', () => {
        expect(serialize({ a: 1, b: 'two' })).toEqual({ a: 1, b: 'two' });
    });
    it('nested object', () => {
        expect(serialize({ a: { b: { c: 3 } } })).toEqual({ a: { b: { c: 3 } } });
    });
    it('arrays recurse', () => {
        expect(serialize([1, { a: 2 }, [3, 4]])).toEqual([1, { a: 2 }, [3, 4]]);
    });
    it('undefined inside array → null', () => {
        expect(serialize([1, undefined, 3])).toEqual([1, null, 3]);
    });
    it('Symbol keys skipped', () => {
        const sym = Symbol('s');
        const obj = { a: 1, [sym]: 'hidden' };
        const out = serialize(obj);
        expect(out).toEqual({ a: 1 });
    });
    it('toJSON taken when present', () => {
        const obj = {
            value: 42,
            toJSON() { return { transformed: true }; },
        };
        expect(serialize(obj)).toEqual({ transformed: true });
    });
    it('toJSON throw → fallback to plain copy without toJSON key', () => {
        const obj = {
            x: 1,
            toJSON() { throw new Error('boom'); },
        };
        const out = serialize(obj);
        expect(out).toEqual({ x: 1 });
        expect(out).not.toHaveProperty('toJSON');
    });
});

describe('class instances → plain copy (no __type marker)', () => {
    it('plain copy of enumerable props', () => {
        class Point {
            constructor(x, y) { this.x = x; this.y = y; }
        }
        expect(serialize(new Point(1, 2))).toEqual({ x: 1, y: 2 });
    });
});

describe('JSON-safety', () => {
    it('result of serialize is always JSON.stringify-safe', () => {
        const ugly = {
            fn: () => {},
            sym: Symbol(),
            big: 1n,
            nan: NaN,
        };
        expect(() => JSON.stringify(serialize(ugly))).not.toThrow();
    });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
npx vitest run src/shared/serializer/__tests__/serializer.test.js
```

Expected: FAIL — `serialize` not exported.

- [ ] **Step 3: Implement core walker in `index.js`**

Create `src/shared/serializer/index.js`:

```js
const { resolveOpts, DEFAULTS, configureSerializer } = require('./limits');
const P = require('./placeholders');
const A = require('./adapters');

const NO_VALUE = Symbol('no-value');

function serialize(value, opts) {
    const cfg = resolveOpts(opts);
    const seen = new WeakMap();   // container → path
    try {
        return walk(value, cfg, '$', 0, seen);
    } catch (err) {
        if (cfg.strict) throw err;
        if (cfg.onError) safeOnError(cfg.onError, err.message, '$');
        return P.placeholderSerializeError(err.message);
    }
}

function safeOnError(onError, reason, path) {
    try { onError(reason, path); } catch { /* swallow */ }
}

function walk(value, cfg, path, depth, seen) {
    // depth guard
    if (depth > cfg.maxDepth) return P.placeholderMaxDepth();

    // null / undefined
    if (value === null) return null;
    if (value === undefined) return undefined;

    const t = typeof value;

    if (t === 'string') {
        if (value.length > cfg.maxStringLength) {
            return value.slice(0, cfg.maxStringLength) +
                P.truncatedString(value.length - cfg.maxStringLength);
        }
        return value;
    }

    if (t === 'number') {
        return Number.isFinite(value) ? value : P.placeholderNumber(value);
    }

    if (t === 'boolean') return value;

    if (t === 'bigint')   return P.placeholderBigInt(value);
    if (t === 'symbol')   return P.placeholderSymbol(value);
    if (t === 'function') return P.placeholderFunction(value);

    // Object-like below
    if (t !== 'object') return P.placeholderUnserializable(t);

    // Adapter dispatch: special types are leaf-like (no seen tracking)
    if (A.isDate(value))         return A.dateToPlain(value);
    if (A.isRegExp(value))       return A.regExpToPlain(value);
    if (A.isError(value)) {
        const recurse = v => walk(v, cfg, path + '.<cause>', depth + 1, seen);
        return A.errorToPlain(value, recurse);
    }
    if (A.isBuffer(value) || A.isArrayBuffer(value)) {
        return P.placeholderBuffer(value);
    }
    if (A.isTypedArray(value)) {
        const arr = Array.from(value);
        return walkArray(arr, cfg, path, depth, seen);
    }
    if (A.isPromise(value))      return P.placeholderPromise();
    if (value instanceof WeakMap) return P.placeholderWeakMap();
    if (value instanceof WeakSet) return P.placeholderWeakSet();
    if (A.isWindowLike(value))   return P.placeholderWindow();
    if (A.isDOMNode(value))      return P.placeholderDOM(value);

    // Containers: Map / Set / plain object / array / class instance — circular check
    if (seen.has(value)) return P.placeholderCircular(seen.get(value));
    seen.set(value, path);

    if (A.isMap(value)) {
        const recurse = v => walk(v, cfg, path + '.<map>', depth + 1, seen);
        return A.mapToPlain(value, recurse);
    }
    if (A.isSet(value)) {
        const recurse = v => walk(v, cfg, path + '.<set>', depth + 1, seen);
        return A.setToPlain(value, recurse);
    }
    if (Array.isArray(value)) {
        return walkArray(value, cfg, path, depth, seen);
    }

    // toJSON path
    if (typeof value.toJSON === 'function') {
        let tjson = NO_VALUE;
        try {
            tjson = value.toJSON();
        } catch {
            // fallback to plain-walk, skip toJSON key
        }
        if (tjson !== NO_VALUE) {
            return walk(tjson, cfg, path, depth + 1, seen);
        }
        return walkObject(value, cfg, path, depth, seen, /* skipToJSON */ true);
    }

    return walkObject(value, cfg, path, depth, seen, false);
}

function walkArray(arr, cfg, path, depth, seen) {
    const out = [];
    const limit = Math.min(arr.length, cfg.maxArrayLength);
    for (let i = 0; i < limit; i++) {
        const v = arr[i];
        const child = walk(v, cfg, `${path}[${i}]`, depth + 1, seen);
        out.push(child === undefined ? null : child);
    }
    if (arr.length > cfg.maxArrayLength) {
        out.push(P.truncatedArray(arr.length - cfg.maxArrayLength));
    }
    return out;
}

function walkObject(obj, cfg, path, depth, seen, skipToJSON) {
    const out = {};
    const keys = Object.keys(obj);
    const limit = Math.min(keys.length, cfg.maxKeys);
    for (let i = 0; i < limit; i++) {
        const k = keys[i];
        if (skipToJSON && k === 'toJSON') continue;
        let v;
        try {
            v = obj[k];
        } catch (err) {
            if (cfg.strict) throw err;
            out[k] = P.placeholderUnserializable(err.message);
            continue;
        }
        out[k] = walk(v, cfg, `${path}.${k}`, depth + 1, seen);
    }
    if (keys.length > cfg.maxKeys) {
        out.__truncated = `${keys.length - cfg.maxKeys} more keys`;
    }
    return out;
}

function safeStringify(value, opts) {
    return JSON.stringify(serialize(value, opts));
}

module.exports = {
    serialize,
    safeStringify,
    configureSerializer,
    DEFAULTS,
};
```

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run src/shared/serializer/__tests__/serializer.test.js
```

Expected: PASS all primitive/object/array tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/serializer/index.js src/shared/serializer/__tests__/serializer.test.js
git commit -m "feat(m1): core walker for primitives, objects, arrays, adapters"
```

---

### Task 6: Special-type integration tests

**Files:**
- Append to: `src/shared/serializer/__tests__/serializer.test.js`

Verify the core walker correctly dispatches through adapters for all spec §7 types.

- [ ] **Step 1: Append tests**

Append to `src/shared/serializer/__tests__/serializer.test.js`:

```js
describe('special types end-to-end', () => {
    const { serialize } = require('../index');

    it('Date → ISO string', () => {
        expect(serialize(new Date('2026-05-27T10:00:00.000Z')))
            .toBe('2026-05-27T10:00:00.000Z');
    });
    it('Error with cause', () => {
        const inner = new RangeError('inner');
        const outer = new Error('outer', { cause: inner });
        const out = serialize(outer);
        expect(out.name).toBe('Error');
        expect(out.message).toBe('outer');
        expect(out.cause.name).toBe('RangeError');
        expect(out.cause.message).toBe('inner');
    });
    it('Map string-only keys → object', () => {
        const m = new Map([['a', 1], ['b', 2]]);
        expect(serialize(m)).toEqual({ a: 1, b: 2 });
    });
    it('Map mixed keys → entries array', () => {
        const m = new Map([[1, 'a'], ['b', 2]]);
        expect(serialize(m)).toEqual([[1, 'a'], ['b', 2]]);
    });
    it('Set → array', () => {
        expect(serialize(new Set([3, 1, 2]))).toEqual([3, 1, 2]);
    });
    it('RegExp → { source, flags }', () => {
        expect(serialize(/foo/gi)).toEqual({ source: 'foo', flags: 'gi' });
    });
    it('Buffer → placeholder', () => {
        expect(serialize(Buffer.from('hi'))).toBe('[Buffer: 2 bytes]');
    });
    it('ArrayBuffer → placeholder', () => {
        expect(serialize(new ArrayBuffer(4))).toBe('[Buffer: 4 bytes]');
    });
    it('TypedArray → plain array', () => {
        expect(serialize(new Uint8Array([1, 2, 3]))).toEqual([1, 2, 3]);
    });
    it('WeakMap / WeakSet → placeholder', () => {
        expect(serialize(new WeakMap())).toBe('[WeakMap]');
        expect(serialize(new WeakSet())).toBe('[WeakSet]');
    });
    it('Promise → placeholder', () => {
        expect(serialize(Promise.resolve())).toBe('[Promise]');
    });
});

describe('shared leaf references', () => {
    const { serialize } = require('../index');
    it('same Date in two fields each serialized separately', () => {
        const d = new Date('2026-01-01T00:00:00.000Z');
        const out = serialize({ a: d, b: d });
        expect(out.a).toBe('2026-01-01T00:00:00.000Z');
        expect(out.b).toBe('2026-01-01T00:00:00.000Z');
    });
    it('same plain object in two fields → second is Circular', () => {
        const shared = { value: 1 };
        const out = serialize({ a: shared, b: shared });
        expect(out.a).toEqual({ value: 1 });
        expect(out.b).toMatch(/^\[Circular: /);
    });
});
```

- [ ] **Step 2: Run test, verify all pass**

```bash
npx vitest run src/shared/serializer/__tests__/serializer.test.js
```

Expected: PASS all tests (primitives + objects + special types + shared refs).

- [ ] **Step 3: Commit**

```bash
git add src/shared/serializer/__tests__/serializer.test.js
git commit -m "test(m1): special-type end-to-end coverage"
```

---

### Task 7: Circular detection

**Files:**
- Create: `src/shared/serializer/__tests__/circular.test.js`

Verify circular paths are correctly detected and labeled.

- [ ] **Step 1: Write tests**

Create `src/shared/serializer/__tests__/circular.test.js`:

```js
const { describe, it, expect } = require('vitest');
const { serialize } = require('../index');

describe('circular detection', () => {
    it('direct self-reference', () => {
        const a = {};
        a.self = a;
        const out = serialize(a);
        expect(out.self).toBe('[Circular: $]');
    });

    it('indirect 2-cycle', () => {
        const a = {};
        const b = { a };
        a.b = b;
        const out = serialize(a);
        expect(out.b.a).toMatch(/^\[Circular: /);
    });

    it('circular inside array', () => {
        const a = { id: 1 };
        a.children = [a];
        const out = serialize(a);
        expect(out.children[0]).toMatch(/^\[Circular: /);
    });

    it('circular path reflects entry chain', () => {
        const a = { id: 'A' };
        const b = { a };
        a.b = b;
        const out = serialize(a);
        expect(out.b.a).toBe('[Circular: $]');
    });

    it('circular output is JSON-safe', () => {
        const a = {};
        a.self = a;
        expect(() => JSON.stringify(serialize(a))).not.toThrow();
    });
});
```

- [ ] **Step 2: Run test, verify pass (walker already handles this)**

```bash
npx vitest run src/shared/serializer/__tests__/circular.test.js
```

Expected: PASS (Task 5's `walkObject` + `walkArray` + `seen` WeakMap already implement this).

- [ ] **Step 3: Commit**

```bash
git add src/shared/serializer/__tests__/circular.test.js
git commit -m "test(m1): circular reference coverage"
```

---

### Task 8: Runtime limits enforcement

**Files:**
- Create: `src/shared/serializer/__tests__/limits-runtime.test.js`

Spec: §8.4 上限触发行为, §8.5 配置优先级.

- [ ] **Step 1: Write tests**

Create `src/shared/serializer/__tests__/limits-runtime.test.js`:

```js
const { describe, it, expect, beforeEach } = require('vitest');
const { serialize, configureSerializer } = require('../index');

describe('runtime limits', () => {
    beforeEach(() => {
        configureSerializer({
            maxDepth: 32,
            maxStringLength: 10240,
            maxArrayLength: 1000,
            maxKeys: 1000,
            strict: false,
        });
    });

    it('long string truncated', () => {
        const s = 'a'.repeat(20);
        const out = serialize(s, { maxStringLength: 10 });
        expect(out).toBe('aaaaaaaaaa...[truncated 10 chars]');
    });

    it('long array truncated', () => {
        const arr = Array.from({ length: 5 }, (_, i) => i);
        const out = serialize(arr, { maxArrayLength: 3 });
        expect(out).toEqual([0, 1, 2, '...[truncated 2 items]']);
    });

    it('many keys truncated', () => {
        const obj = {};
        for (let i = 0; i < 5; i++) obj['k' + i] = i;
        const out = serialize(obj, { maxKeys: 3 });
        expect(Object.keys(out).filter(k => k !== '__truncated')).toEqual(['k0', 'k1', 'k2']);
        expect(out.__truncated).toBe('2 more keys');
    });

    it('deep nesting capped', () => {
        let deep = { v: 0 };
        for (let i = 1; i <= 5; i++) deep = { d: deep };
        const out = serialize(deep, { maxDepth: 2 });
        // root is depth 0, .d is 1, .d.d is 2, .d.d.d should be MaxDepth
        expect(out.d.d.d).toBe('[MaxDepth]');
    });

    it('per-call overrides global', () => {
        configureSerializer({ maxDepth: 5 });
        const s = 'a'.repeat(20);
        const out = serialize(s, { maxStringLength: 5 });
        expect(out).toBe('aaaaa...[truncated 15 chars]');
    });

    it('global default takes when per-call absent', () => {
        configureSerializer({ maxArrayLength: 2 });
        const out = serialize([1, 2, 3, 4]);
        expect(out).toEqual([1, 2, '...[truncated 2 items]']);
    });
});
```

- [ ] **Step 2: Run test, verify pass**

```bash
npx vitest run src/shared/serializer/__tests__/limits-runtime.test.js
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/shared/serializer/__tests__/limits-runtime.test.js
git commit -m "test(m1): runtime limits and truncation"
```

---

### Task 9: Never-throw safety + strict mode

**Files:**
- Create: `src/shared/serializer/__tests__/never-throw.test.js`

Spec: §8.1 永不抛错的两层, §8.3 总兜底.

- [ ] **Step 1: Write tests**

Create `src/shared/serializer/__tests__/never-throw.test.js`:

```js
const { describe, it, expect, beforeEach } = require('vitest');
const { serialize, configureSerializer } = require('../index');

beforeEach(() => {
    configureSerializer({
        maxDepth: 32,
        maxStringLength: 10240,
        maxArrayLength: 1000,
        maxKeys: 1000,
        strict: false,
    });
});

describe('lossy conversions never throw', () => {
    it('strict=true does not throw for lossy types', () => {
        const ugly = { fn: () => {}, sym: Symbol(), big: 1n };
        expect(() => serialize(ugly, { strict: true })).not.toThrow();
    });
});

describe('throwing getters', () => {
    it('strict=false: returns placeholder + invokes onError', () => {
        const errs = [];
        const obj = {};
        Object.defineProperty(obj, 'x', {
            get() { throw new Error('boom'); },
            enumerable: true,
        });
        const onError = (reason, path) => errs.push({ reason, path });
        const out = serialize(obj, { strict: false, onError });
        expect(out.x).toBe('[Unserializable: boom]');
    });

    it('strict=true: rethrows', () => {
        const obj = {};
        Object.defineProperty(obj, 'x', {
            get() { throw new Error('boom'); },
            enumerable: true,
        });
        expect(() => serialize(obj, { strict: true })).toThrow(/boom/);
    });
});

describe('Proxy with throwing handler', () => {
    it('strict=false: placeholder', () => {
        const proxy = new Proxy({}, {
            ownKeys() { throw new Error('proxy boom'); },
        });
        const out = serialize(proxy, { strict: false });
        expect(typeof out).toBe('string');
        expect(out).toMatch(/^\[SerializeError: /);
    });
});

describe('toJSON throwing', () => {
    it('falls back to plain object path, skips toJSON key', () => {
        const obj = {
            value: 1,
            toJSON() { throw new Error('boom'); },
        };
        const out = serialize(obj);
        expect(out).toEqual({ value: 1 });
    });
});

describe('combined chaos', () => {
    it('depth + circular + throwing getter all together → no throw', () => {
        const a = { x: 1 };
        a.self = a;
        Object.defineProperty(a, 'bad', {
            get() { throw new Error('bad'); },
            enumerable: true,
        });
        expect(() => serialize(a, { strict: false })).not.toThrow();
    });
});

describe('onError contract', () => {
    it('lossy conversions do NOT trigger onError', () => {
        const calls = [];
        serialize({ fn: () => {}, sym: Symbol() },
            { strict: false, onError: (r, p) => calls.push({ r, p }) });
        expect(calls).toEqual([]);
    });

    it('throwing getter DOES trigger onError', () => {
        const calls = [];
        const obj = {};
        Object.defineProperty(obj, 'x', {
            get() { throw new Error('via getter'); },
            enumerable: true,
        });
        serialize(obj, { strict: false, onError: (r, p) => calls.push({ r, p }) });
        expect(calls.length).toBeGreaterThan(0);
    });
});
```

- [ ] **Step 2: Run test, verify failures**

```bash
npx vitest run src/shared/serializer/__tests__/never-throw.test.js
```

Expected: Some tests may fail — `onError` invocation from throwing getter in `walkObject` not yet wired to onError callback.

- [ ] **Step 3: Update `walkObject` to invoke `onError` for throwing getter**

Modify `src/shared/serializer/index.js`. Find `walkObject` and change the getter catch branch:

```js
function walkObject(obj, cfg, path, depth, seen, skipToJSON) {
    const out = {};
    const keys = Object.keys(obj);
    const limit = Math.min(keys.length, cfg.maxKeys);
    for (let i = 0; i < limit; i++) {
        const k = keys[i];
        if (skipToJSON && k === 'toJSON') continue;
        let v;
        try {
            v = obj[k];
        } catch (err) {
            if (cfg.strict) throw err;
            if (cfg.onError) safeOnError(cfg.onError, err.message, `${path}.${k}`);
            out[k] = P.placeholderUnserializable(err.message);
            continue;
        }
        out[k] = walk(v, cfg, `${path}.${k}`, depth + 1, seen);
    }
    if (keys.length > cfg.maxKeys) {
        out.__truncated = `${keys.length - cfg.maxKeys} more keys`;
    }
    return out;
}
```

Also handle Proxy `ownKeys` throws in `walk` for object branch: wrap `Object.keys(obj)` access in try/catch at the top of `walkObject`:

```js
function walkObject(obj, cfg, path, depth, seen, skipToJSON) {
    let keys;
    try {
        keys = Object.keys(obj);
    } catch (err) {
        if (cfg.strict) throw err;
        if (cfg.onError) safeOnError(cfg.onError, err.message, path);
        return P.placeholderSerializeError(err.message);
    }
    const out = {};
    const limit = Math.min(keys.length, cfg.maxKeys);
    // ...rest unchanged...
}
```

- [ ] **Step 4: Run tests, verify all pass**

```bash
npx vitest run src/shared/serializer/__tests__/never-throw.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/serializer/index.js src/shared/serializer/__tests__/never-throw.test.js
git commit -m "feat(m1): never-throw safety + strict-mode + onError"
```

---

### Task 10: reviveError module

**Files:**
- Create: `src/shared/serializer/reviveError.js`
- Create: `src/shared/serializer/__tests__/revive-error.test.js`

Spec: §5.3 错误对象处理收编 (reviveError 部分).

- [ ] **Step 1: Write tests**

Create `src/shared/serializer/__tests__/revive-error.test.js`:

```js
const { describe, it, expect } = require('vitest');
const { reviveError } = require('../reviveError');

describe('reviveError', () => {
    it('TypeError preserved', () => {
        const serialized = {
            name: 'TypeError',
            message: 'boom',
            stack: 'TypeError: boom\n  at ...',
        };
        const err = reviveError(serialized);
        expect(err).toBeInstanceOf(TypeError);
        expect(err.message).toBe('boom');
        expect(err.stack).toBe('TypeError: boom\n  at ...');
    });

    it('code field preserved', () => {
        const err = reviveError({ name: 'Error', message: 'x', code: 'E_X' });
        expect(err.code).toBe('E_X');
    });

    it('cause recursively revived', () => {
        const err = reviveError({
            name: 'Error',
            message: 'outer',
            cause: { name: 'RangeError', message: 'inner' },
        });
        expect(err.cause).toBeInstanceOf(RangeError);
        expect(err.cause.message).toBe('inner');
    });

    it('unknown name falls back to Error but preserves name field', () => {
        const err = reviveError({ name: 'CustomBoom', message: 'x' });
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe('CustomBoom');
    });

    it('string input → Error with message', () => {
        const err = reviveError('plain string');
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toBe('plain string');
    });

    it('null/undefined → Error with stringified', () => {
        expect(reviveError(null)).toBeInstanceOf(Error);
        expect(reviveError(undefined)).toBeInstanceOf(Error);
    });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
npx vitest run src/shared/serializer/__tests__/revive-error.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `reviveError.js`**

Create `src/shared/serializer/reviveError.js`:

```js
const ERROR_TYPES = {
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    ReferenceError,
    EvalError,
    URIError,
};

function reviveError(input) {
    if (input == null || typeof input !== 'object') {
        return new Error(String(input));
    }
    const { name, message, stack, code, cause } = input;
    const Ctor = ERROR_TYPES[name] || Error;
    const err = new Ctor(message ?? '');
    if (name && err.name !== name) {
        Object.defineProperty(err, 'name', {
            value: name,
            writable: true,
            configurable: true,
        });
    }
    if (stack) err.stack = stack;
    if (code !== undefined) err.code = code;
    if (cause !== undefined) err.cause = reviveError(cause);
    return err;
}

module.exports = { reviveError };
```

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run src/shared/serializer/__tests__/revive-error.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/serializer/reviveError.js src/shared/serializer/__tests__/revive-error.test.js
git commit -m "feat(m1): reviveError for preload-side Error reconstruction"
```

---

### Task 11: safeStringify smoke

**Files:**
- Append to: `src/shared/serializer/__tests__/serializer.test.js`

Spec: §5.1 `safeStringify`.

- [ ] **Step 1: Append tests**

Append to `src/shared/serializer/__tests__/serializer.test.js`:

```js
describe('safeStringify', () => {
    const { safeStringify } = require('../index');

    it('returns JSON-equivalent for plain data', () => {
        expect(safeStringify({ a: 1, b: 'x' })).toBe('{"a":1,"b":"x"}');
    });

    it('never throws for ugly inputs', () => {
        const a = {};
        a.self = a;
        a.fn = () => {};
        a.sym = Symbol();
        a.big = 99n;
        expect(() => safeStringify(a)).not.toThrow();
        expect(typeof safeStringify(a)).toBe('string');
    });
});
```

- [ ] **Step 2: Run test, verify pass**

```bash
npx vitest run src/shared/serializer/__tests__/serializer.test.js
```

Expected: PASS all in this file.

- [ ] **Step 3: Commit**

```bash
git add src/shared/serializer/__tests__/serializer.test.js
git commit -m "test(m1): safeStringify coverage"
```

---

### Task 12: Full suite green + module exports verification

**Files:**
- Verify: all serializer tests

- [ ] **Step 1: Run full serializer test suite**

```bash
npx vitest run src/shared/serializer/
```

Expected: PASS all 8 test files.

- [ ] **Step 2: Verify `index.js` exports surface**

Open `src/shared/serializer/index.js` and confirm the `module.exports` block contains:

```js
module.exports = {
    serialize,
    safeStringify,
    configureSerializer,
    DEFAULTS,
};
```

Then run a quick import sanity check:

```bash
node -e "const s = require('./src/shared/serializer'); console.log(Object.keys(s).sort());"
```

Expected output: `[ 'DEFAULTS', 'configureSerializer', 'safeStringify', 'serialize' ]`.

- [ ] **Step 3: Build to verify rollup picks it up**

```bash
npm run build
```

Expected: rollup exits 0 (the serializer's transitive structure is purely require()-based and rollup is configured with plugin-commonjs).

- [ ] **Step 4: Final M1 commit**

If there are any uncommitted changes from the verification step:

```bash
git add -A
git commit -m "chore(m1): M1 serializer module complete"
```

If nothing changed, skip.

---

## Self-Review

After completing all tasks, verify:

**Spec coverage:** Each test file from spec §9.2 except the integration tests has been created in this plan (limits / placeholders / adapters / serializer / circular / limits-runtime / never-throw / revive-error = 8 files). Integration tests (`service-main.test.js` / `service-preload.test.js` / `notice-main.test.js`) deferred to M2/M3 plans.

**Type mapping coverage:** Each row of spec §7 type mapping table has at least one assertion in serializer.test.js or adapters.test.js: null/undefined ✓, string truncation ✓, number non-finite ✓, boolean ✓, bigint ✓, symbol ✓, function ✓, plain object ✓, array ✓, TypedArray ✓, Date ✓ (invalid Date ✓), Error ✓ (with cause ✓ and code ✓), Map ✓ (both keys modes), Set ✓, RegExp ✓, Buffer ✓ (Node Buffer & ArrayBuffer), Promise ✓, WeakMap/WeakSet ✓, DOM Node ✓, Window ✓, Class instance ✓, circular ✓ (direct + indirect), maxDepth ✓, maxKeys ✓, Proxy throwing ✓, total fallback ✓.

**Error handling coverage:** §8.1 两层（lossy 静默 + strict 行为）coverage in never-throw.test.js ✓. §8.2 不变量（IPC 路径生产环境永不抛错）verified by tests using `strict: false`. §8.4 上限触发四类 (string/array/keys/depth) in limits-runtime.test.js ✓.

**Config priority:** §8.5 三级回退 verified in limits.test.js + limits-runtime.test.js ✓.

**Integration points (deferred):** M2 (`service-main.test.js`, `service-preload.test.js`) and M3 (`notice-main.test.js`) tests reference `serialize` from M1 but live in their own M-plans.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-04-toolkit-m1-serializer.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch with checkpoints.

Which approach?
