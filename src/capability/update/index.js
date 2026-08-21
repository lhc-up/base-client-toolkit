/**
 * Toolkit T-08: capability/update
 *
 * 公开方法保持无状态；业务 manifest、UI 和版本策略由调用方传入或编排。
 * 依赖装配与行为实现分离，便于覆盖不同平台且避免加载未使用的 optional peer。
 */

const path = require('path');
const fse = require('fs-extra');
const semver = require('semver');
const download = require('download');
const { randomUUID } = require('crypto');
const { exec } = require('child_process');
const { app, dialog, shell } = require('electron');

const logger = require('../logger');
const os = require('../os');
const { getFilePathConfig } = require('../../paths');
const { createUpdateCapability } = require('./createUpdateCapability');

module.exports = createUpdateCapability({
    path,
    fse,
    semver,
    download,
    randomUUID,
    exec,
    app,
    dialog,
    shell,
    logger,
    os,
    filePathConfig: getFilePathConfig(),
    loadSudoPrompt: () => require('@vscode/sudo-prompt'),
    setTimeout,
});
