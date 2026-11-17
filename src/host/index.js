/**
 * 宿主侧入口：建立宿主运行时、创建宿主并挂载包。
 *
 * 只给宿主使用。包不得引用本模块：它引入全量子包表，会把整个 toolkit 打进包的 bundle。
 */
const { HOST_RUNTIME_KEY, TOOLKIT_KEY } = require('../shared/hostKeys');
const modules = require('./modules');

// Service / Notice / logger 刻意在 createHost 内才 require：本模块要在主进程入口第一行引入，
// 而 logger 在 require 时即按 paths 配置落盘目录。顶层引入会让宿主来不及调用 setPathConfig。

/**
 * 建立宿主运行时，并写入业务字段。
 *
 * - 首次调用：在 `globalThis` 上建立锚点（不可写、不可配置），装入 toolkit 子包表
 *   （Symbol key，不可写、不可配置，表冻结）。必须早于任何 toolkit 引用被执行。
 * - 之后每次调用等同 `Object.assign`：业务字段浅覆盖，结果由业务负责。
 *
 * @param {Object} [fields] 业务字段，字符串 key；值可以是数据或函数
 * @returns {Object} 宿主运行时对象
 * @throws {TypeError} 试图覆盖 toolkit 字段时抛错
 * @example
 * exposeHostRuntime();                  // 主进程入口第一行
 * exposeHostRuntime({ foo: 'bar' });    // 之后按需暴露
 */
function exposeHostRuntime(fields) {
    const anchorKey = Symbol.for(HOST_RUNTIME_KEY);
    let runtime = globalThis[anchorKey];
    if (!runtime) {
        runtime = {};
        Object.defineProperty(runtime, Symbol.for(TOOLKIT_KEY), {
            value: Object.freeze(modules),
            writable: false,
            configurable: false,
            enumerable: false,
        });
        Object.defineProperty(globalThis, anchorKey, {
            value: runtime,
            writable: false,
            configurable: false,
            enumerable: false,
        });
    }
    if (fields !== undefined) Object.assign(runtime, fields);
    return runtime;
}

function namespacesOf(capability) {
    return [capability.serviceSchema, capability.noticeSchema]
        .filter(Boolean)
        .map(schema => schema.namespace);
}

/**
 * 创建宿主：注册通用能力，并提供包的挂载与卸载。
 *
 * 内部完成 `Service.init` / `Notice.init`，宿主不再单独调用这两个 init。
 *
 * @param {Object} [options]
 * @param {Object[]} [options.capabilities] 通用能力：每项导出 serviceSchema 和/或 noticeSchema
 * @returns {{ mount: Function, unmount: Function, mounted: Function }}
 * @throws {Error} schema 校验不通过或 namespace 冲突时抛错
 * @example
 * const host = createHost({ capabilities: [logger, store] });
 * await host.mount(require(pkgEntry));
 */
function createHost({ capabilities = [] } = {}) {
    const Service = require('../service/main');
    const Notice = require('../notice/main');
    const Logger = require('../main/libs/logger');

    Service.init({ userSchemas: capabilities.map(c => c.serviceSchema).filter(Boolean) });
    Notice.init({ userSchemas: capabilities.map(c => c.noticeSchema).filter(Boolean) });

    const hostNamespaces = new Set(capabilities.flatMap(namespacesOf));
    /** @type {Map<string, { pkg: Object, registered: Array<[Object, string]> }>} */
    const mountedPkgs = new Map();

    function unregisterAll(registered) {
        for (const [bridge, namespace] of [...registered].reverse()) {
            bridge.unregister(namespace);
        }
    }

    /**
     * 挂载包：uses 校验 → 重名校验 → 注册 provides → activate。
     * 注册中途失败或 activate 抛错时回滚已注册项后再抛出。
     *
     * @param {Object} pkg `definePkg` 的返回值
     * @returns {Promise<void>}
     * @throws {Error} 包已挂载、uses 缺失、namespace 重名、注册失败或 activate 抛错
     */
    async function mount(pkg) {
        if (!pkg || typeof pkg.name !== 'string' || !Array.isArray(pkg.provides)) {
            throw new Error('host.mount 需要 definePkg 的返回值');
        }
        if (mountedPkgs.has(pkg.name)) {
            throw new Error(`包 ${pkg.name} 已挂载`);
        }

        const missing = (pkg.uses || []).filter(ns => !hostNamespaces.has(ns));
        if (missing.length) {
            throw new Error(`包 ${pkg.name} 依赖的通用能力宿主未提供：${missing.join(', ')}`);
        }

        const taken = new Set(hostNamespaces);
        for (const { registered } of mountedPkgs.values()) {
            for (const [, namespace] of registered) taken.add(namespace);
        }
        const conflicts = pkg.provides.flatMap(namespacesOf).filter(ns => taken.has(ns));
        if (conflicts.length) {
            throw new Error(`包 ${pkg.name} 的业务能力与已有能力重名：${[...new Set(conflicts)].join(', ')}`);
        }

        const registered = [];
        try {
            for (const capability of pkg.provides) {
                if (capability.serviceSchema) {
                    Service.register(capability.serviceSchema);
                    registered.push([Service, capability.serviceSchema.namespace]);
                }
                if (capability.noticeSchema) {
                    Notice.register(capability.noticeSchema);
                    registered.push([Notice, capability.noticeSchema.namespace]);
                }
            }
            if (pkg.activate) await pkg.activate();
        } catch (err) {
            unregisterAll(registered);
            throw err;
        }

        mountedPkgs.set(pkg.name, { pkg, registered });
        Logger.info(`[host] 已挂载包 ${pkg.name}`);
    }

    /**
     * 卸载包：deactivate → 注销 provides。deactivate 抛错只记日志，不阻断注销。
     *
     * @param {string} name 包名
     * @returns {Promise<boolean>} 是否确有卸载
     */
    async function unmount(name) {
        const entry = mountedPkgs.get(name);
        if (!entry) return false;
        try {
            if (entry.pkg.deactivate) await entry.pkg.deactivate();
        } catch (err) {
            Logger.error(`[host] 包 ${name} deactivate 失败，继续注销`, err);
        }
        unregisterAll(entry.registered);
        mountedPkgs.delete(name);
        Logger.info(`[host] 已卸载包 ${name}`);
        return true;
    }

    /**
     * @returns {string[]} 当前已挂载的包名
     */
    function mounted() {
        return [...mountedPkgs.keys()];
    }

    return { mount, unmount, mounted };
}

module.exports = { exposeHostRuntime, createHost };
