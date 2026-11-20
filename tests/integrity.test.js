import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import integrity from '../src/main/libs/integrity/index.js';

describe('async streaming integrity', () => {
    it('computes and verifies SHA-256 without synchronous whole-file reads', async () => {
        const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'toolkit-integrity-'));
        const filePath = path.join(root, 'large.bin');
        const content = Buffer.alloc(1024 * 1024 + 37, 0x5a);
        await fsp.writeFile(filePath, content);
        const expected = createHash('sha256').update(content).digest('hex');

        const result = await integrity.verify({ filePath, algorithm: 'sha256', expected });

        expect(result).toMatchObject({ valid: true, algorithm: 'sha256', expected, actual: expected });
        expect(result.size).toBe(content.length);
        const implementation = fs.readFileSync(
            path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/main/libs/integrity/index.js'),
            'utf8',
        );
        expect(implementation).not.toMatch(/readFileSync/);
        await fsp.rm(root, { recursive: true, force: true });
    });

    it('期望摘要可带算法前缀（sha256- / md5-）', async () => {
        const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'toolkit-integrity-'));
        const filePath = path.join(root, 'a.bin');
        await fsp.writeFile(filePath, 'payload');
        const sha = createHash('sha256').update('payload').digest('hex');
        const md5 = createHash('md5').update('payload').digest('hex');
        expect((await integrity.verify({ filePath, expected: `sha256-${sha}` })).valid).toBe(true);
        expect((await integrity.verify({ filePath, algorithm: 'md5', expected: `MD5-${md5}` })).valid).toBe(true);
        await fsp.rm(root, { recursive: true, force: true });
    });

    it('returns invalid for a mismatched digest', async () => {
        const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'toolkit-integrity-'));
        const filePath = path.join(root, 'file.txt');
        await fsp.writeFile(filePath, 'content');

        const result = await integrity.verify({ filePath, algorithm: 'sha256', expected: '0'.repeat(64) });

        expect(result.valid).toBe(false);
        expect(result.actual).not.toBe(result.expected);
        await fsp.rm(root, { recursive: true, force: true });
    });

    it('rejects unsupported algorithms and missing files', async () => {
        await expect(integrity.verify({ filePath: path.join(os.tmpdir(), 'missing'), algorithm: 'sha1', expected: 'x' }))
            .rejects.toMatchObject({ code: 'INTEGRITY_ALGORITHM_UNSUPPORTED' });
        await expect(integrity.verify({ filePath: path.join(os.tmpdir(), 'missing'), algorithm: 'sha256', expected: '0'.repeat(64) }))
            .rejects.toMatchObject({ code: 'INTEGRITY_FILE_READ_FAILED' });
    });
});
