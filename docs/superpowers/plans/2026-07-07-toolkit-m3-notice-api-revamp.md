# Toolkit M3 Notice API 修订实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 M3 Notice 的渲染端 API 从 per-event（`ns.event.on(cb)`）改为 namespace 级（`ns.on('event', cb)`），主端 `broadcast/direct` 扩展为可变参数（rest args），并加严格校验（事件名声明 + cb 类型）。

**Architecture:** Preload 端两级 `listeners: Map<namespace, Map<event, Set<cb>>>`；`buildNamespaceApi` 为每个 namespace 生成共享的 `on/once/off`，事件名作首参；dispatcher 展开 args 数组 `cb(...args)`。主端 `broadcast/direct` 用 rest args 收集参数，`serializeForIpc(args)` 一次数组编码。旧 per-event API 完全移除，无双写。

**Tech Stack:** JavaScript (Node CommonJS)、Electron IPC、Vitest（`npm test` → `vitest run`）。

**参考 spec：** `docs/superpowers/specs/2026-06-03-toolkit-m3-notice-design.md`（已修订到目标形态）

---

## 文件结构

**修改：**
- `src/notice/preload.js` — 完全重写 `buildAppNotice`；新增 `buildNamespaceApi`；两级 listeners Map；dispatcher spread
- `src/notice/main.js` — `broadcast/direct` 签名扩展为 rest args；`serializeForIpc(args)` 一次数组编码
- `src/notice/protocol.js` — 仅文件顶部注释更新（`notice:event` 第三参语义："args 数组"）
- `tests/notice/preload-api.test.js` — 完全重写，覆盖新 namespace API + 严格校验 + off 三态
- `tests/notice/preload-dispatch.test.js` — dispatcher 传入 args 数组，回调 spread 展开
- `tests/notice/main-broadcast.test.js` — `send` 第三参断言改为数组；新增 rest args 场景
- `tests/notice/main-direct.test.js` — 同上

**不改：**
- `tests/notice/main-init.test.js` / `main-cleanup.test.js` / `main-meta.test.js` / `protocol.test.js`（schema 校验、元通道协议未变）
- `tests/preload-aggregator.test.js`（聚合入口协议未变）
- `src/capability/example/index.js`（仅声明 noticeSchema，不消费 appNotice）
- `src/notice/main.js` 的 `init/registerSchema/cleanup/元通道/validateNoticeSchema/assertRegistered/parseFullEventName`（不变）

---

## Task 1: Preload —— 完全重写为 namespace 级 API

**Files:**
- Modify: `tests/notice/preload-api.test.js`（完全替换）
- Modify: `tests/notice/preload-dispatch.test.js`（完全替换）
- Modify: `src/notice/preload.js`（完全替换）

- [ ] **Step 1: 完全替换 `tests/notice/preload-api.test.js`**

写入以下内容（覆盖旧文件）：

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function buildElectronMock() {
    const handlers = new Map();
    return {
        ipcRenderer: {
            on: vi.fn((channel, fn) => { handlers.set(channel, fn); }),
            removeListener: vi.fn(),
            sendSync: vi.fn(),
            __handlers: handlers,
        },
    };
}
const electronMock = buildElectronMock();
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
    id: electronPath, filename: electronPath, loaded: true,
    exports: electronMock, children: [], paths: [],
};

const { ipcRenderer } = electronMock;
const { META_GET_SCHEMA_CHANNEL } = require('../../src/notice/protocol');
const { okEnvelope, errorEnvelope } = require('../../src/shared/envelope');

const preloadPath = require.resolve('../../src/notice/preload');

beforeEach(() => {
    delete require.cache[preloadPath];
    ipcRenderer.on.mockClear();
    ipcRenderer.sendSync.mockReset();
    ipcRenderer.removeListener.mockClear();
    ipcRenderer.__handlers.clear();
});

function loadBuilder() {
    return require('../../src/notice/preload');
}

function build(schemaList) {
    ipcRenderer.sendSync.mockReturnValue(okEnvelope(schemaList));
    return loadBuilder()();
}

describe('buildAppNotice: factory output shape', () => {
    it('returns object keyed by namespace, each with on/once/off methods', () => {
        const api = build([
            { namespace: 'foo', events: ['userLoggedIn', 'dataReady'] },
            { namespace: 'bar', events: ['ping'] },
        ]);
        expect(typeof api.foo).toBe('object');
        expect(typeof api.foo.on).toBe('function');
        expect(typeof api.foo.once).toBe('function');
        expect(typeof api.foo.off).toBe('function');
        expect(typeof api.bar.on).toBe('function');
        // Per-event sub-objects must not exist
        expect(api.foo.userLoggedIn).toBeUndefined();
        expect(api.bar.ping).toBeUndefined();
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
        expect(() => loadBuilder()()).toThrow(/meta failed/);
    });

    it('empty schema list yields empty api object', () => {
        ipcRenderer.sendSync.mockReturnValue(okEnvelope([]));
        expect(loadBuilder()()).toEqual({});
    });
});

describe('on: subscribe and unsubscribe', () => {
    it('on returns a function that removes the subscription', () => {
        const api = build([{ namespace: 'foo', events: ['evA'] }]);
        const cb = vi.fn();
        const off = api.foo.on('evA', cb);

        const dispatcher = ipcRenderer.__handlers.get('notice:event');
        dispatcher({}, 'foo.evA', [{ x: 1 }]);
        expect(cb).toHaveBeenCalledWith({ x: 1 });

        off();
        dispatcher({}, 'foo.evA', [{ x: 2 }]);
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('multiple on subscriptions all fire', () => {
        const api = build([{ namespace: 'foo', events: ['evA'] }]);
        const a = vi.fn();
        const b = vi.fn();
        api.foo.on('evA', a);
        api.foo.on('evA', b);

        const dispatcher = ipcRenderer.__handlers.get('notice:event');
        dispatcher({}, 'foo.evA', [{ v: 1 }]);
        expect(a).toHaveBeenCalledWith({ v: 1 });
        expect(b).toHaveBeenCalledWith({ v: 1 });
    });
});

describe('once: auto-unsubscribes', () => {
    it('once fires exactly one time', () => {
        const api = build([{ namespace: 'foo', events: ['evA'] }]);
        const cb = vi.fn();
        api.foo.once('evA', cb);

        const dispatcher = ipcRenderer.__handlers.get('notice:event');
        dispatcher({}, 'foo.evA', [{ n: 1 }]);
        dispatcher({}, 'foo.evA', [{ n: 2 }]);

        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith({ n: 1 });
    });

    it('once returns unsubscribe that prevents firing if called before push', () => {
        const api = build([{ namespace: 'foo', events: ['evA'] }]);
        const cb = vi.fn();
        const off = api.foo.once('evA', cb);
        off();

        const dispatcher = ipcRenderer.__handlers.get('notice:event');
        dispatcher({}, 'foo.evA', [{ n: 1 }]);
        expect(cb).not.toHaveBeenCalled();
    });
});

describe('off: three-mode semantics', () => {
    it('off(eventName, cb) removes only that callback', () => {
        const api = build([{ namespace: 'foo', events: ['evA'] }]);
        const a = vi.fn();
        const b = vi.fn();
        api.foo.on('evA', a);
        api.foo.on('evA', b);
        api.foo.off('evA', a);

        const dispatcher = ipcRenderer.__handlers.get('notice:event');
        dispatcher({}, 'foo.evA', [{ v: 1 }]);
        expect(a).not.toHaveBeenCalled();
        expect(b).toHaveBeenCalledWith({ v: 1 });
    });

    it('off(eventName) clears all subscriptions for that event', () => {
        const api = build([{ namespace: 'foo', events: ['evA', 'evB'] }]);
        const a = vi.fn();
        const b = vi.fn();
        const c = vi.fn();
        api.foo.on('evA', a);
        api.foo.on('evA', b);
        api.foo.on('evB', c);
        api.foo.off('evA');

        const dispatcher = ipcRenderer.__handlers.get('notice:event');
        dispatcher({}, 'foo.evA', [{ v: 1 }]);
        dispatcher({}, 'foo.evB', [{ v: 2 }]);
        expect(a).not.toHaveBeenCalled();
        expect(b).not.toHaveBeenCalled();
        expect(c).toHaveBeenCalledWith({ v: 2 });
    });

    it('off() with no args clears the entire namespace', () => {
        const api = build([{ namespace: 'foo', events: ['evA', 'evB'] }]);
        const a = vi.fn();
        const b = vi.fn();
        api.foo.on('evA', a);
        api.foo.on('evB', b);
        api.foo.off();

        const dispatcher = ipcRenderer.__handlers.get('notice:event');
        dispatcher({}, 'foo.evA', [{ v: 1 }]);
        dispatcher({}, 'foo.evB', [{ v: 2 }]);
        expect(a).not.toHaveBeenCalled();
        expect(b).not.toHaveBeenCalled();
    });

    it('off(eventName, unknownCb) is a no-op (no throw)', () => {
        const api = build([{ namespace: 'foo', events: ['evA'] }]);
        expect(() => api.foo.off('evA', () => {})).not.toThrow();
    });

    it('off() does not affect other namespaces', () => {
        const api = build([
            { namespace: 'foo', events: ['evA'] },
            { namespace: 'bar', events: ['evB'] },
        ]);
        const a = vi.fn();
        const b = vi.fn();
        api.foo.on('evA', a);
        api.bar.on('evB', b);
        api.foo.off();

        const dispatcher = ipcRenderer.__handlers.get('notice:event');
        dispatcher({}, 'foo.evA', [{ v: 1 }]);
        dispatcher({}, 'bar.evB', [{ v: 2 }]);
        expect(a).not.toHaveBeenCalled();
        expect(b).toHaveBeenCalledWith({ v: 2 });
    });
});

describe('strict event-name validation', () => {
    it('on throws when event is not declared in schema', () => {
        const api = build([{ namespace: 'foo', events: ['evA'] }]);
        expect(() => api.foo.on('undeclared', () => {}))
            .toThrow(/Notice event "foo\.undeclared" not registered/);
    });

    it('once throws when event is not declared in schema', () => {
        const api = build([{ namespace: 'foo', events: ['evA'] }]);
        expect(() => api.foo.once('undeclared', () => {}))
            .toThrow(/Notice event "foo\.undeclared" not registered/);
    });

    it('off(eventName, ...) throws when event is not declared', () => {
        const api = build([{ namespace: 'foo', events: ['evA'] }]);
        expect(() => api.foo.off('undeclared'))
            .toThrow(/Notice event "foo\.undeclared" not registered/);
        expect(() => api.foo.off('undeclared', () => {}))
            .toThrow(/Notice event "foo\.undeclared" not registered/);
    });

    it('off() with no args does NOT throw even if namespace has no subscriptions', () => {
        const api = build([{ namespace: 'foo', events: ['evA'] }]);
        expect(() => api.foo.off()).not.toThrow();
    });
});

describe('strict callback-type validation', () => {
    it('on throws when cb is not a function', () => {
        const api = build([{ namespace: 'foo', events: ['evA'] }]);
        expect(() => api.foo.on('evA', 'not-a-fn'))
            .toThrow(/Notice foo\.on callback must be a function/);
        expect(() => api.foo.on('evA', null))
            .toThrow(/Notice foo\.on callback must be a function/);
        expect(() => api.foo.on('evA', undefined))
            .toThrow(/Notice foo\.on callback must be a function/);
    });

    it('once throws when cb is not a function', () => {
        const api = build([{ namespace: 'foo', events: ['evA'] }]);
        expect(() => api.foo.once('evA', 42))
            .toThrow(/Notice foo\.once callback must be a function/);
    });

    it('off(eventName, cb) throws when cb is provided but not a function', () => {
        const api = build([{ namespace: 'foo', events: ['evA'] }]);
        expect(() => api.foo.off('evA', 'not-a-fn'))
            .toThrow(/Notice foo\.off callback must be a function/);
    });

    it('assertEvent runs before assertFn (event-name error takes precedence)', () => {
        const api = build([{ namespace: 'foo', events: ['evA'] }]);
        // Undeclared event + non-function cb → event-name error wins
        expect(() => api.foo.on('undeclared', 'not-a-fn'))
            .toThrow(/not registered/);
    });
});
```

- [ ] **Step 2: 完全替换 `tests/notice/preload-dispatch.test.js`**

写入以下内容（覆盖旧文件）：

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function buildElectronMock() {
    const handlers = new Map();
    return {
        ipcRenderer: {
            on: vi.fn((channel, fn) => { handlers.set(channel, fn); }),
            removeListener: vi.fn(),
            sendSync: vi.fn(),
            __handlers: handlers,
        },
    };
}
const electronMock = buildElectronMock();
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
    id: electronPath, filename: electronPath, loaded: true,
    exports: electronMock, children: [], paths: [],
};

const { ipcRenderer } = electronMock;
const { EVENT_CHANNEL } = require('../../src/notice/protocol');
const { okEnvelope } = require('../../src/shared/envelope');

const preloadPath = require.resolve('../../src/notice/preload');

beforeEach(() => {
    delete require.cache[preloadPath];
    ipcRenderer.on.mockClear();
    ipcRenderer.sendSync.mockReset();
    ipcRenderer.__handlers.clear();
});

function build(schemaList) {
    ipcRenderer.sendSync.mockReturnValue(okEnvelope(schemaList));
    const buildAppNotice = require('../../src/notice/preload');
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
        api.foo.on('a', fooA);
        api.foo.on('b', fooB);
        api.bar.on('c', barC);

        const dispatcher = ipcRenderer.__handlers.get(EVENT_CHANNEL);
        dispatcher({}, 'foo.a', [{ from: 'A' }]);
        dispatcher({}, 'bar.c', [{ from: 'C' }]);

        expect(fooA).toHaveBeenCalledWith({ from: 'A' });
        expect(fooB).not.toHaveBeenCalled();
        expect(barC).toHaveBeenCalledWith({ from: 'C' });
    });

    it('push for unknown fullEventName is silently ignored', () => {
        build([{ namespace: 'foo', events: ['a'] }]);
        const dispatcher = ipcRenderer.__handlers.get(EVENT_CHANNEL);
        expect(() => dispatcher({}, 'never.registered', [])).not.toThrow();
    });

    it('push for known event with zero subscribers is a no-op', () => {
        build([{ namespace: 'foo', events: ['a'] }]);
        const dispatcher = ipcRenderer.__handlers.get(EVENT_CHANNEL);
        expect(() => dispatcher({}, 'foo.a', [{ x: 1 }])).not.toThrow();
    });

    it('malformed fullEventName (no dot) is silently ignored', () => {
        build([{ namespace: 'foo', events: ['a'] }]);
        const dispatcher = ipcRenderer.__handlers.get(EVENT_CHANNEL);
        expect(() => dispatcher({}, 'nodothere', [])).not.toThrow();
    });

    it('spreads args array to callback (multi-arg push)', () => {
        const api = build([{ namespace: 'foo', events: ['a'] }]);
        const cb = vi.fn();
        api.foo.on('a', cb);

        const dispatcher = ipcRenderer.__handlers.get(EVENT_CHANNEL);
        dispatcher({}, 'foo.a', [1, 'x', { k: 1 }]);

        expect(cb).toHaveBeenCalledWith(1, 'x', { k: 1 });
    });

    it('zero-arg push invokes callback with no args', () => {
        const api = build([{ namespace: 'foo', events: ['tick'] }]);
        const cb = vi.fn();
        api.foo.on('tick', cb);

        const dispatcher = ipcRenderer.__handlers.get(EVENT_CHANNEL);
        dispatcher({}, 'foo.tick', []);

        expect(cb).toHaveBeenCalledWith();
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('single-arg push invokes callback with one arg (backward-compatible shape)', () => {
        const api = build([{ namespace: 'foo', events: ['a'] }]);
        const cb = vi.fn();
        api.foo.on('a', cb);

        const payload = { iso: '2026-01-01T00:00:00.000Z', n: 7 };
        const dispatcher = ipcRenderer.__handlers.get(EVENT_CHANNEL);
        dispatcher({}, 'foo.a', [payload]);

        expect(cb).toHaveBeenCalledWith(payload);
    });

    it('snapshot iteration: once wrapper mutating the set does not break dispatch', () => {
        const api = build([{ namespace: 'foo', events: ['a'] }]);
        const onceCb = vi.fn();
        const onCb = vi.fn();
        api.foo.once('a', onceCb);
        api.foo.on('a', onCb);

        const dispatcher = ipcRenderer.__handlers.get(EVENT_CHANNEL);
        dispatcher({}, 'foo.a', [{ v: 1 }]);
        expect(onceCb).toHaveBeenCalledTimes(1);
        expect(onCb).toHaveBeenCalledWith({ v: 1 });
    });
});
```

- [ ] **Step 3: 运行 preload 测试确认全红**

Run: `npx vitest run tests/notice/preload-api.test.js tests/notice/preload-dispatch.test.js`
Expected: 大量测试失败（旧 preload.js 未实现新 API；`api.foo.on` 不是函数，`api.foo.userLoggedIn` 仍存在等）

- [ ] **Step 4: 完全重写 `src/notice/preload.js`**

写入以下内容（覆盖旧文件）：

```javascript
const { ipcRenderer } = require('electron');
const { reviveError } = require('../shared/serializer/reviveError');
const { EVENT_CHANNEL, META_GET_SCHEMA_CHANNEL } = require('./protocol');

function buildNamespaceApi(namespace, eventSet, listeners) {
    const assertEvent = eventName => {
        if (!eventSet.has(eventName)) {
            throw new Error(`Notice event "${namespace}.${eventName}" not registered`);
        }
    };
    const assertFn = (cb, api) => {
        if (typeof cb !== 'function') {
            throw new Error(`Notice ${namespace}.${api} callback must be a function`);
        }
    };
    const ensureSet = eventName => {
        let byEvent = listeners.get(namespace);
        if (!byEvent) { byEvent = new Map(); listeners.set(namespace, byEvent); }
        let cbs = byEvent.get(eventName);
        if (!cbs) { cbs = new Set(); byEvent.set(eventName, cbs); }
        return cbs;
    };
    const unsubscribe = (eventName, cb) => {
        const byEvent = listeners.get(namespace);
        if (!byEvent) return;
        const cbs = byEvent.get(eventName);
        if (!cbs) return;
        cbs.delete(cb);
        if (cbs.size === 0) byEvent.delete(eventName);
        if (byEvent.size === 0) listeners.delete(namespace);
    };

    return {
        on(eventName, cb) {
            assertEvent(eventName);
            assertFn(cb, 'on');
            ensureSet(eventName).add(cb);
            return () => unsubscribe(eventName, cb);
        },
        once(eventName, cb) {
            assertEvent(eventName);
            assertFn(cb, 'once');
            const wrapper = (...args) => {
                unsubscribe(eventName, wrapper);
                cb(...args);
            };
            ensureSet(eventName).add(wrapper);
            return () => unsubscribe(eventName, wrapper);
        },
        off(eventName, cb) {
            if (eventName === undefined) {
                listeners.delete(namespace);
                return;
            }
            assertEvent(eventName);
            if (cb === undefined) {
                const byEvent = listeners.get(namespace);
                if (byEvent) {
                    byEvent.delete(eventName);
                    if (byEvent.size === 0) listeners.delete(namespace);
                }
                return;
            }
            assertFn(cb, 'off');
            unsubscribe(eventName, cb);
        },
    };
}

/**
 * 构建渲染端 appNotice API。preload 加载时调用一次。
 *
 * 返回形态：{ [namespace]: { on(eventName, cb), once(eventName, cb), off(eventName?, cb?) } }
 *
 * 详见架构 §3.5（preload 一次性 init 与 opt-out 契约）与 M3 spec §5.2 / §5.3。
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
    const appNotice = {};

    for (const { namespace, events } of schemaList) {
        const eventSet = new Set(events);
        appNotice[namespace] = buildNamespaceApi(namespace, eventSet, listeners);
    }

    ipcRenderer.on(EVENT_CHANNEL, (_event, fullEventName, args) => {
        if (typeof fullEventName !== 'string') return;
        const idx = fullEventName.indexOf('.');
        if (idx <= 0) return;
        const namespace = fullEventName.slice(0, idx);
        const eventName = fullEventName.slice(idx + 1);
        const byEvent = listeners.get(namespace);
        if (!byEvent) return;
        const cbs = byEvent.get(eventName);
        if (!cbs) return;
        // Snapshot：once-wrappers 触发时会 mutate cbs，避免迭代破坏
        const argsArray = Array.isArray(args) ? args : [];
        for (const cb of [...cbs]) cb(...argsArray);
    });

    return appNotice;
}

module.exports = buildAppNotice;
```

- [ ] **Step 5: 运行 preload 测试确认全绿**

Run: `npx vitest run tests/notice/preload-api.test.js tests/notice/preload-dispatch.test.js`
Expected: 全部 PASS

- [ ] **Step 6: 运行全部测试确认无回归**

Run: `npm test`
Expected: 除了尚未改动的 `main-broadcast.test.js` 与 `main-direct.test.js` 中"send 第三参断言收到单 data"的 3-5 个用例失败外，其余全绿。这些失败会在 Task 2/3 修复。

如果有除上述之外的失败，回到 Step 4 检查实现。

- [ ] **Step 7: Commit**

```bash
git add tests/notice/preload-api.test.js tests/notice/preload-dispatch.test.js src/notice/preload.js
git commit -m "refactor(m3): rewrite Notice preload to namespace-level on/once/off + strict validation

- appNotice[ns] now exposes shared on/once/off; eventName is first argument
- Two-level listeners Map<namespace, Map<eventName, Set<cb>>> supports off() clearing entire namespace
- dispatcher spreads args array to callback (cb(...args))
- Strict validation: undeclared eventName throws; non-function cb throws
- off() three modes: (eventName, cb) precise / (eventName) clear event / () clear namespace
- Removes per-event API (appNotice[ns][event].on/once/off)
"
```

---

## Task 2: Main —— broadcast rest args

**Files:**
- Modify: `tests/notice/main-broadcast.test.js`
- Modify: `src/notice/main.js`（仅 `broadcast` 函数）

- [ ] **Step 1: 修改 `tests/notice/main-broadcast.test.js`**

打开该文件，做以下修改：

**替换 "sends to every window from getAllWindows" 用例**（原第 64-81 行）为：

```javascript
    it('sends args as array to every window from getAllWindows', () => {
        const w1 = makeWin();
        const w2 = makeWin();
        BrowserWindow.getAllWindows.mockReturnValue([w1, w2]);

        Notice.broadcast('foo.evA', { user: 123 });

        expect(w1.webContents.send).toHaveBeenCalledWith(
            EVENT_CHANNEL,
            'foo.evA',
            [{ user: 123 }],
        );
        expect(w2.webContents.send).toHaveBeenCalledWith(
            EVENT_CHANNEL,
            'foo.evA',
            [{ user: 123 }],
        );
    });
```

**替换 "payload passes through serialize" 用例**（原第 88-97 行）为：

```javascript
    it('args pass through serialize (function stripped to placeholder)', () => {
        const w1 = makeWin();
        BrowserWindow.getAllWindows.mockReturnValue([w1]);

        Notice.broadcast('foo.evA', { cb: function named() {}, ok: true });

        const sentArgs = w1.webContents.send.mock.calls[0][2];
        expect(Array.isArray(sentArgs)).toBe(true);
        expect(sentArgs.length).toBe(1);
        expect(sentArgs[0].ok).toBe(true);
        expect(sentArgs[0].cb).toBe('[Function: named]');
    });
```

**替换 "no per-window state" 用例**（原第 99-111 行）为：

```javascript
    it('no per-window state: broadcast iterates getAllWindows() each call', () => {
        const w1 = makeWin();
        BrowserWindow.getAllWindows.mockReturnValueOnce([w1]);
        Notice.broadcast('foo.evA', { n: 1 });

        const w2 = makeWin();
        BrowserWindow.getAllWindows.mockReturnValueOnce([w2]);
        Notice.broadcast('foo.evA', { n: 2 });

        expect(w1.webContents.send).toHaveBeenCalledWith(EVENT_CHANNEL, 'foo.evA', [{ n: 1 }]);
        expect(w2.webContents.send).toHaveBeenCalledWith(EVENT_CHANNEL, 'foo.evA', [{ n: 2 }]);
        expect(BrowserWindow.getAllWindows).toHaveBeenCalledTimes(2);
    });
```

**在 "broadcast: delivery" describe 块的末尾追加以下三个新用例**（`});` 之前）：

```javascript
    it('accepts multiple args (rest params) and sends them as an array', () => {
        const w1 = makeWin();
        BrowserWindow.getAllWindows.mockReturnValue([w1]);

        Notice.broadcast('foo.evA', 0.42, 'downloading', { eta: 12 });

        expect(w1.webContents.send).toHaveBeenCalledWith(
            EVENT_CHANNEL,
            'foo.evA',
            [0.42, 'downloading', { eta: 12 }],
        );
    });

    it('accepts zero args (pure notification) and sends an empty array', () => {
        const w1 = makeWin();
        BrowserWindow.getAllWindows.mockReturnValue([w1]);

        Notice.broadcast('foo.evA');

        expect(w1.webContents.send).toHaveBeenCalledWith(
            EVENT_CHANNEL,
            'foo.evA',
            [],
        );
    });

    it('single-arg call still wraps in array of length 1', () => {
        const w1 = makeWin();
        BrowserWindow.getAllWindows.mockReturnValue([w1]);

        Notice.broadcast('foo.evA', 'single');

        expect(w1.webContents.send).toHaveBeenCalledWith(
            EVENT_CHANNEL,
            'foo.evA',
            ['single'],
        );
    });
```

- [ ] **Step 2: 运行 broadcast 测试确认失败**

Run: `npx vitest run tests/notice/main-broadcast.test.js`
Expected: 至少 3 个用例失败（现有 `broadcast` 传单 data，非数组）

- [ ] **Step 3: 修改 `src/notice/main.js` 的 `broadcast` 函数**

定位现有 `broadcast` 函数（原实现）：

```javascript
function broadcast(fullEventName, data) {
    assertRegistered(fullEventName);
    const safeData = serializeForIpc(data);
    for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(EVENT_CHANNEL, fullEventName, safeData);
    }
}
```

替换为：

```javascript
/**
 * 推送事件到所有窗口。
 *
 * @param {string} fullEventName 形如 "namespace.event"
 * @param {...*} args 推送 payload 参数（任意个，含零个）；整体经 serializeForIpc 编码为数组后发送
 * @throws {Error} 事件未注册抛错
 */
function broadcast(fullEventName, ...args) {
    assertRegistered(fullEventName);
    const safeArgs = serializeForIpc(args);
    for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(EVENT_CHANNEL, fullEventName, safeArgs);
    }
}
```

- [ ] **Step 4: 运行 broadcast 测试确认通过**

Run: `npx vitest run tests/notice/main-broadcast.test.js`
Expected: 全部 PASS

- [ ] **Step 5: 全测无回归**

Run: `npm test`
Expected: 除了尚未改动的 `main-direct.test.js` 中"send 第三参断言收到单 data"的 2-3 个用例失败外，其余全绿。

- [ ] **Step 6: Commit**

```bash
git add tests/notice/main-broadcast.test.js src/notice/main.js
git commit -m "refactor(m3): Notice.broadcast accepts rest args, encoded as array

- broadcast(fullEvent, ...args) collects any number of payload arguments
- serializeForIpc(args) encodes the whole array in one call
- IPC third parameter is always an array (empty for zero-arg calls)
"
```

---

## Task 3: Main —— direct rest args

**Files:**
- Modify: `tests/notice/main-direct.test.js`
- Modify: `src/notice/main.js`（仅 `direct` 函数）

- [ ] **Step 1: 修改 `tests/notice/main-direct.test.js`**

打开该文件，做以下修改：

**替换 "sends to the window returned by fromId(windowId)" 用例**（原第 47-59 行）为：

```javascript
    it('sends args as array to the window returned by fromId(windowId)', () => {
        const w = makeWin();
        BrowserWindow.fromId.mockImplementation(id => (id === 42 ? w : null));

        Notice.direct('foo.evA', 42, { hello: 'world' });

        expect(BrowserWindow.fromId).toHaveBeenCalledWith(42);
        expect(w.webContents.send).toHaveBeenCalledWith(
            EVENT_CHANNEL,
            'foo.evA',
            [{ hello: 'world' }],
        );
    });
```

**替换 "payload passes through serialize" 用例**（原第 73-82 行）为：

```javascript
    it('args pass through serialize', () => {
        const w = makeWin();
        BrowserWindow.fromId.mockReturnValue(w);

        Notice.direct('foo.evA', 1, { d: new Date('2026-01-01T00:00:00.000Z'), n: 5 });

        const sentArgs = w.webContents.send.mock.calls[0][2];
        expect(Array.isArray(sentArgs)).toBe(true);
        expect(sentArgs.length).toBe(1);
        expect(sentArgs[0].d).toBe('2026-01-01T00:00:00.000Z');
        expect(sentArgs[0].n).toBe(5);
    });
```

**在 `describe('direct', ...)` 块末尾追加以下三个新用例**（`});` 之前）：

```javascript
    it('accepts multiple args (rest params) and sends them as an array', () => {
        const w = makeWin();
        BrowserWindow.fromId.mockReturnValue(w);

        Notice.direct('foo.evA', 7, 'chunk-a', 42, { done: false });

        expect(w.webContents.send).toHaveBeenCalledWith(
            EVENT_CHANNEL,
            'foo.evA',
            ['chunk-a', 42, { done: false }],
        );
    });

    it('accepts zero args (pure notification) and sends an empty array', () => {
        const w = makeWin();
        BrowserWindow.fromId.mockReturnValue(w);

        Notice.direct('foo.evA', 7);

        expect(w.webContents.send).toHaveBeenCalledWith(
            EVENT_CHANNEL,
            'foo.evA',
            [],
        );
    });

    it('does not throw when window is null even with zero args', () => {
        BrowserWindow.fromId.mockReturnValue(null);
        expect(() => Notice.direct('foo.evA', 999)).not.toThrow();
    });
```

- [ ] **Step 2: 运行 direct 测试确认失败**

Run: `npx vitest run tests/notice/main-direct.test.js`
Expected: 至少 3 个用例失败（现有 `direct` 传单 data，非数组）

- [ ] **Step 3: 修改 `src/notice/main.js` 的 `direct` 函数**

定位现有 `direct` 函数（原实现）：

```javascript
function direct(fullEventName, windowId, data) {
    assertRegistered(fullEventName);
    const win = BrowserWindow.fromId(windowId);
    if (!win) return;
    const safeData = serializeForIpc(data);
    win.webContents.send(EVENT_CHANNEL, fullEventName, safeData);
}
```

替换为：

```javascript
/**
 * 推送事件到指定窗口。窗口不存在则静默忽略。
 *
 * @param {string} fullEventName 形如 "namespace.event"
 * @param {number} windowId BrowserWindow.id
 * @param {...*} args 推送 payload 参数（任意个，含零个）；整体经 serializeForIpc 编码为数组后发送
 * @throws {Error} 事件未注册抛错
 */
function direct(fullEventName, windowId, ...args) {
    assertRegistered(fullEventName);
    const win = BrowserWindow.fromId(windowId);
    if (!win) return;
    const safeArgs = serializeForIpc(args);
    win.webContents.send(EVENT_CHANNEL, fullEventName, safeArgs);
}
```

- [ ] **Step 4: 运行 direct 测试确认通过**

Run: `npx vitest run tests/notice/main-direct.test.js`
Expected: 全部 PASS

- [ ] **Step 5: 全测无回归**

Run: `npm test`
Expected: 全部 PASS。

如仍有失败，回到失败用例定位问题。

- [ ] **Step 6: Commit**

```bash
git add tests/notice/main-direct.test.js src/notice/main.js
git commit -m "refactor(m3): Notice.direct accepts rest args, encoded as array

- direct(fullEvent, windowId, ...args) collects any number of payload arguments
- serializeForIpc(args) encodes the whole array in one call
- IPC third parameter is always an array (empty for zero-arg calls)
"
```

---

## Task 4: 收尾 —— protocol.js 注释与相关文档校对

**Files:**
- Modify: `src/notice/protocol.js`（仅顶部注释）
- Check（可能 modify）: `docs/superpowers/specs/2026-06-03-toolkit-m5-capability-contract-design.md`

- [ ] **Step 1: 修改 `src/notice/protocol.js` 顶部注释**

打开文件，找到顶部注释块：

```javascript
/**
 * Notice 模块私有协议：channel 命名。
 * envelope 定义已上收到 shared/envelope（详见架构 §7.1 / §7.7）。
 */
```

替换为：

```javascript
/**
 * Notice 模块私有协议：channel 命名。
 * envelope 定义已上收到 shared/envelope（详见架构 §7.1 / §7.7）。
 *
 * EVENT_CHANNEL 载荷契约（webContents.send / ipcRenderer.on 参数）：
 *   (channel, fullEventName, argsArray)
 *   - fullEventName: `${namespace}.${eventName}`
 *   - argsArray: 已经 serializeForIpc 编码的参数数组（可能为空数组）；渲染端 dispatcher cb(...argsArray) 展开
 *
 * META_GET_SCHEMA_CHANNEL 载荷契约详见 M3 spec §3.3。
 */
```

- [ ] **Step 2: 检查 M5 spec 中的 appNotice 示例**

Run: `grep -n "appNotice" docs/superpowers/specs/2026-06-03-toolkit-m5-capability-contract-design.md`
Expected: 列出所有匹配行号。

如果有类似 `appNotice.example.tick.on(cb)` 的旧 API 引用，用 Edit 改成 `appNotice.example.on('tick', cb)`。如果只是文本提到 "appNotice" 而不涉及 API 形态，跳过。

**判断标准**：只要示例代码里出现旧 per-event 形态（`ns.event.on/once/off` 属性链），必须改；文本描述性提及（如"经 appNotice 暴露"）不改。

- [ ] **Step 3: 运行全测确认无回归**

Run: `npm test`
Expected: 全部 PASS。

- [ ] **Step 4: Commit**

```bash
git add src/notice/protocol.js docs/superpowers/specs/
git commit -m "docs(m3): update protocol.js IPC payload comment; sync M5 spec appNotice examples"
```

（如 M5 spec 无改动，则 `git add` 中只留 `src/notice/protocol.js`。）

---

## 自审检查清单

**Spec coverage：**
- §2.2 主端 broadcast/direct rest args → Task 2 / Task 3 ✓
- §2.4 渲染端 namespace 级 on/once/off + 严格校验 + off 三态 → Task 1 ✓
- §3.2 IPC payload 语义（args 数组）→ Task 1（preload）+ Task 2/3（main）+ Task 4（protocol 注释）✓
- §4.3/4.4 broadcast/direct 实现 → Task 2 / Task 3 ✓
- §5.2/5.3 buildAppNotice/buildNamespaceApi → Task 1 ✓
- §5.4 数据流 → 已由 Task 1 + Task 2/3 联合体现 ✓
- §6.1 对外接口 → 由 Task 1/2/3 实现落实 ✓
- §7.1 各文件职责（含 `assertRegistered`、`buildNamespaceApi`、两级 Map）→ Task 1 / 已在 main.js 存在 ✓

**Placeholder scan：** 无 TBD / TODO。所有代码块内容完整。

**Type consistency：**
- `buildNamespaceApi` 签名 `(namespace, eventSet, listeners)` — Task 1 定义与调用一致
- `assertEvent` / `assertFn` / `ensureSet` / `unsubscribe` — 内部闭包，Task 1 单文件内自洽
- `broadcast(fullEventName, ...args)` / `direct(fullEventName, windowId, ...args)` — Task 2 / Task 3 签名一致
- `serializeForIpc(args)` 编码整个数组 — main.js 与 preload.js dispatcher 对称一致
- 错误消息：`Notice event "..." not registered` / `Notice <ns>.<api> callback must be a function` — 测试断言与实现文本一致
