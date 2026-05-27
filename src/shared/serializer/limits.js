const DEFAULTS = Object.freeze({
    maxDepth: 32,
    maxStringLength: 10240,
    maxArrayLength: 1000,
    maxKeys: 1000,
    strict: process.env.NODE_ENV !== 'production',
    onError: null,
});

let globalDefaults = { ...DEFAULTS };

function configureSerializer(opts) {
    if (!opts || typeof opts !== 'object') return;
    globalDefaults = { ...globalDefaults, ...opts };
}

function resolveOpts(opts = {}) {
    return {
        maxDepth: opts.maxDepth ?? globalDefaults.maxDepth,
        maxStringLength: opts.maxStringLength ?? globalDefaults.maxStringLength,
        maxArrayLength: opts.maxArrayLength ?? globalDefaults.maxArrayLength,
        maxKeys: opts.maxKeys ?? globalDefaults.maxKeys,
        strict: opts.strict ?? globalDefaults.strict,
        onError: opts.onError ?? globalDefaults.onError,
    };
}

// 仅用于测试：重置全局配置
function _resetForTest() {
    globalDefaults = { ...DEFAULTS };
}

module.exports = { DEFAULTS, configureSerializer, resolveOpts, _resetForTest };
