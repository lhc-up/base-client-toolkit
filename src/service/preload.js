const { ipcRenderer } = require('electron');
const { serializeForIpc } = require('../shared/serializer');
const { reviveError } = require('../shared/serializer/reviveError');
const {
    META_LIST_CHANNEL, asyncChannel, syncChannel,
} = require('./protocol');

// envelope 形态由 shared/envelope 定义（架构 §7.1）；preload 只消费不构造。

function buildAsyncCaller(ns, name) {
    return async (...args) => {
        const safeArgs = args.map(a => serializeForIpc(a));
        const envelope = await ipcRenderer.invoke(asyncChannel(ns, name), ...safeArgs);
        if (envelope && envelope.ok) return envelope.data;
        throw reviveError(envelope && envelope.error);
    };
}

function buildSyncCaller(ns, name) {
    return (...args) => {
        const safeArgs = args.map(a => serializeForIpc(a));
        const envelope = ipcRenderer.sendSync(syncChannel(ns, name), ...safeArgs);
        if (envelope && envelope.ok) return envelope.data;
        throw reviveError(envelope && envelope.error);
    };
}

/**
 * 构建渲染端 appService API。preload 加载时调用一次。
 *
 * 返回形态：{ [namespace]: { [handler](...args): Promise<any>, [handler]Sync(...args): any } }
 *
 * 详见架构 §3.5（preload 一次性 init 与 opt-out 契约）。
 *
 * @returns {Object} appService
 * @throws {Error} 元通道 envelope 为 error 或损坏时抛出 revived Error
 */
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
