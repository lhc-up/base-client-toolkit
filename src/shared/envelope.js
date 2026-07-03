/**
 * IPC 应答统一信封（详见架构 §7.1）。
 *
 * 所有 IPC 应答必须使用此信封形态：
 * - 成功：{ ok: true, data: <serialize 后的值> }
 * - 失败：{ ok: false, error: <serialize 后的 Error> }
 *
 * 主端 handler 永不 throw（详见架构 §3.3），异常统一封装为 errorEnvelope 返回。
 * preload 端解包路径唯一：if (ok) return data; else throw reviveError(error);
 *
 * Notice 推送通道 `notice:event` 不走信封（单向流无返回值）。
 */

/**
 * 生成成功信封。
 * @param {*} data 已 serialize 过的数据
 * @returns {{ ok: true, data: * }}
 */
function okEnvelope(data) {
    return { ok: true, data };
}

/**
 * 生成失败信封。
 * @param {*} error 已 serialize 过的 Error（形态 `{ name?, message?, stack?, code?, cause? }`）
 * @returns {{ ok: false, error: * }}
 */
function errorEnvelope(error) {
    return { ok: false, error };
}

module.exports = { okEnvelope, errorEnvelope };
