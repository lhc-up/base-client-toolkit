/**
 * 资源根目录：随安装包分发、运行时读取的资源（内置包、addons、图标等）所在目录。
 *
 * - 本地调试（宿主运行时 `isHostDev` 为 true）：`<项目根目录>/resources`，`dev:app` 在项目根目录启动，取 `process.cwd()`
 * - 打包运行：`process.resourcesPath`
 *
 * 项目根目录的 `resources/` 是打包后 `resources/` 的镜像，由 frame 打包时复制。设计见 docs/design/pkg-source.md §6。
 * 依据只看宿主的 `isHostDev`，不看任何包自身的 `isPkgDev`。
 */
const path = require('path');
const { HOST_RUNTIME_KEY } = require('../../shared/hostKeys');
const { RESOURCES_DIR } = require('../frameContract');

/**
 * 宿主是否本地调试。未建立宿主运行时（存量项目）时视为打包运行。
 *
 * @returns {boolean}
 */
function isHostDev() {
    const runtime = globalThis[Symbol.for(HOST_RUNTIME_KEY)];
    return !!(runtime && runtime.isHostDev);
}

/**
 * @returns {string|null} 非 Electron 环境且非本地调试时为 null
 */
function getResourceRoot() {
    if (isHostDev()) return path.join(process.cwd(), RESOURCES_DIR);
    return process.resourcesPath || null;
}

/**
 * @param {...string} segments 资源根目录下的相对路径
 * @returns {string|null}
 */
function resolveResource(...segments) {
    const root = getResourceRoot();
    return root ? path.join(root, ...segments) : null;
}

module.exports = { isHostDev, getResourceRoot, resolveResource };
