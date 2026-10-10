const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
// **必须是深层子路径，不能用根导入** —— 不是为了省体积，是根导入编不过：
// `unzipper/unzip.js` 的 `exports.Open = require('./lib/Open')` 链上要
// `@aws-sdk/client-s3`（unzipper 支持直读 S3 上的 zip），那是它的 optional 依赖、
// 默认不装，webpack 静态解析时找不到即报错，main 分段直接编译失败（2026-10-09 实测）。
// 要改回根导入，得先在打包层把 `@aws-sdk/*` 标成 externals 或 IgnorePlugin。
// `archiver` 没有这个问题，故用根导入。
const Parse = require('unzipper/lib/parse');
const archiver = require('archiver');

function archiveError(code, message, extra = {}) {
    return Object.assign(new Error(message), { code, ...extra });
}

function resolveInside(root, entryPath) {
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(resolvedRoot, entryPath);
    if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw archiveError('ARCHIVE_PATH_ESCAPE', 'Archive entry escapes extraction root', { entryPath });
    }
    return resolved;
}

function ensureSupportedEntry(entry) {
    const type = String(entry.type || '').toLowerCase();
    if (type !== 'file' && type !== 'directory') {
        throw archiveError(
            'ARCHIVE_UNSUPPORTED_ENTRY_TYPE',
            `Archive contains unsupported entry type: ${entry.type}`,
            { entryType: entry.type, entryPath: entry.path },
        );
    }
}

async function commitDirectory(stagingDir, destinationDir) {
    const parent = path.dirname(destinationDir);
    await fsp.mkdir(parent, { recursive: true });
    const backupDir = `${destinationDir}.backup-${randomUUID()}`;
    const hadDestination = fs.existsSync(destinationDir);
    try {
        if (hadDestination) await fsp.rename(destinationDir, backupDir);
        await fsp.rename(stagingDir, destinationDir);
        if (hadDestination) await fsp.rm(backupDir, { recursive: true, force: true });
    } catch (error) {
        await fsp.rm(destinationDir, { recursive: true, force: true }).catch(() => {});
        if (hadDestination && fs.existsSync(backupDir)) {
            await fsp.rename(backupDir, destinationDir).catch(() => {});
        }
        throw error;
    }
}

async function extractZip({ input, destinationDir, decrypt, signal } = {}) {
    if (!input || typeof input.pipe !== 'function') throw new TypeError('archive input must be a readable stream');
    if (typeof destinationDir !== 'string' || !path.isAbsolute(destinationDir)) {
        throw new TypeError('archive destinationDir must be absolute');
    }
    if (signal && signal.aborted) {
        throw archiveError('ARCHIVE_CANCELLED', 'Archive extraction cancelled');
    }
    const parent = path.dirname(destinationDir);
    const baseName = path.basename(destinationDir);
    await fsp.mkdir(parent, { recursive: true });
    const stagingDir = await fsp.mkdtemp(path.join(parent, `.${baseName}.staging-`));
    const source = decrypt ? input.pipe(decrypt) : input;
    const parser = source.pipe(Parse());
    // Extra error emissions (re-destroy after rejection, late entry errors) must not crash the process.
    parser.on('error', () => {});
    const onAbort = () => {
        const error = archiveError('ARCHIVE_CANCELLED', 'Archive extraction cancelled');
        input.destroy();
        if (decrypt && typeof decrypt.destroy === 'function') decrypt.destroy();
        parser.destroy(error);
    };
    if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
    }
    const jobs = [];
    let entryFailure = null;
    const processEntry = async entry => {
        try {
            ensureSupportedEntry(entry);
            const targetPath = resolveInside(stagingDir, entry.path);
            if (String(entry.type).toLowerCase() === 'directory') {
                await fsp.mkdir(targetPath, { recursive: true });
                entry.autodrain();
                return;
            }
            await fsp.mkdir(path.dirname(targetPath), { recursive: true });
            await pipeline(entry, fs.createWriteStream(targetPath, { flags: 'wx' }));
        } catch (error) {
            entryFailure = entryFailure || error;
            try { entry.autodrain(); } catch {}
            parser.destroy(error);
            throw error;
        }
    };
    parser.on('entry', entry => {
        const job = processEntry(entry);
        jobs.push(job);
        job.catch(() => {});
    });
    try {
        await new Promise((resolve, reject) => {
            parser.once('finish', resolve);
            parser.once('error', reject);
        });
        await Promise.all(jobs);
        if (entryFailure) throw entryFailure;
        await commitDirectory(stagingDir, destinationDir);
        return { destinationDir };
    } catch (error) {
        parser.destroy(error);
        await fsp.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
        throw error;
    } finally {
        if (signal) signal.removeEventListener('abort', onAbort);
    }
}

/**
 * 把若干文件/目录打成一个 zip。`extractZip` 的反向操作。
 *
 * `sources` 收**绝对路径数组，文件或目录皆可** —— 目录递归进去、以 basename 作为 zip 内的
 * 目录名。刻意不把输入形态写进函数名（不叫 `zipDirectory`）：调用方常见的两种需求
 * 「整目录打包」与「挑几个文件打包」用同一个入口，后者不必先拷到一个临时目录去凑形状。
 *
 * **原子晋升**：先写 `output.staging-{uuid}` 再 `rename`，与 `libs/download` 同一约定 ——
 * 中断、取消、崩溃都不会在 `output` 留下半截 zip 让下游当成完整文件读。
 *
 * `level` 默认 8、`forceLocalTime: true`：对齐业务侧既有实现（老项目
 * `main/libs/js/zipUtil.js` 的 `zipFolder`，已在生产跑过）。`forceLocalTime` 不是可选项 ——
 * zip 条目时间默认按 UTC 写，不修正会让解压后的文件时间差一个时区，
 * 按时间排查日志时会错位。
 *
 * @param {object} opts
 * @param {string[]} opts.sources 绝对路径数组，文件或目录
 * @param {string} opts.output zip 落点（绝对路径）
 * @param {number} [opts.level=8] deflate 级别 0-9
 * @param {AbortSignal} [opts.signal] 取消信号
 * @returns {Promise<{ output: string, bytes: number }>}
 */
async function createZip({ sources, output, level = 8, signal } = {}) {
    if (!Array.isArray(sources) || sources.length === 0) {
        throw new TypeError('archive sources must be a non-empty array');
    }
    for (const source of sources) {
        if (typeof source !== 'string' || !path.isAbsolute(source)) {
            throw new TypeError('archive sources entries must be absolute paths');
        }
    }
    if (typeof output !== 'string' || !path.isAbsolute(output)) {
        throw new TypeError('archive output must be absolute');
    }
    if (!Number.isInteger(level) || level < 0 || level > 9) {
        throw new TypeError('archive level must be an integer between 0 and 9');
    }
    if (signal && signal.aborted) {
        throw archiveError('ARCHIVE_CANCELLED', 'Archive creation cancelled');
    }

    // 先逐个 stat：缺文件要给明确错误。交给 archiver 的话它只发 'warning'（ENOENT）、
    // 默认不中断，结果是静默产出一个少了条目的 zip —— 对"打包日志去上报"这种用途是最坏的失败方式
    const entries = [];
    for (const source of sources) {
        let stat;
        try {
            stat = await fsp.stat(source);
        } catch (error) {
            throw archiveError('ARCHIVE_SOURCE_MISSING', `Archive source not found: ${source}`, {
                source,
                cause: error.code,
            });
        }
        entries.push({ source, isDirectory: stat.isDirectory() });
    }

    await fsp.mkdir(path.dirname(output), { recursive: true });
    const staging = `${output}.staging-${randomUUID()}`;

    try {
        await new Promise((resolve, reject) => {
            const sink = fs.createWriteStream(staging);
            const zip = archiver('zip', { zlib: { level }, forceLocalTime: true });
            let settled = false;

            const fail = error => {
                if (settled) return;
                settled = true;
                zip.abort();
                sink.destroy();
                reject(error);
            };
            const onAbort = () => fail(archiveError('ARCHIVE_CANCELLED', 'Archive creation cancelled'));

            if (signal) signal.addEventListener('abort', onAbort, { once: true });
            // archiver 的 ENOENT 等问题走 'warning' 而非 'error'，而上面已 stat 过，
            // 所以这里出现 warning 说明是打包途中文件被删/被占 —— 当失败处理，不产出残缺 zip
            zip.on('warning', fail);
            zip.on('error', fail);
            sink.on('error', fail);
            sink.on('close', () => {
                if (signal) signal.removeEventListener('abort', onAbort);
                if (settled) return;
                settled = true;
                resolve();
            });

            zip.pipe(sink);
            for (const { source, isDirectory } of entries) {
                const name = path.basename(source);
                if (isDirectory) zip.directory(source, name);
                else zip.file(source, { name });
            }
            zip.finalize().catch(fail);
        });

        await fsp.rename(staging, output);
        const { size } = await fsp.stat(output);
        return { output, bytes: size };
    } catch (error) {
        await fsp.rm(staging, { force: true }).catch(() => {});
        throw error;
    }
}

module.exports = { extractZip, createZip, resolveInside };
