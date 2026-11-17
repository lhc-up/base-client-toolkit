/**
 * update capability：公开方法保持无状态，业务 manifest、UI 和版本策略由调用方编排。
 * 依赖装配与行为实现分离（createUpdateCapability），便于测试注入与平台差异覆盖。
 */
const path = require('path');
const fse = require('fs-extra');
const semver = require('semver');
const { createHash, randomUUID } = require('crypto');
const { execFile } = require('child_process');
const { app, dialog, shell } = require('electron');

const logger = require('../../libs/logger');
const os = require('../../libs/os');
const { getFilePathConfig } = require('../../paths');
const { loadOptionalPeer } = require('../../../shared/loadOptionalPeer');
const { createDownload } = require('../../libs/download');
const { createUpdateCapability } = require('./createUpdateCapability');
const { readAsarFile } = require('./readAsarFile');

/**
 * 读取包的描述文件。用原生 fs（Electron 下为 `original-fs`）解析归档，
 * 不让 Electron 缓存并持有归档句柄，详见 `readAsarFile`。
 */
function readPkgDescriptor(pkgPath) {
    const rawFs = process.versions.electron ? require('original-fs') : require('fs');
    const content = readAsarFile(rawFs, pkgPath, 'package.json');
    return content ? JSON.parse(content.toString('utf8')) : null;
}

module.exports = createUpdateCapability({
    path,
    fse,
    semver,
    // 下载底座用自家 libs/download（有 onProgress、走 Electron net.request），
    // 不再用 npm `download`（无进度回调，已整体移除）。`start` 是闭包、不依赖 this
    startDownload: createDownload().start,
    randomUUID,
    createHash,
    execFile,
    app,
    dialog,
    shell,
    logger,
    os,
    filePathConfig: getFilePathConfig(),
    loadSudoPrompt: () => loadOptionalPeer('@vscode/sudo-prompt'),
    setTimeout,
    // 安装包内置包目录（frame 约定 resources/packages/）；dev 下 resourcesPath 指向 electron 自身，
    // 目录不存在时 findPkg 自动跳过
    builtinPackageDir: process.resourcesPath ? path.join(process.resourcesPath, 'packages') : null,
    readPkgDescriptor,
});
