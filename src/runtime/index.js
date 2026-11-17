/**
 * 包侧入口：读取宿主运行时、声明包。
 *
 * 本文件会被打进包的 bundle（构建期映射不覆盖它），因此保持零依赖、无状态：
 * 只引用 `shared/hostKeys`，不引用任何 toolkit 能力。
 */
const { HOST_RUNTIME_KEY } = require('../shared/hostKeys');

/**
 * 返回宿主运行时对象（锚点）。
 *
 * 业务字段由宿主经 `exposeHostRuntime` 写入，读取按 JS 默认行为：不存在的 key 为 undefined。
 *
 * @returns {Object} 宿主运行时
 * @throws {Error} 宿主未调用 `exposeHostRuntime` 时抛错
 */
function getHostRuntime() {
    const runtime = globalThis[Symbol.for(HOST_RUNTIME_KEY)];
    if (!runtime) {
        throw new Error('宿主运行时未建立：宿主须在主进程入口第一行调用 exposeHostRuntime()');
    }
    return runtime;
}

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 校验并冻结包描述。宿主 `createHost().mount` 接收的就是它。
 *
 * 只做形态校验，无副作用；在包的 `main/pkg.js` 被 require 时执行，形态错误即时抛出。
 *
 * @param {Object} def
 * @param {string} def.name 包名（与 package.json#name 一致）
 * @param {string[]} [def.uses] 依赖的通用能力 namespace（由宿主注册）
 * @param {Object[]} [def.provides] 自带业务能力：每项至少导出 serviceSchema 或 noticeSchema
 * @param {Function} [def.activate] 挂载后调用，可为 async
 * @param {Function} [def.deactivate] 卸载前调用，可为 async；撤销 activate 的副作用
 * @returns {Readonly<Object>} 冻结的包描述
 * @throws {Error} 形态不合规时抛错
 * @example
 * module.exports = definePkg({ name: 'demo', uses: ['logger'], provides: [foo] });
 */
function definePkg(def) {
    if (!isPlainObject(def)) throw new Error('definePkg 需要一个对象');
    const { name, uses = [], provides = [], activate, deactivate } = def;

    if (typeof name !== 'string' || !name.trim()) {
        throw new Error('definePkg: name 必须是非空字符串');
    }
    if (!Array.isArray(uses) || uses.some(u => typeof u !== 'string' || !u)) {
        throw new Error(`definePkg(${name}): uses 必须是非空字符串数组`);
    }
    if (!Array.isArray(provides)) {
        throw new Error(`definePkg(${name}): provides 必须是数组`);
    }
    provides.forEach((cap, i) => {
        if (!isPlainObject(cap) || (!cap.serviceSchema && !cap.noticeSchema)) {
            throw new Error(`definePkg(${name}): provides[${i}] 必须导出 serviceSchema 或 noticeSchema`);
        }
    });
    for (const [key, fn] of [['activate', activate], ['deactivate', deactivate]]) {
        if (fn !== undefined && typeof fn !== 'function') {
            throw new Error(`definePkg(${name}): ${key} 必须是函数`);
        }
    }

    return Object.freeze({
        name,
        uses: Object.freeze([...uses]),
        provides: Object.freeze([...provides]),
        activate,
        deactivate,
    });
}

module.exports = { getHostRuntime, definePkg };
