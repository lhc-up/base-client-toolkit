const KNOWN_ERROR_CTORS = {
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    ReferenceError,
    URIError,
    EvalError,
};

function reviveError(s) {
    if (!s || typeof s !== 'object') {
        return new Error(String(s));
    }
    const Ctor = KNOWN_ERROR_CTORS[s.name] || Error;
    const err = new Ctor(s.message || '');
    if (s.name && err.name !== s.name) {
        Object.defineProperty(err, 'name', { value: s.name, writable: true, configurable: true });
    }
    if (s.stack) {
        Object.defineProperty(err, 'stack', { value: s.stack, writable: true, configurable: true });
    }
    if (s.code !== undefined) err.code = s.code;
    if (s.cause !== undefined) err.cause = reviveError(s.cause);
    return err;
}

module.exports = { reviveError };
