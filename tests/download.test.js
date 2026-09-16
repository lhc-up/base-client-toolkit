import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createDownload } from '../src/main/libs/download/index.js';

async function tempRoot() {
    return fsp.mkdtemp(path.join(os.tmpdir(), 'toolkit-download-'));
}

function response(body, statusCode = 200) {
    const buffer = Buffer.from(body);
    return {
        statusCode,
        headers: { 'content-length': String(buffer.length) },
        body: Readable.from([buffer.subarray(0, 2), buffer.subarray(2)]),
    };
}

describe('main download library', () => {
    it('falls back across URLs, reports progress, and atomically writes the destination', async () => {
        const root = await tempRoot();
        const destinationPath = path.join(root, 'scope', 'file.bin');
        const calls = [];
        const progress = [];
        const task = createDownload({ transport: {
            request: async url => {
                calls.push(url);
                if (calls.length === 1) throw Object.assign(new Error('primary unavailable'), { code: 'ECONNREFUSED' });
                return response('payload');
            },
        } }).start({
            urls: ['https://primary.invalid/file', 'https://backup.invalid/file'],
            destinationPath,
            onProgress: value => progress.push(value),
        });

        const result = await task.promise;
        expect(calls).toEqual(['https://primary.invalid/file', 'https://backup.invalid/file']);
        expect(result.filePath).toBe(destinationPath);
        expect(fs.readFileSync(destinationPath, 'utf8')).toBe('payload');
        expect(progress.at(-1).percent).toBe(100);
        expect(fs.readdirSync(path.dirname(destinationPath))).toEqual(['file.bin']);
        await fsp.rm(root, { recursive: true, force: true });
    });

    it('cancels an active transport and cleans the temporary file', async () => {
        const root = await tempRoot();
        const destinationPath = path.join(root, 'file.bin');
        let cancelled = false;
        let rejectRequest;
        let startedResolve;
        const started = new Promise(resolve => { startedResolve = resolve; });
        const task = createDownload({ transport: {
            request: () => new Promise((resolve, reject) => {
                rejectRequest = reject;
                startedResolve();
            }),
        } }).start({
            urls: ['https://example.invalid/file'],
            destinationPath,
        });
        await started;
        task.cancel();
        cancelled = true;
        rejectRequest(Object.assign(new Error('aborted'), { code: 'ABORT_ERR' }));
        await expect(task.promise).rejects.toMatchObject({ code: 'DOWNLOAD_CANCELLED' });
        expect(cancelled).toBe(true);
        expect(fs.existsSync(destinationPath)).toBe(false);
        await fsp.rm(root, { recursive: true, force: true });
    });

    it('rejects HTTP failures without leaving a destination file', async () => {
        const root = await tempRoot();
        const destinationPath = path.join(root, 'file.bin');
        const task = createDownload({ transport: { request: async () => response('not found', 404) } }).start({
            urls: ['https://example.invalid/file'],
            destinationPath,
        });
        await expect(task.promise).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
        expect(fs.existsSync(destinationPath)).toBe(false);
        await fsp.rm(root, { recursive: true, force: true });
    });
});
