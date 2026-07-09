/**
 * Toolkit T-08: capability/update
 *
 * 完全照搬 base-client.bake：
 *   src/main/libs/package.js  → getUpdatePkgList / getNewestPkg / downloadPkg
 *   src/main/libs/app.js      → installApp / installByOpenShell / installByXdgOpen /
 *                                installByDpkg / installDebOnLinux / quitApp
 *
 * 顶层 require ../logger、../os、shared/paths、外部包（DAG 允许）。
 * corePkg 由函数调用方传入（业务参数不 init 注入）。
 */

const path = require('path');
const fse = require('fs-extra');
const semver = require('semver');
const download = require('download');
const sudo = require('@vscode/sudo-prompt');
const { randomUUID } = require('crypto');
const { exec } = require('child_process');
const { app, dialog, shell } = require('electron');

const logger = require('../logger');
const { isLinux, isLoongnix, isWindows } = require('../os');
const { getFilePathConfig } = require('../../shared/paths');

const filePathConfig = getFilePathConfig();

function getUpdatePkgList(corePkg) {
    // 扫描本地更新包，注意检查项目标识，列出所有的版本，包括核心版本（打在安装包里的版本），取最新版本
    const pkgList = fse
        .readdirSync(filePathConfig.updatePackage)
        .map(v => {
            try {
                const jsonPath = path.join(
                    filePathConfig.updatePackage,
                    v,
                    'package.json'
                );
                if (!fse.existsSync(jsonPath)) return null;
                const pkg = fse.readJSONSync(jsonPath);
                pkg.path = path.join(filePathConfig.updatePackage, v);
                pkg.type = 'update';
                return pkg;
            } catch (err) {
                logger.error(err);
                return null;
            }
        })
        .filter(json => {
            if (!json) return false;
            return json.name === corePkg.name;
        })
        .sort((a, b) => {
            // 按版本号降序
            return semver.rcompare(a.version, b.version);
        });
    return pkgList;
}

/**
 * 获取最新的程序版本
 */
function getNewestPkg(corePkg) {
    const core = {
        ...corePkg,
        type: 'core',
    };
    const pkgList = getUpdatePkgList(corePkg);
    const newestLocalPkg = pkgList[0];
    if (!newestLocalPkg) return core;
    // 核心版本较新
    if (semver.gte(core.version, newestLocalPkg.version)) return core;
    return newestLocalPkg;
}

function downloadPkg(option) {
    return new Promise((resolve, reject) => {
        const tempName = randomUUID();
        const tempPath = path.join(filePathConfig.updatePackage, tempName);
        download(option.url, filePathConfig.updatePackage, {
            filename: tempName,
        }).then(() => {
            // 改为 asar 后缀
            const finalName = path.basename(option.url).replace('.asax', '.asar');
            const finalPath = path.join(filePathConfig.updatePackage, finalName);
            fse.renameSync(tempPath, finalPath);
            resolve(finalPath);
        }).catch(err => {
            logger.error(err);
            reject(err);
        });
    });
}

// 使用新开命令行的方式安装
function installByOpenShell(filePath) {
    return new Promise(resolve => {
        // 使用 xterm 命令新开一个窗口并保持该窗口不关闭，以显示安装进度
        const command = `xterm -T 安装更新 -e "sudo dpkg -i ${filePath} && echo 安装完成，3s后退出安装程序\n sleep 3"`;
        exec(command, (err, stdout, stderr) => {
            if (err) return resolve(false);
            if (stderr) return resolve(false);
            resolve(true);
        });
    });
}

// 使用 xdg-open 命令触发默认的安装器
function installByXdgOpen(filePath) {
    return new Promise(resolve => {
        const command = `xdg-open ${filePath}`;
        exec(command, (err, stdout, stderr) => {
            if (err) return resolve(false);
            if (stderr) return resolve(false);
            resolve(true);
        });
    });
}

// 使用 dpkg 命令静默安装，需要 root 权限
function installByDpkg(filePath) {
    return new Promise(resolve => {
        const options = {
            name: 'install',
        };
        const command = `dpkg -i ${filePath}`;
        sudo.exec(command, options, error => {
            if (error) return resolve(false);
            resolve(true);
        });
    });
}

// 在 linux 上安装 deb 包
async function installDebOnLinux(filePath) {
    try {
        if (isLoongnix()) {
            // 龙芯系统无法使用 xdg-open 调起安装器，这里使用 xterm 命令打开终端窗口安装
            // 新开的终端退出后，这里才会收到返回值，如果无异常，需要退出客户端，防止出现用户直接关掉终端，导致客户端挂起的情况
            const success = await installByOpenShell(filePath);
            if (success) return quitApp();
            return success;
        }

        let success = await installByXdgOpen(filePath);
        if (!success) {
            success = await installByDpkg(filePath);
        }
        return success;
    } catch (err) {
        logger.error(err);
        return false;
    }
}

async function installApp(filePath) {
    logger.info('执行大版本安装文件', filePath);
    if (isLinux()) {
        const success = await installDebOnLinux(filePath);
        if (!success) {
            dialog.showErrorBox(
                '错误提示',
                '自动更新失败，请下载最新的安装包手动安装！'
            );
            quitApp();
        }
        return;
    }
    if (isWindows()) {
        const errMsg = await shell.openPath(filePath);
        if (errMsg) {
            // 安装失败之后，先展示弹窗提示，用户点击确定后，再退出客户端
            dialog.showErrorBox(
                '错误提示',
                '启动安装程序失败，请手动下载安装最新版本！'
            );
        }
        quitApp();
    }
}

function quitApp() {
    logger.shutdown();
    setTimeout(() => {
        app.exit(1);
    }, 500);
}

module.exports = {
    getUpdatePkgList,
    getNewestPkg,
    downloadPkg,
    installApp,
    quitApp,
};
