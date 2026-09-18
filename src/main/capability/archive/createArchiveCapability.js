/**
 * Renderer-facing archive capability.
 *
 * Contract (see 2026-09-15 toolkit main runtime capabilities design):
 * - Service: archive.extract(options) -> { taskId }, archive.cancel(taskId) -> { accepted }
 * - Notice: archive.changed carries started/completed/failed/cancelled
 * - Renderer passes controlled scope + fileName and a target parent scope only;
 *   no absolute paths, no Node streams, no plain business keys cross the IPC boundary
 * - Decryption material is resolved in main: business registers named decryptors
 *   through registerDecryptor(name, factory), renderer passes decrypt: { name, params }
 * - Extraction lands in a ZIP-owned directory named after the archive file under the
 *   target scope, so replacing it never touches sibling history files
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

function createArchiveCapability(deps) {
    const {
        archive,
        fs,
        filePathConfig,
        broadcast,
        randomUUID,
    } = deps;

    const decryptors = new Map();
    const tasks = new Map();

    function emitChanged(payload) {
        broadcast('archive.changed', payload);
    }

    function registerDecryptor(name, factory) {
        if (typeof name !== 'string' || !name) {
            throw new TypeError('archive decryptor name must be a non-empty string');
        }
        if (typeof factory !== 'function') {
            throw new TypeError('archive decryptor factory must be a function');
        }
        decryptors.set(name, factory);
    }

    function resolveDecrypt(option) {
        if (option === undefined || option === null) return undefined;
        const factory = decryptors.get(option && option.name);
        if (!factory) {
            throw capabilityError(
                'ARCHIVE_DECRYPTOR_NOT_FOUND',
                `archive decryptor "${option && option.name}" is not registered`,
            );
        }
        const transform = factory(option.params);
        if (!transform || typeof transform.pipe !== 'function') {
            throw new TypeError(`archive decryptor "${option.name}" must return a Transform`);
        }
        return transform;
    }

    function extract(options = {}) {
        const source = options.source || {};
        const target = options.target || {};
        const sourceScope = normalizeScope(source.scope);
        const fileName = normalizeFileName(source.fileName);
        const targetScope = normalizeScope(target.scope);
        const decrypt = resolveDecrypt(options.decrypt);
        const root = filePathConfig.storageResource;
        const sourcePath = path.join(resolveScopeDir(root, source.scope), fileName);
        const targetParent = resolveScopeDir(root, target.scope);
        const directory = fileName.replace(/\.zip$/i, '');
        const destinationDir = path.join(targetParent, directory);
        const taskId = randomUUID();
        const controller = new AbortController();
        const task = { id: taskId, controller, cancelled: false };
        tasks.set(taskId, task);
        const base = { taskId, source: { scope: sourceScope, fileName }, targetScope };
        (async () => {
            emitChanged({ ...base, state: 'started' });
            try {
                if (task.cancelled) {
                    throw capabilityError('ARCHIVE_CANCELLED', 'archive extraction cancelled');
                }
                const input = fs.createReadStream(sourcePath);
                try {
                    await archive.extractZip({
                        input,
                        destinationDir,
                        decrypt,
                        signal: controller.signal,
                    });
                } finally {
                    input.destroy();
                }
                if (task.cancelled) {
                    throw capabilityError('ARCHIVE_CANCELLED', 'archive extraction cancelled');
                }
                emitChanged({ ...base, state: 'completed', directory });
            } catch (error) {
                if (task.cancelled || error.code === 'ARCHIVE_CANCELLED') {
                    emitChanged({ ...base, state: 'cancelled' });
                } else {
                    emitChanged({
                        ...base,
                        state: 'failed',
                        error: { code: error.code || 'ARCHIVE_FAILED', message: error.message },
                    });
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
        task.controller.abort();
        return { accepted: true };
    }

    return {
        extract,
        cancel,
        registerDecryptor,
        serviceSchema: { namespace: 'archive', handlers: { extract, cancel } },
        noticeSchema: { namespace: 'archive', events: ['changed'] },
    };
}

module.exports = { createArchiveCapability };