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
});
