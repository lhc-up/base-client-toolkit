const path = require('path');
const dl = require('download');

let initialized = false;
let opts = null;

function assertInitialized() {
    if (!initialized) {
        throw new Error('[toolkit/downloader] Downloader not initialized');
    }
}

function reportError(err) {
    if (opts.logger && typeof opts.logger.error === 'function') {
        opts.logger.error(err);
    } else {
        console.error(err);
    }
}

/**
 * @param {object} [userOpts]
 * @param {object} [userOpts.logger] 具备 error 方法的 logger 实例
 */
function init(userOpts) {
    if (initialized) {
        throw new Error('[toolkit/downloader] Downloader already initialized');
    }
    opts = userOpts || {};
    initialized = true;
}

/**
 * 下载 URL 到目标目录下的指定文件名
 * @param {string} url
 * @param {string} destDir 目标目录（download 库会自动创建）
 * @param {object} downloadOpts
 * @param {string} downloadOpts.filename 文件名（不含目录部分；必传）
 * @param {(percent: number) => void} [downloadOpts.onProgress] 进度回调（percent 为 0-100 整数，1% 阈值节流）
 * @returns {Promise<string>} 落盘完成后的最终文件绝对路径
 */
function download(url, destDir, downloadOpts) {
    assertInitialized();
    const { filename, onProgress } = downloadOpts || {};
    if (!filename || typeof filename !== 'string') {
        throw new Error('[toolkit/downloader] download requires opts.filename');
    }
    return new Promise((resolve, reject) => {
        const stream = dl(url, destDir, { filename });
        if (typeof onProgress === 'function') {
            let lastPercent = 0;
            stream.on('downloadProgress', data => {
                const newPercent = Math.round(data.percent * 100);
                // 1% 阈值节流（bake 逻辑）
                if (newPercent - lastPercent < 1) return;
                lastPercent = newPercent;
                onProgress(newPercent);
            });
        }
        stream.then(() => {
            resolve(path.join(destDir, filename));
        }).catch(err => {
            reportError(err);
            reject(err);
        });
    });
}

module.exports = {
    init,
    download,
};
