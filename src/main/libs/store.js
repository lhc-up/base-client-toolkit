/**
 * 持久存储，两种形态、各管一摊：
 *
 * - **简单值存储** `set` / `get` / `remove` —— electron-store，落 `{store}/__store__.json`。
 *   适合小而结构化、整体读写的数据（窗口位置、用户偏好这类）。支持点路径嵌套（`a.b.c`）。
 *   **`get` 是同步的**，这是它的核心价值之一：调用方不必 await，也能服务那些
 *   必须同步返回的旧契约。代价是每次 `get` 都会读 + 解析整份 JSON
 *   （实测约 196 µs / 次，随文件增大而变慢），所以**不适合放大块数据或高频读取**。
 *
 * - **文件存储** `setFile` / `getFile` / `removeFile` —— 自行实现，一个 key 一个文件，
 *   落 `{store}/files/`。适合大块、互不相关、需要独立读写的数据（答案草稿、
 *   过程性文件、下载产物）。**只有它支持二进制。**
 *
 * 顶层即创建 Store 实例（cwd 取 paths 配置的 store 目录），无 init。
 * 坑：业务侧要改存储目录，必须在 require 本模块之前调用 `setPathConfig({ store: '...' })`。
 *
 * ## 文件存储的三处设计决定
 *
 * 1. **落在 `files/` 子目录，不与 `__store__.json` 同级**。`key` 常常来自外部
 *    （下载来的插件、题包、服务端下发的文件名），虽然经 `normalizeFileName` 挡掉了
 *    路径逃逸，但它**不挡 `__store__.json` 这个名字** —— 同级存放意味着一个普通的
 *    写入就能覆盖掉整个值存储。
 * 2. **`getFile` 返回 `Buffer`，不替调用方解码**。只有调用方知道自己存的是
 *    JSON、文本还是二进制；统一 `.toString()` 会把二进制静默损坏（UTF-8 解码会
 *    替换非法字节，且不报错）。要文本就 `buf.toString()`，要 Blob 就 `new Blob([buf])`。
 * 3. **全异步**。写盘在主进程，同步 API 会阻塞所有窗口。
 *
 * ## ⚠️ 相对上一版的破坏性变更
 *
 * 上一版 `setFile` 是 `typeof value === 'string' ? value : JSON.stringify(value)`
 * + `writeFileSync`，`getFile` 是 `readFileSync().toString()`，落点在 `{store}` 根。
 * 即：**存不了二进制**（Buffer 会被 `JSON.stringify` 成 `{"type":"Buffer","data":[…]}`）、
 * **读回来必然是字符串**、**同步 IO**。本版修正这三点，因此：
 * - 三个方法改为返回 Promise，调用方需 `await`（原先不 await 也能用）
 * - `getFile` 的返回类型由 `string` 变为 `Buffer`
 * - 落点由 `{store}/` 变为 `{store}/files/`，**旧位置的遗留文件不会被读到**
 */

const fse = require('fs-extra');
const path = require('path');
const logger = require('./logger');
const { getFilePathConfig } = require('../paths');
const { normalizeFileName } = require('./scope');

const filePathConfig = getFilePathConfig();

const Store = require('electron-store');
const store = new Store({
    cwd: filePathConfig.store,
    name: '__store__',
});

/** 文件存储的根。与 `__store__.json` 隔离，理由见文件头设计决定 1 */
const fileDir = path.join(filePathConfig.store, 'files');

function set(key, value) {
    store.set(key, value);
}

function get(key) {
    return store.get(key);
}

/**
 * 删除一个或多个 key。
 *
 * **入参可以是字符串或数组** —— 删除是幂等且无返回值的操作，多态入参的两个典型代价
 * （返回值形状分叉、调用方要判类型）在它身上都不成立。`setFile`/`getFile` 刻意不多态：
 * 批量读该返回数组还是 Map、缺失项怎么占位，全是歧义。
 *
 * **全部尝试完才抛**：某一个失败不中断其余，最后把第一个错误抛出（`err.errors` 带全部）。
 * 不吞异常——通用库吞掉失败就是在制造静默故障。
 *
 * @param {string|string[]} keyOrKeys
 */
function remove(keyOrKeys) {
    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
    const errors = [];
    for (const key of keys) {
        try {
            store.delete(key);
        } catch (err) {
            errors.push(err);
        }
    }
    if (errors.length) {
        const error = new Error(`store.remove: ${errors.length}/${keys.length} 个 key 删除失败`);
        error.errors = errors;
        throw error;
    }
}

/**
 * 把待写入的值归一成 Buffer。
 *
 * **二进制必须带 `byteOffset` / `byteLength`，不能写 `Buffer.from(view.buffer)`** ——
 * Node 的小 Buffer 分配自一个 8 KB 共享池，`.buffer` 指的是**整个池**而不是这几十个
 * 字节，于是会写出一大坨池内容。该坑只在小数据上出现（超过 `Buffer.poolSize / 2`
 * 的分配不走池，`.buffer` 恰好就是自己），**所以"用大文件测通了"不能说明问题**。
 */
function toBuffer(value) {
    if (Buffer.isBuffer(value)) return value;
    if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer) return Buffer.from(value);
    if (typeof value === 'string') return Buffer.from(value, 'utf8');
    if (value === undefined || value === null) {
        throw new TypeError('store.setFile: value must not be null or undefined');
    }
    // 对象 / 数组 / 数字 / 布尔 —— 按 JSON 存，与上一版对非字符串的处理一致
    return Buffer.from(JSON.stringify(value), 'utf8');
}

function resolveFilePath(key) {
    return path.join(fileDir, normalizeFileName(key));
}

/**
 * 写入一个文件。
 *
 * @param {string} key 纯文件名（不可含路径分隔符，经 `normalizeFileName` 校验）
 * @param {Buffer|Uint8Array|ArrayBuffer|string|object} value
 *   二进制原样写；字符串按 utf8 写；其余 `JSON.stringify` 后写
 * @returns {Promise<string>} 写入的绝对路径
 * @throws key 非法或 value 为空时抛
 */
async function setFile(key, value) {
    const filePath = resolveFilePath(key);
    const bytes = toBuffer(value);
    await fse.ensureDir(fileDir);
    await fse.writeFile(filePath, bytes);
    return filePath;
}

/**
 * 读取一个文件。
 *
 * @param {string} key 纯文件名
 * @returns {Promise<Buffer|null>} 文件内容；**不存在时为 `null`**
 *
 * 返回 Buffer 而非字符串，理由见文件头设计决定 2。
 * 文件不存在是正常分支、不打日志；其余错误记日志后同样返回 `null`。
 */
async function getFile(key) {
    try {
        return await fse.readFile(resolveFilePath(key));
    } catch (err) {
        if (err.code !== 'ENOENT') logger.error('获取文件失败', key, err);
        return null;
    }
}

/**
 * 删除一个或多个文件。不存在时静默成功（与 `fse.remove` 语义一致，删除本就幂等）。
 *
 * **入参可以是字符串或数组**，理由同 `remove`。
 *
 * **先把所有 key 校验完再开始删** —— 否则一个非法 key 会让前面几个已经删掉、
 * 调用方拿到异常却不知道删到哪了。文件名非法属**入参错误**，不计入"部分失败"。
 *
 * **全部尝试完才抛**：某个文件删不掉（占用、权限）不中断其余，最后抛第一个错误
 * （`err.errors` 带全部）。
 *
 * @param {string|string[]} keyOrKeys 纯文件名
 * @returns {Promise<void>}
 */
async function removeFile(keyOrKeys) {
    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
    // 先全部解析，非法 key 在这里抛，此时还没有任何文件被删
    const paths = keys.map(resolveFilePath);
    const errors = [];
    for (const filePath of paths) {
        try {
            await fse.remove(filePath);
        } catch (err) {
            errors.push(err);
        }
    }
    if (errors.length) {
        const error = new Error(`store.removeFile: ${errors.length}/${keys.length} 个文件删除失败`);
        error.errors = errors;
        throw error;
    }
}

module.exports = {
    set,
    get,
    remove,
    setFile,
    getFile,
    removeFile,
    /** 文件存储根，供业务侧需要把它交给协议白名单一类场景使用 */
    fileDir,
};
