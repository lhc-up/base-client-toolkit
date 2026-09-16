const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const unzipper = require('unzipper');

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

async function extractZip({ input, destinationDir, decrypt } = {}) {
    if (!input || typeof input.pipe !== 'function') throw new TypeError('archive input must be a readable stream');
    if (typeof destinationDir !== 'string' || !path.isAbsolute(destinationDir)) {
        throw new TypeError('archive destinationDir must be absolute');
    }
    const parent = path.dirname(destinationDir);
    const baseName = path.basename(destinationDir);
    const stagingDir = await fsp.mkdtemp(path.join(parent, `.${baseName}.staging-`));
    const source = decrypt ? input.pipe(decrypt) : input;
    const parser = source.pipe(unzipper.Parse());
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
    }
}

module.exports = { extractZip, resolveInside };
