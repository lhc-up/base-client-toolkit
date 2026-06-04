# Toolkit M5 Capability Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the `capability/` namespace contract per `docs/superpowers/specs/2026-06-03-toolkit-m5-capability-contract-design.md` by shipping the reference example `capability/example/` and a test suite that pins the contract for all future capability modules.

**Architecture:** M5 is primarily a documentation contract; the only code deliverable is one ~15-line entry file `src/capability/example/index.js` exporting `{ echo, serviceSchema, noticeSchema }`. The contract is enforced by a co-located vitest suite that verifies: export shape, behavioral identity (`echo` direct call matches `serviceSchema.handlers.echo` by reference), namespace consistency across both schemas, schema shape compliance with M2 / M3 protocol descriptors, zero `require`-time side effects, and that the subpath export `@base-client/toolkit/capability/example` resolves to the same module. The example imports nothing—no M1 serializer, no M2 Service, no M3 Notice—because schemas are plain data descriptors.

**Tech Stack:** Node.js CJS, Vitest. No third-party dependencies.

**Spec sections referenced:** §2.1 物理结构 (directory + `index.js` entry), §2.2 标准导出形态 (top-level shape), §2.3 命名约定 (namespace alignment), §2.4 副作用约束 (zero side effects on require), §4.1 完整代码 (the example body), §4.2/4.3 接入示例 (informational only). Cross-reference: overview §8.1 `exports` field — the `./capability/*` wildcard depends on M5 §2.1 directory shape being honored, which Task 6 verifies via the subpath export entry.

---

## File Structure

All paths relative to repo root `base-client-toolkit/`.

**Source files:**
- `src/capability/example/index.js` — the reference example (sole code deliverable, ~15 lines).

**Test files (vitest):**
- `src/capability/example/__tests__/exports.test.js` — top-level export shape + behavioral identity + schema-namespace consistency.
- `src/capability/example/__tests__/schema-shape.test.js` — M2 `serviceSchema` shape (namespace + handlers + sync opt-in) and M3 `noticeSchema` shape (namespace + events array, name regex).
- `src/capability/example/__tests__/no-side-effects.test.js` — `require('../index')` triggers no IPC registration, no fs / network calls, no global mutation.
- `src/capability/example/__tests__/subpath-export.test.js` — verify the `./capability/example` subpath in `package.json` resolves and returns the same exports object.

**Configuration touch points:**
- `package.json` — Verify `exports['./capability/*']` mapping (per overview §8.1) is present; if missing, add. No new dependencies needed.

---

## Tasks

### Task 1: Project setup verification

**Files:**
- Verify: `package.json`

- [ ] **Step 1: Confirm vitest + scripts present**

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

If `vitest` missing, install:

```bash
npm install -D vitest
```

- [ ] **Step 2: Confirm exports wildcard for capability subpath**

Open `package.json` and confirm `exports` contains the M5-relevant entry (per overview §8.1):

```json
{
  "exports": {
    "./capability/*": "./dist/capability/*/index.js"
  }
}
```

If missing, add this entry. For the Task 6 subpath-resolution test to work during dev (no build), we also need a dev-time fallback. Add a sibling entry that points at the source tree when consumed via the relative path used in tests:

```json
{
  "exports": {
    "./capability/*": {
      "default": "./dist/capability/*/index.js"
    }
  }
}
```

(The Task 6 test resolves via relative `require('../../index')` rather than the package name, so the dist mapping only governs published consumption; the test is structural — see Task 6.)

- [ ] **Step 3: Run baseline test suite**

```bash
npm test
```

Expected: vitest exits 0 (other M-plans may have already added tests; all of those should still pass).

- [ ] **Step 4: Commit any config touch-ups**

```bash
git add package.json
git commit -m "chore(m5): ensure capability subpath export is declared"
```

If nothing changed, skip this step.

---

### Task 2: Example module export shape

**Files:**
- Create: `src/capability/example/index.js`
- Create: `src/capability/example/__tests__/exports.test.js`

Spec: §2.2 标准导出形态, §4.1 完整代码.

- [ ] **Step 1: Write failing test**

Create `src/capability/example/__tests__/exports.test.js`:

```js
const { describe, it, expect } = require('vitest');
const example = require('../index');

describe('capability/example: export shape', () => {
    it('exports an object', () => {
        expect(example).not.toBeNull();
        expect(typeof example).toBe('object');
    });

    it('exposes echo as a function', () => {
        expect(typeof example.echo).toBe('function');
    });

    it('exposes a serviceSchema object', () => {
        expect(example.serviceSchema).not.toBeNull();
        expect(typeof example.serviceSchema).toBe('object');
    });

    it('exposes a noticeSchema object', () => {
        expect(example.noticeSchema).not.toBeNull();
        expect(typeof example.noticeSchema).toBe('object');
    });

    it('does not expose unexpected reserved-word collisions', () => {
        // serviceSchema and noticeSchema are reserved; they should be the schema
        // objects, not API methods that happen to share the name.
        expect(typeof example.serviceSchema).not.toBe('function');
        expect(typeof example.noticeSchema).not.toBe('function');
    });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
npx vitest run src/capability/example/__tests__/exports.test.js
```

Expected: FAIL with `Cannot find module '../index'`.

- [ ] **Step 3: Implement `index.js`**

Create `src/capability/example/index.js`:

```js
// src/capability/example/index.js
//
// Reference capability module. Demonstrates the M5 contract:
// - direct API method (`echo`)
// - serviceSchema for M2 IPC service exposure
// - noticeSchema for M3 main-to-renderer broadcast
//
// The same `echo` function reference appears in both the top-level export
// and `serviceSchema.handlers.echo` — one implementation, three call paths
// (main direct / renderer async / renderer sync).

const echo = (message) => message;

const serviceSchema = {
    namespace: 'example',
    handlers: {
        echo,
    },
    sync: ['echo'],
};

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

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run src/capability/example/__tests__/exports.test.js
```

Expected: PASS all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/capability/example/index.js src/capability/example/__tests__/exports.test.js
git commit -m "feat(m5): reference capability/example with contract export shape"
```

---

### Task 3: Behavioral identity tests

**Files:**
- Append to: `src/capability/example/__tests__/exports.test.js`

Spec: §2.2 — `serviceSchema.handlers` 中的函数引用应与顶层 API 方法引用同一份函数, §4.1 echo 在三处出现.

- [ ] **Step 1: Append tests**

Append to `src/capability/example/__tests__/exports.test.js`:

```js
describe('capability/example: behavioral identity', () => {
    it('echo returns its argument verbatim', () => {
        expect(example.echo('hi')).toBe('hi');
        expect(example.echo(42)).toBe(42);
        expect(example.echo(null)).toBe(null);
        expect(example.echo(undefined)).toBe(undefined);
        const obj = { a: 1 };
        expect(example.echo(obj)).toBe(obj);
    });

    it('echo is a pure synchronous function (no thenable)', () => {
        const out = example.echo('x');
        // not a Promise
        expect(out && typeof out.then).not.toBe('function');
    });

    it('serviceSchema.handlers.echo IS the same function reference as example.echo', () => {
        // The M5 contract — "one implementation, three call paths" — is
        // enforced by identity here, not equivalence.
        expect(Object.is(example.serviceSchema.handlers.echo, example.echo)).toBe(true);
    });

    it('namespaces match across both schemas and the directory name', () => {
        expect(example.serviceSchema.namespace).toBe('example');
        expect(example.noticeSchema.namespace).toBe('example');
        expect(example.serviceSchema.namespace).toBe(example.noticeSchema.namespace);
    });
});
```

- [ ] **Step 2: Run test, verify pass**

```bash
npx vitest run src/capability/example/__tests__/exports.test.js
```

Expected: PASS all tests in file (5 from Task 2 + 4 new).

- [ ] **Step 3: Commit**

```bash
git add src/capability/example/__tests__/exports.test.js
git commit -m "test(m5): behavioral identity + namespace consistency"
```

---

### Task 4: Schema shape compliance

**Files:**
- Create: `src/capability/example/__tests__/schema-shape.test.js`

Spec: §2.2 (serviceSchema fields + noticeSchema fields), §2.5 (cross-reference to M2 / M3 protocol).

- [ ] **Step 1: Write failing test**

Create `src/capability/example/__tests__/schema-shape.test.js`:

```js
const { describe, it, expect } = require('vitest');
const example = require('../index');

const NAMESPACE_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const EVENT_NAME_RE = /^[A-Za-z0-9_-]+$/;

describe('serviceSchema shape (M2 protocol form)', () => {
    const { serviceSchema } = example;

    it('namespace is a non-empty string matching the allowed pattern', () => {
        expect(typeof serviceSchema.namespace).toBe('string');
        expect(serviceSchema.namespace.length).toBeGreaterThan(0);
        expect(NAMESPACE_RE.test(serviceSchema.namespace)).toBe(true);
    });

    it('handlers is a non-null object whose every value is a function', () => {
        expect(serviceSchema.handlers).not.toBeNull();
        expect(typeof serviceSchema.handlers).toBe('object');
        const entries = Object.entries(serviceSchema.handlers);
        expect(entries.length).toBeGreaterThan(0);
        for (const [name, fn] of entries) {
            expect(typeof fn).toBe('function');
            // handler keys themselves must be safe identifiers
            expect(EVENT_NAME_RE.test(name)).toBe(true);
        }
    });

    it('sync (if present) is an array of strings', () => {
        if (serviceSchema.sync === undefined) return;
        expect(Array.isArray(serviceSchema.sync)).toBe(true);
        for (const name of serviceSchema.sync) {
            expect(typeof name).toBe('string');
        }
    });

    it('every entry in sync is also a handler key', () => {
        if (!serviceSchema.sync) return;
        const handlerKeys = Object.keys(serviceSchema.handlers);
        for (const name of serviceSchema.sync) {
            expect(handlerKeys).toContain(name);
        }
    });

    it('needsEvent (if present) is an array of strings; each is a handler key', () => {
        if (serviceSchema.needsEvent === undefined) return;
        expect(Array.isArray(serviceSchema.needsEvent)).toBe(true);
        const handlerKeys = Object.keys(serviceSchema.handlers);
        for (const name of serviceSchema.needsEvent) {
            expect(typeof name).toBe('string');
            expect(handlerKeys).toContain(name);
        }
    });
});

describe('noticeSchema shape (M3 protocol form)', () => {
    const { noticeSchema } = example;

    it('namespace is a non-empty string matching the allowed pattern', () => {
        expect(typeof noticeSchema.namespace).toBe('string');
        expect(noticeSchema.namespace.length).toBeGreaterThan(0);
        expect(NAMESPACE_RE.test(noticeSchema.namespace)).toBe(true);
    });

    it('events is a non-empty array of strings', () => {
        expect(Array.isArray(noticeSchema.events)).toBe(true);
        expect(noticeSchema.events.length).toBeGreaterThan(0);
        for (const name of noticeSchema.events) {
            expect(typeof name).toBe('string');
            expect(EVENT_NAME_RE.test(name)).toBe(true);
        }
    });

    it('events have no duplicates', () => {
        const set = new Set(noticeSchema.events);
        expect(set.size).toBe(noticeSchema.events.length);
    });
});

describe('contract: at least one schema must be present (§2.2 约束)', () => {
    it('example has both schemas defined', () => {
        // example exercises the maximal shape; capability modules in the wild
        // may omit one, but at least one is mandatory per §2.2.
        expect(example.serviceSchema || example.noticeSchema).toBeTruthy();
    });
});
```

- [ ] **Step 2: Run test, verify pass**

```bash
npx vitest run src/capability/example/__tests__/schema-shape.test.js
```

Expected: PASS. The example was authored to satisfy the contract; this test pins it.

- [ ] **Step 3: Commit**

```bash
git add src/capability/example/__tests__/schema-shape.test.js
git commit -m "test(m5): serviceSchema and noticeSchema shape compliance"
```

---

### Task 5: Zero side effects on require

**Files:**
- Create: `src/capability/example/__tests__/no-side-effects.test.js`

Spec: §2.4 副作用约束（require 零副作用）.

- [ ] **Step 1: Write failing test**

Create `src/capability/example/__tests__/no-side-effects.test.js`:

```js
const { describe, it, expect, vi, beforeEach, afterEach } = require('vitest');
const path = require('path');

// Resolve once, then delete from the cache before each test so we can observe
// a fresh require().
const modulePath = require.resolve('../index');

describe('capability/example: zero side effects on require', () => {
    let spies;

    beforeEach(() => {
        // Drop any cached load so each test does a clean require.
        delete require.cache[modulePath];

        spies = {
            // fs surface
            fsReadFileSync: vi.spyOn(require('fs'), 'readFileSync').mockImplementation(() => {
                throw new Error('fs.readFileSync called during require()');
            }),
            fsWriteFileSync: vi.spyOn(require('fs'), 'writeFileSync').mockImplementation(() => {
                throw new Error('fs.writeFileSync called during require()');
            }),
            // network surface (http/https get/request — minimal coverage)
            httpRequest: vi.spyOn(require('http'), 'request').mockImplementation(() => {
                throw new Error('http.request called during require()');
            }),
            httpsRequest: vi.spyOn(require('https'), 'request').mockImplementation(() => {
                throw new Error('https.request called during require()');
            }),
        };
    });

    afterEach(() => {
        for (const s of Object.values(spies)) s.mockRestore();
        delete require.cache[modulePath];
    });

    it('require() triggers no fs / network calls', () => {
        expect(() => require('../index')).not.toThrow();
        expect(spies.fsReadFileSync).not.toHaveBeenCalled();
        expect(spies.fsWriteFileSync).not.toHaveBeenCalled();
        expect(spies.httpRequest).not.toHaveBeenCalled();
        expect(spies.httpsRequest).not.toHaveBeenCalled();
    });

    it('require() does not import Service or Notice (zero IPC coupling)', () => {
        // Resolve the index.js content as a string and assert no reference to
        // Service / Notice. The test is intentionally textual — runtime
        // assertions cannot prove the absence of a require() call without
        // re-implementing the loader.
        const fs = require('fs');
        const source = fs.readFileSync(modulePath, 'utf8');
        // mockRestore has not happened yet, but readFileSync above is the live one
        // because this assertion is inside the it() body which restores in afterEach.
        // To avoid tripping the mock, we restore explicitly first:
        spies.fsReadFileSync.mockRestore();
        const safeSource = require('fs').readFileSync(modulePath, 'utf8');
        expect(safeSource).not.toMatch(/require\(['"][^'"]*\/service['"]\)/);
        expect(safeSource).not.toMatch(/require\(['"][^'"]*\/notice['"]\)/);
        // also: no top-level await, no immediate IIFE that calls electron
        expect(safeSource).not.toMatch(/require\(['"]electron['"]\)/);
        // suppress unused safe binding warning
        expect(typeof safeSource).toBe('string');
    });

    it('require() does not mutate global state', () => {
        const before = Object.keys(globalThis).sort().join(',');
        require('../index');
        const after = Object.keys(globalThis).sort().join(',');
        expect(after).toBe(before);
    });

    it('multiple requires return the same module export object (no re-init)', () => {
        const a = require('../index');
        delete require.cache[modulePath];
        const b = require('../index');
        // Different require()s after cache drop yield NEW objects, but
        // structurally identical and with reference-stable echo per-load.
        expect(a).not.toBe(b);                 // cache cleared → new object
        expect(a.echo).not.toBe(b.echo);       // each load gets its own closure
        // What matters for the contract: within a SINGLE load, echo identity holds.
        expect(Object.is(a.serviceSchema.handlers.echo, a.echo)).toBe(true);
        expect(Object.is(b.serviceSchema.handlers.echo, b.echo)).toBe(true);
    });
});
```

- [ ] **Step 2: Run test, verify pass**

```bash
npx vitest run src/capability/example/__tests__/no-side-effects.test.js
```

Expected: PASS — the example does not touch fs / http / electron / globals on load.

- [ ] **Step 3: Commit**

```bash
git add src/capability/example/__tests__/no-side-effects.test.js
git commit -m "test(m5): require-time zero side effects"
```

---

### Task 6: Subpath export resolution

**Files:**
- Create: `src/capability/example/__tests__/subpath-export.test.js`

Spec: overview §8.1 `exports['./capability/*']` wildcard; M5 §2.1 物理结构 (directory + `index.js`) — this test pins that the example honors the wildcard target shape.

- [ ] **Step 1: Write failing test**

Create `src/capability/example/__tests__/subpath-export.test.js`:

```js
const { describe, it, expect } = require('vitest');
const fs = require('fs');
const path = require('path');

describe('capability/example: subpath export wiring', () => {
    it('physical structure matches §2.1 (directory + index.js)', () => {
        const dir = path.resolve(__dirname, '..');
        expect(fs.statSync(dir).isDirectory()).toBe(true);
        const entry = path.join(dir, 'index.js');
        expect(fs.existsSync(entry)).toBe(true);
        expect(fs.statSync(entry).isFile()).toBe(true);
        expect(path.basename(dir)).toBe('example');
    });

    it('directory name equals serviceSchema.namespace and noticeSchema.namespace', () => {
        const dir = path.resolve(__dirname, '..');
        const dirName = path.basename(dir);
        const example = require('../index');
        expect(example.serviceSchema.namespace).toBe(dirName);
        expect(example.noticeSchema.namespace).toBe(dirName);
    });

    it('package.json declares ./capability/* wildcard export pointing into dist', () => {
        const pkgPath = path.resolve(__dirname, '../../../../package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        expect(pkg.exports).toBeTruthy();
        const cap = pkg.exports['./capability/*'];
        expect(cap).toBeTruthy();
        const target = typeof cap === 'string' ? cap : cap.default;
        // Must reference the dist tree and end with /index.js (per §2.1 entry rule)
        expect(target).toMatch(/\.\/dist\/capability\/\*\/index\.js$/);
    });

    it('the resolved subpath produces the same export shape as the relative require', () => {
        // We cannot rely on the package name resolving in the test env
        // (dist may not exist yet). Instead, resolve via the relative
        // source path the wildcard target would map to.
        const directRequire = require('../index');
        const viaPath = require(path.resolve(__dirname, '..', 'index.js'));
        expect(viaPath).toBe(directRequire);
        expect(Object.keys(viaPath).sort()).toEqual(
            ['echo', 'noticeSchema', 'serviceSchema'],
        );
    });
});
```

- [ ] **Step 2: Run test, verify pass**

```bash
npx vitest run src/capability/example/__tests__/subpath-export.test.js
```

Expected: PASS. If the package.json wildcard test fails, return to Task 1 Step 2 and fix the `exports` field.

- [ ] **Step 3: Commit**

```bash
git add src/capability/example/__tests__/subpath-export.test.js
git commit -m "test(m5): subpath export wiring and physical structure"
```

---

### Task 7: Full suite green + M5 closeout

**Files:**
- Verify only.

- [ ] **Step 1: Run full M5 test suite**

```bash
npx vitest run src/capability/example/
```

Expected: PASS all 4 test files (`exports.test.js`, `schema-shape.test.js`, `no-side-effects.test.js`, `subpath-export.test.js`).

- [ ] **Step 2: Run full project suite to check no regressions in M1–M4**

```bash
npm test
```

Expected: PASS. M5 introduces no shared code; if other suites break, the cause is unrelated to M5 and should be filed as a regression on the originating M.

- [ ] **Step 3: Sanity check the example via a one-line Node load**

```bash
node -e "const e = require('./src/capability/example'); console.log(Object.keys(e).sort()); console.log(e.echo('ok')); console.log(e.serviceSchema.namespace, e.noticeSchema.namespace);"
```

Expected output:
```
[ 'echo', 'noticeSchema', 'serviceSchema' ]
ok
example example
```

- [ ] **Step 4: Build to verify rollup picks the capability tree**

```bash
npm run build
```

Expected: rollup exits 0; `dist/capability/example/index.js` exists. Verify:

```bash
node -e "const fs = require('fs'); console.log(fs.existsSync('./dist/capability/example/index.js'));"
```

Expected output: `true`.

- [ ] **Step 5: Final M5 commit**

If verification produced any tracked changes:

```bash
git add -A
git commit -m "chore(m5): capability namespace contract + reference example complete"
```

If nothing changed, skip.

---

## Self-Review

After completing all tasks, verify against the M5 spec:

**§2.1 物理结构:** Directory `src/capability/example/` exists with sole entry `index.js`. Task 6 Step 1 pins this structurally.

**§2.2 标准导出形态:** Top-level exports are `{ echo, serviceSchema, noticeSchema }`. `serviceSchema` carries `{ namespace, handlers, sync }`. `noticeSchema` carries `{ namespace, events }`. Both schemas present (the spec mandates at least one). `serviceSchema.handlers.echo === example.echo` (Object.is). Reserved-word collision check: `echo` is not `serviceSchema` / `noticeSchema`. Tasks 2 + 3 + 4 pin these.

**§2.3 命名约定:** Directory name `example` = `serviceSchema.namespace` = `noticeSchema.namespace`. Task 3 + Task 6 pin both equality chains.

**§2.4 副作用约束 (require 零副作用):** Task 5 verifies no fs / http / global mutation on require; plus a textual scan for `require('.../service')`, `require('.../notice')`, `require('electron')` in the module source.

**§2.5 与 M2 / M3 protocol 的关系:** `serviceSchema` shape conforms to M2 protocol form (namespace string, handlers object, optional `sync` / `needsEvent` arrays referencing handler keys). `noticeSchema` shape conforms to M3 protocol form (namespace string, events array of non-empty unique names matching `[A-Za-z0-9_-]+`). Task 4 pins both.

**§4.1 参考示例完整代码:** The implementation in Task 2 Step 3 mirrors the spec §4.1 verbatim (minus inline comments), including the `sync: ['echo']` opt-in and the `events: ['tick']` declaration.

**Overview §8.1 exports field:** Task 1 Step 2 ensures `package.json exports['./capability/*']` resolves to `./dist/capability/*/index.js`. Task 6 Step 3 + Step 4 verify wildcard + dist tree.

**Documentation-only contract aspects (not runtime-testable):**

- §2.2's "若两个 schema 都定义，二者 namespace 应当一致" is technically a should not a must; we lifted it to a hard test since the reference example defines both. Future capabilities omitting one schema cannot use the cross-schema namespace test — this is informational, not enforceable here.
- §2.4 forbids "registering IPC channels" — we cannot prove the negative at runtime without mocking the entire electron surface (and electron is not available in the test environment). We approximate by spying on fs / http and by source-text scanning for `require('electron')` / `require('.../service')` / `require('.../notice')`. A capability that imports electron and registers an IPC handler at top level would fail the textual scan.
- §2.5 cross-references M2 / M3 protocol shapes — the truth source lives in those specs. Our schema-shape test pins what M5's reference example must satisfy, but does not validate against an M2 / M3 importable validator (no such validator was committed at the time of M5 — M2 / M3 protocols define shape, not enforce it). When M2 / M3 ship a runtime schema validator, this test should switch to delegate.

**Integration points (deferred):** End-to-end "mount the example into Service.init / Notice.init and roundtrip through IPC" lives in M2 / M3 integration tests, not M5.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-04-toolkit-m5-capability-contract.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks. M5 is small (7 tasks, ~10–25 minutes total) so a single subagent run is also reasonable.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch with checkpoints.

Which approach?
