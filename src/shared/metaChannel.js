/**
 * preload 装配 bridge 时同步读取元通道（Service 清单 / Notice schema）。
 *
 * 主进程未 init 对应模块时，元通道没有 listener。Electron 22 实测：`sendSync` 不抛异常，
 * 而是阻塞到主进程回收这次 IPC 的 event 对象（取决于主进程 GC，实测约 2–8 秒），
 * 之后返回 `{ error: 'reply was never sent' }`。这段阻塞无法在 preload 侧避免，
 * 只能由 preload `init({ service: false })` / `init({ notice: false })` 不发出请求。
 *
 * toolkit 主端的应答一定是信封（`ok` 为布尔值，见 `envelope.js`），
 * 所以「sendSync 抛异常」或「收到的不是信封」都判定为主进程未 init。
 */

/**
 * @param {*} value
 * @returns {boolean}
 */
function isEnvelope(value) {
    if (value === null || typeof value !== 'object') return false;
    return typeof value.ok === 'boolean';
}

/**
 * @param {*} reply 非信封的应答
 * @returns {string}
 */
function describeReply(reply) {
    if (reply !== null && typeof reply === 'object' && typeof reply.error === 'string') {
        return reply.error;
    }
    return `unexpected reply: ${reply === null ? 'null' : typeof reply}`;
}

/**
 * @param {import('electron').IpcRenderer} ipcRenderer
 * @param {string} channel 元通道名
 * @returns {{ initialized: true, envelope: { ok: boolean, data?: *, error?: * } }
 *         | { initialized: false, reason: string }}
 */
function requestMetaSync(ipcRenderer, channel) {
    let reply;
    try {
        reply = ipcRenderer.sendSync(channel);
    } catch (err) {
        const reason = err && err.message ? err.message : String(err);
        return { initialized: false, reason };
    }
    if (isEnvelope(reply)) {
        return { initialized: true, envelope: reply };
    }
    return { initialized: false, reason: describeReply(reply) };
}

module.exports = { requestMetaSync };
