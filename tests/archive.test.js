import { describe, expect, it } from 'vitest';
import archiver from 'archiver';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sm4 from '../src/main/libs/sm4/index.js';
import { extractZip, resolveInside } from '../src/main/libs/archive/index.js';

async function createZip(entries) {
    const output = new PassThrough();
    const chunks = [];
    output.on('data', chunk => chunks.push(Buffer.from(chunk)));
    const ended = new Promise(resolve => output.once('end', resolve));
    const archive = archiver('zip', { zlib: { level: 8 } });
    archive.pipe(output);
    for (const entry of entries) {
        if (entry.type === 'symlink') archive.symlink(entry.name, entry.content);
        else archive.append(entry.content, { name: entry.name });
    }
    await archive.finalize();
    await ended;
    return Buffer.concat(chunks);
}

async function tempRoot() {
    return fsp.mkdtemp(path.join(os.tmpdir(), 'toolkit-archive-'));
}

describe('streaming safe ZIP archive', () => {
    it('extracts entries into a ZIP-owned directory and replaces only that directory', async () => {
        const root = await tempRoot();
        const target = path.join(root, 'paper-1');
        await fsp.mkdir(target, { recursive: true });
        await fsp.writeFile(path.join(target, 'old.txt'), 'old');
        const zip = await createZip([{ name: 'new.txt', content: 'new' }]);

        const result = await extractZip({ input: Readable.from([zip]), destinationDir: target });

        expect(result.destinationDir).toBe(target);
        expect(await fsp.readFile(path.join(target, 'new.txt'), 'utf8')).toBe('new');
        expect(fs.existsSync(path.join(target, 'old.txt'))).toBe(false);
        await fsp.rm(root, { recursive: true, force: true });
    });

    it('supports a decrypt Transform directly before ZIP parsing', async () => {
        const root = await tempRoot();
        const target = path.join(root, 'paper-2');
        const key = Buffer.from('0123456789abcdeffedcba9876543210', 'hex');
        const iv = Buffer.alloc(16);
        const zip = await createZip([{ name: 'entry.txt', content: 'decrypted content' }]);
        const encrypted = await sm4.encrypt(zip, { key, iv });

        await extractZip({
            input: Readable.from([encrypted]),
            decrypt: sm4.createDecipheriv('SM4-CBC', key, iv),
            destinationDir: target,
        });

        expect(await fsp.readFile(path.join(target, 'entry.txt'), 'utf8')).toBe('decrypted content');
        await fsp.rm(root, { recursive: true, force: true });
    });

    it('rejects entries whose resolved path escapes the extraction root', async () => {
        const root = await tempRoot();
        const target = path.join(root, 'paper-3');

        expect(() => resolveInside(target, '../outside.txt'))
            .toThrowError(expect.objectContaining({ code: 'ARCHIVE_PATH_ESCAPE', entryPath: '../outside.txt' }));
        await fsp.rm(root, { recursive: true, force: true });
    });

    it('does not restore ZIP symlink metadata and writes the streamed entry as a regular file', async () => {
        const root = await tempRoot();
        const target = path.join(root, 'paper-4');
        const zip = await createZip([{ type: 'symlink', name: 'current.txt', content: 'releases/v1.txt' }]);

        await extractZip({ input: Readable.from([zip]), destinationDir: target });

        expect(await fsp.readFile(path.join(target, 'current.txt'), 'utf8')).toBe('releases/v1.txt');
        expect((await fsp.lstat(path.join(target, 'current.txt'))).isSymbolicLink()).toBe(false);
        await fsp.rm(root, { recursive: true, force: true });
    });
});
