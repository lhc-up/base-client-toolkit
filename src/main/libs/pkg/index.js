/**
 * 包的通用操作（主进程）：`get` / `download` / `removeOtherVersions` / `parseDevSources`。
 * 行为见 createPkgLib.js，设计见 docs/design/pkg-source.md。
 */
const path = require('path');
const os = require('os');
const { createHash, randomUUID } = require('crypto');
const { pathToFileURL } = require('url');
const fse = require('fs-extra');
const semver = require('semver');
const { app } = require('electron');

const logger = require('../logger');
const { createDownload } = require('../download');
const { getFilePathConfig } = require('../../paths');
const { resolveResource } = require('../resourceRoot');
const { HOST_RUNTIME_KEY } = require('../../../shared/hostKeys');
const { createPkgLib } = require('./createPkgLib');
const { readPkgDescriptor } = require('./readPkgDescriptor');
const { BUILTIN_PKG_DIR } = require('../../frameContract');

const FETCH_TIMEOUT_MS = 5000;

/**
 * GET 一个 JSON（本地调试时读 dev server 上的描述文件）。
 *
 * @param {string} url
 * @returns {Promise<Object>}
 */
function fetchJson(url) {
    const client = url.startsWith('https:') ? require('https') : require('http');
    return new Promise((resolve, reject) => {
        const req = client.get(url, { timeout: FETCH_TIMEOUT_MS }, res => {
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                } catch (err) {
                    reject(err);
                }
            });
            res.on('error', reject);
        });
        req.on('timeout', () => req.destroy(new Error(`超时（${FETCH_TIMEOUT_MS}ms）`)));
        req.on('error', reject);
    });
}

module.exports = createPkgLib({
    path,
    fse,
    semver,
    logger,
    readPkgDescriptor,
    fetchJson,
    startDownload: createDownload().start,
    randomUUID,
    createHash,
    toFileUrl: filePath => pathToFileURL(filePath).href,
    // 未建立宿主运行时（存量项目）时视为打包运行
    getHostRuntime: () => globalThis[Symbol.for(HOST_RUNTIME_KEY)] || {},
    // 内置目录：<资源根目录>/packages。调用时计算：资源根目录取决于宿主运行方式
    getBuiltinDir: () => resolveResource(BUILTIN_PKG_DIR),
    getUpdateDir: () => getFilePathConfig().updatePackage,
    getCopyDir: () => path.join(os.tmpdir(), 'base-client', app.getName(), 'pkg-copies'),
});
