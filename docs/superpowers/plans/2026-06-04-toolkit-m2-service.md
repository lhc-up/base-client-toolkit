# Toolkit M2 Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement IPC 双向调用 bridge (renderer→main calls, async + opt-in sync) per `docs/superpowers/specs/2026-06-03-toolkit-m2-service-design.md`.

**Architecture:** Three files under `src/service/`: `protocol.js` (single source of truth for channel naming + envelope helpers — `META_LIST_CHANNEL`, `asyncChannel`, `syncChannel`, `okEnvelope`, `errorEnvelope`), `main.js` (`init({userSchemas})` / `cleanup()` with internal `registerService` per-schema and `registeredSchemas: Map<namespace, schema>`), `preload.js` (`buildAppService()` factory consuming the meta channel synchronously, then generating async + opt-in sync callers per handler). Async channels via `ipcMain.handle` / `ipcRenderer.invoke`; sync channels via `ipcMain.on` / `ipcRenderer.sendSync`. Main NEVER throws over IPC — every response is `{ok, data?, error?}`. Per-handler `sync: ['name']` opts into sync channels; per-handler `needsEvent: ['name']` opts into `event` as last arg (NOT exposed via meta channel). M2 depends on M1 `shared/serializer` for payload encoding and `reviveError` for preload-side error revival.

**Tech Stack:** Node.js CJS, Vitest, Rollup. Mock `electron` via `vi.mock` — same pattern as M3 plan (synchronous mock factory, `__handlers` Map for channel→listener inspection).

**Spec sections referenced:** §3 (protocol), §4 (main flow), §5 (preload flow), §6 (boundaries), §7 (file structure). Cross-reference: overview-design §8.2 (preload aggregator contract — M2 preload exports `buildAppService` factory consumed by `src/preload.js`, NOT auto-contextBridge).

**Prerequisite:** M1 `src/shared/serializer/` already implemented (per `2026-06-04-toolkit-m1-serializer.md`) — including `serialize`, `reviveError`.

---

## File Structure

All paths relative to repo root `base-client-toolkit/`.

**Source files:**
- `src/service/protocol.js` — channel constants (`META_LIST_CHANNEL`) + channel builders (`asyncChannel`, `syncChannel`) + envelope helpers (`okEnvelope`, `errorEnvelope`). Single truth source consumed by both `main.js` and `preload.js`.
- `src/service/main.js` — exports `init({userSchemas})`, `cleanup()`. Internal: `registeredSchemas: Map<namespace, schema>`, `registerService(schema)`, meta channel listener.
- `src/service/preload.js` — exports `buildAppService()` factory. Internal: `buildAsyncCaller(ns, name)` / `buildSyncCaller(ns, name)`. Does NOT call `contextBridge` (that's the aggregator's job per overview §8.2).

**Test files (vitest):**
- `src/service/__tests__/protocol.test.js`
- `src/service/__tests__/main-init.test.js`
- `src/service/__tests__/main-async.test.js`
- `src/service/__tests__/main-sync.test.js`
- `src/service/__tests__/main-meta.test.js`
- `src/service/__tests__/main-cleanup.test.js`
- `src/service/__tests__/preload-build.test.js`
- `src/service/__tests__/preload-callers.test.js`

**Configuration:**
- `package.json` — verify `vitest` in `devDependencies`; `"test": "vitest run"` / `"test:watch": "vitest"` scripts (already verified in M1 plan).

---

## Tasks

### Task 1: Protocol module

**Files:**
- Create: `src/service/protocol.js`
- Create: `src/service/__tests__/protocol.test.js`

Spec: §3.1 channel naming, §3.2 envelope, §7.1 protocol.js shape.

- [ ] **Step 1: Write failing tests**

Create `src/service/__tests__/protocol.test.js`:

```js
const { describe, it, expect } = require('vitest');
const protocol = require('../protocol');

describe('protocol channel constants', () => {
    it('META_LIST_CHANNEL is "service:getServiceList"', () => {
        expect(protocol.META_LIST_CHANNEL).toBe('service:getServiceList');
    });
});

describe('channel builders', () => {
    it('asyncChannel composes "{ns}:{name}"', () => {
        expect(protocol.asyncChannel('foo', 'bar')).toBe('foo:bar');
    });
    it('syncChannel composes "{ns}:{name}Sync"', () => {
        expect(protocol.syncChannel('foo', 'log')).toBe('foo:logSync');
    });
    it('async and sync channels are distinct', () => {
        expect(protocol.asyncChannel('a', 'b'))
            .not.toBe(protocol.syncChannel('a', 'b'));
    });
});

describe('envelope helpers', () => {
    it('okEnvelope wraps data', () => {
        expect(protocol.okEnvelope({ a: 1 })).toEqual({ ok: true, data: { a: 1 } });
    });
    it('okEnvelope preserves undefined data', () => {
        const env = protocol.okEnvelope(undefined);
        expect(env.ok).toBe(true);
        expect(env.data).toBeUndefined();
    });
    it('errorEnvelope wraps error', () => {
        expect(protocol.errorEnvelope('boom')).toEqual({ ok: false, error: 'boom' });
    });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
npx vitest run src/service/__tests__/protocol.test.js
```

Expected: FAIL — `Cannot find module '../protocol'`.

- [ ] **Step 3: Implement `protocol.js`**

Create `src/service/protocol.js`:

```js
const META_LIST_CHANNEL = 'service:getServiceList';

const asyncChannel = (ns, name) => `${ns}:${name}`;
const syncChannel  = (ns, name) => `${ns}:${name}Sync`;

const okEnvelope    = data  => ({ ok: true,  data });
const errorEnvelope = error => ({ ok: false, error });

module.exports = {
    META_LIST_CHANNEL,
    asyncChannel,
    syncChannel,
    okEnvelope,
    errorEnvelope,
};
```

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run src/service/__tests__/protocol.test.js
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/service/protocol.js src/service/__tests__/protocol.test.js
git commit -m "feat(m2): service protocol channels and envelope helpers"
```

---

### Task 2: Main `init` — schema validation + registration

**Files:**
- Create: `src/service/main.js`
- Create: `src/service/__tests__/main-init.test.js`

Spec: §4.1 init, §4.2 registerService (validation rules), §2.1 schema form.

- [ ] **Step 1: Write failing tests**

Create `src/service/__tests__/main-init.test.js`:

```js
const { describe, it, expect, beforeEach, vi } = require('vitest');

vi.mock('electron', () => {
    const handlers = new Map();
    const syncListeners = new Map();
    const ipcMain = {
        handle: vi.fn((channel, fn) => { handlers.set(channel, fn); }),
        on: vi.fn((channel, fn) => { syncListeners.set(channel, fn); }),
        removeHandler: vi.fn(channel => { handlers.delete(channel); }),
        removeAllListeners: vi.fn(channel => { syncListeners.delete(channel); }),
        __handlers: handlers,
        __syncListeners: syncListeners,
    };
    return { ipcMain };
});

const Service = require('../main');
const { META_LIST_CHANNEL, asyncChannel, syncChannel } = require('../protocol');
const { ipcMain } = require('electron');

beforeEach(() => {
    Service.cleanup();
    ipcMain.handle.mockClear();
    ipcMain.on.mockClear();
    ipcMain.removeHandler.mockClear();
    ipcMain.removeAllListeners.mockClear();
    ipcMain.__handlers.clear();
    ipcMain.__syncListeners.clear();
});

describe('init: input validation', () => {
    it('non-array userSchemas throws', () => {
        expect(() => Service.init({ userSchemas: 'not array' })).toThrow();
        expect(() => Service.init({ userSchemas: null })).toThrow();
    });
    it('missing opts throws', () => {
        expect(() => Service.init()).toThrow();
    });
    it('empty userSchemas is allowed', () => {
        expect(() => Service.init({ userSchemas: [] })).not.toThrow();
    });
});

describe('init: schema validation', () => {
    it('schema missing namespace throws', () => {
        expect(() => Service.init({
            userSchemas: [{ handlers: { a() {} } }],
        })).toThrow();
    });
    it('schema missing handlers throws', () => {
        expect(() => Service.init({
            userSchemas: [{ namespace: 'foo' }],
        })).toThrow();
    });
    it('handlers not a plain object throws', () => {
        expect(() => Service.init({
            userSchemas: [{ namespace: 'foo', handlers: 'bad' }],
        })).toThrow();
    });
    it('sync item not in handlers throws', () => {
        expect(() => Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { a() {} },
                sync: ['missing'],
            }],
        })).toThrow(/sync/i);
    });
    it('needsEvent item not in handlers throws', () => {
        expect(() => Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { a() {} },
                needsEvent: ['missing'],
            }],
        })).toThrow(/needsEvent/i);
    });
    it('duplicate namespace across schemas throws', () => {
        expect(() => Service.init({
            userSchemas: [
                { namespace: 'foo', handlers: { a() {} } },
                { namespace: 'foo', handlers: { b() {} } },
            ],
        })).toThrow(/conflict|冲突/i);
    });
    it('valid schemas pass', () => {
        expect(() => Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { bar() {}, baz() {}, log() {} },
                sync: ['log'],
                needsEvent: ['baz'],
            }],
        })).not.toThrow();
    });
});

describe('init: channel registration', () => {
    it('registers ipcMain.handle for each handler (async channel)', () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { bar() {}, baz() {} },
            }],
        });
        expect(ipcMain.handle).toHaveBeenCalledWith(
            asyncChannel('foo', 'bar'), expect.any(Function),
        );
        expect(ipcMain.handle).toHaveBeenCalledWith(
            asyncChannel('foo', 'baz'), expect.any(Function),
        );
    });
    it('registers ipcMain.on for each sync handler only', () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { bar() {}, log() {} },
                sync: ['log'],
            }],
        });
        expect(ipcMain.on).toHaveBeenCalledWith(
            syncChannel('foo', 'log'), expect.any(Function),
        );
        // bar should NOT have a sync listener
        expect(ipcMain.__syncListeners.has(syncChannel('foo', 'bar'))).toBe(false);
    });
    it('registers meta channel listener', () => {
        Service.init({ userSchemas: [] });
        expect(ipcMain.on).toHaveBeenCalledWith(
            META_LIST_CHANNEL, expect.any(Function),
        );
    });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
npx vitest run src/service/__tests__/main-init.test.js
```

Expected: FAIL — `Cannot find module '../main'`.

- [ ] **Step 3: Implement `main.js`**

Create `src/service/main.js`:

```js
const { ipcMain } = require('electron');
const { serialize } = require('../shared/serializer');
const {
    META_LIST_CHANNEL,
    asyncChannel,
    syncChannel,
    okEnvelope,
    errorEnvelope,
} = require('./protocol');

const registeredSchemas = new Map();

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function registerService(schema) {
    if (!isPlainObject(schema)) {
        throw new Error('Service schema must be an object');
    }
    const { namespace, handlers } = schema;
    const sync       = schema.sync       || [];
    const needsEvent = schema.needsEvent || [];

    if (typeof namespace !== 'string' || !namespace) {
        throw new Error('Service schema requires string namespace');
    }
    if (!isPlainObject(handlers)) {
        throw new Error(`Service schema "${namespace}" requires handlers object`);
    }
    if (!Array.isArray(sync)) {
        throw new Error(`Service schema "${namespace}" sync must be an array`);
    }
    if (!Array.isArray(needsEvent)) {
        throw new Error(`Service schema "${namespace}" needsEvent must be an array`);
    }
    const handlerNames = Object.keys(handlers);
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
    if (registeredSchemas.has(namespace)) {
        throw new Error(`Service namespace "${namespace}" conflict`);
    }

    for (const name of handlerNames) {
        const fn = handlers[name];
        const wantsEvent = needsEvent.includes(name);

        ipcMain.handle(asyncChannel(namespace, name), async (event, ...args) => {
            try {
                const result = wantsEvent
                    ? await fn(...args, event)
                    : await fn(...args);
                return okEnvelope(serialize(result, { strict: false }));
            } catch (err) {
                return errorEnvelope(serialize(err, { strict: false }));
            }
        });

        if (sync.includes(name)) {
            ipcMain.on(syncChannel(namespace, name), async (event, ...args) => {
                try {
                    const result = await (
                        wantsEvent ? fn(...args, event) : fn(...args)
                    );
                    event.returnValue = okEnvelope(serialize(result, { strict: false }));
                } catch (err) {
                    event.returnValue = errorEnvelope(serialize(err, { strict: false }));
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
        event.returnValue = okEnvelope(serialize(list, { strict: false }));
    } catch (err) {
        event.returnValue = errorEnvelope(serialize(err, { strict: false }));
    }
}

function init(opts) {
    if (!opts || !Array.isArray(opts.userSchemas)) {
        throw new Error('Service.init requires { userSchemas: Array }');
    }
    for (const schema of opts.userSchemas) {
        registerService(schema);
    }
    ipcMain.on(META_LIST_CHANNEL, handleGetServiceList);
}

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

module.exports = { init, cleanup };
```

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run src/service/__tests__/main-init.test.js
```

Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add src/service/main.js src/service/__tests__/main-init.test.js
git commit -m "feat(m2): service main init with schema validation and channel registration"
```

---

### Task 3: Main async channel handler behavior

**Files:**
- Create: `src/service/__tests__/main-async.test.js`

Spec: §4.2 async registration (envelope return, error wrap, needsEvent injection, args passthrough).

- [ ] **Step 1: Write failing tests**

Create `src/service/__tests__/main-async.test.js`:

```js
const { describe, it, expect, beforeEach, vi } = require('vitest');

vi.mock('electron', () => {
    const handlers = new Map();
    const syncListeners = new Map();
    const ipcMain = {
        handle: vi.fn((channel, fn) => { handlers.set(channel, fn); }),
        on: vi.fn((channel, fn) => { syncListeners.set(channel, fn); }),
        removeHandler: vi.fn(channel => { handlers.delete(channel); }),
        removeAllListeners: vi.fn(channel => { syncListeners.delete(channel); }),
        __handlers: handlers,
        __syncListeners: syncListeners,
    };
    return { ipcMain };
});

const Service = require('../main');
const { asyncChannel } = require('../protocol');
const { ipcMain } = require('electron');

beforeEach(() => {
    Service.cleanup();
    ipcMain.__handlers.clear();
    ipcMain.__syncListeners.clear();
});

describe('async channel handler', () => {
    it('returns okEnvelope with serialized result for sync handler', async () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { add(a, b) { return a + b; } },
            }],
        });
        const handler = ipcMain.__handlers.get(asyncChannel('foo', 'add'));
        const envelope = await handler({}, 1, 2);
        expect(envelope).toEqual({ ok: true, data: 3 });
    });

    it('awaits async handler before responding', async () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: {
                    async delay(v) {
                        await new Promise(r => setTimeout(r, 1));
                        return v * 2;
                    },
                },
            }],
        });
        const handler = ipcMain.__handlers.get(asyncChannel('foo', 'delay'));
        const envelope = await handler({}, 5);
        expect(envelope).toEqual({ ok: true, data: 10 });
    });

    it('handler throw → errorEnvelope (never re-throws)', async () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { bad() { throw new TypeError('boom'); } },
            }],
        });
        const handler = ipcMain.__handlers.get(asyncChannel('foo', 'bad'));
        const envelope = await handler({});
        expect(envelope.ok).toBe(false);
        expect(envelope.error.name).toBe('TypeError');
        expect(envelope.error.message).toBe('boom');
    });

    it('async handler rejection → errorEnvelope', async () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: {
                    async reject() { throw new RangeError('nope'); },
                },
            }],
        });
        const handler = ipcMain.__handlers.get(asyncChannel('foo', 'reject'));
        const envelope = await handler({});
        expect(envelope.ok).toBe(false);
        expect(envelope.error.name).toBe('RangeError');
    });

    it('needsEvent: handler receives event as last arg', async () => {
        const spy = vi.fn((a, event) => ({ a, hasSender: !!event.sender }));
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { peek: spy },
                needsEvent: ['peek'],
            }],
        });
        const handler = ipcMain.__handlers.get(asyncChannel('foo', 'peek'));
        const fakeEvent = { sender: {} };
        const envelope = await handler(fakeEvent, 42);
        expect(envelope.ok).toBe(true);
        expect(spy).toHaveBeenCalledWith(42, fakeEvent);
        expect(envelope.data).toEqual({ a: 42, hasSender: true });
    });

    it('non-needsEvent handler does NOT receive event (rest-params safe)', async () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { sum(...nums) { return nums.reduce((a, b) => a + b, 0); } },
            }],
        });
        const handler = ipcMain.__handlers.get(asyncChannel('foo', 'sum'));
        const envelope = await handler({}, 1, 2, 3, 4);
        expect(envelope).toEqual({ ok: true, data: 10 });
    });

    it('result serialized: Date → ISO string', async () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { now() { return new Date('2026-01-01T00:00:00.000Z'); } },
            }],
        });
        const handler = ipcMain.__handlers.get(asyncChannel('foo', 'now'));
        const envelope = await handler({});
        expect(envelope.data).toBe('2026-01-01T00:00:00.000Z');
    });
});
```

- [ ] **Step 2: Run test, verify pass**

```bash
npx vitest run src/service/__tests__/main-async.test.js
```

Expected: PASS (7 tests) — Task 2's `registerService` async path already implements this.

- [ ] **Step 3: Commit**

```bash
git add src/service/__tests__/main-async.test.js
git commit -m "test(m2): service async channel envelope, needsEvent, error wrapping"
```

---

### Task 4: Main sync channel handler behavior

**Files:**
- Create: `src/service/__tests__/main-sync.test.js`

Spec: §4.2 sync registration (event.returnValue envelope, await async handler, error wrap).

- [ ] **Step 1: Write failing tests**

Create `src/service/__tests__/main-sync.test.js`:

```js
const { describe, it, expect, beforeEach, vi } = require('vitest');

vi.mock('electron', () => {
    const handlers = new Map();
    const syncListeners = new Map();
    const ipcMain = {
        handle: vi.fn((channel, fn) => { handlers.set(channel, fn); }),
        on: vi.fn((channel, fn) => { syncListeners.set(channel, fn); }),
        removeHandler: vi.fn(channel => { handlers.delete(channel); }),
        removeAllListeners: vi.fn(channel => { syncListeners.delete(channel); }),
        __handlers: handlers,
        __syncListeners: syncListeners,
    };
    return { ipcMain };
});

const Service = require('../main');
const { syncChannel } = require('../protocol');
const { ipcMain } = require('electron');

beforeEach(() => {
    Service.cleanup();
    ipcMain.__handlers.clear();
    ipcMain.__syncListeners.clear();
});

describe('sync channel handler', () => {
    it('sets event.returnValue to okEnvelope for sync handler', async () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { upper(s) { return s.toUpperCase(); } },
                sync: ['upper'],
            }],
        });
        const listener = ipcMain.__syncListeners.get(syncChannel('foo', 'upper'));
        const event = {};
        await listener(event, 'hi');
        expect(event.returnValue).toEqual({ ok: true, data: 'HI' });
    });

    it('awaits async handler before writing returnValue', async () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: {
                    async asyncLog(msg) {
                        await new Promise(r => setTimeout(r, 1));
                        return `logged:${msg}`;
                    },
                },
                sync: ['asyncLog'],
            }],
        });
        const listener = ipcMain.__syncListeners.get(syncChannel('foo', 'asyncLog'));
        const event = {};
        await listener(event, 'hello');
        expect(event.returnValue).toEqual({ ok: true, data: 'logged:hello' });
    });

    it('handler throw → errorEnvelope on returnValue', async () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { boom() { throw new Error('sync-boom'); } },
                sync: ['boom'],
            }],
        });
        const listener = ipcMain.__syncListeners.get(syncChannel('foo', 'boom'));
        const event = {};
        await listener(event);
        expect(event.returnValue.ok).toBe(false);
        expect(event.returnValue.error.message).toBe('sync-boom');
    });

    it('async handler rejection → errorEnvelope on returnValue', async () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: {
                    async reject() { throw new TypeError('async-bad'); },
                },
                sync: ['reject'],
            }],
        });
        const listener = ipcMain.__syncListeners.get(syncChannel('foo', 'reject'));
        const event = {};
        await listener(event);
        expect(event.returnValue.ok).toBe(false);
        expect(event.returnValue.error.name).toBe('TypeError');
    });

    it('needsEvent on sync handler: event passed as last arg', async () => {
        const spy = vi.fn((msg, event) => `${msg}:${event.sender.id}`);
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { tag: spy },
                sync: ['tag'],
                needsEvent: ['tag'],
            }],
        });
        const listener = ipcMain.__syncListeners.get(syncChannel('foo', 'tag'));
        const event = { sender: { id: 9 } };
        await listener(event, 'hi');
        expect(spy).toHaveBeenCalledWith('hi', event);
        expect(event.returnValue).toEqual({ ok: true, data: 'hi:9' });
    });

    it('sync handler result serialized', async () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { mk() { return { fn: () => {}, n: 5 }; } },
                sync: ['mk'],
            }],
        });
        const listener = ipcMain.__syncListeners.get(syncChannel('foo', 'mk'));
        const event = {};
        await listener(event);
        expect(event.returnValue.ok).toBe(true);
        expect(event.returnValue.data.n).toBe(5);
        expect(event.returnValue.data.fn).toMatch(/^\[Function/);
    });
});
```

- [ ] **Step 2: Run test, verify pass**

```bash
npx vitest run src/service/__tests__/main-sync.test.js
```

Expected: PASS (6 tests) — Task 2 sync branch already handles this.

- [ ] **Step 3: Commit**

```bash
git add src/service/__tests__/main-sync.test.js
git commit -m "test(m2): service sync channel returnValue envelope and async-handler await"
```

---

### Task 5: Main meta channel handler

**Files:**
- Create: `src/service/__tests__/main-meta.test.js`

Spec: §3.3 meta channel data shape, §4.3 meta channel impl (envelope, NO needsEvent in output).

- [ ] **Step 1: Write failing tests**

Create `src/service/__tests__/main-meta.test.js`:

```js
const { describe, it, expect, beforeEach, vi } = require('vitest');

vi.mock('electron', () => {
    const handlers = new Map();
    const syncListeners = new Map();
    const ipcMain = {
        handle: vi.fn((channel, fn) => { handlers.set(channel, fn); }),
        on: vi.fn((channel, fn) => { syncListeners.set(channel, fn); }),
        removeHandler: vi.fn(channel => { handlers.delete(channel); }),
        removeAllListeners: vi.fn(channel => { syncListeners.delete(channel); }),
        __handlers: handlers,
        __syncListeners: syncListeners,
    };
    return { ipcMain };
});

const Service = require('../main');
const { META_LIST_CHANNEL } = require('../protocol');
const { ipcMain } = require('electron');

beforeEach(() => {
    Service.cleanup();
    ipcMain.__handlers.clear();
    ipcMain.__syncListeners.clear();
});

describe('meta channel', () => {
    it('returnValue is okEnvelope with full schema list', () => {
        Service.init({
            userSchemas: [
                {
                    namespace: 'foo',
                    handlers: { bar() {}, baz() {}, log() {} },
                    sync: ['log'],
                    needsEvent: ['baz'],
                },
                {
                    namespace: 'qux',
                    handlers: { ping() {} },
                },
            ],
        });
        const listener = ipcMain.__syncListeners.get(META_LIST_CHANNEL);
        expect(typeof listener).toBe('function');

        const event = {};
        listener(event);

        expect(event.returnValue.ok).toBe(true);
        expect(event.returnValue.data).toEqual([
            { namespace: 'foo', handlers: ['bar', 'baz', 'log'], sync: ['log'] },
            { namespace: 'qux', handlers: ['ping'],              sync: [] },
        ]);
    });

    it('needsEvent is NOT exposed in meta data', () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { bar() {} },
                needsEvent: ['bar'],
            }],
        });
        const listener = ipcMain.__syncListeners.get(META_LIST_CHANNEL);
        const event = {};
        listener(event);
        expect(event.returnValue.data[0]).not.toHaveProperty('needsEvent');
    });

    it('empty schemas → empty data array', () => {
        Service.init({ userSchemas: [] });
        const listener = ipcMain.__syncListeners.get(META_LIST_CHANNEL);
        const event = {};
        listener(event);
        expect(event.returnValue).toEqual({ ok: true, data: [] });
    });

    it('preserves registration order', () => {
        Service.init({
            userSchemas: [
                { namespace: 'z', handlers: { a() {} } },
                { namespace: 'a', handlers: { b() {} } },
            ],
        });
        const listener = ipcMain.__syncListeners.get(META_LIST_CHANNEL);
        const event = {};
        listener(event);
        expect(event.returnValue.data.map(s => s.namespace)).toEqual(['z', 'a']);
    });
});
```

- [ ] **Step 2: Run test, verify pass**

```bash
npx vitest run src/service/__tests__/main-meta.test.js
```

Expected: PASS (4 tests) — Task 2's `handleGetServiceList` covers this.

- [ ] **Step 3: Commit**

```bash
git add src/service/__tests__/main-meta.test.js
git commit -m "test(m2): service meta channel envelope and schema list shape"
```

---

### Task 6: Main `cleanup`

**Files:**
- Create: `src/service/__tests__/main-cleanup.test.js`

Spec: §4.4 cleanup (removes meta listener, removes each async handler, removes each sync listener, clears registry).

- [ ] **Step 1: Write failing tests**

Create `src/service/__tests__/main-cleanup.test.js`:

```js
const { describe, it, expect, beforeEach, vi } = require('vitest');

vi.mock('electron', () => {
    const handlers = new Map();
    const syncListeners = new Map();
    const ipcMain = {
        handle: vi.fn((channel, fn) => { handlers.set(channel, fn); }),
        on: vi.fn((channel, fn) => { syncListeners.set(channel, fn); }),
        removeHandler: vi.fn(channel => { handlers.delete(channel); }),
        removeAllListeners: vi.fn(channel => { syncListeners.delete(channel); }),
        __handlers: handlers,
        __syncListeners: syncListeners,
    };
    return { ipcMain };
});

const Service = require('../main');
const {
    META_LIST_CHANNEL, asyncChannel, syncChannel,
} = require('../protocol');
const { ipcMain } = require('electron');

beforeEach(() => {
    Service.cleanup();
    ipcMain.handle.mockClear();
    ipcMain.on.mockClear();
    ipcMain.removeHandler.mockClear();
    ipcMain.removeAllListeners.mockClear();
    ipcMain.__handlers.clear();
    ipcMain.__syncListeners.clear();
});

describe('cleanup', () => {
    it('removes meta channel listener', () => {
        Service.init({
            userSchemas: [{ namespace: 'foo', handlers: { a() {} } }],
        });
        Service.cleanup();
        expect(ipcMain.removeAllListeners).toHaveBeenCalledWith(META_LIST_CHANNEL);
    });

    it('removes async handler for each registered handler', () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { bar() {}, baz() {} },
            }],
        });
        Service.cleanup();
        expect(ipcMain.removeHandler).toHaveBeenCalledWith(asyncChannel('foo', 'bar'));
        expect(ipcMain.removeHandler).toHaveBeenCalledWith(asyncChannel('foo', 'baz'));
    });

    it('removes sync listener for each sync handler', () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { bar() {}, log() {} },
                sync: ['log'],
            }],
        });
        Service.cleanup();
        expect(ipcMain.removeAllListeners).toHaveBeenCalledWith(
            syncChannel('foo', 'log'),
        );
        // bar has no sync listener, so removeAllListeners NOT called for foo:barSync
        const calls = ipcMain.removeAllListeners.mock.calls.map(c => c[0]);
        expect(calls).not.toContain(syncChannel('foo', 'bar'));
    });

    it('clears registry so re-init same namespace does not conflict', () => {
        Service.init({
            userSchemas: [{ namespace: 'foo', handlers: { a() {} } }],
        });
        Service.cleanup();
        expect(() => Service.init({
            userSchemas: [{ namespace: 'foo', handlers: { a() {} } }],
        })).not.toThrow();
    });

    it('cleanup is idempotent (callable without prior init)', () => {
        expect(() => Service.cleanup()).not.toThrow();
        expect(() => Service.cleanup()).not.toThrow();
    });

    it('after cleanup, meta + handler maps in mock are empty', () => {
        Service.init({
            userSchemas: [{
                namespace: 'foo',
                handlers: { bar() {}, log() {} },
                sync: ['log'],
            }],
        });
        Service.cleanup();
        expect(ipcMain.__handlers.size).toBe(0);
        expect(ipcMain.__syncListeners.size).toBe(0);
    });
});
```

- [ ] **Step 2: Run test, verify pass**

```bash
npx vitest run src/service/__tests__/main-cleanup.test.js
```

Expected: PASS (6 tests) — Task 2 cleanup implementation already covers this.

- [ ] **Step 3: Commit**

```bash
git add src/service/__tests__/main-cleanup.test.js
git commit -m "test(m2): service cleanup removes all channels and clears registry"
```

---

### Task 7: Preload `buildAppService` — factory shape + meta consumption

**Files:**
- Create: `src/service/preload.js`
- Create: `src/service/__tests__/preload-build.test.js`

Spec: §5.1 entry, §5.2 buildAppService flow, §5.3 / §5.4 caller wrappers.

- [ ] **Step 1: Write failing tests**

Create `src/service/__tests__/preload-build.test.js`:

```js
const { describe, it, expect, beforeEach, vi } = require('vitest');

vi.mock('electron', () => {
    return {
        ipcRenderer: {
            invoke: vi.fn(),
            sendSync: vi.fn(),
        },
    };
});

const { ipcRenderer } = require('electron');
const {
    okEnvelope, errorEnvelope, META_LIST_CHANNEL,
} = require('../protocol');

beforeEach(() => {
    vi.resetModules();
    ipcRenderer.invoke.mockReset();
    ipcRenderer.sendSync.mockReset();
});

function loadBuilder() {
    return require('../preload');
}

describe('buildAppService: meta consumption', () => {
    it('calls sendSync on META_LIST_CHANNEL', () => {
        ipcRenderer.sendSync.mockReturnValue(okEnvelope([]));
        loadBuilder()();
        expect(ipcRenderer.sendSync).toHaveBeenCalledWith(META_LIST_CHANNEL);
    });

    it('throws revived Error when envelope is not ok', () => {
        ipcRenderer.sendSync.mockReturnValue(errorEnvelope({
            name: 'TypeError',
            message: 'meta failed',
        }));
        const buildAppService = loadBuilder();
        expect(() => buildAppService()).toThrow(/meta failed/);
    });

    it('empty schema list yields empty api object', () => {
        ipcRenderer.sendSync.mockReturnValue(okEnvelope([]));
        const api = loadBuilder()();
        expect(api).toEqual({});
    });
});

describe('buildAppService: API surface generation', () => {
    it('each handler becomes async caller on namespace', () => {
        ipcRenderer.sendSync.mockReturnValue(okEnvelope([
            { namespace: 'foo', handlers: ['bar', 'baz'], sync: [] },
        ]));
        const api = loadBuilder()();
        expect(typeof api.foo.bar).toBe('function');
        expect(typeof api.foo.baz).toBe('function');
    });

    it('each sync-listed handler ALSO gets {name}Sync caller', () => {
        ipcRenderer.sendSync.mockReturnValue(okEnvelope([
            { namespace: 'foo', handlers: ['bar', 'log'], sync: ['log'] },
        ]));
        const api = loadBuilder()();
        expect(typeof api.foo.bar).toBe('function');
        expect(typeof api.foo.log).toBe('function');
        expect(typeof api.foo.logSync).toBe('function');
        // non-sync handler does NOT get Sync variant
        expect(api.foo.barSync).toBeUndefined();
    });

    it('multiple namespaces each get their own object', () => {
        ipcRenderer.sendSync.mockReturnValue(okEnvelope([
            { namespace: 'foo', handlers: ['a'], sync: [] },
            { namespace: 'bar', handlers: ['b'], sync: ['b'] },
        ]));
        const api = loadBuilder()();
        expect(typeof api.foo.a).toBe('function');
        expect(typeof api.bar.b).toBe('function');
        expect(typeof api.bar.bSync).toBe('function');
    });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
npx vitest run src/service/__tests__/preload-build.test.js
```

Expected: FAIL — `Cannot find module '../preload'`.

- [ ] **Step 3: Implement `preload.js`**

Create `src/service/preload.js`:

```js
const { ipcRenderer } = require('electron');
const { serialize } = require('../shared/serializer');
const { reviveError } = require('../shared/serializer/reviveError');
const {
    META_LIST_CHANNEL, asyncChannel, syncChannel,
} = require('./protocol');

function buildAsyncCaller(ns, name) {
    return async (...args) => {
        const safeArgs = args.map(a => serialize(a, { strict: false }));
        const envelope = await ipcRenderer.invoke(asyncChannel(ns, name), ...safeArgs);
        if (envelope && envelope.ok) return envelope.data;
        throw reviveError(envelope && envelope.error);
    };
}

function buildSyncCaller(ns, name) {
    return (...args) => {
        const safeArgs = args.map(a => serialize(a, { strict: false }));
        const envelope = ipcRenderer.sendSync(syncChannel(ns, name), ...safeArgs);
        if (envelope && envelope.ok) return envelope.data;
        throw reviveError(envelope && envelope.error);
    };
}

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

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run src/service/__tests__/preload-build.test.js
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/service/preload.js src/service/__tests__/preload-build.test.js
git commit -m "feat(m2): service preload buildAppService factory and caller generation"
```

---

### Task 8: Preload async + sync caller behavior

**Files:**
- Create: `src/service/__tests__/preload-callers.test.js`

Spec: §5.3 async caller, §5.4 sync caller, §5.5 arg serialization.

- [ ] **Step 1: Write failing tests**

Create `src/service/__tests__/preload-callers.test.js`:

```js
const { describe, it, expect, beforeEach, vi } = require('vitest');

vi.mock('electron', () => {
    return {
        ipcRenderer: {
            invoke: vi.fn(),
            sendSync: vi.fn(),
        },
    };
});

const { ipcRenderer } = require('electron');
const {
    okEnvelope, errorEnvelope, asyncChannel, syncChannel,
} = require('../protocol');

beforeEach(() => {
    vi.resetModules();
    ipcRenderer.invoke.mockReset();
    ipcRenderer.sendSync.mockReset();
});

function build(schemaList) {
    ipcRenderer.sendSync.mockReturnValueOnce(okEnvelope(schemaList));
    const buildAppService = require('../preload');
    return buildAppService();
}

describe('async caller', () => {
    it('invokes correct channel with serialized args', async () => {
        const api = build([
            { namespace: 'foo', handlers: ['add'], sync: [] },
        ]);
        ipcRenderer.invoke.mockResolvedValue(okEnvelope(3));

        const result = await api.foo.add(1, 2);

        expect(ipcRenderer.invoke).toHaveBeenCalledWith(
            asyncChannel('foo', 'add'), 1, 2,
        );
        expect(result).toBe(3);
    });

    it('unwraps okEnvelope.data', async () => {
        const api = build([{ namespace: 'foo', handlers: ['get'], sync: [] }]);
        ipcRenderer.invoke.mockResolvedValue(okEnvelope({ user: 'alice' }));
        await expect(api.foo.get()).resolves.toEqual({ user: 'alice' });
    });

    it('errorEnvelope → throws revived Error', async () => {
        const api = build([{ namespace: 'foo', handlers: ['fail'], sync: [] }]);
        ipcRenderer.invoke.mockResolvedValue(errorEnvelope({
            name: 'RangeError',
            message: 'out of range',
        }));
        await expect(api.foo.fail()).rejects.toBeInstanceOf(RangeError);
        await expect(api.foo.fail()).rejects.toThrow(/out of range/);
    });

    it('args serialized: function arg becomes placeholder', async () => {
        const api = build([{ namespace: 'foo', handlers: ['take'], sync: [] }]);
        ipcRenderer.invoke.mockResolvedValue(okEnvelope(null));
        await api.foo.take({ cb: function named() {}, n: 5 });

        const sentArg = ipcRenderer.invoke.mock.calls[0][1];
        expect(sentArg.n).toBe(5);
        expect(sentArg.cb).toBe('[Function: named]');
    });

    it('Date arg serialized to ISO string', async () => {
        const api = build([{ namespace: 'foo', handlers: ['log'], sync: [] }]);
        ipcRenderer.invoke.mockResolvedValue(okEnvelope(null));
        await api.foo.log(new Date('2026-01-01T00:00:00.000Z'));
        expect(ipcRenderer.invoke.mock.calls[0][1]).toBe('2026-01-01T00:00:00.000Z');
    });
});

describe('sync caller', () => {
    it('uses sendSync on syncChannel and unwraps data', () => {
        const api = build([
            { namespace: 'foo', handlers: ['log'], sync: ['log'] },
        ]);
        ipcRenderer.sendSync.mockReturnValueOnce(okEnvelope('ok'));

        const result = api.foo.logSync('hello');

        expect(ipcRenderer.sendSync).toHaveBeenLastCalledWith(
            syncChannel('foo', 'log'), 'hello',
        );
        expect(result).toBe('ok');
    });

    it('errorEnvelope → throws revived Error synchronously', () => {
        const api = build([
            { namespace: 'foo', handlers: ['fail'], sync: ['fail'] },
        ]);
        ipcRenderer.sendSync.mockReturnValueOnce(errorEnvelope({
            name: 'TypeError',
            message: 'sync bad',
        }));
        expect(() => api.foo.failSync()).toThrow(TypeError);
        expect(() => {
            ipcRenderer.sendSync.mockReturnValueOnce(errorEnvelope({
                name: 'TypeError', message: 'sync bad',
            }));
            api.foo.failSync();
        }).toThrow(/sync bad/);
    });

    it('args serialized before sendSync', () => {
        const api = build([
            { namespace: 'foo', handlers: ['emit'], sync: ['emit'] },
        ]);
        ipcRenderer.sendSync.mockReturnValueOnce(okEnvelope(null));

        api.foo.emitSync({ fn: () => {}, n: 1 });

        const sentArg = ipcRenderer.sendSync.mock.calls.at(-1)[1];
        expect(sentArg.n).toBe(1);
        expect(sentArg.fn).toMatch(/^\[Function/);
    });

    it('non-sync handler has no Sync variant (regression guard)', () => {
        const api = build([
            { namespace: 'foo', handlers: ['bar'], sync: [] },
        ]);
        expect(api.foo.barSync).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run test, verify pass**

```bash
npx vitest run src/service/__tests__/preload-callers.test.js
```

Expected: PASS (9 tests) — Task 7's `buildAsyncCaller` / `buildSyncCaller` already implement this.

- [ ] **Step 3: Commit**

```bash
git add src/service/__tests__/preload-callers.test.js
git commit -m "test(m2): service preload async/sync callers with arg serialization and error revival"
```

---

### Task 9: Full suite green + module exports verification

**Files:**
- Verify: all service tests + main / preload / protocol export surfaces

- [ ] **Step 1: Run full M2 test suite**

```bash
npx vitest run src/service/
```

Expected: PASS all 8 test files.

- [ ] **Step 2: Verify `main.js` exports surface**

```bash
node -e "const m = require('./src/service/main'); console.log(Object.keys(m).sort());"
```

Expected: `[ 'cleanup', 'init' ]`.

- [ ] **Step 3: Verify `preload.js` exports the factory**

```bash
node -e "const f = require('./src/service/preload'); console.log(typeof f);"
```

Expected: `function`.

- [ ] **Step 4: Verify `protocol.js` exports surface**

```bash
node -e "const p = require('./src/service/protocol'); console.log(Object.keys(p).sort());"
```

Expected: `[ 'META_LIST_CHANNEL', 'asyncChannel', 'errorEnvelope', 'okEnvelope', 'syncChannel' ]`.

- [ ] **Step 5: Build via rollup**

```bash
npm run build
```

Expected: rollup exits 0; produces `dist/service/main.js` and `dist/service/preload.js`.

- [ ] **Step 6: Final M2 commit**

If verification produced any uncommitted changes:

```bash
git add -A
git commit -m "chore(m2): M2 service module complete"
```

Otherwise skip.

---

## Self-Review

After completing all tasks, verify:

**Spec coverage:**

- §3.1 channel naming (`{ns}:{name}`, `{ns}:{name}Sync`, `service:getServiceList`) ✓ (protocol.test.js)
- §3.2 unified envelope `{ok, data?, error?}` ✓ (protocol.test.js + main-async/sync/meta tests)
- §3.3 meta channel data shape `[{namespace, handlers, sync}]`; `needsEvent` NOT in meta ✓ (main-meta.test.js explicit assertion)
- §4.1 init validation (array userSchemas, each schema validated) ✓ (main-init.test.js)
- §4.2 registerService validation (namespace string, handlers object, sync/needsEvent items must exist in handlers, namespace conflict) ✓ (main-init.test.js)
- §4.2 async registration (try/catch wrapping, serialize result + error, never throws) ✓ (main-async.test.js)
- §4.2 sync registration (event.returnValue envelope, awaits async handler, never throws) ✓ (main-sync.test.js)
- §4.2 needsEvent injection in both async and sync paths ✓ (main-async.test.js + main-sync.test.js)
- §4.3 meta channel impl (envelope-wrapped serialized list, no needsEvent) ✓ (main-meta.test.js)
- §4.4 cleanup (removes meta listener, each async handler via removeHandler, each sync listener via removeAllListeners, clears registry) ✓ (main-cleanup.test.js)
- §5.1 preload exports `buildAppService` factory only (no auto contextBridge) ✓ (preload.js `module.exports = buildAppService`)
- §5.2 buildAppService flow (sendSync META_LIST_CHANNEL, throw revived Error on !ok, generate async + sync callers) ✓ (preload-build.test.js)
- §5.3 buildAsyncCaller (serialize args, ipcRenderer.invoke, unwrap data or throw reviveError) ✓ (preload-callers.test.js)
- §5.4 buildSyncCaller (serialize args, ipcRenderer.sendSync, unwrap data or throw reviveError sync) ✓ (preload-callers.test.js)
- §5.5 arg serialization closes the IPC-safe loop ✓ (function/Date args verified in preload-callers.test.js)
- §7 file structure (3 files: main.js, preload.js, protocol.js) ✓

**Architectural invariants:**

- `protocol.js` is the **single source of truth** for channel names + envelope helpers ✓ — both `main.js` and `preload.js` require from `./protocol`; no string literals like `'service:getServiceList'` outside it.
- Main **never throws over IPC** ✓ — every async handler wrapped in try/catch returning envelope; every sync handler wraps returnValue assignment in try/catch (main-async / main-sync error tests verify).
- Per-handler **`sync` opt-in** ✓ — sync listener only registered for handlers in `schema.sync` (main-init.test.js asserts `__syncListeners.has(...)` false for non-sync).
- Per-handler **`needsEvent` opt-in**, never exposed via meta ✓ — main-meta.test.js explicit `not.toHaveProperty('needsEvent')`.
- Sync channel can host **async handler** ✓ — main-sync.test.js "awaits async handler before writing returnValue".
- Preload does **NOT** call `contextBridge` ✓ — preload.js imports only `ipcRenderer` from electron; aggregation is `src/preload.js`'s job per overview §8.2.
- Args round-trip via `serialize` on both sides (renderer args → main; main return → renderer) ✓ — verified in preload-callers (renderer side) and main-async (main side).

**Integration points (deferred):** Aggregate entry `src/preload.js` consuming `buildAppService` and exposing `window.appService` belongs to the overview-level packaging plan, not M2 module.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-04-toolkit-m2-service.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch with checkpoints.

Which approach?
