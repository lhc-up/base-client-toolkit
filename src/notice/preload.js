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
