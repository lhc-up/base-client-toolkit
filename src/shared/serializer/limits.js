/**
 * serialize 默认配置。
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
    // 日志/诊断用的单条上限。**IPC 路径不受此限制** —— serializeForIpc 显式传
    // Infinity，见 index.js 的说明。调高到 64 KB 是为了装得下正常业务 body，
    // 同时相对 logger 的 maxLogSize（100K）仍留余量。
    maxStringLength: 65536,
    maxArrayLength: 1000,
    maxKeys: 1000,
    strict: false,
    onError: null,
    // 二进制原样透传。**只有 IPC 路径该开** —— Electron 的 structured clone 原生
    // 支持 ArrayBuffer / TypedArray（实测 3MB Uint8Array、5MB 字符串完整到达），
    // 把它们换成占位符等于摧毁 IPC 本来就有的能力。
    // 日志路径（safeStringify）必须保持 false，否则一条日志能打出几 MB 二进制。
    binaryPassthrough: false,
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
        binaryPassthrough: opts.binaryPassthrough ?? globalDefaults.binaryPassthrough,
    };
}

// 仅用于测试：重置全局配置
function _resetForTest() {
    globalDefaults = { ...DEFAULTS };
}

module.exports = { DEFAULTS, configureSerializer, resolveOpts, _resetForTest };
