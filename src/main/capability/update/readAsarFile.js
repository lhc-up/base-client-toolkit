/**
 * 从 `.asar` 归档中读取单个文件，不经过 Electron 的 asar 支持。
 *
 * 为什么不直接 `fse.readJSONSync(xxx.asar/package.json)`：Electron 读过一个归档后会缓存
 * 并一直持有它的文件句柄。Windows 下被持有的文件无法删除或改名（`fse.removeSync`
 * 静默不删，`rename` / `unlink` 报 EBUSY），导致读过描述文件的旧版本包再也清理不掉。
 * 这里用原生 fs 自己解析归档头，读完即关闭句柄。
 *
 * 归档格式：
 * - [0, 8)：pickle，`UInt32LE(4)` 为头部 pickle 的字节数 headerSize
 * - [8, 8 + headerSize)：头部 pickle，`UInt32LE(4)` 为 JSON 长度，JSON 从偏移 8 开始
 * - 文件内容起点 = 8 + headerSize + 条目的 `offset`
 *
 * @param {typeof import('fs')} fs 原生 fs（Electron 下为 `original-fs`）
 * @param {string} archivePath 归档路径
 * @param {string} innerPath 归档内路径，`/` 分隔，如 `package.json`
 * @returns {Buffer|null} 文件内容；条目不存在、是目录或被 unpack 时为 null
 * @throws {Error} 归档无法打开或头部损坏
 */
function readAsarFile(fs, archivePath, innerPath) {
    const fd = fs.openSync(archivePath, 'r');
    try {
        const sizeBuf = Buffer.alloc(8);
        fs.readSync(fd, sizeBuf, 0, 8, 0);
        const headerSize = sizeBuf.readUInt32LE(4);

        const headerBuf = Buffer.alloc(headerSize);
        fs.readSync(fd, headerBuf, 0, headerSize, 8);
        const jsonSize = headerBuf.readUInt32LE(4);
        const header = JSON.parse(headerBuf.toString('utf8', 8, 8 + jsonSize));

        let node = header;
        for (const segment of innerPath.split('/').filter(Boolean)) {
            node = node && node.files ? node.files[segment] : undefined;
        }
        if (!node || node.files || node.unpacked || node.offset === undefined) return null;

        const content = Buffer.alloc(node.size);
        fs.readSync(fd, content, 0, node.size, 8 + headerSize + Number(node.offset));
        return content;
    } finally {
        fs.closeSync(fd);
    }
}

module.exports = { readAsarFile };
