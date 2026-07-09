const { ipcRenderer } = require('electron');
const { serializeForIpc } = require('../shared/serializer');
const { reviveError } = require('../shared/serializer/reviveError');
const {
    META_LIST_CHANNEL, asyncChannel, syncChannel,
} = require('./protocol');

// envelope 形态由 shared/envelope 定义（架构 §7.1）；preload 只消费不构造。

function isPlainObject(v) {
    if (v === null || typeof v !== 'object') return false;
    const proto = Object.getPrototypeOf(v);
    return proto === null || proto === Object.prototype;
}

/**
 * 遍历 args，对 plain object 参数中的 function 字段：
 * - clone 对象（不污染调用方）
 * - function 字段替换为动态 channel 字符串
 * - ipcRenderer 注册对应 channel 的 listener
 *
 * 主进程 handler 收到 channel 字符串后，需通过 event.sender.send(channel, data) 触发回调
 * （handler 需在 serviceSchema.needsEvent 中声明以拿到 event）
 *
 * @param {string} baseChannel 用作 channel 前缀，避免不同 handler 之间命名冲突
 * @param {any[]} args 用户传入的实参列表
 * @returns {{ mappedArgs: any[], tempChannels: string[] }} mappedArgs 用于 serializeForIpc；tempChannels 用于调用结束后 removeAllListeners
 */
function replaceCallbacksWithChannels(baseChannel, args) {
    const tempChannels = [];
    const mappedArgs = args.map(arg => {
        if (!isPlainObject(arg)) return arg;
        const cloned = { ...arg };
        for (const key of Object.keys(cloned)) {
            const cb = cloned[key];
            if (typeof cb !== 'function') continue;
            const cbChannel = `${baseChannel}-${key}-${Date.now()}-${Math.random()}`;
            ipcRenderer.on(cbChannel, (_event, data) => cb(data));
            cloned[key] = cbChannel;
            tempChannels.push(cbChannel);
        }
        return cloned;
    });
    return { mappedArgs, tempChannels };
}

function buildAsyncCaller(ns, name) {
    const channel = asyncChannel(ns, name);
    return async (...args) => {
        const { mappedArgs, tempChannels } = replaceCallbacksWithChannels(channel, args);
        const safeArgs = mappedArgs.map(a => serializeForIpc(a));
        try {
            const envelope = await ipcRenderer.invoke(channel, ...safeArgs);
            if (envelope && envelope.ok) return envelope.data;
            throw reviveError(envelope && envelope.error);
        } finally {
            for (const c of tempChannels) ipcRenderer.removeAllListeners(c);
        }
    };
}

function buildSyncCaller(ns, name) {
    const channel = syncChannel(ns, name);
    return (...args) => {
        const { mappedArgs, tempChannels } = replaceCallbacksWithChannels(channel, args);
        const safeArgs = mappedArgs.map(a => serializeForIpc(a));
        try {
            const envelope = ipcRenderer.sendSync(channel, ...safeArgs);
            if (envelope && envelope.ok) return envelope.data;
            throw reviveError(envelope && envelope.error);
        } finally {
            for (const c of tempChannels) ipcRenderer.removeAllListeners(c);
        }
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
