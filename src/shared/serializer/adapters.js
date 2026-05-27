function isPlainObject(v) {
    if (v === null || typeof v !== 'object') return false;
    const proto = Object.getPrototypeOf(v);
    return proto === null || proto === Object.prototype;
}

function isError(v) {
    return v instanceof Error;
}

function isBuffer(v) {
    return typeof Buffer !== 'undefined' && Buffer.isBuffer(v);
}

function isArrayBuffer(v) {
    return v instanceof ArrayBuffer;
}

function isTypedArray(v) {
    return ArrayBuffer.isView(v) && !(v instanceof DataView);
}

function isPromise(v) {
    return v !== null && typeof v === 'object' && typeof v.then === 'function';
}

function isDomNode(v) {
    return v !== null
        && typeof v === 'object'
        && typeof v.nodeType === 'number'
        && typeof v.nodeName === 'string';
}

function isWindowLike(v) {
    if (v === null || typeof v !== 'object') return false;
    try {
        return v.window === v && typeof v.document === 'object';
    } catch (_) {
        return false;
    }
}

function adaptDate(d) {
    const t = d.getTime();
    if (Number.isNaN(t)) return null;
    return d.toISOString();
}

function adaptError(err, recurse) {
    const out = {
        name: err.name || 'Error',
        message: err.message || '',
        stack: err.stack || '',
    };
    if (err.code !== undefined) out.code = err.code;
    if (err.cause !== undefined) out.cause = recurse(err.cause);
    return out;
}

function adaptMap(m, recurse) {
    let allStringKeys = true;
    for (const k of m.keys()) {
        if (typeof k !== 'string') { allStringKeys = false; break; }
    }
    if (allStringKeys) {
        const out = {};
        for (const [k, v] of m) out[k] = recurse(v);
        return out;
    }
    return [...m].map(([k, v]) => [recurse(k), recurse(v)]);
}

function adaptSet(s, recurse) {
    const out = [];
    for (const v of s) out.push(recurse(v));
    return out;
}

function adaptRegExp(r) {
    return { source: r.source, flags: r.flags };
}

module.exports = {
    isPlainObject,
    isError,
    isBuffer,
    isArrayBuffer,
    isTypedArray,
    isPromise,
    isDomNode,
    isWindowLike,
    adaptDate,
    adaptError,
    adaptMap,
    adaptSet,
    adaptRegExp,
};
