/**
 * 包的通用操作：按来源取包、下载、清理其他版本。设计见 docs/design/pkg-source.md。
 *
 * 包信息（`get` / `download` 的返回值）：
 *
 * ```js
 * { name, version, env, source, main, renderer, update? }
 * ```
 *
 * - `source`：`PKG_SOURCE` 之一
 * - `main`：主进程入口，绝对路径（供 require）
 * - `renderer`：主页面，完整地址（供 loadURL）
 * - `update`：启动页，完整地址；包里没有启动页时没有该字段
 *
 * 入口取自描述文件（包根目录下 / dev server 根地址下的 `package.json`）：相对路径按包根目录拼成完整值，
 * 已是绝对路径或完整地址的原样使用。页面与目录的命名只由 frame 决定，这里不出现。
 */
const { PKG_SOURCE } = require('../../../shared/pkgSource');

const DESCRIPTOR_FILE = 'package.json';
const PREFIX = '[包]';
const SOURCE_TYPES = Object.values(PKG_SOURCE);
const REQUIRED_FIELDS = Object.freeze({
    [PKG_SOURCE.DEV_SERVER]: ['url'],
    [PKG_SOURCE.FILE]: ['path'],
    [PKG_SOURCE.SEMVER]: [],
});
const DESCRIPTOR_FIELDS = ['name', 'version', 'env', 'main', 'renderer'];

/**
 * 包的分发名用 `.asax`、落盘名用 `.asar`：
 * - 分发（构建产物、上传、下载地址）用 `.asax`：任何 Electron 程序碰到 `.asar` 都会当作归档打开并持有句柄，
 *   Windows 下随后无法删除、覆盖；`.asax` 不受影响
 * - 落盘用 `.asar`：Electron 只有路径中出现 `.asar` 才能读取包内文件
 */
const PKG_FILE_RE = /\.(asax|asar)$/i;
const ASAX_RE = /\.asax$/i;
const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * @param {Object} deps
 * @param {import('path')} deps.path
 * @param {import('fs-extra')} deps.fse
 * @param {import('semver')} deps.semver
 * @param {{ info: Function, warn: Function, error: Function }} deps.logger
 * @param {(pkgPath: string) => Object|null} deps.readPkgDescriptor 读包文件内的描述文件（不经 Electron 的 asar 支持）
 * @param {(url: string) => Promise<Object>} deps.fetchJson 读 dev server 上的描述文件
 * @param {(option: Object) => { promise: Promise, cancel: Function }} deps.startDownload
 * @param {() => string} deps.randomUUID
 * @param {Function} deps.createHash
 * @param {(filePath: string) => string} deps.toFileUrl
 * @param {() => { isHostDev?: boolean, devPkgSources?: Object }} deps.getHostRuntime
 * @param {() => string|null} deps.getBuiltinDir 内置目录
 * @param {() => string} deps.getUpdateDir 下载目录
 * @param {() => string} deps.getCopyDir `.asax` 临时副本目录
 */
function createPkgLib(deps) {
    const {
        path, fse, semver, logger,
        readPkgDescriptor, fetchJson, startDownload, randomUUID, createHash, toFileUrl,
        getHostRuntime, getBuiltinDir, getUpdateDir, getCopyDir,
    } = deps;

    let copiesCleaned = false;
    /** 源文件 → 本次运行已复制的副本路径 */
    const copied = new Map();

    // ---------------------------------------------------------------- 来源

    /**
     * 解析并校验 `BC_DEV_PKG_SOURCES` 的值。格式错误的整体或单项忽略（按默认来源），记错误日志，不抛出。
     *
     * @param {string|undefined} raw JSON 字符串；空串 / undefined 视为未配置
     * @returns {Record<string, Object>} 包名 → 来源
     */
    function parseDevSources(raw) {
        if (raw === undefined || raw === null || String(raw).trim() === '') return {};
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (err) {
            logger.error(`${PREFIX} BC_DEV_PKG_SOURCES 不是合法的 JSON，全部按默认来源`, err.message);
            return {};
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            logger.error(`${PREFIX} BC_DEV_PKG_SOURCES 必须是对象（包名 → 来源），全部按默认来源`);
            return {};
        }
        const result = {};
        for (const [name, source] of Object.entries(parsed)) {
            const type = source && source.type;
            if (!SOURCE_TYPES.includes(type)) {
                logger.error(`${PREFIX} BC_DEV_PKG_SOURCES.${name}.type 无效（${type}），应为 ${SOURCE_TYPES.join(' / ')}；该项按默认来源`);
                continue;
            }
            const missing = REQUIRED_FIELDS[type].filter(k => typeof source[k] !== 'string' || !source[k]);
            if (missing.length) {
                logger.error(`${PREFIX} BC_DEV_PKG_SOURCES.${name}（type=${type}）缺少 ${missing.join('、')}；该项按默认来源`);
                continue;
            }
            result[name] = { ...source };
        }
        return result;
    }

    /**
     * 包的来源。打包运行一律 semver；本地调试时宿主运行时 `devPkgSources` 中有该包就按配置，否则 semver。
     * 只看宿主的 `isHostDev`，不看任何包自身的 `isPkgDev`。
     */
    function getSource(name) {
        const { isHostDev, devPkgSources } = getHostRuntime() || {};
        const configured = isHostDev && devPkgSources ? devPkgSources[name] : undefined;
        const source = configured ? { ...configured } : { type: PKG_SOURCE.SEMVER };
        const mode = isHostDev ? '本地调试' : '打包运行';
        // 本地调试的来源配置由宿主写入（自身包的默认项 + .env 的 BC_DEV_PKG_SOURCES），这里分不清两者
        const basis = configured ? '依据宿主运行时 devPkgSources' : '默认来源';
        const detail = source.url ? `，url=${source.url}` : source.path ? `，path=${source.path}` : '';
        logger.info(`${PREFIX} ${name}：${mode}，${basis}，来源=${source.type}${detail}`);
        return source;
    }

    // ---------------------------------------------------------------- 读包

    /**
     * 删除临时副本目录中的全部旧副本。被其他运行中的实例占用而删不掉的，只记日志。
     */
    function cleanCopies() {
        copiesCleaned = true;
        const dir = getCopyDir();
        fse.ensureDirSync(dir);
        for (const name of fse.readdirSync(dir)) {
            const file = path.join(dir, name);
            try {
                fse.removeSync(file);
                if (fse.readdirSync(dir).includes(name)) throw new Error('文件被占用');
            } catch (err) {
                logger.warn(`${PREFIX} 旧的临时副本未能删除（可能被其他实例占用），跳过：${file}`, err.message);
            }
        }
    }

    /**
     * `.asax` 复制为可加载的 `.asar` 临时副本；`.asar` 原样返回。同一文件一次运行只复制一次。
     *
     * `.asax` 出现在本地调试时：项目的内置目录 `resources/packages/` 与 file 来源指定的文件。
     */
    function toLoadable(filePath) {
        if (!ASAX_RE.test(filePath)) return filePath;
        if (copied.has(filePath)) return copied.get(filePath);
        if (!copiesCleaned) cleanCopies();
        const stat = fse.statSync(filePath);
        const base = path.basename(filePath).replace(ASAX_RE, '');
        const target = path.join(getCopyDir(), `${base}-${stat.size}-${Math.floor(stat.mtimeMs)}.asar`);
        // 先写不带 .asar 后缀的文件再改名：Electron 会把以 .asar 结尾的路径当作归档解析，
        // 直接复制到 .asar 目标时，复制前对目标的检查会报 Invalid package
        const partial = target.replace(/\.asar$/i, '.partial');
        fse.ensureDirSync(getCopyDir());
        fse.copySync(filePath, partial);
        fse.renameSync(partial, target);
        copied.set(filePath, target);
        logger.info(`${PREFIX} 已将 ${filePath} 复制为临时副本 ${target}`);
        return target;
    }

    /**
     * @throws {Error} 描述文件缺少必需字段
     */
    function assertDescriptor(descriptor, where) {
        const missing = DESCRIPTOR_FIELDS.filter(k => typeof descriptor[k] !== 'string' || !descriptor[k]);
        if (missing.length) {
            throw new Error(`${PREFIX} ${where} 不是有效的包：描述文件缺少 ${missing.join('、')}`);
        }
    }

    /**
     * 描述文件 → 包信息。
     *
     * @param {Object} descriptor
     * @param {string} source
     * @param {string|null} root 包根目录（dev server 时为 null，入口已是完整值）
     */
    function toPkg(descriptor, source, root) {
        const entry = value => {
            if (URL_RE.test(value) || path.isAbsolute(value)) return value;
            return path.join(root, value);
        };
        const page = value => {
            if (URL_RE.test(value)) return value;
            return toFileUrl(entry(value));
        };
        const pkg = {
            name: descriptor.name,
            version: descriptor.version,
            env: descriptor.env,
            source,
            main: entry(descriptor.main),
            renderer: page(descriptor.renderer),
        };
        if (descriptor.update) pkg.update = page(descriptor.update);
        return pkg;
    }

    /**
     * 读一个包文件（`.asax` 先复制为副本）。
     *
     * @throws {Error} 不是有效的包
     */
    function readFile(filePath, source, descriptor = readPkgDescriptor(filePath)) {
        if (!descriptor) throw new Error(`${PREFIX} ${filePath} 不是有效的包（读不到描述文件）`);
        assertDescriptor(descriptor, filePath);
        return toPkg(descriptor, source, toLoadable(filePath));
    }

    /**
     * 读 dev server 根地址下的描述文件。
     *
     * @throws {Error} dev server 未启动或描述文件无效
     */
    async function readDevServer(url) {
        const descriptorUrl = new URL(DESCRIPTOR_FILE, url).href;
        let descriptor;
        try {
            descriptor = await fetchJson(descriptorUrl);
        } catch (err) {
            throw new Error(`${PREFIX} dev server 未启动或不可访问：${descriptorUrl}（${err.message}）`);
        }
        assertDescriptor(descriptor || {}, descriptorUrl);
        return toPkg(descriptor, PKG_SOURCE.DEV_SERVER, null);
    }

    /**
     * 目录下全部包的描述文件。下载目录只认 `.asar`（下载中的临时文件不带该后缀）；内置目录还认 `.asax`。
     */
    function listDir(dir, acceptAsax) {
        if (!dir || !fse.existsSync(dir)) return [];
        return fse.readdirSync(dir)
            .filter(name => (acceptAsax ? PKG_FILE_RE : /\.asar$/i).test(name))
            .map(name => {
                const filePath = path.join(dir, name);
                try {
                    const descriptor = readPkgDescriptor(filePath);
                    return descriptor ? { descriptor, filePath } : null;
                } catch (err) {
                    logger.error(err);
                    return null;
                }
            })
            .filter(Boolean);
    }

    function listUpdateDir() {
        const dir = getUpdateDir();
        fse.ensureDirSync(dir);
        return listDir(dir, false);
    }

    /**
     * semver：在内置目录与下载目录中找。给版本找该版本，不给取最新；同版本内置优先。
     */
    function find({ name, env, version }) {
        const builtin = listDir(getBuiltinDir(), true).map(item => ({ ...item, rank: 0 }));
        const downloaded = listUpdateDir().map(item => ({ ...item, rank: 1 }));
        const candidates = [...builtin, ...downloaded].filter(({ descriptor: d }) => (
            d.name === name
            && d.env === env
            && semver.valid(d.version)
            && (version === undefined || d.version === version)
        ));
        if (!candidates.length) {
            logger.info(`${PREFIX} ${name}：内置目录与下载目录均未命中（期望 ${env} ${version ? `v${version}` : '最新版本'}）`);
            return null;
        }
        candidates.sort((a, b) => semver.rcompare(a.descriptor.version, b.descriptor.version) || a.rank - b.rank);
        const picked = candidates[0];
        const where = picked.rank === 0 ? '内置目录' : '下载目录';
        logger.info(`${PREFIX} ${name}：${where}命中 ${path.basename(picked.filePath)}`);
        return readFile(picked.filePath, PKG_SOURCE.SEMVER, picked.descriptor);
    }

    function warnMismatch(pkg, { name, env }) {
        const mismatches = [['name', name], ['env', env]]
            .filter(([k, expected]) => expected !== undefined && pkg[k] !== expected)
            .map(([k, expected]) => `${k}=${pkg[k]}（预期 ${expected}）`);
        if (mismatches.length) {
            logger.warn(`${PREFIX} ${name}：指定的包与预期不符，照常加载：${mismatches.join('，')}`);
        }
    }

    /**
     * 按来源取包。
     *
     * - semver：给版本找该版本，不给取最新（同版本内置优先）；找不到返回 null，是否下载由调用方决定
     * - devServer / file：忽略版本，读配置指定的包；名称、环境与预期不符时照常加载并警告
     *
     * 一般不传 `source`，按来源规则决定；宿主需要明确指定时才传（如本地调试找不到内置包时回落到自己的 dev server）。
     *
     * @param {string} name 包名
     * @param {{ env: string, version?: string, source?: { type: string, url?: string, path?: string } }} option
     * @returns {Promise<Object|null>} 包信息
     * @throws {Error} devServer / file 指定的包不可用
     */
    async function get(name, { env, version, source: specified } = {}) {
        if (typeof name !== 'string' || !name) throw new TypeError('pkg.get name 不能为空');
        if (typeof env !== 'string' || !env) throw new TypeError('pkg.get env 不能为空');
        let source;
        if (specified) {
            source = { ...specified };
            logger.info(`${PREFIX} ${name}：调用方指定来源=${source.type}`);
        } else {
            source = getSource(name);
        }

        let pkg;
        if (source.type === PKG_SOURCE.DEV_SERVER) {
            pkg = await readDevServer(source.url);
            warnMismatch(pkg, { name, env });
        } else if (source.type === PKG_SOURCE.FILE) {
            if (!fse.existsSync(source.path)) {
                throw new Error(`${PREFIX} ${name}：file 指定的包不存在：${source.path}`);
            }
            pkg = readFile(source.path, PKG_SOURCE.FILE);
            warnMismatch(pkg, { name, env });
        } else {
            pkg = find({ name, env, version });
        }

        if (pkg) logger.info(`${PREFIX} ${name}：已选定`, pkg);
        return pkg;
    }

    // ---------------------------------------------------------------- 下载与清理

    /**
     * 删除一个 `.asar` 文件，并核对确实删掉。
     *
     * 本进程中被 Electron 读过的包句柄被持有，Windows 下 `fse.removeSync` 会静默不删，因此删后按目录列表核对。
     * 是否存在也按目录列表判断：Electron 会把 `.asar` 路径当作目录，`existsSync` 不可靠。
     *
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

    function verifyIntegrity(filePath, integrity) {
        if (integrity === undefined) return;
        const expected = String(integrity || '').replace(/^sha256-/i, '').toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(expected)) {
            throw new TypeError('包的 integrity 必须是 SHA-256 摘要');
        }
        const actual = createHash('sha256').update(fse.readFileSync(filePath)).digest('hex');
        if (actual !== expected) throw new Error('包的完整性校验失败');
    }

    /**
     * 下载包（`.asax` / `.asar` 地址）到下载目录：先写不带后缀的临时文件，校验后改名为 `.asar`。
     *
     * 名称、环境、版本与预期不符时删除文件并抛错，不让错包留在下载目录。
     * 卡住的下载由 `libs/download` 的空闲超时结束。
     *
     * @param {Object} option
     * @param {string} option.url
     * @param {string} option.name 预期包名
     * @param {string} option.env 预期环境
     * @param {string} [option.version] 预期版本
     * @param {string} [option.integrity] `sha256-<hex>` 或 64 位 hex；给了才校验
     * @param {Object} [option.headers] 默认带 `Cache-Control: no-cache`
     * @param {(p: { transferred: number, total?: number, percent?: number }) => void} [option.onProgress]
     * @returns {Promise<Object>} 包信息
     */
    async function download({ url, name, env, version, integrity, headers, onProgress } = {}) {
        if (typeof url !== 'string' || !url) throw new TypeError('pkg.download url 不能为空');
        if (typeof name !== 'string' || !name) throw new TypeError('pkg.download name 不能为空');
        if (typeof env !== 'string' || !env) throw new TypeError('pkg.download env 不能为空');

        let sourceName;
        try {
            sourceName = path.posix.basename(new URL(url).pathname);
        } catch {
            throw new TypeError(`pkg.download url 无效：${url}`);
        }
        if (!PKG_FILE_RE.test(sourceName)) {
            throw new Error(`pkg.download 只接受 .asax / .asar 包：${sourceName}`);
        }

        const dir = getUpdateDir();
        fse.ensureDirSync(dir);
        // 临时文件不带 `.asar` 后缀：写入过程中不能让 Electron 把它当归档目录处理
        const tempPath = path.join(dir, randomUUID());
        const finalPath = path.join(dir, sourceName.replace(ASAX_RE, '.asar'));

        try {
            // 包要求的是精确版本内容，同一地址覆盖发布后必须能取到新包
            const task = startDownload({
                urls: [url],
                destinationPath: tempPath,
                onProgress,
                headers: { 'Cache-Control': 'no-cache', ...headers },
            });
            await task.promise;
            verifyIntegrity(tempPath, integrity);

            const descriptor = readPkgDescriptor(tempPath);
            if (!descriptor) throw new Error(`${PREFIX} 下载的文件不是有效的包：${url}`);
            const mismatches = [['name', name], ['env', env], ['version', version]]
                .filter(([k, expected]) => expected !== undefined && descriptor[k] !== expected)
                .map(([k, expected]) => `${k}=${descriptor[k]}（预期 ${expected}）`);
            if (mismatches.length) {
                throw new Error(`${PREFIX} 下载的包与预期不符：${mismatches.join('，')}`);
            }

            removeAsarFile(finalPath);
            fse.renameSync(tempPath, finalPath);
            logger.info(`${PREFIX} ${name}：已下载 ${path.basename(finalPath)}`);
            return readFile(finalPath, PKG_SOURCE.SEMVER, descriptor);
        } catch (err) {
            try { fse.removeSync(tempPath); } catch { /* best effort */ }
            logger.error(err);
            throw err;
        }
    }

    /**
     * 删除下载目录中该包的其他版本（同名、版本不同）。内置目录随安装包，不在清理范围内。
     * 非 semver 来源的包不处理。
     *
     * 必须在加载该包之前调用：本进程中被 Electron 读过的包在 Windows 下无法删除。
     *
     * @param {{ name: string, version: string, source: string }} pkg
     * @returns {{ removed: number }}
     */
    function removeOtherVersions(pkg) {
        if (!pkg || pkg.source !== PKG_SOURCE.SEMVER) return { removed: 0 };
        let removed = 0;
        for (const { descriptor, filePath } of listUpdateDir()) {
            if (descriptor.name !== pkg.name || descriptor.version === pkg.version) continue;
            try {
                removeAsarFile(filePath);
                removed += 1;
            } catch (err) {
                logger.error(err);
            }
        }
        if (removed) logger.info(`${PREFIX} ${pkg.name}：已删除其他版本 ${removed} 个`);
        return { removed };
    }

    return { get, download, removeOtherVersions, parseDevSources };
}

module.exports = { createPkgLib, DESCRIPTOR_FILE };
