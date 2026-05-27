import * as ph from './placeholders.js';
import * as ad from './adapters.js';
import { resolveOpts, configureSerializer } from './limits.js';

function serialize(value, opts) {
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
                return v.slice(0, finalOpts.maxStringLength)
                    + ph.truncatedStringSuffix(v.length - finalOpts.maxStringLength);
            }
            return v;
        }
        if (t === 'number') return ph.numberPlaceholder(v);
        if (t === 'boolean') return v;
        if (t === 'bigint') return ph.bigintPlaceholder(v);
        if (t === 'symbol') return ph.symbolPlaceholder(v);
        if (t === 'function') return ph.fnPlaceholder(v);

        if (depth >= finalOpts.maxDepth) return ph.maxDepthPlaceholder();

        if (seen.has(v)) return ph.circularPlaceholder(seen.get(v));
        seen.set(v, path);

        try {
            if (v instanceof Date) return ad.adaptDate(v);
            if (ad.isError(v)) return ad.adaptError(v, (x) => walk(x, depth + 1, path + '.cause'));
            if (v instanceof RegExp) return ad.adaptRegExp(v);
            if (ad.isBuffer(v) || ad.isArrayBuffer(v)) return ph.bufferPlaceholder(v);
            if (ad.isPromise(v)) return ph.promisePlaceholder();
            if (typeof WeakMap !== 'undefined' && v instanceof WeakMap) return ph.weakMapPlaceholder();
            if (typeof WeakSet !== 'undefined' && v instanceof WeakSet) return ph.weakSetPlaceholder();
            if (ad.isWindowLike(v)) return ph.windowPlaceholder();
            if (ad.isDomNode(v)) return ph.domPlaceholder(v);
            if (v instanceof Map) return ad.adaptMap(v, (x) => walk(x, depth + 1, path));
            if (v instanceof Set) return ad.adaptSet(v, (x) => walk(x, depth + 1, path));
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
            return walkArray(Array.from(v), depth, path);
        }

        if (Array.isArray(v)) return walkArray(v, depth, path);

        return walkObject(v, depth, path);
    }

    function walkArray(arr, depth, path) {
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

export { serialize, safeStringify, configureSerializer };
export default { serialize, safeStringify, configureSerializer };
