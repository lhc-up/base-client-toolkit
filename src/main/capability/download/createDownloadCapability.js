/**
 * Renderer-facing download capability.
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
        integrity,
        fsp,
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
        emitChanged({ ...base, state: 'started' });
        try {
            const handle = download.start({
                urls: spec.urls,
                destinationPath,
                timeoutMs: spec.timeoutMs,
                headers: spec.headers,
                onProgress: progress => emitChanged({ ...base, state: 'progress', ...progress }),
            });
            task.cancelCurrent = handle.cancel;
            if (task.cancelled) handle.cancel();
            const result = await handle.promise;
            if (spec.integrity) {
                const check = await integrity.verify({
                    filePath: result.filePath,
                    algorithm: spec.integrity.algorithm,
                    expected: spec.integrity.expected,
                });
                if (!check.valid) {
                    await fsp.rm(result.filePath, { force: true });
                    throw capabilityError(
                        'DOWNLOAD_INTEGRITY_MISMATCH',
                        `integrity check failed for ${fileName}`,
                    );
                }
            }
            emitChanged({ ...base, state: 'completed', size: result.size });
            return 'completed';
        } catch (error) {
            if (task.cancelled || error.code === 'DOWNLOAD_CANCELLED') {
                emitChanged({ ...base, state: 'cancelled' });
                return 'cancelled';
            }
            emitChanged({
                ...base,
                state: 'failed',
                error: { code: error.code || 'DOWNLOAD_FAILED', message: error.message },
            });
            return 'failed';
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