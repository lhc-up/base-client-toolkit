import { describe, expect, it } from 'vitest';
import archiver from 'archiver';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { randomUUID } from 'node:crypto';
import sm4 from '../src/main/libs/sm4/index.js';
import { extractZip } from '../src/main/libs/archive/index.js';
import { createArchiveCapability } from '../src/main/capability/archive/createArchiveCapability.js';

async function createZip(entries) {
    const output = new PassThrough();
    const chunks = [];
    output.on('data', chunk => chunks.push(Buffer.from(chunk)));
    const ended = new Promise(resolve => output.once('end', resolve));
    const archive = archiver('zip', { zlib: { level: 8 } });
    archive.pipe(output);
    for (const entry of entries) archive.append(entry.content, { name: entry.name });
    await archive.finalize();
    await ended;
    return Buffer.concat(chunks);
}

async function tempRoot() {
    return fsp.mkdtemp(path.join(os.tmpdir(), 'toolkit-cap-archive-'));
}

async function createHarness() {
    const root = await tempRoot();
    const events = [];
    const capability = createArchiveCapability({
        archive: { extractZip },
        fs,
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

async function stageZip(root, scope, fileName, entries) {
    const dir = path.join(root, ...scope.split('/'));
    await fsp.mkdir(dir, { recursive: true });
    const zip = await createZip(entries);
    await fsp.writeFile(path.join(dir, fileName), zip);
    return zip;
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
describe('archive capability', () => {
    it('exposes only extract/cancel through Service and changed through Notice', () => {
        const capability = createArchiveCapability({
            archive: { extractZip },
            fs,
            filePathConfig: { storageResource: os.tmpdir() },
            broadcast: () => {},
            randomUUID,
        });

        expect(Object.keys(capability.serviceSchema.handlers).sort()).toEqual(['cancel', 'extract']);
        expect(capability.serviceSchema.namespace).toBe('archive');
        expect(capability.serviceSchema.sync || []).toEqual([]);
        expect(capability.noticeSchema).toEqual({ namespace: 'archive', events: ['changed'] });
    });

    it('extracts into a ZIP-owned directory under the target scope and reports through notice', async () => {
        const { root, events, capability, cleanup } = await createHarness();
        await stageZip(root, 'incoming', 'pack.zip', [
            { name: 'dir/a.txt', content: 'alpha' },
            { name: 'b.txt', content: 'beta' },
        ]);

        const result = capability.serviceSchema.handlers.extract({
            source: { scope: 'incoming', fileName: 'pack.zip' },
            target: { scope: 'papers' },
        });

        expect(Object.keys(result)).toEqual(['taskId']);
        expect(JSON.parse(JSON.stringify(result))).toEqual(result);

        await waitForEvent(events, p => p.state === 'completed');
        expect(events.every(e => e.name === 'archive.changed')).toBe(true);
        expect(events[0].payload.state).toBe('started');
        const completed = events.at(-1).payload;
        expect(completed.directory).toBe('pack');
        expect(completed.source).toEqual({ scope: 'incoming', fileName: 'pack.zip' });
        expect(completed.targetScope).toBe('papers');
        for (const { payload } of events) {
            expect(payload.taskId).toBe(result.taskId);
            expect(JSON.stringify(payload)).not.toContain(root);
            expect(payload.destinationDir).toBeUndefined();
        }

        const target = path.join(root, 'papers', 'pack');
        expect(fs.readFileSync(path.join(target, 'dir', 'a.txt'), 'utf8')).toBe('alpha');
        expect(fs.readFileSync(path.join(target, 'b.txt'), 'utf8')).toBe('beta');
        await cleanup();
    });

    it('decrypts through a decryptor registered in main without exposing key material', async () => {
        const { root, events, capability, cleanup } = await createHarness();
        const key = Buffer.from('0123456789abcdeffedcba9876543210', 'hex');
        const iv = Buffer.alloc(16);
        const zip = await createZip([{ name: 'secret.txt', content: 'classified' }]);
        const encrypted = await sm4.encrypt(zip, { key, iv });
        const dir = path.join(root, 'incoming');
        await fsp.mkdir(dir, { recursive: true });
        await fsp.writeFile(path.join(dir, 'secure.zip'), encrypted);

        capability.registerDecryptor('unit-sm4', () => sm4.createDecipheriv('SM4-CBC', key, iv));
        capability.serviceSchema.handlers.extract({
            source: { scope: 'incoming', fileName: 'secure.zip' },
            target: { scope: 'papers' },
            decrypt: { name: 'unit-sm4' },
        });

        await waitForEvent(events, p => p.state === 'completed');
        expect(fs.readFileSync(path.join(root, 'papers', 'secure', 'secret.txt'), 'utf8')).toBe('classified');
        const rendered = JSON.stringify(events);
        expect(rendered).not.toContain(key.toString('hex'));
        expect(rendered).not.toContain('0123456789abcdeffedcba9876543210');
        await cleanup();
    });

    it('rejects extract when the decryptor is not registered', async () => {
        const { capability, cleanup } = await createHarness();

        expect(() => capability.serviceSchema.handlers.extract({
            source: { scope: 'incoming', fileName: 'secure.zip' },
            target: { scope: 'papers' },
            decrypt: { name: 'missing' },
        })).toThrowError(expect.objectContaining({ code: 'ARCHIVE_DECRYPTOR_NOT_FOUND' }));
        await cleanup();
    });
    it('cancels an in-flight extraction and leaves no target directory', async () => {
        const { root, events, capability, cleanup } = await createHarness();
        await stageZip(root, 'incoming', 'big.zip', [
            { name: 'big.bin', content: randomUUID().repeat(100000) },
        ]);

        const result = capability.serviceSchema.handlers.extract({
            source: { scope: 'incoming', fileName: 'big.zip' },
            target: { scope: 'papers' },
        });
        expect(capability.serviceSchema.handlers.cancel(result.taskId)).toEqual({ accepted: true });

        await waitForEvent(events, p => p.state === 'cancelled');
        expect(events.some(e => e.payload.state === 'completed')).toBe(false);
        expect(fs.existsSync(path.join(root, 'papers', 'big'))).toBe(false);
        const leftovers = fs.existsSync(path.join(root, 'papers'))
            ? fs.readdirSync(path.join(root, 'papers')).filter(n => n.includes('staging'))
            : [];
        expect(leftovers).toEqual([]);
        await cleanup();
    });

    it('rejects cancellation for unknown taskId', () => {
        const capability = createArchiveCapability({
            archive: { extractZip },
            fs,
            filePathConfig: { storageResource: os.tmpdir() },
            broadcast: () => {},
            randomUUID,
        });

        expect(capability.serviceSchema.handlers.cancel('missing-task')).toEqual({ accepted: false });
    });

    it('reports corrupt archives as failed through notice', async () => {
        const { root, events, capability, cleanup } = await createHarness();
        const dir = path.join(root, 'incoming');
        await fsp.mkdir(dir, { recursive: true });
        await fsp.writeFile(path.join(dir, 'broken.zip'), Buffer.from('not a zip at all'));

        capability.serviceSchema.handlers.extract({
            source: { scope: 'incoming', fileName: 'broken.zip' },
            target: { scope: 'papers' },
        });

        const failed = await waitForEvent(events, p => p.state === 'failed');
        expect(failed.payload.error.code).toBeDefined();
        expect(fs.existsSync(path.join(root, 'papers', 'broken'))).toBe(false);
        await cleanup();
    });

    it('rejects escaping source scopes and file names', async () => {
        const { capability, cleanup } = await createHarness();

        expect(() => capability.serviceSchema.handlers.extract({
            source: { scope: '../outside', fileName: 'pack.zip' },
            target: { scope: 'papers' },
        })).toThrowError(expect.objectContaining({ code: 'SCOPE_INVALID' }));
        expect(() => capability.serviceSchema.handlers.extract({
            source: { scope: 'incoming', fileName: '../pack.zip' },
            target: { scope: 'papers' },
        })).toThrowError(expect.objectContaining({ code: 'FILE_NAME_INVALID' }));
        await cleanup();
    });
});