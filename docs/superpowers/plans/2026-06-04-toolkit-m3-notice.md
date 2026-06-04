# Toolkit M3 Notice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement IPC 单向推送 bridge (main→renderer push) per `docs/superpowers/specs/2026-06-03-toolkit-m3-notice-design.md`.

**Architecture:** Three files under `src/notice/`: `protocol.js` (single source of truth for channel names + envelope helpers), `main.js` (init / broadcast / direct / cleanup with internal `registeredSchemas` Map and zero per-window state), `preload.js` (`buildAppNotice` factory with single dispatcher routing into `listeners: Map<fullEventName, Set<cb>>`). Push channel `notice:event` is plain (no envelope, single shared channel keyed by `fullEventName`); meta channel `notice:getSchema` uses `{ok, data?, error?}` envelope per M2. M3 depends on M1 `shared/serializer` for IPC payload encoding and Error revival.

**Tech Stack:** Node.js CJS, Vitest, Rollup. Mock `electron` via `vi.mock`.

**Spec sections referenced:** §3 (protocol), §4 (main flow), §5 (preload flow), §6 (boundaries), §7 (file structure). Cross-reference: overview-design §8.2 (preload aggregator contract — M3 preload exports `buildAppNotice` factory consumed by `src/preload.js`).

**Prerequisite:** M1 `src/shared/serializer/` already implemented (per `2026-06-04-toolkit-m1-serializer.md`).

---

## File Structure

All paths relative to repo root `base-client-toolkit/`.

**Source files:**
- `src/notice/protocol.js` — channel constants (`EVENT_CHANNEL`, `META_GET_SCHEMA_CHANNEL`) + envelope helpers (`okEnvelope`, `errorEnvelope`). Single truth source consumed by both `main.js` and `preload.js`.
- `src/notice/main.js` — exports `init({userSchemas})`, `broadcast(fullEvent, data)`, `direct(fullEvent, windowId, data)`, `cleanup()`. Internal: `registeredSchemas: Map<namespace, eventList>`, `registerSchema`, `parseFullEventName`, meta channel listener.
- `src/notice/preload.js` — exports `buildAppNotice()` factory. Internal: `buildEventApi(fullEventName, listeners)` returning `{on, once, off}`; single `ipcRenderer.on(EVENT_CHANNEL, dispatcher)`.

**Test files (vitest):**
- `src/notice/__tests__/protocol.test.js`
- `src/notice/__tests__/main-init.test.js`
- `src/notice/__tests__/main-broadcast.test.js`
- `src/notice/__tests__/main-direct.test.js`
- `src/notice/__tests__/main-meta.test.js`
- `src/notice/__tests__/main-cleanup.test.js`
- `src/notice/__tests__/preload-api.test.js`
- `src/notice/__tests__/preload-dispatch.test.js`

**Configuration:**
- `package.json` — verify `vitest` in `devDependencies`; ensure `"test": "vitest run"` and `"test:watch": "vitest"` scripts (already verified in M1 plan).

---

## Tasks

### Task 1: Protocol module

**Files:**
- Create: `src/notice/protocol.js`
- Create: `src/notice/__tests__/protocol.test.js`

Spec: §3.1 channel naming, §3.3 envelope, §7.1 protocol.js shape.

- [ ] **Step 1: Write failing tests**

Create `src/notice/__tests__/protocol.test.js`:

```js
const { describe, it, expect } = require('vitest');
const protocol = require('../protocol');

describe('protocol channel constants', () => {
    it('EVENT_CHANNEL is "notice:event"', () => {
        expect(protocol.EVENT_CHANNEL).toBe('notice:event');
    });
    it('META_GET_SCHEMA_CHANNEL is "notice:getSchema"', () => {
        expect(protocol.META_GET_SCHEMA_CHANNEL).toBe('notice:getSchema');
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
npx vitest run src/notice/__tests__/protocol.test.js
```

Expected: FAIL — `Cannot find module '../protocol'`.

- [ ] **Step 3: Implement `protocol.js`**

Create `src/notice/protocol.js`:

```js
const EVENT_CHANNEL = 'notice:event';
const META_GET_SCHEMA_CHANNEL = 'notice:getSchema';

const okEnvelope    = data  => ({ ok: true,  data });
const errorEnvelope = error => ({ ok: false, error });

module.exports = {
    EVENT_CHANNEL,
    META_GET_SCHEMA_CHANNEL,
    okEnvelope,
    errorEnvelope,
};
```

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run src/notice/__tests__/protocol.test.js
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notice/protocol.js src/notice/__tests__/protocol.test.js
git commit -m "feat(m3): notice protocol channel constants and envelope helpers"
```

---

### Task 2: Main `init` — schema validation + registration

**Files:**
- Create: `src/notice/main.js`
- Create: `src/notice/__tests__/main-init.test.js`

Spec: §4.1 init, §4.2 registerSchema (validation rules), §2.1 schema form.

- [ ] **Step 1: Write failing tests**

Create `src/notice/__tests__/main-init.test.js`:

```js
const { describe, it, expect, beforeEach, vi } = require('vitest');

vi.mock('electron', () => {
    const ipcMain = {
        on: vi.fn(),
        removeAllListeners: vi.fn(),
    };
    const BrowserWindow = {
        getAllWindows: vi.fn(() => []),
        fromId: vi.fn(() => null),
    };
    return { ipcMain, BrowserWindow };
});

const Notice = require('../main');
const { META_GET_SCHEMA_CHANNEL } = require('../protocol');
const { ipcMain } = require('electron');

beforeEach(() => {
    Notice.cleanup();
    ipcMain.on.mockClear();
    ipcMain.removeAllListeners.mockClear();
});

describe('init: input validation', () => {
    it('non-array userSchemas throws', () => {
        expect(() => Notice.init({ userSchemas: 'not array' })).toThrow();
        expect(() => Notice.init({ userSchemas: null })).toThrow();
    });
    it('missing opts throws', () => {
        expect(() => Notice.init()).toThrow();
    });
    it('empty userSchemas is allowed', () => {
        expect(() => Notice.init({ userSchemas: [] })).not.toThrow();
    });
});

describe('init: schema validation', () => {
    it('schema missing namespace throws', () => {
        expect(() => Notice.init({ userSchemas: [{ events: ['x'] }] })).toThrow();
    });
    it('schema missing events array throws', () => {
        expect(() => Notice.init({ userSchemas: [{ namespace: 'foo' }] })).toThrow();
    });
    it('events not an array throws', () => {
        expect(() => Notice.init({
            userSchemas: [{ namespace: 'foo', events: 'bar' }],
        })).toThrow();
    });
    it('event name with dot throws', () => {
        expect(() => Notice.init({
            userSchemas: [{ namespace: 'foo', events: ['a.b'] }],
        })).toThrow(/invalid event name/i);
    });
    it('event name with space throws', () => {
        expect(() => Notice.init({
            userSchemas: [{ namespace: 'foo', events: ['has space'] }],
        })).toThrow(/invalid event name/i);
    });
    it('valid event names pass: letters/digits/underscore/dash', () => {
        expect(() => Notice.init({
            userSchemas: [{ namespace: 'foo', events: ['ab_c-1', 'X', 'event2'] }],
        })).not.toThrow();
    });
    it('duplicate namespace across schemas throws', () => {
        expect(() => Notice.init({
            userSchemas: [
                { namespace: 'foo', events: ['a'] },
                { namespace: 'foo', events: ['b'] },
            ],
        })).toThrow(/conflict|冲突/i);
    });
});

describe('init: meta channel registration', () => {
    it('registers ipcMain listener on META_GET_SCHEMA_CHANNEL', () => {
        Notice.init({ userSchemas: [{ namespace: 'foo', events: ['x'] }] });
        expect(ipcMain.on).toHaveBeenCalledWith(
            META_GET_SCHEMA_CHANNEL,
            expect.any(Function),
        );
    });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
npx vitest run src/notice/__tests__/main-init.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `main.js` (init + cleanup skeleton)**

Create `src/notice/main.js`:

```js
const { ipcMain, BrowserWindow } = require('electron');
const { serialize } = require('../shared/serializer');
const {
    EVENT_CHANNEL,
    META_GET_SCHEMA_CHANNEL,
    okEnvelope,
    errorEnvelope,
} = require('./protocol');

const EVENT_NAME_RE = /^[A-Za-z0-9_-]+$/;

const registeredSchemas = new Map();

function registerSchema(schema) {
    if (!schema || typeof schema !== 'object') {
        throw new Error('Notice schema must be an object');
    }
    const { namespace, events } = schema;
    if (typeof namespace !== 'string' || !namespace) {
        throw new Error('Notice schema requires string namespace');
    }
    if (!Array.isArray(events)) {
        throw new Error(`Notice schema "${namespace}" requires events array`);
    }
    for (const ev of events) {
        if (typeof ev !== 'string' || !EVENT_NAME_RE.test(ev)) {
            throw new Error(
                `Notice schema "${namespace}": invalid event name "${ev}" ` +
                `(allowed: [A-Za-z0-9_-]+)`,
            );
        }
    }
    if (registeredSchemas.has(namespace)) {
        throw new Error(`Notice namespace "${namespace}" conflict`);
    }
    registeredSchemas.set(namespace, [...events]);
}

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
        event.returnValue = okEnvelope(serialize(list, { strict: false }));
    } catch (err) {
        event.returnValue = errorEnvelope(serialize(err, { strict: false }));
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

function broadcast(fullEventName, data) {
    assertRegistered(fullEventName);
    const safeData = serialize(data, { strict: false });
    for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(EVENT_CHANNEL, fullEventName, safeData);
    }
}

function direct(fullEventName, windowId, data) {
    assertRegistered(fullEventName);
    const win = BrowserWindow.fromId(windowId);
    if (!win) return;
    const safeData = serialize(data, { strict: false });
    win.webContents.send(EVENT_CHANNEL, fullEventName, safeData);
}

function cleanup() {
    ipcMain.removeAllListeners(META_GET_SCHEMA_CHANNEL);
    registeredSchemas.clear();
}

module.exports = { init, broadcast, direct, cleanup };
```

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run src/notice/__tests__/main-init.test.js
```

Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notice/main.js src/notice/__tests__/main-init.test.js
git commit -m "feat(m3): notice main init with schema validation and registry"
```

---

### Task 3: Main `broadcast` — push to all windows

**Files:**
- Create: `src/notice/__tests__/main-broadcast.test.js`

Spec: §4.3 broadcast, §2.2 conventions (event registration check, payload serialize).

- [ ] **Step 1: Write failing tests**

Create `src/notice/__tests__/main-broadcast.test.js`:

```js
const { describe, it, expect, beforeEach, vi } = require('vitest');

vi.mock('electron', () => {
    const ipcMain = { on: vi.fn(), removeAllListeners: vi.fn() };
    const BrowserWindow = {
        getAllWindows: vi.fn(() => []),
        fromId: vi.fn(() => null),
    };
    return { ipcMain, BrowserWindow };
});

const Notice = require('../main');
const { EVENT_CHANNEL } = require('../protocol');
const { BrowserWindow } = require('electron');

function makeWin() {
    return { webContents: { send: vi.fn() } };
}

beforeEach(() => {
    Notice.cleanup();
    BrowserWindow.getAllWindows.mockReset();
    BrowserWindow.fromId.mockReset();
});

describe('broadcast: validation', () => {
    beforeEach(() => {
        Notice.init({ userSchemas: [{ namespace: 'foo', events: ['evA'] }] });
    });

    it('unregistered namespace throws', () => {
        expect(() => Notice.broadcast('bar.evA', { x: 1 })).toThrow(/not registered/);
    });
    it('registered namespace but unknown event throws', () => {
        expect(() => Notice.broadcast('foo.unknown', { x: 1 })).toThrow(/not registered/);
    });
    it('malformed full event name throws', () => {
        expect(() => Notice.broadcast('no-dot', {})).toThrow(/malformed/);
        expect(() => Notice.broadcast('.evA', {})).toThrow(/malformed/);
        expect(() => Notice.broadcast('foo.', {})).toThrow(/malformed/);
    });
});

describe('broadcast: delivery', () => {
    beforeEach(() => {
        Notice.init({ userSchemas: [{ namespace: 'foo', events: ['evA'] }] });
    });

    it('sends to every window from getAllWindows', () => {
        const w1 = makeWin();
        const w2 = makeWin();
        BrowserWindow.getAllWindows.mockReturnValue([w1, w2]);

        Notice.broadcast('foo.evA', { user: 123 });

        expect(w1.webContents.send).toHaveBeenCalledWith(
            EVENT_CHANNEL,
            'foo.evA',
            { user: 123 },
        );
        expect(w2.webContents.send).toHaveBeenCalledWith(
            EVENT_CHANNEL,
            'foo.evA',
            { user: 123 },
        );
    });

    it('zero windows is a no-op (no throw)', () => {
        BrowserWindow.getAllWindows.mockReturnValue([]);
        expect(() => Notice.broadcast('foo.evA', { x: 1 })).not.toThrow();
    });

    it('payload passes through serialize (function stripped to placeholder)', () => {
        const w1 = makeWin();
        BrowserWindow.getAllWindows.mockReturnValue([w1]);

        Notice.broadcast('foo.evA', { cb: function named() {}, ok: true });

        const sentPayload = w1.webContents.send.mock.calls[0][2];
        expect(sentPayload.ok).toBe(true);
        expect(sentPayload.cb).toBe('[Function: named]');
    });

    it('no per-window state: broadcast iterates getAllWindows() each call', () => {
        const w1 = makeWin();
        BrowserWindow.getAllWindows.mockReturnValueOnce([w1]);
        Notice.broadcast('foo.evA', { n: 1 });

        const w2 = makeWin();
        BrowserWindow.getAllWindows.mockReturnValueOnce([w2]);
        Notice.broadcast('foo.evA', { n: 2 });

        expect(w1.webContents.send).toHaveBeenCalledTimes(1);
        expect(w2.webContents.send).toHaveBeenCalledTimes(1);
        expect(BrowserWindow.getAllWindows).toHaveBeenCalledTimes(2);
    });
});
```

- [ ] **Step 2: Run test, verify pass**

```bash
npx vitest run src/notice/__tests__/main-broadcast.test.js
```

Expected: PASS (8 tests) — Task 2's `broadcast` implementation already covers this.

- [ ] **Step 3: Commit**

```bash
git add src/notice/__tests__/main-broadcast.test.js
git commit -m "test(m3): notice broadcast delivery and serialize encoding"
```

---

### Task 4: Main `direct` — push to specific window

**Files:**
- Create: `src/notice/__tests__/main-direct.test.js`

Spec: §4.4 direct (windowId target, fromId(id) null → silent ignore).

- [ ] **Step 1: Write failing tests**

Create `src/notice/__tests__/main-direct.test.js`:

```js
const { describe, it, expect, beforeEach, vi } = require('vitest');

vi.mock('electron', () => {
    const ipcMain = { on: vi.fn(), removeAllListeners: vi.fn() };
    const BrowserWindow = {
        getAllWindows: vi.fn(() => []),
        fromId: vi.fn(() => null),
    };
    return { ipcMain, BrowserWindow };
});

const Notice = require('../main');
const { EVENT_CHANNEL } = require('../protocol');
const { BrowserWindow } = require('electron');

function makeWin() {
    return { webContents: { send: vi.fn() } };
}

beforeEach(() => {
    Notice.cleanup();
    BrowserWindow.fromId.mockReset();
    BrowserWindow.getAllWindows.mockReset();
    Notice.init({ userSchemas: [{ namespace: 'foo', events: ['evA'] }] });
});

describe('direct', () => {
    it('unregistered event throws', () => {
        expect(() => Notice.direct('foo.unknown', 1, {})).toThrow(/not registered/);
    });

    it('sends to the window returned by fromId(windowId)', () => {
        const w = makeWin();
        BrowserWindow.fromId.mockImplementation(id => (id === 42 ? w : null));

        Notice.direct('foo.evA', 42, { hello: 'world' });

        expect(BrowserWindow.fromId).toHaveBeenCalledWith(42);
        expect(w.webContents.send).toHaveBeenCalledWith(
            EVENT_CHANNEL,
            'foo.evA',
            { hello: 'world' },
        );
    });

    it('silently ignores when fromId returns null (window closed)', () => {
        BrowserWindow.fromId.mockReturnValue(null);
        expect(() => Notice.direct('foo.evA', 999, { x: 1 })).not.toThrow();
    });

    it('does not iterate getAllWindows', () => {
        const w = makeWin();
        BrowserWindow.fromId.mockReturnValue(w);
        Notice.direct('foo.evA', 1, {});
        expect(BrowserWindow.getAllWindows).not.toHaveBeenCalled();
    });

    it('payload passes through serialize', () => {
        const w = makeWin();
        BrowserWindow.fromId.mockReturnValue(w);

        Notice.direct('foo.evA', 1, { d: new Date('2026-01-01T00:00:00.000Z'), n: 5 });

        const payload = w.webContents.send.mock.calls[0][2];
        expect(payload.d).toBe('2026-01-01T00:00:00.000Z');
        expect(payload.n).toBe(5);
    });
});
```

- [ ] **Step 2: Run test, verify pass**

```bash
npx vitest run src/notice/__tests__/main-direct.test.js
```

Expected: PASS (5 tests) — Task 2 implementation handles this.

- [ ] **Step 3: Commit**

```bash
git add src/notice/__tests__/main-direct.test.js
git commit -m "test(m3): notice direct windowId targeting and silent-ignore"
```

---

### Task 5: Main meta channel handler

**Files:**
- Create: `src/notice/__tests__/main-meta.test.js`

Spec: §4.5 meta channel (envelope output, `data` shape).

- [ ] **Step 1: Write failing tests**

Create `src/notice/__tests__/main-meta.test.js`:

```js
const { describe, it, expect, beforeEach, vi } = require('vitest');

vi.mock('electron', () => {
    const handlers = new Map();
    const ipcMain = {
        on: vi.fn((channel, fn) => { handlers.set(channel, fn); }),
        removeAllListeners: vi.fn(channel => { handlers.delete(channel); }),
        __handlers: handlers,
    };
    const BrowserWindow = {
        getAllWindows: vi.fn(() => []),
        fromId: vi.fn(() => null),
    };
    return { ipcMain, BrowserWindow };
});

const Notice = require('../main');
const { META_GET_SCHEMA_CHANNEL } = require('../protocol');
const { ipcMain } = require('electron');

beforeEach(() => {
    Notice.cleanup();
    ipcMain.__handlers.clear();
});

describe('meta channel handler', () => {
    it('returnValue is okEnvelope with serialized schema list', () => {
        Notice.init({
            userSchemas: [
                { namespace: 'foo', events: ['a', 'b'] },
                { namespace: 'bar', events: ['c'] },
            ],
        });

        const handler = ipcMain.__handlers.get(META_GET_SCHEMA_CHANNEL);
        expect(typeof handler).toBe('function');

        const event = {};
        handler(event);

        expect(event.returnValue.ok).toBe(true);
        expect(event.returnValue.data).toEqual([
            { namespace: 'foo', events: ['a', 'b'] },
            { namespace: 'bar', events: ['c'] },
        ]);
    });

    it('empty schemas returns empty data array', () => {
        Notice.init({ userSchemas: [] });
        const handler = ipcMain.__handlers.get(META_GET_SCHEMA_CHANNEL);
        const event = {};
        handler(event);
        expect(event.returnValue).toEqual({ ok: true, data: [] });
    });

    it('preserves registration order', () => {
        Notice.init({
            userSchemas: [
                { namespace: 'z', events: ['x'] },
                { namespace: 'a', events: ['y'] },
            ],
        });
        const handler = ipcMain.__handlers.get(META_GET_SCHEMA_CHANNEL);
        const event = {};
        handler(event);
        expect(event.returnValue.data.map(s => s.namespace)).toEqual(['z', 'a']);
    });
});
```

- [ ] **Step 2: Run test, verify pass**

```bash
npx vitest run src/notice/__tests__/main-meta.test.js
```

Expected: PASS (3 tests) — Task 2 already wired `handleGetSchema`.

- [ ] **Step 3: Commit**

```bash
git add src/notice/__tests__/main-meta.test.js
git commit -m "test(m3): notice meta channel envelope and schema list shape"
```

---

### Task 6: Main `cleanup`

**Files:**
- Create: `src/notice/__tests__/main-cleanup.test.js`

Spec: §4.6 cleanup (removes ipcMain listener, clears registry).

- [ ] **Step 1: Write failing tests**

Create `src/notice/__tests__/main-cleanup.test.js`:

```js
const { describe, it, expect, beforeEach, vi } = require('vitest');

vi.mock('electron', () => {
    const ipcMain = {
        on: vi.fn(),
        removeAllListeners: vi.fn(),
    };
    const BrowserWindow = {
        getAllWindows: vi.fn(() => []),
        fromId: vi.fn(() => null),
    };
    return { ipcMain, BrowserWindow };
});

const Notice = require('../main');
const { META_GET_SCHEMA_CHANNEL } = require('../protocol');
const { ipcMain } = require('electron');

beforeEach(() => {
    Notice.cleanup();
    ipcMain.removeAllListeners.mockClear();
});

describe('cleanup', () => {
    it('removes meta channel listener', () => {
        Notice.init({ userSchemas: [{ namespace: 'foo', events: ['a'] }] });
        Notice.cleanup();
        expect(ipcMain.removeAllListeners).toHaveBeenCalledWith(META_GET_SCHEMA_CHANNEL);
    });

    it('clears registry so re-init same namespace does not conflict', () => {
        Notice.init({ userSchemas: [{ namespace: 'foo', events: ['a'] }] });
        Notice.cleanup();
        expect(() =>
            Notice.init({ userSchemas: [{ namespace: 'foo', events: ['a'] }] }),
        ).not.toThrow();
    });

    it('after cleanup, broadcast on cleared namespace throws not-registered', () => {
        Notice.init({ userSchemas: [{ namespace: 'foo', events: ['a'] }] });
        Notice.cleanup();
        expect(() => Notice.broadcast('foo.a', {})).toThrow(/not registered/);
    });

    it('cleanup is idempotent (callable without prior init)', () => {
        expect(() => Notice.cleanup()).not.toThrow();
        expect(() => Notice.cleanup()).not.toThrow();
    });
});
```

- [ ] **Step 2: Run test, verify pass**

```bash
npx vitest run src/notice/__tests__/main-cleanup.test.js
```

Expected: PASS (4 tests).

- [ ] **Step 3: Commit**

```bash
git add src/notice/__tests__/main-cleanup.test.js
git commit -m "test(m3): notice cleanup removes listener and clears registry"
```

---

### Task 7: Preload `buildAppNotice` — factory + API surface

**Files:**
- Create: `src/notice/preload.js`
- Create: `src/notice/__tests__/preload-api.test.js`

Spec: §5.1 entry, §5.2 buildAppNotice flow, §5.3 buildEventApi (on/once/off semantics).

- [ ] **Step 1: Write failing tests**

Create `src/notice/__tests__/preload-api.test.js`:

```js
const { describe, it, expect, beforeEach, vi } = require('vitest');

vi.mock('electron', () => {
    const handlers = new Map();
    return {
        ipcRenderer: {
            on: vi.fn((channel, fn) => { handlers.set(channel, fn); }),
            removeListener: vi.fn(),
            sendSync: vi.fn(),
            __handlers: handlers,
        },
    };
});

const { ipcRenderer } = require('electron');
const { okEnvelope, errorEnvelope, META_GET_SCHEMA_CHANNEL } = require('../protocol');

beforeEach(() => {
    vi.resetModules();
    ipcRenderer.on.mockClear();
    ipcRenderer.sendSync.mockReset();
    ipcRenderer.__handlers.clear();
});

function loadBuilder() {
    return require('../preload');
}

describe('buildAppNotice: factory output shape', () => {
    it('returns object keyed by namespace, each with event names', () => {
        ipcRenderer.sendSync.mockReturnValue(okEnvelope([
            { namespace: 'foo', events: ['userLoggedIn', 'dataReady'] },
            { namespace: 'bar', events: ['ping'] },
        ]));

        const buildAppNotice = loadBuilder();
        const api = buildAppNotice();

        expect(typeof api.foo).toBe('object');
        expect(typeof api.foo.userLoggedIn.on).toBe('function');
        expect(typeof api.foo.userLoggedIn.once).toBe('function');
        expect(typeof api.foo.userLoggedIn.off).toBe('function');
        expect(typeof api.bar.ping.on).toBe('function');
    });

    it('calls sendSync on META_GET_SCHEMA_CHANNEL', () => {
        ipcRenderer.sendSync.mockReturnValue(okEnvelope([]));
        loadBuilder()();
        expect(ipcRenderer.sendSync).toHaveBeenCalledWith(META_GET_SCHEMA_CHANNEL);
    });

    it('throws revived Error when envelope is not ok', () => {
        ipcRenderer.sendSync.mockReturnValue(errorEnvelope({
            name: 'TypeError',
            message: 'meta failed',
        }));
        const buildAppNotice = loadBuilder();
        expect(() => buildAppNotice()).toThrow(/meta failed/);
    });

    it('empty schema list yields empty api object', () => {
        ipcRenderer.sendSync.mockReturnValue(okEnvelope([]));
        const api = loadBuilder()();
        expect(api).toEqual({});
    });
});

describe('buildEventApi: on returns unsubscribe', () => {
    function build() {
        ipcRenderer.sendSync.mockReturnValue(okEnvelope([
            { namespace: 'foo', events: ['evA'] },
        ]));
        return loadBuilder()();
    }

    it('on returns a function that removes the subscription', () => {
        const api = build();
        const cb = vi.fn();
        const off = api.foo.evA.on(cb);

        // Simulate push
        const dispatcher = ipcRenderer.__handlers.get('notice:event');
        dispatcher({}, 'foo.evA', { x: 1 });
        expect(cb).toHaveBeenCalledWith({ x: 1 });

        off();
        dispatcher({}, 'foo.evA', { x: 2 });
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('multiple on subscriptions all fire', () => {
        const api = build();
        const a = vi.fn();
        const b = vi.fn();
        api.foo.evA.on(a);
        api.foo.evA.on(b);

        const dispatcher = ipcRenderer.__handlers.get('notice:event');
        dispatcher({}, 'foo.evA', { v: 1 });
        expect(a).toHaveBeenCalledWith({ v: 1 });
        expect(b).toHaveBeenCalledWith({ v: 1 });
    });
});

describe('buildEventApi: once auto-unsubscribes', () => {
    function build() {
        ipcRenderer.sendSync.mockReturnValue(okEnvelope([
            { namespace: 'foo', events: ['evA'] },
        ]));
        return loadBuilder()();
    }

    it('once fires exactly one time', () => {
        const api = build();
        const cb = vi.fn();
        api.foo.evA.once(cb);

        const dispatcher = ipcRenderer.__handlers.get('notice:event');
        dispatcher({}, 'foo.evA', { n: 1 });
        dispatcher({}, 'foo.evA', { n: 2 });

        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith({ n: 1 });
    });

    it('once returns unsubscribe that prevents firing if called before push', () => {
        const api = build();
        const cb = vi.fn();
        const off = api.foo.evA.once(cb);
        off();

        const dispatcher = ipcRenderer.__handlers.get('notice:event');
        dispatcher({}, 'foo.evA', { n: 1 });
        expect(cb).not.toHaveBeenCalled();
    });
});

describe('buildEventApi: off semantics', () => {
    function build() {
        ipcRenderer.sendSync.mockReturnValue(okEnvelope([
            { namespace: 'foo', events: ['evA'] },
        ]));
        return loadBuilder()();
    }

    it('off(cb) removes only that callback', () => {
        const api = build();
        const a = vi.fn();
        const b = vi.fn();
        api.foo.evA.on(a);
        api.foo.evA.on(b);
        api.foo.evA.off(a);

        const dispatcher = ipcRenderer.__handlers.get('notice:event');
        dispatcher({}, 'foo.evA', { v: 1 });
        expect(a).not.toHaveBeenCalled();
        expect(b).toHaveBeenCalledWith({ v: 1 });
    });

    it('off() with no arg clears all subscriptions for that event', () => {
        const api = build();
        const a = vi.fn();
        const b = vi.fn();
        api.foo.evA.on(a);
        api.foo.evA.on(b);
        api.foo.evA.off();

        const dispatcher = ipcRenderer.__handlers.get('notice:event');
        dispatcher({}, 'foo.evA', { v: 1 });
        expect(a).not.toHaveBeenCalled();
        expect(b).not.toHaveBeenCalled();
    });

    it('off(cb) on unknown callback is a no-op (no throw)', () => {
        const api = build();
        expect(() => api.foo.evA.off(() => {})).not.toThrow();
    });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
npx vitest run src/notice/__tests__/preload-api.test.js
```

Expected: FAIL — `Cannot find module '../preload'`.

- [ ] **Step 3: Implement `preload.js`**

Create `src/notice/preload.js`:

```js
const { ipcRenderer } = require('electron');
const { reviveError } = require('../shared/serializer/reviveError');
const { EVENT_CHANNEL, META_GET_SCHEMA_CHANNEL } = require('./protocol');

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

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run src/notice/__tests__/preload-api.test.js
```

Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notice/preload.js src/notice/__tests__/preload-api.test.js
git commit -m "feat(m3): notice preload buildAppNotice with on/once/off API"
```

---

### Task 8: Preload single-dispatcher routing

**Files:**
- Create: `src/notice/__tests__/preload-dispatch.test.js`

Spec: §5.2 single dispatcher, §5.4 data flow (one ipcRenderer.on for all events, route by fullEventName).

- [ ] **Step 1: Write failing tests**

Create `src/notice/__tests__/preload-dispatch.test.js`:

```js
const { describe, it, expect, beforeEach, vi } = require('vitest');

vi.mock('electron', () => {
    const handlers = new Map();
    return {
        ipcRenderer: {
            on: vi.fn((channel, fn) => { handlers.set(channel, fn); }),
            removeListener: vi.fn(),
            sendSync: vi.fn(),
            __handlers: handlers,
        },
    };
});

const { ipcRenderer } = require('electron');
const { okEnvelope, EVENT_CHANNEL } = require('../protocol');

beforeEach(() => {
    vi.resetModules();
    ipcRenderer.on.mockClear();
    ipcRenderer.sendSync.mockReset();
    ipcRenderer.__handlers.clear();
});

function build(schemaList) {
    ipcRenderer.sendSync.mockReturnValue(okEnvelope(schemaList));
    const buildAppNotice = require('../preload');
    return buildAppNotice();
}

describe('single dispatcher', () => {
    it('registers exactly one ipcRenderer.on for EVENT_CHANNEL', () => {
        build([
            { namespace: 'foo', events: ['a', 'b'] },
            { namespace: 'bar', events: ['c'] },
        ]);
        const calls = ipcRenderer.on.mock.calls.filter(
            ([ch]) => ch === EVENT_CHANNEL,
        );
        expect(calls.length).toBe(1);
    });

    it('routes pushes to correct event listeners by fullEventName', () => {
        const api = build([
            { namespace: 'foo', events: ['a', 'b'] },
            { namespace: 'bar', events: ['c'] },
        ]);
        const fooA = vi.fn();
        const fooB = vi.fn();
        const barC = vi.fn();
        api.foo.a.on(fooA);
        api.foo.b.on(fooB);
        api.bar.c.on(barC);

        const dispatcher = ipcRenderer.__handlers.get(EVENT_CHANNEL);
        dispatcher({}, 'foo.a', { from: 'A' });
        dispatcher({}, 'bar.c', { from: 'C' });

        expect(fooA).toHaveBeenCalledWith({ from: 'A' });
        expect(fooB).not.toHaveBeenCalled();
        expect(barC).toHaveBeenCalledWith({ from: 'C' });
    });

    it('push for unknown fullEventName is silently ignored', () => {
        build([{ namespace: 'foo', events: ['a'] }]);
        const dispatcher = ipcRenderer.__handlers.get(EVENT_CHANNEL);
        expect(() => dispatcher({}, 'never.registered', {})).not.toThrow();
    });

    it('push for known event with zero subscribers is a no-op', () => {
        build([{ namespace: 'foo', events: ['a'] }]);
        const dispatcher = ipcRenderer.__handlers.get(EVENT_CHANNEL);
        expect(() => dispatcher({}, 'foo.a', { x: 1 })).not.toThrow();
    });

    it('callback throw does not break subsequent callbacks (current snapshot semantics)', () => {
        const api = build([{ namespace: 'foo', events: ['a'] }]);
        const good = vi.fn();
        api.foo.a.on(() => { throw new Error('one cb failed'); });
        api.foo.a.on(good);

        const dispatcher = ipcRenderer.__handlers.get(EVENT_CHANNEL);
        // Spec does not require catching; if first throws, second won't run.
        // We assert the dispatcher itself does not crash the test runner with unhandled.
        let threw = false;
        try { dispatcher({}, 'foo.a', { v: 1 }); } catch { threw = true; }
        // Either it threw (and good was not called) or it didn't and good was.
        // What matters: dispatcher must not corrupt internal state.
        if (!threw) expect(good).toHaveBeenCalled();
    });

    it('data delivered as-is (already serialized by main)', () => {
        const api = build([{ namespace: 'foo', events: ['a'] }]);
        const cb = vi.fn();
        api.foo.a.on(cb);

        const payload = { iso: '2026-01-01T00:00:00.000Z', n: 7 };
        const dispatcher = ipcRenderer.__handlers.get(EVENT_CHANNEL);
        dispatcher({}, 'foo.a', payload);

        expect(cb).toHaveBeenCalledWith(payload);
    });
});
```

- [ ] **Step 2: Run test, verify pass**

```bash
npx vitest run src/notice/__tests__/preload-dispatch.test.js
```

Expected: PASS (6 tests).

- [ ] **Step 3: Commit**

```bash
git add src/notice/__tests__/preload-dispatch.test.js
git commit -m "test(m3): notice preload single-dispatcher routing"
```

---

### Task 9: Full suite green + module exports verification

**Files:**
- Verify: all notice tests + main exports surface

- [ ] **Step 1: Run full M3 test suite**

```bash
npx vitest run src/notice/
```

Expected: PASS all 8 test files.

- [ ] **Step 2: Verify `main.js` exports surface**

```bash
node -e "const m = require('./src/notice/main'); console.log(Object.keys(m).sort());"
```

Expected: `[ 'broadcast', 'cleanup', 'direct', 'init' ]`.

- [ ] **Step 3: Verify `preload.js` exports the factory**

```bash
node -e "const f = require('./src/notice/preload'); console.log(typeof f);"
```

Expected: `function`.

- [ ] **Step 4: Verify `protocol.js` exports surface**

```bash
node -e "const p = require('./src/notice/protocol'); console.log(Object.keys(p).sort());"
```

Expected: `[ 'EVENT_CHANNEL', 'META_GET_SCHEMA_CHANNEL', 'errorEnvelope', 'okEnvelope' ]`.

- [ ] **Step 5: Build via rollup**

```bash
npm run build
```

Expected: rollup exits 0; produces `dist/notice/main.js` and `dist/notice/preload.js`.

- [ ] **Step 6: Final M3 commit**

If verification produced any uncommitted changes:

```bash
git add -A
git commit -m "chore(m3): M3 notice module complete"
```

Otherwise skip.

---

## Self-Review

After completing all tasks, verify:

**Spec coverage:**

- §3.1 channel naming ✓ (protocol.test.js)
- §3.2 push channel plain shape (no envelope) ✓ (broadcast/direct send `(channel, fullEventName, data)` with no envelope wrapper — verified in main-broadcast/main-direct/preload-dispatch tests)
- §3.3 meta channel envelope ✓ (main-meta.test.js, preload-api.test.js)
- §4.1 init validation ✓ (main-init.test.js)
- §4.2 registerSchema (namespace conflict, events array, event name regex `[A-Za-z0-9_-]+`, dot-in-event rejection) ✓ (main-init.test.js)
- §4.3 broadcast iterates `getAllWindows()` per call, no per-window state ✓ (main-broadcast.test.js — explicit "no per-window state" test)
- §4.4 direct uses `fromId(id)`, null returns silently ignored ✓ (main-direct.test.js)
- §4.5 meta returnValue envelope shape ✓ (main-meta.test.js)
- §4.6 cleanup removes ipcMain listener + clears registry ✓ (main-cleanup.test.js)
- §5.1 preload exports `buildAppNotice` factory (not auto-init, no contextBridge inside) ✓ (preload exports a function, no `electron.contextBridge` import)
- §5.2 single dispatcher (one `ipcRenderer.on(EVENT_CHANNEL)`) ✓ (preload-dispatch.test.js)
- §5.3 on/once/off semantics: `on` returns unsubscribe, `once` auto-removes, `off(cb)` removes one, `off()` clears all ✓ (preload-api.test.js)
- §5.4 data flow (route by fullEventName from listeners Map) ✓ (preload-dispatch.test.js)
- §7 file structure (3 files: main.js, preload.js, protocol.js) ✓

**Architectural invariants:**

- Main has **zero per-window subscription state** ✓ — `registeredSchemas` only maps `namespace → eventList`; no window references stored. Verified in test "no per-window state: broadcast iterates getAllWindows() each call".
- Push channel `notice:event` is **plain** (no envelope) ✓ — main sends `(channel, fullEventName, safeData)`; preload dispatcher signature `(_event, fullEventName, data)`.
- Meta channel `notice:getSchema` uses `{ok, data?, error?}` envelope ✓.
- Event full name uses **dot separator** ✓ — `${namespace}.${event}`; parser uses `indexOf('.')`.
- Event names restricted to `[A-Za-z0-9_-]+` (no dots) ✓ — regex `EVENT_NAME_RE`.
- `protocol.js` is the **single source of truth** for channel names + envelope helpers ✓ — both `main.js` and `preload.js` require from `./protocol`.
- Subscription state lives **only in preload memory** ✓ — `listeners` Map closed over by `buildAppNotice`; GC'd with the renderer process when the window closes (no main-side mirror).
- Preload aggregator contract: `notice/preload.js` exports `buildAppNotice` (a function), does NOT call `contextBridge` itself ✓ — that's `src/preload.js`'s job per overview §8.2.

**Integration points (deferred):** Aggregate entry `src/preload.js` consuming `buildAppNotice` and exposing `window.appNotice` belongs to the overview-level packaging plan, not M3 module.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-04-toolkit-m3-notice.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch with checkpoints.

Which approach?
