const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
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
                    cleanup();
                    resolve({
                        statusCode: response.statusCode,
                        headers: response.headers,
                        body: response,
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

function createProgressTransform({ total, onProgress }) {
    let transferred = 0;
    return new Transform({
        transform(chunk, _encoding, callback) {
            transferred += chunk.length;
            onProgress?.({
                transferred,
                total: Number.isFinite(total) ? total : undefined,
                percent: Number.isFinite(total) && total > 0
                    ? Math.min(100, Math.round((transferred / total) * 100))
                    : undefined,
            });
            callback(null, chunk);
        },
    });
}

function createDownload(dependencies = {}) {
    const transport = dependencies.transport || createElectronNetTransport();
    const fsApi = dependencies.fsp || fsp;
    const streamFs = dependencies.fs || fs;

    function start({ urls, destinationPath, timeoutMs = 180000, headers, onProgress } = {}) {
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
                        const progress = createProgressTransform({ total: Number.isFinite(totalValue) ? totalValue : undefined, onProgress });
                        await pipeline(response.body, progress, streamFs.createWriteStream(tempPath));
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

    return { start };
}

module.exports = { createDownload, createElectronNetTransport };
