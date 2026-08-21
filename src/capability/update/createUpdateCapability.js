function createUpdateCapability(deps) {
    const {
        path,
        fse,
        semver,
        download,
        randomUUID,
        createHash,
        execFile,
        app,
        dialog,
        shell,
        logger,
        os,
        filePathConfig,
        loadSudoPrompt,
        setTimeout: schedule,
    } = deps;

    const updatePackageDir = filePathConfig.updatePackage;

    function getUpdatePkgList(corePkg) {
        fse.ensureDirSync(updatePackageDir);
        return fse
            .readdirSync(updatePackageDir)
            .map(name => {
                try {
                    const jsonPath = path.join(updatePackageDir, name, 'package.json');
                    if (!fse.existsSync(jsonPath)) return null;
                    const pkg = fse.readJSONSync(jsonPath);
                    return {
                        ...pkg,
                        path: path.join(updatePackageDir, name),
                        type: 'update',
                    };
                } catch (err) {
                    logger.error(err);
                    return null;
                }
            })
            .filter(pkg => pkg?.name === corePkg.name)
            .sort((a, b) => semver.rcompare(a.version, b.version));
    }

    function getNewestPkg(corePkg) {
        const core = { ...corePkg, type: 'core' };
        const newestLocalPkg = getUpdatePkgList(corePkg)[0];
        if (!newestLocalPkg || semver.gte(core.version, newestLocalPkg.version)) return core;
        return newestLocalPkg;
    }

    async function downloadPkg(option = {}) {
        const { url, integrity } = option;
        if (typeof url !== 'string' || !url) {
            throw new TypeError('update.downloadPkg url 不能为空');
        }

        let sourceName;
        try {
            sourceName = path.posix.basename(new URL(url).pathname);
        } catch {
            throw new TypeError(`update.downloadPkg url 无效：${url}`);
        }
        if (!/\.asax$/i.test(sourceName)) {
            throw new Error(`update.downloadPkg 只接受 .asax 增量包：${sourceName}`);
        }

        fse.ensureDirSync(updatePackageDir);
        const tempName = randomUUID();
        const tempPath = path.join(updatePackageDir, tempName);
        const finalName = sourceName.replace(/\.asax$/i, '.asar');
        const finalPath = path.join(updatePackageDir, finalName);

        try {
            await download(url, updatePackageDir, { filename: tempName });
            if (integrity !== undefined) {
                const expected = String(integrity).replace(/^sha256-/i, '').toLowerCase();
                if (!/^[a-f0-9]{64}$/.test(expected)) {
                    throw new TypeError('update.downloadPkg integrity must be a SHA-256 hex digest');
                }
                const actual = createHash('sha256')
                    .update(fse.readFileSync(tempPath))
                    .digest('hex');
                if (actual !== expected) throw new Error('update package integrity check failed');
            }
            if (fse.existsSync(finalPath)) fse.removeSync(finalPath);
            fse.renameSync(tempPath, finalPath);
            return finalPath;
        } catch (err) {
            try { fse.removeSync(tempPath); } catch { /* best effort */ }
            logger.error(err);
            throw err;
        }
    }

    function installByOpenShell(filePath) {
        return new Promise(resolve => {
            execFile(
                'xterm',
                ['-T', 'Install update', '-e', 'sudo', 'dpkg', '-i', filePath],
                (err, _stdout, stderr) => resolve(!err && !stderr),
            );
        });
    }

    function installByXdgOpen(filePath) {
        return new Promise(resolve => {
            execFile('xdg-open', [filePath], (err, _stdout, stderr) => resolve(!err && !stderr));
        });
    }

    function installByDpkg(filePath) {
        return new Promise(resolve => {
            const sudo = loadSudoPrompt();
            const quotedPath = `'${filePath.replaceAll("'", "'\\''")}'`;
            sudo.exec(`dpkg -i ${quotedPath}`, { name: 'install' }, error => resolve(!error));
        });
    }

    function assertInstallerPath(filePath) {
        if (typeof filePath !== 'string' || !filePath) {
            throw new TypeError('installer path must be a non-empty string');
        }
        const platformPath = os.isWindows() ? path.win32 : path.posix;
        if (!platformPath.isAbsolute(filePath)) {
            throw new Error('installer path must be absolute');
        }
        const extension = platformPath.extname(filePath).toLowerCase();
        const allowed = os.isWindows()
            ? ['.exe', '.msi']
            : os.isMacOS()
                ? ['.dmg', '.pkg']
                : ['.deb'];
        if (!allowed.includes(extension)) {
            throw new Error(`installer extension is not allowed on this platform: ${extension || '(none)'}`);
        }
    }

    async function installDebOnLinux(filePath) {
        try {
            if (os.isLoongnix()) return installByOpenShell(filePath);
            return await installByXdgOpen(filePath) || installByDpkg(filePath);
        } catch (err) {
            logger.error(err);
            return false;
        }
    }

    function quitApp() {
        logger.shutdown();
        schedule(() => app.exit(1), 500);
    }

    async function openInstaller(filePath) {
        const message = await shell.openPath(filePath);
        if (message) {
            dialog.showErrorBox('错误提示', '启动安装程序失败，请手动下载安装最新版本！');
            quitApp();
            return { started: false, reason: 'open-failed', message };
        }
        quitApp();
        return { started: true };
    }

    async function installApp(filePath) {
        if (os.isWindows() || os.isMacOS() || os.isLinux()) assertInstallerPath(filePath);
        logger.info('执行大版本安装文件', filePath);
        if (os.isLinux()) {
            const started = await installDebOnLinux(filePath);
            if (!started) {
                dialog.showErrorBox('错误提示', '自动更新失败，请下载最新的安装包手动安装！');
                quitApp();
                return { started: false, reason: 'open-failed' };
            }
            quitApp();
            return { started: true };
        }
        if (os.isWindows() || os.isMacOS()) return openInstaller(filePath);
        logger.error('不支持当前平台自动安装更新');
        return { started: false, reason: 'unsupported-platform' };
    }

    return { getUpdatePkgList, getNewestPkg, downloadPkg, installApp, quitApp };
}

module.exports = { createUpdateCapability };
