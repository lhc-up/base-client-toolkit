function createUpdateCapability(deps) {
    const {
        path,
        fse,
        randomUUID,
        createHash,
        app,
        dialog,
        shell,
        logger,
        os,
        filePathConfig,
        debInstaller,
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

    /** 静默安装（Linux 兜底的最后一层）的结果文件：客户端下次启动时由 consumeInstallResult 读取 */
    const installResultFile = path.join(filePathConfig.updatePackage, '.install-result.json');

    /**
     * Linux：交给 @base-client/deb-installer 的 installDeb（系统安装器 → 终端 → 静默），交出后退出客户端。
     * 安装器、终端、后台脚本都与客户端脱离，客户端退出不影响它们；安装是否成功由它们自己提示
     * （静默安装把结果写入结果文件，并按 options.relaunch 重新启动客户端）。
     */
    async function installDebOnLinux(filePath, options) {
        const result = await debInstaller.installDeb({
            debPath: filePath,
            packageName: options.packageName,
            version: options.version,
            logger,
            resultFile: installResultFile,
            relaunch: options.relaunch,
        });
        if (!result.started) {
            logger.error('[升级] 未能交出安装', result);
            dialog.showErrorBox('错误提示', '自动更新失败，请下载最新的安装包手动安装！');
            await quitApp();
            return { started: false, reason: result.reason, detail: result.detail };
        }
        logger.info('[升级] 已交出安装', result);
        await quitApp();
        return { started: true, method: result.method };
    }

    /**
     * 读取并删除上一次静默安装的结果（没有时返回 null）。宿主在启动时调用，按 status 提示用户。
     *
     * @returns {{ status: 'success'|'unauthorized'|'failed', code: number, packageName: string, version: string, logFile: string, finishedAt: string }|null}
     */
    function consumeInstallResult() {
        if (!fse.existsSync(installResultFile)) return null;
        let result = null;
        try {
            result = fse.readJSONSync(installResultFile);
        } catch (err) {
            logger.error('[升级] 安装结果文件无法解析', installResultFile, err);
        }
        try {
            fse.removeSync(installResultFile);
        } catch (err) {
            logger.error('[升级] 删除安装结果文件失败', installResultFile, err);
        }
        return result;
    }

    /**
     * 安装大版本。
     *
     * @param {string} filePath 安装包绝对路径
     * @param {{ packageName?: string, version?: string, relaunch?: { command: string, args?: string[] } }} [options]
     *        仅 Linux 使用：packageName / version 为期望值（与 deb 中不一致则不安装）；relaunch 为静默安装结束后重新启动的命令
     */
    async function installApp(filePath, options = {}) {
        if (os.isWindows() || os.isMacOS() || os.isLinux()) assertInstallerPath(filePath);
        logger.info('执行大版本安装文件', filePath);
        if (os.isLinux()) return installDebOnLinux(filePath, options || {});
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
        consumeInstallResult,
        quitApp,
    };
}

module.exports = { createUpdateCapability };
