const { readAsarFile } = require('./readAsarFile');
const { DESCRIPTOR_FILE } = require('../../frameContract');

/**
 * 读取包（`.asar` / `.asax`）的描述文件。用原生 fs（Electron 下为 `original-fs`）解析归档，
 * 不让 Electron 缓存并持有归档句柄，详见 `readAsarFile`。归档格式与扩展名无关，`.asax` 同样可读。
 *
 * @param {string} pkgPath
 * @returns {Object|null}
 */
function readPkgDescriptor(pkgPath) {
    const rawFs = process.versions.electron ? require('original-fs') : require('fs');
    const content = readAsarFile(rawFs, pkgPath, DESCRIPTOR_FILE);
    return content ? JSON.parse(content.toString('utf8')) : null;
}

module.exports = { readPkgDescriptor };
