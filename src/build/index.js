/**
 * 构建期辅助：在 bc.config 的 `main.externals` 中使用，不在运行时加载。
 */
const { HOST_RUNTIME_KEY, TOOLKIT_KEY } = require('../shared/hostKeys');

const PREFIX = '@base-client/toolkit/';

/** 不映射的子路径：宿主专用、包侧入口、构建期、描述文件与 preload 相关 */
const NOT_MAPPED = new Set([
    'host',
    'runtime',
    'build',
    'package.json',
    'preload',
    'service/preload',
    'notice/preload',
]);

/**
 * 生成读取宿主运行时子包表的表达式。
 *
 * @param {string} subpath 如 `main/libs/logger`
 * @returns {string}
 */
function toolkitExpression(subpath) {
    return `globalThis[Symbol.for(${JSON.stringify(HOST_RUNTIME_KEY)})]`
        + `[Symbol.for(${JSON.stringify(TOOLKIT_KEY)})]`
        + `[${JSON.stringify(subpath)}]`;
}

/**
 * webpack externals 函数：把主进程代码中的 `require('@base-client/toolkit/<subpath>')`
 * 替换为从宿主运行时取值，宿主与包的主进程 bundle 共用。
 *
 * 只用于主进程；preload 不接入（运行在渲染进程，没有宿主运行时）。
 * 子包不存在时表达式得到 undefined，按 JS 默认行为在使用处报错。
 *
 * @param {{ request?: string }} data webpack 传入的请求信息
 * @param {(err?: Error|null, result?: string, type?: string) => void} callback
 * @returns {void}
 * @example
 * main: { externals: [toolkitExternals] }
 */
function toolkitExternals({ request } = {}, callback) {
    if (typeof request !== 'string' || !request.startsWith(PREFIX)) return callback();
    const subpath = request.slice(PREFIX.length);
    if (!subpath || NOT_MAPPED.has(subpath)) return callback();
    return callback(null, toolkitExpression(subpath), 'var');
}

module.exports = { toolkitExternals, toolkitExpression, NOT_MAPPED };
