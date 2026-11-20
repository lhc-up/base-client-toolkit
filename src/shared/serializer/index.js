const ph = require('./placeholders');
const ad = require('./adapters');
const { resolveOpts, configureSerializer } = require('./limits');

/**
 * @param {*} value
 * @param {Object} [opts]
 * @param {{ cloneSafe?: boolean }} [mode] `cloneSafe` 由 `serializeForIpc` 内部使用：
 *   structured clone 原生支持的类型（Date / RegExp / Map / Set / BigInt / NaN / ±Infinity）原样透传；
 *   日志路径不传，保持可读的字符串 / 普通对象形态。不作为对外选项开放。
 */
function serialize(value, opts, { cloneSafe = false } = {}) {
    const finalOpts = resolveOpts(opts);
    const seen = new WeakMap();

    function reportError(reason, path) {
        if (finalOpts.strict) {
            const err = new Error(`[serializer] ${reason} at ${path}`);
            throw err;
        }
        if (typeof finalOpts.onError === 'function') {
            try { finalOpts.onError(reason, path); } catch (_) { /* swallow */ }
        }
    }

    function walk(v, depth, path) {
        if (v === null) return null;
        if (v === undefined) return undefined;
        const t = typeof v;
        if (t === 'string') {
            if (v.length > finalOpts.maxStringLength) {
                reportError(
                    `string truncated: ${v.length} -> ${finalOpts.maxStringLength} chars`,
                    path,
                );
                return v.slice(0, finalOpts.maxStringLength)
                    + ph.truncatedStringSuffix(v.length - finalOpts.maxStringLength);
            }
            return v;
        }
        if (t === 'number') return cloneSafe ? v : ph.numberPlaceholder(v);
        if (t === 'boolean') return v;
        if (t === 'bigint') return cloneSafe ? v : ph.bigintPlaceholder(v);
        if (t === 'symbol') return ph.symbolPlaceholder(v);
        if (t === 'function') return ph.fnPlaceholder(v);

        if (depth >= finalOpts.maxDepth) {
            reportError(`max depth ${finalOpts.maxDepth} exceeded`, path);
            return ph.maxDepthPlaceholder();
        }

        if (seen.has(v)) return ph.circularPlaceholder(seen.get(v));

        try {
            if (v instanceof Date) return cloneSafe ? v : ad.adaptDate(v);
            if (ad.isError(v)) return ad.adaptError(v, (x) => walk(x, depth + 1, path + '.cause'));
            if (v instanceof RegExp) return cloneSafe ? v : ad.adaptRegExp(v);
            if (ad.isBuffer(v) || ad.isArrayBuffer(v)) {
                // IPC 路径原样透传（structured clone 原生支持）；日志路径换占位符
                return finalOpts.binaryPassthrough ? v : ph.bufferPlaceholder(v);
            }
            if (ad.isPromise(v)) return ph.promisePlaceholder();
            if (typeof WeakMap !== 'undefined' && v instanceof WeakMap) return ph.weakMapPlaceholder();
            if (typeof WeakSet !== 'undefined' && v instanceof WeakSet) return ph.weakSetPlaceholder();
            if (ad.isWindowLike(v)) return ph.windowPlaceholder();
            if (ad.isDomNode(v)) return ph.domPlaceholder(v);
            // structured clone 原生支持 Map / Set，但其中的值未必可克隆（函数、Symbol、Promise 等会让发送整体失败）：
            // IPC 路径保留类型、逐项按同一规则处理；日志路径转成对象 / 数组
            if (v instanceof Map) {
                seen.set(v, path);
                const recurse = (x) => walk(x, depth + 1, path);
                if (!cloneSafe) return ad.adaptMap(v, recurse);
                const out = new Map();
                for (const [k, val] of v) out.set(recurse(k), recurse(val));
                return out;
            }
            if (v instanceof Set) {
                seen.set(v, path);
                const recurse = (x) => walk(x, depth + 1, path);
                if (!cloneSafe) return ad.adaptSet(v, recurse);
                const out = new Set();
                for (const val of v) out.add(recurse(val));
                return out;
            }
        } catch (e) {
            reportError(`adapter threw: ${e.message}`, path);
        }

        if (typeof v.toJSON === 'function') {
            try {
                const replaced = v.toJSON();
                return walk(replaced, depth, path);
            } catch (e) {
                reportError(`toJSON threw: ${e.message}`, path);
                return walkObject(v, depth, path, { skipToJSON: true });
            }
        }

        if (ad.isTypedArray(v)) {
            // 同二进制：IPC 路径透传。展开成 number[] 会撞 maxArrayLength、
            // 把几 MB 的数据截成 1000 项 —— 对 IPC 是纯损坏
            if (finalOpts.binaryPassthrough) return v;
            return walkArray(Array.from(v), depth, path);
        }

        if (Array.isArray(v)) return walkArray(v, depth, path);

        return walkObject(v, depth, path);
    }

    function walkArray(arr, depth, path) {
        seen.set(arr, path);
        const limit = finalOpts.maxArrayLength;
        const out = [];
        const len = Math.min(arr.length, limit);
        for (let i = 0; i < len; i++) {
            let item;
            try {
                item = arr[i];
            } catch (e) {
                reportError(`array[${i}] threw: ${e.message}`, `${path}[${i}]`);
                out.push(ph.unserializablePlaceholder(e.message));
                continue;
            }
            out.push(walk(item, depth + 1, `${path}[${i}]`));
        }
        if (arr.length > limit) {
            reportError(`array truncated: ${arr.length} -> ${limit} items`, path);
            out.push(ph.truncatedArrayItem(arr.length - limit));
        }
        return out;
    }

    function walkObject(obj, depth, path, opts) {
        const skipToJSON = !!(opts && opts.skipToJSON);
        let keys;
        try {
            keys = Object.keys(obj);
        } catch (e) {
            reportError(`Object.keys threw: ${e.message}`, path);
            return ph.unserializablePlaceholder(e.message);
        }
        if (skipToJSON) keys = keys.filter((k) => k !== 'toJSON');
        seen.set(obj, path);
        const limit = finalOpts.maxKeys;
        const sliced = keys.slice(0, limit);
        const out = {};
        for (const key of sliced) {
            let val;
            try {
                val = obj[key];
            } catch (e) {
                reportError(`getter "${key}" threw: ${e.message}`, `${path}.${key}`);
                out[key] = ph.unserializablePlaceholder(e.message);
                continue;
            }
            out[key] = walk(val, depth + 1, `${path}.${key}`);
        }
        if (keys.length > limit) {
            reportError(`keys truncated: ${keys.length} -> ${limit} keys`, path);
            out.__truncated = ph.truncatedKeysValue(keys.length - limit);
        }
        return out;
    }

    try {
        return walk(value, 0, '$');
    } catch (e) {
        if (finalOpts.strict) throw e;
        if (typeof finalOpts.onError === 'function') {
            try { finalOpts.onError(`top-level: ${e.message}`, '$'); } catch (_) {}
        }
        return ph.unserializablePlaceholder(`SerializeError: ${e.message}`);
    }
}

function safeStringify(value, opts) {
    try {
        return JSON.stringify(serialize(value, opts));
    } catch (e) {
        return JSON.stringify(`[SerializeError: ${e.message}]`);
    }
}

/**
 * IPC 专用序列化封装。主端与 preload 的所有 IPC 序列化调用点统一使用此函数。
 *
 * ## 它**不做大小裁剪、也不动二进制** —— 这是 2026-10-10 定的
 *
 * 本函数原先只传 `strict: false`，于是套用了 safeStringify 那套面向**日志可读性**的默认值
 * （`maxStringLength: 10240` 等），后果是**业务数据在 IPC 上被静默裁剪**：
 *
 * - 问卷 `paperJson`（实测 13891 字符）被截成 10240 + 占位符，写进本地缓存后
 *   下次读出 `JSON.parse` 必失败 —— 而失败发生在业务侧，报的是"获取工具失败"这种
 *   与真因无关的文案。业务侧反复重试无效（重试仍命中同一份坏缓存）。
 * - `Buffer` / `ArrayBuffer` 被换成字符串占位符、`TypedArray` 被展开成数组后撞
 *   `maxArrayLength` —— **二进制在 IPC 上根本无法传输**，而这是纯损失：
 *   Electron 的 structured clone 原生支持它们（实测 3MB `Uint8Array`、2MB `ArrayBuffer`、
 *   5MB 字符串全部完整到达，首尾字节校验通过）。
 *
 * 所以 IPC 路径只保留"真正不可克隆"的处理（函数、DOM、window、Promise、WeakMap、
 * 循环引用），**不再裁剪、不再改二进制**。裁剪与占位是 safeStringify 的职责，
 * 那是"给人看"的需求，不该出现在数据通道上。
 *
 * `onError` 仍由调用方通过 `configureSerializer` 设置 —— 裁剪虽然不再发生，
 * 但不可克隆对象的占位仍需上报（见 service/preload.js 的接线）。
 *
 * @param {*} value 任意值
 * @returns {*} 可直接过 IPC 的值
 */
function serializeForIpc(value, opts) {
    return serialize(value, {
        strict: false,
        maxStringLength: Infinity,
        maxArrayLength: Infinity,
        maxKeys: Infinity,
        binaryPassthrough: true,
        // 调用方可按次传入 onError 覆盖全局默认（Service 的 preload 侧用它按调用收集，
        // 以便把出问题的参数下标与通道名一并上报）。不传则回落到 globalDefaults
        ...(opts || {}),
        // **maxDepth 刻意不给 Infinity** —— 深度是唯一会威胁调用栈的维度：
        // 无上限时深嵌套（实测 ≥3000 层）会爆栈，而顶层 catch 会把异常吞成一个
        // 占位字符串，**整个对象静默变成一行文字** —— 比截断更严重的全量丢失。
        // 实测：3000 层 → `[Unserializable: SerializeError: Maximum call stack size exceeded]`。
        // 而深度从来不是本次缺陷的成因（那是字符串长度），所以保留默认的有限值，
        // 超限时经 reportError 上报、不再静默。
    }, { cloneSafe: true });
}

module.exports = { serialize, safeStringify, configureSerializer, serializeForIpc };
