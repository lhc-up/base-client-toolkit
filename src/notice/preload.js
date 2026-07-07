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
