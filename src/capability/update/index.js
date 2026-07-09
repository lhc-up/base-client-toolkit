const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { exec } = require('child_process');
const semver = require('semver');
const sudo = require('@vscode/sudo-prompt');
const { app, dialog, shell } = require('electron');

let initialized = false;
let opts = null;

function assertInitialized() {
    if (!initialized) {
        throw new Error('[toolkit/update] Update not initialized');
    }
}

function reportError(err) {
    if (opts.logger && typeof opts.logger.error === 'function') {
        opts.logger.error(err);
    } else {
        console.error(err);
    }
}

function reportInfo(msg, ...args) {
    if (opts.logger && typeof opts.logger.info === 'function') {
        opts.logger.info(msg, ...args);
    } else {
        console.info(msg, ...args);
    }
}

/**
 * @param {object} userOpts
 * @param {string} userOpts.updatePackageDir 更新包目录（每个更新包一个子目录，内含 package.json）
 * @param {{ name: string, version: string }} userOpts.corePkg 打在安装包里的核心版本
 * @param {object} userOpts.os T-02 capability 或兼容对象（需 isLinux/isWindows/isLoongnix）
 * @param {object} userOpts.downloader T-06 capability 或兼容对象（需 download(url, dir, { filename }) => Promise<string>）
 * @param {object} [userOpts.logger] 可选。需 error（用于 catch）/ info（用于安装日志）/ shutdown（用于 quitApp 前 flush）
 */
function init(userOpts) {
    if (initialized) {
        throw new Error('[toolkit/update] Update already initialized');
    }
    opts = userOpts || {};
    if (!opts.updatePackageDir || typeof opts.updatePackageDir !== 'string') {
        throw new Error('[toolkit/update] init requires opts.updatePackageDir');
    }
    if (!opts.corePkg || !opts.corePkg.name || !opts.corePkg.version) {
        throw new Error('[toolkit/update] init requires opts.corePkg with name+version');
    }
    if (!opts.os || typeof opts.os.isLinux !== 'function' || typeof opts.os.isWindows !== 'function' || typeof opts.os.isLoongnix !== 'function') {
        throw new Error('[toolkit/update] init requires opts.os with isLinux/isWindows/isLoongnix');
    }
    if (!opts.downloader || typeof opts.downloader.download !== 'function') {
        throw new Error('[toolkit/update] init requires opts.downloader with download function');
    }
    initialized = true;
}

// —— 更新包扫描 ——

/**
 * 扫描本地更新包，返回按 version 降序的列表。
 * 每项形态：{ name, version, path, type: 'update', ...其他 package.json 字段 }
 * @returns {Array<object>}
 */
function getUpdatePkgList() {
    assertInitialized();
    let entries;
    try {
        entries = fs.readdirSync(opts.updatePackageDir);
    } catch (err) {
        reportError(err);
        return [];
    }
    return entries
        .map(v => {
            try {
                const jsonPath = path.join(opts.updatePackageDir, v, 'package.json');
                if (!fs.existsSync(jsonPath)) return null;
                const pkg = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
                pkg.path = path.join(opts.updatePackageDir, v);
                pkg.type = 'update';
                return pkg;
            } catch (err) {
                reportError(err);
                return null;
            }
        })
        .filter(json => {
            if (!json) return false;
            return json.name === opts.corePkg.name;
        })
        .sort((a, b) => semver.rcompare(a.version, b.version));
}

/**
 * 核心版本 vs 最新本地更新包，返回较新的。
 * @returns {object} { name, version, type: 'core' | 'update', path? }
 */
function getNewestPkg() {
    assertInitialized();
    const corePkg = { ...opts.corePkg, type: 'core' };
    const [newestLocalPkg] = getUpdatePkgList();
    if (!newestLocalPkg) return corePkg;
    if (semver.gte(corePkg.version, newestLocalPkg.version)) return corePkg;
    return newestLocalPkg;
}

// —— 增量包下载：.asax → .asar ——

/**
 * 下载增量包到 updatePackageDir，落盘后按 URL basename 改名（.asax → .asar）。
 * @param {object} option
 * @param {string} option.url
 * @returns {Promise<string>} 最终 .asar 文件绝对路径
 */
function downloadPkg(option) {
    assertInitialized();
    return new Promise((resolve, reject) => {
        const tempName = randomUUID();
        opts.downloader.download(option.url, opts.updatePackageDir, { filename: tempName })
            .then(tempPath => {
                const finalName = path.basename(option.url).replace('.asax', '.asar');
                const finalPath = path.join(opts.updatePackageDir, finalName);
                fs.renameSync(tempPath, finalPath);
                resolve(finalPath);
            })
            .catch(err => {
                reportError(err);
                reject(err);
            });
    });
}

// —— 多平台安装 ——

function installByOpenShell(filePath) {
    return new Promise(resolve => {
        const command = `xterm -T 安装更新 -e "sudo dpkg -i ${filePath} && echo 安装完成，3s后退出安装程序\n sleep 3"`;
        exec(command, (err, stdout, stderr) => {
            if (err) return resolve(false);
            if (stderr) return resolve(false);
            resolve(true);
        });
    });
}

function installByXdgOpen(filePath) {
    return new Promise(resolve => {
        exec(`xdg-open ${filePath}`, (err, stdout, stderr) => {
            if (err) return resolve(false);
            if (stderr) return resolve(false);
            resolve(true);
        });
    });
}

function installByDpkg(filePath) {
    return new Promise(resolve => {
        sudo.exec(`dpkg -i ${filePath}`, { name: 'install' }, error => {
            if (error) return resolve(false);
            resolve(true);
        });
    });
}

async function installDebOnLinux(filePath) {
    try {
        if (opts.os.isLoongnix()) {
            // 龙芯系统无法使用 xdg-open 调起安装器，用 xterm 命令打开终端窗口安装
            const success = await installByOpenShell(filePath);
            if (success) return quitApp();
            return success;
        }
        let success = await installByXdgOpen(filePath);
        if (!success) success = await installByDpkg(filePath);
        return success;
    } catch (err) {
        reportError(err);
        return false;
    }
}

/**
 * 全量安装包多平台安装。成功后调用 quitApp（logger.shutdown + app.exit(1) 延时 500ms）。
 * @param {string} filePath 安装包绝对路径
 */
async function installApp(filePath) {
    assertInitialized();
    reportInfo('执行大版本安装文件', filePath);
    if (opts.os.isLinux()) {
        const success = await installDebOnLinux(filePath);
        if (!success) {
            dialog.showErrorBox('错误提示', '自动更新失败，请下载最新的安装包手动安装！');
            quitApp();
        }
        return;
    }
    if (opts.os.isWindows()) {
        const errMsg = await shell.openPath(filePath);
        if (errMsg) {
            // 安装失败之后，先展示弹窗提示，用户点击确定后，再退出客户端
            dialog.showErrorBox('错误提示', '启动安装程序失败，请手动下载安装最新版本！');
        }
        quitApp();
    }
}

/**
 * 退出应用。logger.shutdown flush 日志后延时 500ms 调 app.exit(1)。
 */
function quitApp() {
    if (opts.logger && typeof opts.logger.shutdown === 'function') {
        opts.logger.shutdown();
    }
    setTimeout(() => {
        app.exit(1);
    }, 500);
}

module.exports = {
    init,
    getUpdatePkgList,
    getNewestPkg,
    downloadPkg,
    installApp,
    quitApp,
};
