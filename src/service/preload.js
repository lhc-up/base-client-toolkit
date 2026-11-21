const { ipcRenderer } = require('electron');
const { serializeForIpc } = require('../shared/serializer');
const { reviveError } = require('../shared/serializer/reviveError');
const { requestMetaSync } = require('../shared/metaChannel');
const {
    META_LIST_CHANNEL, SERIALIZER_REPORT_CHANNEL, asyncChannel, syncChannel,
} = require('./protocol');


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
 * **拷贝用逐键 try/catch，不用 `{ ...arg }`**：对象展开会读全部可枚举属性，
 * 遇到抛错的 getter 就**直接抛出去、整次 Service 调用失败** —— 而下游
 * `serializeForIpc` 对同一对象是安全的（有 try/catch，降级成
 * `[Unserializable: …]` 并上报）。2026-10-10 实测确认了这个绕行：
 *
 * ```
 * { ...bad }        → ❌ 展开即抛: getter 故意抛
 * serializeForIpc() → ✅ {"boom":"[Unserializable: getter 故意抛]"} + 上报 $.boom
 * ```
 *
 * 所以这里按 key 逐个取、单独 try —— 抛错的键**跳过不拷**，交给下游 serializer
 * 去记录并降级（那里有统一的占位与上报通道，不在这里重复实现）。
 *
 * @param {string} baseChannel 用作 channel 前缀，避免不同 handler 之间命名冲突
 * @param {any[]} args 用户传入的实参列表
 * @returns {{ mappedArgs: any[], tempChannels: string[] }} mappedArgs 用于 serializeForIpc；tempChannels 用于调用结束后 removeAllListeners
 */
function replaceCallbacksWithChannels(baseChannel, args) {
    const tempChannels = [];
    const skips = [];
    const mappedArgs = args.map((arg, argIndex) => {
        if (!isPlainObject(arg)) return arg;
        const cloned = {};
        for (const key of Object.keys(arg)) {
            let cb;
            try {
                cb = arg[key];
            } catch (err) {
                // getter 抛错：跳过该键。**但必须自己上报** —— 这个键根本不会进
                // serializeForIpc（对象里已没有它），下游无从知道，不报就又静默了
                skips.push({ argIndex, path: `$.${key}`, reason: `getter threw: ${err.message}` });
                continue;
            }
            if (typeof cb !== 'function') {
                cloned[key] = cb;
                continue;
            }
            const cbChannel = `${baseChannel}-${key}-${Date.now()}-${Math.random()}`;
            ipcRenderer.on(cbChannel, (_event, data) => cb(data));
            cloned[key] = cbChannel;
            tempChannels.push(cbChannel);
        }
        return cloned;
    });
    return { mappedArgs, tempChannels, skips };
}

/**
 * 序列化全部入参，并**把途中的占位/截断事件收集起来上报主进程**。
 *
 * `serializeForIpc` 对不可克隆的对象（函数、DOM、Symbol…）会降级成占位符，超深也会截断 ——
 * 这本身是必要的适配，但**此前完全静默**：数据在通道上被改动，没有任何人知道。
 * 2026-10-10 的 `paperJson` 缺陷就是这么漏出去的（那份是本仓自己成因不同，但同一类静默）。
 *
 * 上报走 `SERIALIZER_REPORT_CHANNEL` 单向 send，**载荷不经 serializeForIpc** ——
 * 否则就是"序列化出问题时再走一次序列化"，自激。
 *
 * @param {string} channel 目标通道名，用于定位是哪个 Service 调用
 * @param {any[]} mappedArgs 已把回调替换成临时通道的入参
 * @returns {any[]} 可过 IPC 的参数
 */
function serializeArgs(channel, mappedArgs, skips) {
    const reports = [...(skips || [])];
    const safeArgs = mappedArgs.map((a, argIndex) =>
        serializeForIpc(a, {
            onError: (reason, path) => reports.push({ argIndex, path, reason }),
        }),
    );
    if (reports.length) {
        try {
            // 单向、不等回复；失败也不能影响本次调用
            ipcRenderer.send(SERIALIZER_REPORT_CHANNEL, { channel, reports });
        } catch (_) { /* swallow */ }
    }
    return safeArgs;
}

function buildAsyncCaller(ns, name) {
    const channel = asyncChannel(ns, name);
    return async (...args) => {
        const { mappedArgs, tempChannels, skips } = replaceCallbacksWithChannels(channel, args);
        const safeArgs = serializeArgs(channel, mappedArgs, skips);
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
        const { mappedArgs, tempChannels, skips } = replaceCallbacksWithChannels(channel, args);
        const safeArgs = serializeArgs(channel, mappedArgs, skips);
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
 * **sync 语义澄清**：schema 里 `sync: ['foo']` 是**新增别名**，不是替换。
 * 即使 `foo` 在 sync 列表里，`appService[ns].foo(...)` 仍返回 Promise；
 * 要拿同步返回值必须调 `appService[ns].fooSync(...)`。
 * 若渲染端把 `.foo()` 的 Promise 直接赋给 template 会渲染成 `[object Promise]`，
 * 且无 runtime 报错——常见踩点，切勿混淆。
 *
 * **主进程未调用 `Service.init`**：返回空对象并 `console.warn`，不抛错（不影响同一 preload 里的
 * appNotice 装配）。元通道请求会先阻塞到主进程 GC（见 `shared/metaChannel.js`），
 * 不需要 appService 时应在 preload 中 `init({ service: false })`。
 *
 * @returns {Object} appService
 * @throws {Error} 主端返回失败信封时抛出 revived Error
 */
function buildAppService() {
    const meta = requestMetaSync(ipcRenderer, META_LIST_CHANNEL);
    if (!meta.initialized) {
        console.warn(
            `[base-client] appService 未装配：主进程未调用 Service.init（${meta.reason}）。` +
            '不需要 appService 时在 preload 中 init({ service: false })，避免装配时的同步等待',
        );
        return {};
    }
    const envelope = meta.envelope;
    if (!envelope.ok) {
        throw reviveError(envelope.error);
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
