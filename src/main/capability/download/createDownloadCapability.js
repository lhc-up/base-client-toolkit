/**
 * Renderer-facing download capability.
 *
 * 本层只是薄适配：解析 scope → 调 `libs/download` 的批量编排 `startBatch` → 把文件级回调
 * 映射成 `download.changed`。编排本身（循环、并发、取消传导、完整性跳过）在 libs 层，
 * 业务主进程可直接复用 `startBatch`，不必经过本 capability。
 *
 * 契约要点：
 * - Service: download.start(options) -> { taskId }, download.cancel(taskId) -> { accepted }
 * - Notice: download.changed carries started/progress/completed/failed/cancelled
 * - No getState/getProgress polling handlers; renderer never receives absolute paths
 * - taskId only correlates cancellation and concurrent events; persistent files are
 *   referenced by scope + fileName
 * - scope is a '/' separated string or segment array resolved under the controlled
 *   storage root; fileName is a plain file name (a business unique id maps directly)
 */

const path = require('node:path');
const {
    normalizeScope,
    resolveScopeDir,
    normalizeFileName,
} = require('../../libs/scope');

function capabilityError(code, message) {
    return Object.assign(new Error(message), { code });
}

function deriveFileName(urls, randomUUID) {
    try {
        const base = decodeURIComponent(path.posix.basename(new URL(urls[0]).pathname));
        if (base) return normalizeFileName(base);
    } catch { /* fall back to a generated name */ }
    return randomUUID();
}

function normalizeFileSpec(spec) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
        throw new TypeError('download file spec must be an object');
    }
    if (
        !Array.isArray(spec.urls) ||
        spec.urls.length === 0 ||
        spec.urls.some(u => typeof u !== 'string' || !u)
    ) {
        throw new TypeError('download urls must be a non-empty string array');
    }
    const file = { urls: [...spec.urls] };
    if (spec.fileName !== undefined) file.fileName = normalizeFileName(spec.fileName);
    if (spec.timeoutMs !== undefined) file.timeoutMs = spec.timeoutMs;
    if (spec.headers !== undefined) file.headers = spec.headers;
    if (spec.integrity !== undefined && spec.integrity !== null) {
        const { algorithm, expected } = spec.integrity;
        if (typeof expected !== 'string' || !expected) {
            throw new TypeError('download integrity requires an expected digest string');
        }
        file.integrity = { algorithm, expected };
    }
    return file;
}

function createDownloadCapability(deps) {
    const {
        download,
        filePathConfig,
        broadcast,
        randomUUID,
    } = deps;

    const tasks = new Map();

    function emitChanged(payload) {
        broadcast('download.changed', payload);
    }

    async function runFile(task, scope, scopeDir, spec) {
        const fileName = spec.fileName || deriveFileName(spec.urls, randomUUID);
        const destinationPath = path.join(scopeDir, fileName);
        const base = { taskId: task.id, scope, fileName };
        const handle = download.startBatch({
            files: [{
                urls: spec.urls,
                destinationPath,
                timeoutMs: spec.timeoutMs,
                headers: spec.headers,
                integrity: spec.integrity,
            }],
            onFileChange: event => {
                // 只把渲染层需要的字段推出去：绝对路径、index 等一律不外泄
                if (event.state === 'started') {
                    emitChanged({ ...base, state: 'started' });
                } else if (event.state === 'progress') {
                    emitChanged({ ...base, state: 'progress', transferred: event.transferred, total: event.total, percent: event.percent });
                } else if (event.state === 'completed') {
                    emitChanged({ ...base, state: 'completed', size: event.size });
                } else if (event.state === 'skipped') {
                    // 命中「已存在且完整性匹配」：对渲染层语义等同完成
                    emitChanged({ ...base, state: 'completed' });
                } else if (event.state === 'cancelled') {
                    emitChanged({ ...base, state: 'cancelled' });
                } else if (event.state === 'failed') {
                    emitChanged({ ...base, state: 'failed', error: event.error });
                }
            },
        });
        task.cancelCurrent = handle.cancel;
        if (task.cancelled) handle.cancel();
        try {
            const { results } = await handle.promise;
            return results[0]?.state || 'failed';
        } finally {
            task.cancelCurrent = null;
        }
    }

    function start(options = {}) {
        const scope = normalizeScope(options.scope);
        const scopeDir = resolveScopeDir(filePathConfig.storageResource, options.scope);
        const files = Array.isArray(options.files)
            ? options.files.map(normalizeFileSpec)
            : [normalizeFileSpec(options)];
        if (files.length === 0) throw new TypeError('download files must be a non-empty array');
        const taskId = randomUUID();
        const task = { id: taskId, cancelled: false, cancelCurrent: null };
        tasks.set(taskId, task);
        (async () => {
            try {
                for (const spec of files) {
                    if (task.cancelled) break;
                    const outcome = await runFile(task, scope, scopeDir, spec);
                    if (outcome === 'cancelled') break;
                }
            } finally {
                tasks.delete(taskId);
            }
        })().catch(() => {});
        return { taskId };
    }

    function cancel(taskId) {
        const task = tasks.get(taskId);
        if (!task) return { accepted: false };
        task.cancelled = true;
        if (task.cancelCurrent) task.cancelCurrent();
        return { accepted: true };
    }

    return {
        start,
        cancel,
        serviceSchema: { namespace: 'download', handlers: { start, cancel } },
        noticeSchema: { namespace: 'download', events: ['changed'] },
    };
}

module.exports = { createDownloadCapability };