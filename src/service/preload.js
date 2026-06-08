const { ipcRenderer } = require('electron');
// IPC 路径必须永不抛错：strict=false 覆盖 dev 默认的 strict=true。
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
