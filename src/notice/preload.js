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

// envelope 形态由 shared/envelope 定义（架构 §7.1）；preload 只消费。

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
