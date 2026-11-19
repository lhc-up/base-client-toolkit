/**
 * 包来源：决定一个包从哪里加载，并准备好可加载的路径。设计见 docs/design/pkg-source.md。
 *
 * 三种来源（`type`）：
 * - `devServer`：`main` 指定的主进程入口 + `url` 指定的 dev server 页面；不比对版本、不下载
 * - `file`：指定的包文件（`.asax` / `.asar`）；不比对版本、不下载
 * - `semver`：按线上版本选包：内置目录 → 下载目录 →（调用方）现场下载
 *
 * 默认来源：打包运行时一律 `semver`；本地调试时自身的包为 `devServer`，其他包为 `semver`。
 * 本地调试时可用宿主 `.env` 的 `BC_DEV_PKG_SOURCES` 逐个覆盖（由宿主读取、解析后经宿主运行时 `devPkgSources` 传入）。
 *
 * 运行方式只看宿主的 `isHostDev`（由调用方传入），不看任何包自身的 `isPkgDev`：被加载的一方不能用自己的标志位决定自己怎么被加载。
 * `semver` 下查不到包时返回 null，是否下载、下载后如何生效（重启、直接挂载）属于业务策略，由调用方决定。
 * toolkit 不直接读环境变量。
 */
const SOURCE_TYPES = Object.freeze(['devServer', 'file', 'semver']);
const REQUIRED_FIELDS = Object.freeze({ devServer: ['main', 'url'], file: ['path'], semver: [] });
const PREFIX = '[包来源]';

/**
 * @param {Object} deps
 * @param {import('path')} deps.path
 * @param {import('fs-extra')} deps.fse
 * @param {{ info: Function, warn: Function, error: Function }} deps.logger
 * @param {{ findPkg: Function }} deps.update toolkit update 能力
 * @param {(pkgPath: string) => Object|null} deps.readPkgDescriptor
 * @param {() => string} deps.getCopyDir `.asax` 临时副本目录
 */
function createPkgSource(deps) {
    const { path, fse, logger, update, readPkgDescriptor, getCopyDir } = deps;
    let copiesCleaned = false;
    /** 源文件 → 本次运行已复制的副本路径 */
    const copied = new Map();

    const modeText = isHostDev => (isHostDev ? '本地调试' : '打包运行');

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
     * 把 `.asax` 复制为可加载的 `.asar` 临时副本；`.asar` 原样返回。同一文件一次运行只复制一次。
     *
     * @param {string} source
     * @returns {string} 可加载的路径
     */
    function toLoadable(source) {
        if (!/\.asax$/i.test(source)) return source;
        if (copied.has(source)) return copied.get(source);
        if (!copiesCleaned) cleanCopies();
        const stat = fse.statSync(source);
        const base = path.basename(source).replace(/\.asax$/i, '');
        const target = path.join(getCopyDir(), `${base}-${stat.size}-${Math.floor(stat.mtimeMs)}.asar`);
        fse.ensureDirSync(getCopyDir());
        fse.copySync(source, target);
        copied.set(source, target);
        logger.info(`${PREFIX} 已将 ${source} 复制为临时副本 ${target}`);
        return target;
    }

    /**
     * 解析并校验 `BC_DEV_PKG_SOURCES` 的值。格式错误的整体或单项忽略（按默认来源），记错误日志，不抛出。
     *
     * @param {string|undefined} raw JSON 字符串；空串 / undefined 视为未配置
     * @returns {Record<string, Object>} 包名 → 来源
     */
    function parseDevPkgSources(raw) {
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
     * 决定一个包的来源。
     *
     * @param {Object} option
     * @param {string} option.name 包名
     * @param {boolean} option.isSelf 是否宿主自身的包
     * @param {boolean} option.isHostDev 宿主是否本地调试（宿主运行时 `isHostDev`）
     * @param {Record<string, Object>} [option.devPkgSources] 宿主运行时 `devPkgSources`，只在本地调试时使用
     * @param {{ main: string, url: string }} [option.selfDevServer] 自身的包在本地调试时的默认 devServer
     * @returns {{ type: string, from: 'default'|'config', main?: string, url?: string, path?: string }}
     * @throws {Error} 来源为 devServer / file 但指定的文件不存在
     */
    function decide({ name, isSelf, isHostDev, devPkgSources = {}, selfDevServer } = {}) {
        if (typeof name !== 'string' || !name) throw new TypeError('pkgSource.decide name 不能为空');
        if (isHostDev && !copiesCleaned) cleanCopies();

        let source;
        if (!isHostDev) {
            source = { type: 'semver', from: 'default' };
        } else if (devPkgSources[name]) {
            source = { ...devPkgSources[name], from: 'config' };
        } else if (isSelf) {
            if (!selfDevServer || !selfDevServer.main || !selfDevServer.url) {
                throw new TypeError(`pkgSource.decide：自身的包 ${name} 在本地调试时需要 selfDevServer（main、url）`);
            }
            source = { type: 'devServer', main: selfDevServer.main, url: selfDevServer.url, from: 'default' };
        } else {
            source = { type: 'semver', from: 'default' };
        }

        const basis = source.from === 'config' ? '依据配置 BC_DEV_PKG_SOURCES' : '默认来源';
        const detail = source.type === 'devServer' ? `，main=${source.main} url=${source.url}`
            : source.type === 'file' ? `，path=${source.path}` : '';
        logger.info(`${PREFIX} ${name}：${modeText(isHostDev)}，${basis}，type=${source.type}${detail}`);

        if (source.type === 'devServer' && !fse.pathExistsSync(source.main)) {
            throw new Error(`${PREFIX} ${name}：devServer 的 main 不存在：${source.main}（先执行该包的 dev:app 或 dev:app --pkg-only）`);
        }
        if (source.type === 'file' && !fse.pathExistsSync(source.path)) {
            throw new Error(`${PREFIX} ${name}：file 指定的包不存在：${source.path}`);
        }
        return source;
    }

    /**
     * 准备 `file` 来源：读取描述文件、按需复制为 `.asar` 副本。名称 / 环境 / 版本与预期不符时照常加载并警告。
     *
     * @param {Object} option
     * @param {string} option.name 包名（预期）
     * @param {string} option.path 包文件
     * @param {string} [option.env] 预期环境
     * @param {string} [option.version] 预期版本（线上版本）
     * @returns {{ path: string, sourcePath: string, descriptor: Object }}
     */
    function prepareFile({ name, path: filePath, env, version } = {}) {
        const descriptor = readPkgDescriptor(filePath);
        if (!descriptor) throw new Error(`${PREFIX} ${name}：${filePath} 不是有效的应用包（读不到 package.json）`);
        const mismatches = [
            ['name', name], ['env', env], ['version', version],
        ].filter(([k, expected]) => expected !== undefined && descriptor[k] !== expected)
            .map(([k, expected]) => `${k}=${descriptor[k]}（预期 ${expected}）`);
        if (mismatches.length) {
            logger.warn(`${PREFIX} ${name}：file 指定的包与预期不符，照常加载：${mismatches.join('，')}`);
        }
        const loadPath = toLoadable(filePath);
        logger.info(`${PREFIX} ${name}：已选定 来源=file 路径=${loadPath} 描述文件 name=${descriptor.name} env=${descriptor.env} version=${descriptor.version}`);
        return { path: loadPath, sourcePath: filePath, descriptor };
    }

    /**
     * `semver` 来源：在内置目录与下载目录中查找（同版本内置优先），命中 `.asax`（本地调试的内置目录）时复制为副本。
     *
     * @param {Object} option
     * @param {string} option.name
     * @param {string} option.env
     * @param {string} [option.version] 精确版本；省略时取最新
     * @returns {Object|null} 描述文件内容 + `path`（可加载路径）+ `sourcePath` + `type`（builtin / update）；未命中为 null
     */
    function findSemver({ name, env, version } = {}) {
        const expect = `${env} ${version ? `v${version}` : '最新版本'}`;
        const found = update.findPkg({ name, env, version });
        if (!found) {
            logger.info(`${PREFIX} ${name}：内置目录与下载目录均未命中（期望 ${expect}）`);
            return null;
        }
        const where = found.type === 'builtin' ? '内置目录' : '下载目录';
        const loadPath = toLoadable(found.path);
        logger.info(`${PREFIX} ${name}：${where}命中 ${path.basename(found.path)}，已选定 路径=${loadPath} `
            + `描述文件 name=${found.name} env=${found.env} version=${found.version}`);
        return { ...found, path: loadPath, sourcePath: found.path };
    }

    return { SOURCE_TYPES, parseDevPkgSources, decide, prepareFile, findSemver, cleanCopies };
}

let instance = null;

function getInstance() {
    if (instance) return instance;
    const path = require('path');
    const os = require('os');
    const fse = require('fs-extra');
    const { app } = require('electron');
    instance = createPkgSource({
        path,
        fse,
        logger: require('./logger'),
        update: require('../capability/update'),
        readPkgDescriptor: require('../capability/update/readPkgDescriptor').readPkgDescriptor,
        getCopyDir: () => path.join(os.tmpdir(), 'base-client', app.getName(), 'pkg-copies'),
    });
    return instance;
}

module.exports = {
    createPkgSource,
    SOURCE_TYPES,
    parseDevPkgSources: (...args) => getInstance().parseDevPkgSources(...args),
    decide: (...args) => getInstance().decide(...args),
    prepareFile: (...args) => getInstance().prepareFile(...args),
    findSemver: (...args) => getInstance().findSemver(...args),
    cleanCopies: (...args) => getInstance().cleanCopies(...args),
};
