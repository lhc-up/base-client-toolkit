function createUpdateCapability(deps) {
    const {
        path,
        fse,
        semver,
        startDownload,
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
        builtinPackageDir,
        readPkgDescriptor,
    } = deps;

    const updatePackageDir = filePathConfig.updatePackage;
    const installerStageRoot = path.join(filePathConfig.temp, 'base-client-toolkit-installers');

    /**
     * 读取目录下全部包（`*.asar`）的描述文件。
     *
     * 只认 `.asar` 结尾的条目：下载中的临时文件不带该后缀。
     * 描述文件经 `readPkgDescriptor` 读取，不经 Electron 的 asar 支持，
     * 否则被读过的包会被 Electron 持有句柄，Windows 下再也删不掉。
     *
     * @param {string} dir
     * @param {'builtin'|'update'} type
     * @returns {Array<Object>} 描述文件内容 + `path` + `type`
     */
    function readPkgDir(dir, type) {
        return fse
            .readdirSync(dir)
            .filter(name => /\.asar$/i.test(name))
            .map(name => {
                const pkgPath = path.join(dir, name);
                try {
                    const pkg = readPkgDescriptor(pkgPath);
                    return pkg ? { ...pkg, path: pkgPath, type } : null;
                } catch (err) {
                    logger.error(err);
                    return null;
                }
            })
            .filter(Boolean);
    }

    function getUpdatePkgList(corePkg) {
        fse.ensureDirSync(updatePackageDir);
        return readPkgDir(updatePackageDir, 'update')
            .filter(pkg => pkg.name === corePkg.name)
            .sort((a, b) => semver.rcompare(a.version, b.version));
    }

    /**
     * 在内置目录与下载目录中查找包。
     *
     * 只做匹配，不做选择策略：调用方决定要「与配置一致的版本」（传 version）
     * 还是「最新版本」（不传 version）。同版本时内置包优先（无需下载、随安装包可信）。
     *
     * @param {Object} query
     * @param {string} query.name 包名
     * @param {string} query.env 环境，必须一致（生产环境不会命中测试环境的包）
     * @param {string} [query.version] 精确版本；省略时返回最新版本
     * @returns {Object|null} 描述文件内容 + `path` + `type`（`builtin` / `update`）
     * @throws {TypeError} name / env 为空
     */
    function findPkg({ name, env, version } = {}) {
        if (typeof name !== 'string' || !name) throw new TypeError('update.findPkg name 不能为空');
        if (typeof env !== 'string' || !env) throw new TypeError('update.findPkg env 不能为空');
        fse.ensureDirSync(updatePackageDir);
        const builtin = builtinPackageDir && fse.existsSync(builtinPackageDir)
            ? readPkgDir(builtinPackageDir, 'builtin')
            : [];
        const candidates = [...builtin, ...readPkgDir(updatePackageDir, 'update')]
            .filter(pkg => pkg.name === name
                && pkg.env === env
                && semver.valid(pkg.version)
                && (version === undefined || pkg.version === version));
        if (!candidates.length) return null;
        const rank = pkg => (pkg.type === 'builtin' ? 0 : 1);
        candidates.sort((a, b) => semver.rcompare(a.version, b.version) || rank(a) - rank(b));
        return candidates[0];
    }

    /**
     * 删除一个 `.asar` 文件，并核对确实删掉。
     *
     * 本进程中被 Electron 读过的包（require 过其中模块、加载过其中页面）句柄被持有，
     * Windows 下 `fse.removeSync` 会静默不删。因此删后按目录列表核对，删不掉时明确抛错。
     * 是否存在也按目录列表判断：Electron 会把 `.asar` 路径当作目录，`existsSync` 不可靠。
     *
     * @param {string} filePath
     * @throws {Error} 文件被占用、删除失败
     */
    function removeAsarFile(filePath) {
        const dir = path.dirname(filePath);
        const name = path.basename(filePath);
        if (!fse.readdirSync(dir).includes(name)) return;
        fse.removeSync(filePath);
        if (fse.readdirSync(dir).includes(name)) {
            throw new Error(`包文件被占用，无法删除：${filePath}`);
        }
    }

    /**
     * 删除下载目录中同名包的其他版本。内置目录随安装包，不在清理范围内。
     *
     * @param {Object} option
     * @param {string} option.name 包名
     * @param {string} [option.keepPath] 要保留的包路径
     * @returns {{ removed: number }}
     * @throws {TypeError} name 为空
     */
    function cleanupPkgs({ name, keepPath } = {}) {
        if (typeof name !== 'string' || !name) throw new TypeError('update.cleanupPkgs name 不能为空');
        fse.ensureDirSync(updatePackageDir);
        const keep = keepPath ? path.resolve(keepPath) : null;
        let removed = 0;
        for (const pkg of readPkgDir(updatePackageDir, 'update')) {
            if (pkg.name !== name || path.resolve(pkg.path) === keep) continue;
            try {
                removeAsarFile(pkg.path);
                removed += 1;
            } catch (err) {
                logger.error(err);
            }
        }
        return { removed };
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

    /**
     * 包的分发名用 `.asax`、落盘名用 `.asar`：
     * - 分发（构建产物、上传、下载地址）用 `.asax`：任何 Electron 程序（包括 VS Code）碰到 `.asar`
     *   都会当作归档打开并持有句柄，Windows 下随后无法删除、覆盖；`.asax` 不受影响
     * - 落盘用 `.asar`：Electron 只有路径中出现 `.asar` 才能读取包内文件
     * 兼容直接以 `.asar` 分发的地址。
     */
    const PKG_SOURCE_RE = /\.(asax|asar)$/i;

    function toPkgFileName(sourceName) {
        return sourceName.replace(/\.asax$/i, '.asar');
    }

    // 临时文件不带 `.asar` 后缀：写入过程中不能让 Electron 把它当归档目录处理
    function getPackagePaths(sourceName) {
        fse.ensureDirSync(updatePackageDir);
        const tempPath = path.join(updatePackageDir, randomUUID());
        return { tempPath, finalPath: path.join(updatePackageDir, toPkgFileName(sourceName)) };
    }

    function promoteTempPackage({ tempPath, finalPath, integrity, integrityRequired = false }) {
        verifyIntegrity(tempPath, integrity, { required: integrityRequired });
        removeAsarFile(finalPath);
        fse.renameSync(tempPath, finalPath);
        return finalPath;
    }

    /**
     * 下载包（`.asax` / `.asar` 地址）：先写不带后缀的临时文件，校验后原子晋升为 `.asar`。
     *
     * **下载底座用自家 `libs/download`，不是 npm `download`**（2026-10-19 换掉）：
     * 后者是 2019 年的包（底层 `got@9`）、**没有进度回调**，于是调用方画不出进度条；
     * 而本库自己的 `libs/download` 走 Electron `net.request`，有 `onProgress`、
     * 支持多 URL fallback、临时文件原子晋升，并且**尊重 Chromium 的代理设置**
     * （考场环境常有透明代理）。两套下载实现并存本就是个缺陷，此处收敛掉。
     *
     * @param {object} option
     * @param {string} option.url `.asax` / `.asar` 包地址
     * @param {string} [option.integrity] `sha256-<hex>` 或 64 位 hex；给了才校验
     * ## 为什么这里要自己兜一层整体超时
     *
     * **换底座带来一个必须补回的行为**：npm `download@8`（底层 `got`）的 `timeout.request`
     * 覆盖**整个请求周期**，而 `libs/download` 的 `timeoutMs` **只覆盖"等响应头"那一段**
     * （`createElectronNetTransport` 在 `response` 回调里就 `cleanup()` 清了 timer，
     * 随后的 pipeline 不再受任何时限约束，也没有 stall 检测 —— 本库 known-limitations
     * 已登记该缺口）。不补的话，服务端发完响应头再卡住（弱网、中间代理、服务端半挂）
     * 就是 **`promise` 永不 settle、调用方永久挂起**，对升级流程意味着卡在进度条上出不来。
     *
     * 故在此用 `Promise.race` + `cancel()` 兜一个**整体**上限，与被替换掉的 npm
     * `download@8` 行为对齐。**真正的修法在 `libs/download`**（给 pipeline 阶段加 stall
     * 超时），上游修好后这层可以删掉。
     *
     * @param {(p: {transferred: number, total?: number, percent?: number}) => void} [option.onProgress]
     *        下载进度回调。**只在主进程内调用**，不跨 IPC；调用方自行节流
     * @param {number} [option.timeoutMs=600000] 整个下载任务的上限，超时即 `cancel()` 并抛。
     *        默认 10 分钟：增量包比资源文件大（实测业务侧 14.6 MB），按慢速 50 KB/s
     *        约需 5 分钟，留一倍余量。调用方可按部署环境覆盖
     */
    async function downloadPkg(option = {}) {
        const { url, integrity, onProgress, timeoutMs = 600000 } = option;
        if (typeof url !== 'string' || !url) {
            throw new TypeError('update.downloadPkg url 不能为空');
        }

        let sourceName;
        try {
            sourceName = path.posix.basename(new URL(url).pathname);
        } catch {
            throw new TypeError(`update.downloadPkg url 无效：${url}`);
        }
        if (!PKG_SOURCE_RE.test(sourceName)) {
            throw new Error(`update.downloadPkg 只接受 .asax / .asar 包：${sourceName}`);
        }

        const { tempPath, finalPath } = getPackagePaths(sourceName);

        let timer;
        try {
            const task = startDownload({ urls: [url], destinationPath: tempPath, onProgress });
            await Promise.race([
                task.promise,
                new Promise((_, reject) => {
                    timer = schedule(() => {
                        task.cancel();
                        reject(new Error(`update.downloadPkg 整体超时（${timeoutMs}ms）`));
                    }, timeoutMs);
                }),
            ]);
            return promoteTempPackage({ tempPath, finalPath, integrity });
        } catch (err) {
            try { fse.removeSync(tempPath); } catch { /* best effort */ }
            logger.error(err);
            throw err;
        } finally {
            // 必须清：下载正常结束后若让它烧到点，会对一个已完成的 task 调 cancel()
            if (timer !== undefined) clearTimeout(timer);
        }
    }

    async function stageLocalPkg({ sourcePath, integrity } = {}) {
        if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) {
            throw new TypeError('update.stageLocalPkg sourcePath must be absolute');
        }
        const sourceName = path.basename(sourcePath);
        if (!PKG_SOURCE_RE.test(sourceName)) {
            throw new Error(`update.stageLocalPkg only accepts .asax / .asar packages: ${sourceName}`);
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
        findPkg,
        cleanupPkgs,
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
