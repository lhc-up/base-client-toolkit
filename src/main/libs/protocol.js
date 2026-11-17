/**
 * 自定义协议：`resource://`（本地资源）与 `iframe-resource://`（交互内容独立 origin）。
 *
 * 分工：特权 scheme 只能在 app ready 前、整个进程声明一次，由宿主调用 `declareSchemes`；
 * handler 由包在挂载时注册（`serveResource` / `serveIframeResource`），卸载时用返回的函数撤销。
 *
 * 两个协议不能合并：`resource://` 下所有资源共用一个 origin；`iframe-resource://`
 * 的 host 段 `pkg-{id}` 为每份交互内容提供独立 origin，使它们之间无法互相访问 DOM 与存储。
 *
 * `iframe-resource` 必须注册为 `standard + secure`：交互内容要用麦克风录音，
 * `getUserMedia` 只在 secure context 下可用，去掉 `secure` 会让录音静默失效；
 * `standard` 是内容内相对 URL（如 `./media/demo.mp4`）能解析的前提。
 */
const { protocol } = require('electron');
const url = require('url');
const path = require('path');
const Logger = require('./logger');

const IFRAME_SCHEME = 'iframe-resource';
const RESOURCE_SCHEME = 'resource';

const DEFAULT_SCHEMES = [
    {
        scheme: IFRAME_SCHEME,
        privileges: {
            standard: true,
            secure: true,
        },
    },
    {
        scheme: RESOURCE_SCHEME,
        privileges: {
            // 渲染层要 `fetch(resource://…)` 取文件，不注册 supportFetchAPI 时
            // fetch 根本到不了 handler（`<img>` / `<video>` 等子资源加载不受影响）。
            //
            // 不能加 `standard`：它会把 Windows 盘符当 host 吃掉并小写化，
            // `resource://c/Users/x` 会被还原成 UNC 路径 `\\c\Users\x`。
            // `buildResourceUrl` 与 handler 的 `${u.host}${u.pathname}` 都按非 standard 设计。
            supportFetchAPI: true,
        },
    },
];

let declared = false;

/**
 * 声明特权 scheme。宿主在 app ready 前调用，整个进程只能调用一次。
 *
 * 挪到 ready 之后 Electron 会静默忽略：iframe 失去 secure context（录音失效）且不报错。
 * `registerSchemesAsPrivileged` 多次调用以最后一次为准，因此所有 scheme 必须在这一次里声明。
 *
 * @param {Electron.CustomScheme[]} [extra] 追加的特权 scheme
 * @throws {Error} 重复调用时抛错
 */
function declareSchemes(extra = []) {
    if (declared) throw new Error('declareSchemes 只能调用一次（须包含全部特权 scheme）');
    protocol.registerSchemesAsPrivileged([...DEFAULT_SCHEMES, ...extra]);
    declared = true;
}

/**
 * 把本地绝对路径转成 `resource://` URL。
 *
 * 必须经 `pathToFileURL` 再换 scheme，不能自己拼字符串或对整条路径 `encodeURIComponent`：
 * 整体编码会把 `/` 也编码掉，导致 `new URL('./js/a.js', entryUrl)` 这类相对路径解析失效。
 *
 * @param {string} filePath 绝对路径
 * @returns {string} 形如 `resource:///C:/.../a%20b.png`
 */
function buildResourceUrl(filePath) {
    return url.pathToFileURL(filePath).href.replace(/^file:/, `${RESOURCE_SCHEME}:`);
}

/**
 * 把内容包内的文件路径转成 `iframe-resource://pkg-{id}/...` URL。
 *
 * `id` 属外部输入：先转小写（URL 会把 host 规范化为小写，不转无法比对），
 * 再确认 `port` 为空（防注入端口）、`pathname` 未被改写（防 id 里带 `/` 或 `?` 改变路径）。
 *
 * @param {string} filePath 绝对路径
 * @param {string} id 内容标识，组成 origin 的 host 段
 * @returns {string}
 * @throws {Error} id 不合法
 */
function buildIframeResourceUrl(filePath, id) {
    if (id === undefined || id === null) {
        throw new Error(`内容标识不合法：${id}`);
    }
    const normalized = String(id).trim().toLowerCase();
    if (!normalized) throw new Error(`内容标识不合法：${id}`);
    const fileUrl = url.pathToFileURL(filePath);
    const iframeUrl = new URL(`${IFRAME_SCHEME}://pkg-${normalized}${fileUrl.pathname}`);
    if (
        !iframeUrl.hostname.startsWith('pkg-') ||
        iframeUrl.port ||
        iframeUrl.pathname !== fileUrl.pathname
    ) {
        throw new Error(`内容标识不合法：${id}`);
    }
    return iframeUrl.href;
}

/**
 * 判断 target 是否落在 roots 任一根之内（含等于）。
 * 只做 `path.resolve` + 前缀比较、不访问文件系统，根目录尚未创建也不影响判断。
 *
 * @param {string[]} roots
 * @param {string} target
 * @returns {boolean}
 */
function isInsideAnyRoot(roots, target) {
    const t = path.resolve(target);
    return roots.some(root => {
        const r = path.resolve(root);
        return t === r || t.startsWith(r + path.sep);
    });
}

function assertRoots(roots, api) {
    if (!Array.isArray(roots) || roots.some(r => typeof r !== 'string' || !path.isAbsolute(r))) {
        throw new TypeError(`${api}: roots 必须是绝对路径数组`);
    }
}

/**
 * 协议 URL 是外部输入，带 `../` 就可能读到任意文件，因此对解析后的最终路径做允许根校验，
 * 越界返回 ACCESS_DENIED。`?t=123` 这类 query 由 URL 解析自动剥离，不会进 pathname。
 */
function handleFile(request, callback, toFileUrl, scheme, roots) {
    try {
        const requestUrl = new url.URL(request.url);
        const filePath = url.fileURLToPath(toFileUrl(requestUrl));
        if (!isInsideAnyRoot(roots, filePath)) {
            // net error -10 = ACCESS_DENIED；-6 = FILE_NOT_FOUND
            Logger.error(`${scheme} 请求越界，已拒绝`, request.url);
            return callback({ error: -10 });
        }
        return callback(filePath);
    } catch (err) {
        // 非法 URL 会让 fileURLToPath 抛错，不能让它抛进 Electron 的协议栈
        Logger.error(`${scheme} 解析失败`, request.url, err);
        return callback({ error: -6 });
    }
}

/**
 * 注册 `resource://` handler：在允许的根目录内提供本地文件。须在 app ready 之后调用。
 *
 * @param {Object} options
 * @param {string[]} options.roots 允许访问的根目录（绝对路径），消费者应是可信的页面
 * @returns {() => void} 撤销函数
 */
function serveResource({ roots } = {}) {
    assertRoots(roots, 'serveResource');
    protocol.registerFileProtocol(RESOURCE_SCHEME, (request, callback) =>
        // 保留 host 段：非 standard scheme 下部分实现会把首段解析成 host，带上它才能完整还原
        handleFile(request, callback, u => `file://${u.host}${u.pathname}`, RESOURCE_SCHEME, roots));
    return () => protocol.unregisterProtocol(RESOURCE_SCHEME);
}

/**
 * 注册 `iframe-resource://` handler：为交互内容提供 `pkg-*` 独立 origin。须在 app ready 之后调用。
 *
 * 允许根应与 `serveResource` 分开：这里的消费者是下载来的不可信内容，
 * 给可信页面开放的目录（如日志导出目录）不应同时暴露给它。
 *
 * @param {Object} options
 * @param {string[]} options.roots 允许访问的根目录（绝对路径）
 * @returns {() => void} 撤销函数
 */
function serveIframeResource({ roots } = {}) {
    assertRoots(roots, 'serveIframeResource');
    protocol.registerFileProtocol(IFRAME_SCHEME, (request, callback) => {
        const requestUrl = new url.URL(request.url);
        if (!requestUrl.hostname.startsWith('pkg-')) {
            Logger.error(`${IFRAME_SCHEME} host 非法`, request.url);
            return callback({ error: -6 });
        }
        // 不带 host：host 是 `pkg-{id}` 的 origin 标识，不是路径的一部分
        return handleFile(request, callback, u => `file://${u.pathname}`, IFRAME_SCHEME, roots);
    });
    return () => protocol.unregisterProtocol(IFRAME_SCHEME);
}

module.exports = {
    IFRAME_SCHEME,
    RESOURCE_SCHEME,
    declareSchemes,
    buildResourceUrl,
    buildIframeResourceUrl,
    serveResource,
    serveIframeResource,
};
