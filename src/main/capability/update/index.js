/**
 * update capability：安装包（大版本）的暂存、校验、安装与退出。公开方法保持无状态，版本策略由调用方编排。
 * 应用包（小版本）的查找、下载、清理见 `main/libs/pkg`。
 * 依赖装配与行为实现分离（createUpdateCapability），便于测试注入与平台差异覆盖。
 */
const path = require('path');
const fse = require('fs-extra');
const { createHash, randomUUID } = require('crypto');
const { execFile } = require('child_process');
const { app, dialog, shell } = require('electron');

const logger = require('../../libs/logger');
const os = require('../../libs/os');
const { getFilePathConfig } = require('../../paths');
const { loadOptionalPeer } = require('../../../shared/loadOptionalPeer');
const { createUpdateCapability } = require('./createUpdateCapability');

module.exports = createUpdateCapability({
    path,
    fse,
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
});
