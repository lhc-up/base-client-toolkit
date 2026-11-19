import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import { createDownload } from '../src/main/libs/download/index.js';
import { createDownloadCapability } from '../src/main/capability/download/createDownloadCapability.js';

async function tempRoot() {
    return fsp.mkdtemp(path.join(os.tmpdir(), 'toolkit-cap-download-'));
}

function okTransport(body = 'payload') {
    const buffer = Buffer.from(body);
    return {
        request: async () => ({
            statusCode: 200,
            headers: { 'content-length': String(buffer.length) },
            body: Readable.from([buffer.subarray(0, 2), buffer.subarray(2)]),
        }),
    };
}

function hangingTransport() {
    return {
        request: (url, { signal }) => new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(
                Object.assign(new Error('aborted'), { code: 'ABORT_ERR' }),
            ), { once: true });
        }),
    };
}

async function createHarness({ transport = okTransport() } = {}) {
    const root = await tempRoot();
    const events = [];
    const capability = createDownloadCapability({
        download: createDownload({ transport }),
        fsp,
        filePathConfig: { storageResource: root },
        broadcast: (name, payload) => events.push({ name, payload }),
        randomUUID,
    });
    return {
        root,
        events,
        capability,
        cleanup: () => fsp.rm(root, { recursive: true, force: true }),
    };
}

async function waitForEvent(events, predicate, timeoutMs = 5000) {
    const startedAt = Date.now();
    for (;;) {
        const hit = events.find(e => predicate(e.payload));
        if (hit) return hit;
        if (Date.now() - startedAt > timeoutMs) {
            throw new Error(`timed out waiting for event; got ${JSON.stringify(events)}`);
        }
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}
describe('download capability', () => {
    it('exposes only start/cancel through Service and changed through Notice', () => {
        const capability = createDownloadCapability({
            download: { start: () => ({ promise: Promise.resolve(), cancel: () => true }) },
                fsp,
            filePathConfig: { storageResource: os.tmpdir() },
            broadcast: () => {},
            randomUUID,
        });

        expect(Object.keys(capability.serviceSchema.handlers).sort()).toEqual(['cancel', 'start']);
        expect(capability.serviceSchema.namespace).toBe('download');
        expect(capability.serviceSchema.sync || []).toEqual([]);
        expect(capability.noticeSchema).toEqual({ namespace: 'download', events: ['changed'] });
        expect(capability.serviceSchema.handlers.getState).toBeUndefined();
        expect(capability.serviceSchema.handlers.getProgress).toBeUndefined();
    });

    it('returns a serializable { taskId } and reports lifecycle only through notice', async () => {
        const { root, events, capability, cleanup } = await createHarness();

        const result = capability.serviceSchema.handlers.start({
            scope: 'paper/1',
            urls: ['https://example.invalid/f.bin'],
        });

        expect(Object.keys(result)).toEqual(['taskId']);
        expect(typeof result.taskId).toBe('string');
        expect(JSON.parse(JSON.stringify(result))).toEqual(result);

        await waitForEvent(events, p => p.state === 'completed');

        expect(events.every(e => e.name === 'download.changed')).toBe(true);
        expect(events[0].payload.state).toBe('started');
        expect(events.at(-1).payload.state).toBe('completed');
        for (const { payload } of events) {
            expect(payload.taskId).toBe(result.taskId);
            expect(payload.scope).toBe('paper/1');
            expect(payload.fileName).toBe('f.bin');
            expect(JSON.stringify(payload)).not.toContain(root);
            expect(payload.filePath).toBeUndefined();
        }

        expect(events.some(e => e.payload.state === 'progress')).toBe(true);
        const completed = events.at(-1).payload;
        expect(completed.size).toBe(Buffer.byteLength('payload'));
        expect(fs.readFileSync(path.join(root, 'paper', '1', 'f.bin'), 'utf8')).toBe('payload');
        await cleanup();
    });

    it('accepts scope segment arrays and normalizes them in events', async () => {
        const { events, capability, cleanup } = await createHarness();

        capability.serviceSchema.handlers.start({
            scope: ['answer', 'u-7'],
            urls: ['https://example.invalid/a.bin'],
        });
        await waitForEvent(events, p => p.state === 'completed');

        expect(events[0].payload.scope).toBe('answer/u-7');
        await cleanup();
    });

    it('lands a batch of files in the same scope under one taskId', async () => {
        const { root, events, capability, cleanup } = await createHarness();

        const result = capability.serviceSchema.handlers.start({
            scope: 'batch',
            files: [
                { urls: ['https://example.invalid/a.bin'], fileName: 'a.bin' },
                { urls: ['https://example.invalid/b.bin'], fileName: 'b.bin' },
            ],
        });

        await waitForEvent(events, p => p.state === 'completed' && p.fileName === 'b.bin');
        const completedFiles = events
            .filter(e => e.payload.state === 'completed')
            .map(e => e.payload.fileName);
        expect(completedFiles).toEqual(['a.bin', 'b.bin']);
        expect(events.every(e => e.payload.taskId === result.taskId)).toBe(true);
        expect(fs.existsSync(path.join(root, 'batch', 'a.bin'))).toBe(true);
        expect(fs.existsSync(path.join(root, 'batch', 'b.bin'))).toBe(true);
        await cleanup();
    });
    it('verifies integrity after download and reports mismatch as failed without keeping the file', async () => {
        const { root, events, capability, cleanup } = await createHarness();
        const expected = createHash('sha256').update('tampered').digest('hex');

        capability.serviceSchema.handlers.start({
            scope: 'checked',
            urls: ['https://example.invalid/f.bin'],
            integrity: { algorithm: 'sha256', expected },
        });
        const failed = await waitForEvent(events, p => p.state === 'failed');

        expect(failed.payload.error.code).toBe('DOWNLOAD_INTEGRITY_MISMATCH');
        expect(fs.existsSync(path.join(root, 'checked', 'f.bin'))).toBe(false);
        await cleanup();
    });

    it('completes when integrity matches', async () => {
        const { events, capability, cleanup } = await createHarness();
        const expected = createHash('sha256').update('payload').digest('hex');

        capability.serviceSchema.handlers.start({
            scope: 'checked-ok',
            urls: ['https://example.invalid/f.bin'],
            integrity: { expected },
        });
        const completed = await waitForEvent(events, p => p.state === 'completed');

        expect(completed.payload.fileName).toBe('f.bin');
        await cleanup();
    });

    it('cancels an in-flight download through taskId and emits cancelled', async () => {
        const { events, capability, cleanup } = await createHarness({ transport: hangingTransport() });

        const result = capability.serviceSchema.handlers.start({
            scope: 'cancel-me',
            urls: ['https://example.invalid/slow.bin'],
        });
        await waitForEvent(events, p => p.state === 'started');

        expect(capability.serviceSchema.handlers.cancel(result.taskId)).toEqual({ accepted: true });
        await waitForEvent(events, p => p.state === 'cancelled');
        expect(capability.serviceSchema.handlers.cancel(result.taskId)).toEqual({ accepted: false });
        expect(events.some(e => e.payload.state === 'failed')).toBe(false);
        await cleanup();
    });

    it('rejects unknown taskId cancellation', () => {
        const capability = createDownloadCapability({
            download: { start: () => ({ promise: Promise.resolve(), cancel: () => true }) },
                fsp,
            filePathConfig: { storageResource: os.tmpdir() },
            broadcast: () => {},
            randomUUID,
        });

        expect(capability.serviceSchema.handlers.cancel('missing-task')).toEqual({ accepted: false });
    });

    it('rejects scopes that escape the controlled root', async () => {
        const { capability, cleanup } = await createHarness();

        expect(() => capability.serviceSchema.handlers.start({
            scope: '../escape',
            urls: ['https://example.invalid/f.bin'],
        })).toThrowError(expect.objectContaining({ code: 'SCOPE_INVALID' }));
        expect(() => capability.serviceSchema.handlers.start({
            scope: ['ok', '..', 'escape'],
            urls: ['https://example.invalid/f.bin'],
        })).toThrowError(expect.objectContaining({ code: 'SCOPE_INVALID' }));
        await cleanup();
    });

    it('rejects file names that contain path separators', async () => {
        const { capability, cleanup } = await createHarness();

        expect(() => capability.serviceSchema.handlers.start({
            scope: 'safe',
            urls: ['https://example.invalid/f.bin'],
            fileName: '../f.bin',
        })).toThrowError(expect.objectContaining({ code: 'FILE_NAME_INVALID' }));
        await cleanup();
    });
    it('reports transport failure through notice and continues the batch', async () => {
        let calls = 0;
        const failingThenOk = {
            request: async () => {
                calls += 1;
                if (calls === 1) return { statusCode: 500, headers: {}, body: Readable.from(['x']) };
                const buffer = Buffer.from('payload');
                return {
                    statusCode: 200,
                    headers: { 'content-length': String(buffer.length) },
                    body: Readable.from([buffer]),
                };
            },
        };
        const { events, capability, cleanup } = await createHarness({ transport: failingThenOk });

        capability.serviceSchema.handlers.start({
            scope: 'mixed',
            files: [
                { urls: ['https://example.invalid/broken.bin'] },
                { urls: ['https://example.invalid/good.bin'] },
            ],
        });

        await waitForEvent(events, p => p.state === 'completed' && p.fileName === 'good.bin');
        const failed = events.find(e => e.payload.state === 'failed');
        expect(failed.payload.fileName).toBe('broken.bin');
        expect(failed.payload.error.code).toBe('DOWNLOAD_FAILED');
        await cleanup();
    });
});