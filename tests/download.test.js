import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
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

    it('传输阶段连续无数据超过 idleTimeoutMs 即中止（不再永久挂起）', async () => {
        const root = await tempRoot();
        const destinationPath = path.join(root, 'stalled.bin');
        const body = new Readable({ read() {} });
        const task = createDownload({ transport: {
            request: async () => ({ statusCode: 200, headers: {}, body }),
        } }).start({
            urls: ['https://stalled.invalid/file'],
            destinationPath,
            idleTimeoutMs: 30,
        });

        await expect(task.promise).rejects.toMatchObject({
            code: 'DOWNLOAD_FAILED',
            cause: expect.objectContaining({ code: 'DOWNLOAD_TIMEOUT' }),
        });
        expect(fs.existsSync(destinationPath)).toBe(false);
        await fsp.rm(root, { recursive: true, force: true });
    });

    it('idleTimeoutMs <= 0 关闭停顿检测', async () => {
        const root = await tempRoot();
        const destinationPath = path.join(root, 'file.bin');
        const task = createDownload({ transport: { request: async () => response('payload') } }).start({
            urls: ['https://ok.invalid/file'],
            destinationPath,
            idleTimeoutMs: 0,
        });
        await expect(task.promise).resolves.toMatchObject({ filePath: destinationPath });
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


describe('main download library: startBatch', () => {
    it('逐文件回调 started / completed，单文件失败不影响后续', async () => {
        const root = await tempRoot();
        const events = [];
        let calls = 0;
        const task = createDownload({ transport: {
            request: async () => {
                calls += 1;
                if (calls === 1) return { statusCode: 500, headers: {}, body: Readable.from(['x']) };
                return response('payload');
            },
        } }).startBatch({
            files: [
                { urls: ['https://a.invalid/f1'], destinationPath: path.join(root, 'f1.bin') },
                { urls: ['https://b.invalid/f2'], destinationPath: path.join(root, 'f2.bin') },
            ],
            onFileChange: event => events.push(event),
        });

        const { results } = await task.promise;
        expect(results.map(r => r.state)).toEqual(['failed', 'completed']);
        expect(events.filter(e => e.state === 'completed')).toHaveLength(1);
        expect(fs.readFileSync(path.join(root, 'f2.bin'), 'utf8')).toBe('payload');
        await fsp.rm(root, { recursive: true, force: true });
    });

    it('skipIfValid + integrity 命中已缓存文件时跳过，不发请求', async () => {
        const root = await tempRoot();
        const destinationPath = path.join(root, 'cached.bin');
        await fsp.writeFile(destinationPath, 'payload');
        const expected = createHash('sha256').update('payload').digest('hex');
        let requested = 0;
        const events = [];
        const task = createDownload({ transport: {
            request: async () => { requested += 1; return response('payload'); },
        } }).startBatch({
            files: [{
                urls: ['https://a.invalid/cached'],
                destinationPath,
                integrity: { algorithm: 'sha256', expected },
                skipIfValid: true,
            }],
            onFileChange: event => events.push(event),
        });

        const { results } = await task.promise;
        expect(results[0].state).toBe('skipped');
        expect(requested).toBe(0);
        expect(events.map(e => e.state)).toEqual(['skipped']);
        await fsp.rm(root, { recursive: true, force: true });
    });

    it('cancel 中止当前文件，未开始的文件不再执行', async () => {
        const root = await tempRoot();
        const events = [];
        const task = createDownload({ transport: {
            request: (url, { signal }) => new Promise((_, reject) => {
                signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { code: 'ABORT_ERR' })), { once: true });
            }),
        } }).startBatch({
            files: [{ urls: ['https://a.invalid/f1'], destinationPath: path.join(root, 'f1.bin') }],
            onFileChange: event => events.push(event),
        });

        await new Promise(resolve => setTimeout(resolve, 10));
        expect(task.cancel()).toBe(true);
        expect(task.cancel()).toBe(false);
        const { results } = await task.promise;
        expect(results[0].state).toBe('cancelled');
        expect(events.some(e => e.state === 'cancelled')).toBe(true);
        await fsp.rm(root, { recursive: true, force: true });
    });
});
