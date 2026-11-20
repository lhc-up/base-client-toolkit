const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

function errorWithCode(code, message, cause) {
    return Object.assign(new Error(message, cause ? { cause } : undefined), { code });
}

function headerValue(headers, name) {
    const value = headers && headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
}

function createElectronNetTransport() {
    return {
        request(url, { signal, timeoutMs = 180000, headers } = {}) {
            return new Promise((resolve, reject) => {
                const { net } = require('electron');
                const request = net.request({ url, method: 'GET', headers });
                let settled = false;
                const timeout = setTimeout(() => {
                    request.abort();
                    reject(errorWithCode('DOWNLOAD_TIMEOUT', `Download timed out: ${url}`));
                }, timeoutMs);
                const cleanup = () => {
                    clearTimeout(timeout);
                    signal?.removeEventListener('abort', onAbort);
                };
                const onAbort = () => {
                    request.abort();
                    if (!settled) reject(errorWithCode('DOWNLOAD_CANCELLED', 'Download cancelled'));
                };
                signal?.addEventListener('abort', onAbort, { once: true });
                request.on('response', response => {
                    settled = true;
                    // 等响应头的超时与取消到此结束；传输阶段的停顿与取消由调用方经 abort 处理
                    cleanup();
                    resolve({
                        statusCode: response.statusCode,
                        headers: response.headers,
                        body: response,
                        abort: () => request.abort(),
                    });
                });
                request.on('error', error => {
                    cleanup();
                    if (signal?.aborted) reject(errorWithCode('DOWNLOAD_CANCELLED', 'Download cancelled', error));
                    else reject(error);
                });
                request.end();
            });
        },
    };
}

function createProgressTransform({ total, onProgress, onChunk }) {
    let transferred = 0;
    const transform = new Transform({
        transform(chunk, _encoding, callback) {
            transferred += chunk.length;
            onProgress?.({
                transferred,
                total: Number.isFinite(total) ? total : undefined,
                percent: Number.isFinite(total) && total > 0
                    ? Math.min(100, Math.round((transferred / total) * 100))
                    : undefined,
            });
            onChunk?.();
            callback(null, chunk);
        },
    });
    transform.getTransferred = () => transferred;
    return transform;
}

/**
 * 传输阶段停顿检测：等响应头的 `timeoutMs` 结束后开始计时，每收到一块数据重置；
 * 连续 `idleTimeoutMs` 没有数据即触发 `onStall`。`idleTimeoutMs <= 0` 表示关闭。
 */
function createStallGuard({ idleTimeoutMs, onStall }) {
    let timer = null;
    return {
        arm() {
            if (!(idleTimeoutMs > 0)) return;
            clearTimeout(timer);
            timer = setTimeout(onStall, idleTimeoutMs);
        },
        stop() {
            clearTimeout(timer);
        },
    };
}

function createDownload(dependencies = {}) {
    const transport = dependencies.transport || createElectronNetTransport();
    const fsApi = dependencies.fsp || fsp;
    const streamFs = dependencies.fs || fs;

    function start({ urls, destinationPath, timeoutMs = 180000, idleTimeoutMs = 60000, headers, onProgress } = {}) {
        if (!Array.isArray(urls) || urls.length === 0) {
            throw new TypeError('download urls must be a non-empty array');
        }
        if (typeof destinationPath !== 'string' || !path.isAbsolute(destinationPath)) {
            throw new TypeError('download destinationPath must be absolute');
        }
        const controller = new AbortController();
        let cancelled = false;
        const promise = (async () => {
            const tempPath = `${destinationPath}.tmp-${randomUUID()}`;
            let lastError;
            await fsApi.mkdir(path.dirname(destinationPath), { recursive: true });
            try {
                for (const url of urls) {
                    if (cancelled || controller.signal.aborted) {
                        throw errorWithCode('DOWNLOAD_CANCELLED', 'Download cancelled');
                    }
                    try {
                        const response = await transport.request(url, {
                            signal: controller.signal,
                            timeoutMs,
                            headers,
                        });
                        if (response.statusCode < 200 || response.statusCode >= 300) {
                            response.body?.resume?.();
                            throw errorWithCode('DOWNLOAD_HTTP_ERROR', `Download returned HTTP ${response.statusCode}`);
                        }
                        const totalValue = Number(headerValue(response.headers, 'content-length'));
                        // 传输阶段的中止只有一条路径：停顿超时与取消都以对应错误结束读取流，再中止网络请求
                        // （只销毁读取流时底层请求仍会挂着）。顺序不能反：先中止请求时 Electron 的响应流
                        // 会先以 ERR_STREAM_PREMATURE_CLOSE 结束，pipeline 拿不到这里给的错误
                        const stopTransfer = error => {
                            response.body?.destroy?.(error);
                            try { response.abort?.(); } catch { /* 已结束的请求 */ }
                        };
                        let touch = () => {};
                        const progress = createProgressTransform({
                            total: Number.isFinite(totalValue) ? totalValue : undefined,
                            onProgress,
                            onChunk: () => touch(),
                        });
                        // 响应头到了才开始计时：每收到一片数据重置，连续 idleTimeoutMs 无数据即停顿
                        const guard = createStallGuard({
                            idleTimeoutMs,
                            onStall: () => stopTransfer(errorWithCode(
                                'DOWNLOAD_TIMEOUT',
                                `Download stalled: no data for ${idleTimeoutMs}ms after ${progress.getTransferred()} bytes (${url})`,
                            )),
                        });
                        const onCancel = () => stopTransfer(errorWithCode('DOWNLOAD_CANCELLED', 'Download cancelled'));
                        if (controller.signal.aborted) onCancel();
                        else controller.signal.addEventListener('abort', onCancel, { once: true });
                        touch = guard.arm;
                        guard.arm();
                        try {
                            await pipeline(response.body, progress, streamFs.createWriteStream(tempPath));
                        } finally {
                            guard.stop();
                            controller.signal.removeEventListener('abort', onCancel);
                        }
                        const stat = await fsApi.stat(tempPath);
                        await fsApi.rm(destinationPath, { force: true });
                        await fsApi.rename(tempPath, destinationPath);
                        onProgress?.({ transferred: stat.size, total: stat.size, percent: 100 });
                        return { filePath: destinationPath, fileName: path.basename(destinationPath), size: stat.size };
                    } catch (error) {
                        lastError = error;
                        await fsApi.rm(tempPath, { force: true }).catch(() => {});
                        if (error.code === 'DOWNLOAD_CANCELLED' || controller.signal.aborted) {
                            throw errorWithCode('DOWNLOAD_CANCELLED', 'Download cancelled', error);
                        }
                    }
                }
                throw errorWithCode('DOWNLOAD_FAILED', 'All download URLs failed', lastError);
            } finally {
                await fsApi.rm(tempPath, { force: true }).catch(() => {});
            }
        })();
        return {
            promise,
            cancel() {
                if (cancelled) return false;
                cancelled = true;
                controller.abort();
                return true;
            },
        };
    }

    /**
     * 批量下载编排：按 `files` 顺序（或 `concurrency` 并发）逐个下载，只接收完整的目标路径，
     * 不涉及业务 scope、不推送 Notice。文件级生命周期经 `onFileChange` 回调给出：
     * `{ index, destinationPath, state, ... }`，state 为 started / progress / completed / skipped / failed / cancelled。
     *
     * `skipIfValid` + `integrity` 命中「目标已存在且摘要一致」时直接跳过（state: skipped），
     * 供离线 / 弱网场景复用已缓存的文件。
     *
     * @param {Object} option
     * @param {Array<{urls: string[], destinationPath: string, integrity?: {algorithm: string, expected: string}, skipIfValid?: boolean, timeoutMs?: number, idleTimeoutMs?: number, headers?: Object}>} option.files
     * @param {(event: Object) => void} [option.onFileChange]
     * @param {number} [option.concurrency=1]
     * @returns {{ promise: Promise<{results: Array<{state: string, size?: number}>}>, cancel: () => boolean }}
     */
    function startBatch({ files, onFileChange, concurrency = 1 } = {}) {
        if (!Array.isArray(files) || files.length === 0) {
            throw new TypeError('download files must be a non-empty array');
        }
        for (const file of files) {
            if (!file || typeof file.destinationPath !== 'string' || !path.isAbsolute(file.destinationPath)) {
                throw new TypeError('download files[].destinationPath must be absolute');
            }
        }

        let cancelled = false;
        let current = null;
        const emit = event => {
            try { onFileChange?.(event); } catch { /* 回调异常不影响下载 */ }
        };
        const results = new Array(files.length);
        let nextIndex = 0;

        async function hashFile(filePath, algorithm) {
            return new Promise((resolve, reject) => {
                const hash = createHash(algorithm);
                const stream = streamFs.createReadStream(filePath);
                stream.on('data', chunk => hash.update(chunk));
                stream.on('error', reject);
                stream.on('end', () => resolve(hash.digest('hex')));
            });
        }

        async function verify(filePath, spec) {
            const { algorithm = 'sha256', expected } = spec.integrity;
            const actual = await hashFile(filePath, algorithm);
            return actual === String(expected).replace(new RegExp(`^${algorithm}-`, 'i'), '').toLowerCase();
        }

        async function runOne(index, spec) {
            const base = { index, destinationPath: spec.destinationPath };
            try {
                if (spec.skipIfValid && spec.integrity) {
                    const exists = await fsApi.stat(spec.destinationPath).then(() => true, () => false);
                    if (exists && await verify(spec.destinationPath, spec)) {
                        emit({ ...base, state: 'skipped' });
                        return { state: 'skipped' };
                    }
                }
                emit({ ...base, state: 'started' });
                const handle = start({
                    urls: spec.urls,
                    destinationPath: spec.destinationPath,
                    timeoutMs: spec.timeoutMs,
                    idleTimeoutMs: spec.idleTimeoutMs,
                    headers: spec.headers,
                    onProgress: progress => emit({ ...base, state: 'progress', ...progress }),
                });
                current = handle;
                if (cancelled) handle.cancel();
                const result = await handle.promise;
                if (spec.integrity && !(await verify(result.filePath, spec))) {
                    await fsApi.rm(result.filePath, { force: true });
                    throw errorWithCode('DOWNLOAD_INTEGRITY_MISMATCH', `integrity check failed: ${spec.destinationPath}`);
                }
                emit({ ...base, state: 'completed', size: result.size });
                return { state: 'completed', size: result.size };
            } catch (error) {
                if (cancelled || error.code === 'DOWNLOAD_CANCELLED') {
                    emit({ ...base, state: 'cancelled' });
                    return { state: 'cancelled' };
                }
                emit({ ...base, state: 'failed', error: { code: error.code || 'DOWNLOAD_FAILED', message: error.message } });
                return { state: 'failed' };
            } finally {
                current = null;
            }
        }

        const promise = (async () => {
            const worker = async () => {
                while (!cancelled) {
                    const index = nextIndex++;
                    if (index >= files.length) return;
                    results[index] = await runOne(index, files[index]);
                }
            };
            const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, files.length));
            await Promise.all(Array.from({ length: workerCount }, worker));
            return { results };
        })();

        return {
            promise,
            cancel() {
                if (cancelled) return false;
                cancelled = true;
                if (current) current.cancel();
                return true;
            },
        };
    }

    return { start, startBatch };
}

module.exports = { createDownload, createElectronNetTransport };
