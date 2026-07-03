/**
 * serialize 默认配置（详见架构 §7.2 / §7.6）。
 *
 * strict: false 是硬编码 —— 默认更安全，用户忘配置也不会在生产崩溃。
 * 开发环境用户若想暴露序列化 Proxy / toJSON 抛错等真 bug，主动 opt-in：
 *
 *     if (process.env.NODE_ENV !== 'production') {
 *         configureSerializer({ strict: true });
 *     }
 *
 * 注意：globalDefaults 是**模块级私有变量**，每进程一份 —— 主进程 configureSerializer
 * 只影响主进程默认；渲染进程若直接调 serialize 需在渲染进程再配一次。
 */
const DEFAULTS = Object.freeze({
    maxDepth: 32,
    maxStringLength: 10240,
    maxArrayLength: 1000,
    maxKeys: 1000,
    strict: false,
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
