const { ipcRenderer } = require('electron');
const { reviveError } = require('../shared/serializer/reviveError');
const { requestMetaSync } = require('../shared/metaChannel');
const { EVENT_CHANNEL, META_GET_SCHEMA_CHANNEL } = require('./protocol');

// 顶层保留字：与 subscribe/unsubscribe/once 顶层语法糖共享同一命名空间字典
// 键。若某 schema 用了同名 namespace，构建时抛错以避免顶层方法被覆盖。
const TOP_LEVEL_KEYS = new Set(['subscribe', 'unsubscribe', 'once']);

function parseFullEventName(fullEventName) {
    if (typeof fullEventName !== 'string') {
        throw new Error('Notice fullEventName must be a string');
    }
    const idx = fullEventName.indexOf('.');
    if (idx <= 0 || idx === fullEventName.length - 1) {
        throw new Error(
            `Notice fullEventName "${fullEventName}" malformed (expected "ns.event")`,
        );
    }
    return {
        namespace: fullEventName.slice(0, idx),
        eventName: fullEventName.slice(idx + 1),
    };
}

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
 * 返回形态：
 * ```
 * {
 *   [namespace]: { on(eventName, cb), once(eventName, cb), off(eventName?, cb?) },
 *   subscribe(fullEventName, cb),      // 顶层语法糖：等价 [ns].on(event, cb)
 *   unsubscribe(fullEventName, cb?),   // 顶层语法糖：等价 [ns].off(event, cb?)
 *   once(fullEventName, cb),           // 顶层语法糖：等价 [ns].once(event, cb)
 * }
 * ```
 *
 * 顶层 subscribe/unsubscribe/once 与 [ns].on/off/once 共享同一订阅存储，任选一路
 * 注册的回调都能被同一 dispatcher 触发，可互相拆卸。namespace 名撞上顶层保留字
 * (subscribe/unsubscribe/once) 时构建抛错。
 *
 * **主进程未调用 `Notice.init`**：只保留顶层 subscribe / unsubscribe / once（调用即抛出说明原因的错误）
 * 并 `console.warn`，不抛错（不影响同一 preload 里的 appService 装配）。元通道请求会先阻塞到
 * 主进程 GC（见 `shared/metaChannel.js`），不需要 appNotice 时应在 preload 中 `init({ notice: false })`。
 *
 * @returns {Object} appNotice
 * @throws {Error} 主端返回失败信封时抛出 revived Error；
 *                 namespace 与顶层保留字冲突时抛错
 */
function buildAppNotice() {
    const meta = requestMetaSync(ipcRenderer, META_GET_SCHEMA_CHANNEL);
    let schemaList = [];
    if (meta.initialized) {
        if (!meta.envelope.ok) {
            throw reviveError(meta.envelope.error);
        }
        schemaList = meta.envelope.data || [];
    } else {
        console.warn(
            `[base-client] appNotice 未装配：主进程未调用 Notice.init（${meta.reason}）。` +
            '不需要 appNotice 时在 preload 中 init({ notice: false })，避免装配时的同步等待',
        );
    }

    const listeners = new Map();
    const appNotice = {};

    for (const { namespace, events } of schemaList) {
        if (TOP_LEVEL_KEYS.has(namespace)) {
            throw new Error(
                `Notice namespace "${namespace}" collides with top-level API ` +
                `(reserved: subscribe / unsubscribe / once)`,
            );
        }
        const eventSet = new Set(events);
        appNotice[namespace] = buildNamespaceApi(namespace, eventSet, listeners);
    }

    const resolveNsApi = (fullEventName, api) => {
        const { namespace, eventName } = parseFullEventName(fullEventName);
        if (!meta.initialized) {
            throw new Error(
                `Notice ${api}: appNotice 未装配（主进程未调用 Notice.init）`,
            );
        }
        const nsApi = appNotice[namespace];
        if (!nsApi) {
            throw new Error(
                `Notice ${api}: namespace "${namespace}" not registered`,
            );
        }
        return { nsApi, eventName };
    };

    appNotice.subscribe = (fullEventName, cb) => {
        const { nsApi, eventName } = resolveNsApi(fullEventName, 'subscribe');
        return nsApi.on(eventName, cb);
    };
    appNotice.unsubscribe = (fullEventName, cb) => {
        const { nsApi, eventName } = resolveNsApi(fullEventName, 'unsubscribe');
        nsApi.off(eventName, cb);
    };
    appNotice.once = (fullEventName, cb) => {
        const { nsApi, eventName } = resolveNsApi(fullEventName, 'once');
        return nsApi.once(eventName, cb);
    };

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
