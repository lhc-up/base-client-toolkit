function createUpdateCapability(deps) {
    const {
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
        filePathConfig,
        loadSudoPrompt,
    } = deps;

    const installerStageRoot = path.join(filePathConfig.temp, 'base-client-toolkit-installers');

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

    /**
     * 新开 xterm 终端窗口安装，显示安装过程。安装成功后提示，无论成败窗口都停留 3 秒再关闭。
     * 命令与业务项目原实现一致；安装包路径作为 sh 的参数 $1 传入，不拼进命令字符串。
     */
    function installByOpenShell(filePath) {
        const script = 'sudo dpkg -i "$1" && echo 安装完成，3s后退出安装程序\nsleep 3';
        return new Promise(resolve => {
            execFile(
                'xterm',
                ['-T', '安装更新', '-e', 'sh', '-c', script, 'sh', filePath],
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

    /**
     * 退出应用：先等日志 appender 全部写完，再 `app.exit(1)`。
     *
     * 不能盲等固定时长，也不能丢掉 `shutdown()` 的 Promise —— 大版本安装是最需要日志
     * 排查的路径，`app.exit` 又会跳过 `will-quit`（见 libs/logger 文件头的实测对照表）。
     * `logger.shutdown` 契约永不抛，这里不需要额外的错误分支。
     */
    async function quitApp() {
        await logger.shutdown();
        app.exit(1);
    }

    async function openInstaller(filePath) {
        const message = await shell.openPath(filePath);
        if (message) {
            dialog.showErrorBox('错误提示', '启动安装程序失败，请手动下载安装最新版本！');
            await quitApp();
            return { started: false, reason: 'open-failed', message };
        }
        await quitApp();
        return { started: true };
    }

    async function installApp(filePath) {
        if (os.isWindows() || os.isMacOS() || os.isLinux()) assertInstallerPath(filePath);
        logger.info('执行大版本安装文件', filePath);
        if (os.isLinux()) {
            const started = await installDebOnLinux(filePath);
            if (!started) {
                dialog.showErrorBox('错误提示', '自动更新失败，请下载最新的安装包手动安装！');
                await quitApp();
                return { started: false, reason: 'open-failed' };
            }
            // 与业务项目原实现一致：龙芯在终端窗口关闭（安装结束）后退出；其他发行版交给系统安装器后不退出
            if (os.isLoongnix()) await quitApp();
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
        stageLocalInstaller,
        installApp,
        installStagedInstaller,
        discardStagedInstaller,
        cleanupStagedInstallers,
        quitApp,
    };
}

module.exports = { createUpdateCapability };
