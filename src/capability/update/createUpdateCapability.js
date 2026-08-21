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
    const installerStageRoot = path.join(filePathConfig.temp, 'base-client-toolkit-installers');

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

    function normalizeIntegrity(integrity, { required = false } = {}) {
        if (integrity === undefined && !required) return null;
        const expected = String(integrity || '').replace(/^sha256-/i, '').toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(expected)) {
            throw new TypeError('update package integrity must be a SHA-256 hex digest');
        }
        return expected;
    }

    function verifyIntegrity(filePath, integrity, options) {
        const expected = normalizeIntegrity(integrity, options);
        if (!expected) return;
        const actual = createHash('sha256')
            .update(fse.readFileSync(filePath))
            .digest('hex');
        if (actual !== expected) throw new Error('update package integrity check failed');
    }

    function getPackagePaths(sourceName) {
        fse.ensureDirSync(updatePackageDir);
        const tempPath = path.join(updatePackageDir, randomUUID());
        const finalName = sourceName.replace(/\.asax$/i, '.asar');
        return { tempPath, finalPath: path.join(updatePackageDir, finalName) };
    }

    function promoteTempPackage({ tempPath, finalPath, integrity, integrityRequired = false }) {
        verifyIntegrity(tempPath, integrity, { required: integrityRequired });
        if (fse.existsSync(finalPath)) fse.removeSync(finalPath);
        fse.renameSync(tempPath, finalPath);
        return finalPath;
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

        const { tempPath, finalPath } = getPackagePaths(sourceName);

        try {
            await download(url, updatePackageDir, { filename: path.basename(tempPath) });
            return promoteTempPackage({ tempPath, finalPath, integrity });
        } catch (err) {
            try { fse.removeSync(tempPath); } catch { /* best effort */ }
            logger.error(err);
            throw err;
        }
    }

    async function stageLocalPkg({ sourcePath, integrity } = {}) {
        if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) {
            throw new TypeError('update.stageLocalPkg sourcePath must be absolute');
        }
        const sourceName = path.basename(sourcePath);
        if (!/\.asax$/i.test(sourceName)) {
            throw new Error(`update.stageLocalPkg only accepts .asax packages: ${sourceName}`);
        }

        const { tempPath, finalPath } = getPackagePaths(sourceName);
        try {
            fse.copyFileSync(sourcePath, tempPath);
            return promoteTempPackage({
                tempPath,
                finalPath,
                integrity,
                integrityRequired: true,
            });
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
        if (!os.isWindows() && !os.isMacOS() && !os.isLinux()) {
            throw new Error('installer platform is unsupported');
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
        return platformPath;
    }

    async function stageLocalInstaller({ sourcePath, integrity } = {}) {
        const platformPath = assertInstallerPath(sourcePath);
        const expected = normalizeIntegrity(integrity, { required: true });
        const stageDir = path.join(installerStageRoot, randomUUID());
        const fileName = platformPath.basename(sourcePath);
        const filePath = path.join(stageDir, fileName);
        try {
            fse.ensureDirSync(stageDir);
            fse.copyFileSync(sourcePath, filePath);
            verifyIntegrity(filePath, expected, { required: true });
            return { filePath, integrity: expected, fileName };
        } catch (err) {
            try { fse.removeSync(stageDir); } catch { /* best effort */ }
            logger.error(err);
            throw err;
        }
    }

    function resolveStagedInstaller(staged = {}) {
        if (!staged || typeof staged !== 'object') {
            throw new TypeError('staged installer descriptor must be an object');
        }
        const platformPath = assertInstallerPath(staged.filePath);
        const integrity = normalizeIntegrity(staged.integrity, { required: true });
        const root = path.resolve(installerStageRoot);
        const filePath = path.resolve(staged.filePath);
        const relative = path.relative(root, filePath);
        const segments = relative.split(path.sep).filter(Boolean);
        if (!relative
            || relative.startsWith(`..${path.sep}`)
            || relative === '..'
            || path.isAbsolute(relative)
            || segments.length !== 2
            || platformPath.basename(filePath) !== staged.fileName) {
            throw new Error('staged installer path is outside the controlled temp namespace');
        }
        return { filePath, integrity, stageDir: path.dirname(filePath) };
    }

    function discardStagedInstaller(staged) {
        const { stageDir } = resolveStagedInstaller(staged);
        fse.removeSync(stageDir);
        return true;
    }

    function cleanupStagedInstallers({ maxAgeMs = 24 * 60 * 60 * 1000, now = Date.now() } = {}) {
        if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
            throw new TypeError('staged installer maxAgeMs must be a non-negative number');
        }
        fse.ensureDirSync(installerStageRoot);
        let removed = 0;
        for (const name of fse.readdirSync(installerStageRoot)) {
            const entry = path.join(installerStageRoot, name);
            try {
                if (now - fse.statSync(entry).mtimeMs < maxAgeMs) continue;
                fse.removeSync(entry);
                removed += 1;
            } catch (err) {
                logger.error(err);
            }
        }
        return { removed };
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

    async function installStagedInstaller(staged = {}) {
        const { filePath, integrity } = resolveStagedInstaller(staged);
        verifyIntegrity(filePath, integrity, { required: true });
        return installApp(filePath);
    }

    return {
        getUpdatePkgList,
        getNewestPkg,
        downloadPkg,
        stageLocalPkg,
        stageLocalInstaller,
        installApp,
        installStagedInstaller,
        discardStagedInstaller,
        cleanupStagedInstallers,
        quitApp,
    };
}

module.exports = { createUpdateCapability };
