import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { readAsarFile } = require('../src/main/libs/pkg/readAsarFile');

/**
 * 按 asar 格式手工拼一个归档：
 * [UInt32 4][UInt32 headerSize] + [UInt32 payload][UInt32 jsonLen][json][pad] + 文件内容
 */
function buildAsar(entries) {
    const files = {};
    const contents = [];
    let offset = 0;
    for (const [name, text] of Object.entries(entries)) {
        const buf = Buffer.from(text);
        const segments = name.split('/');
        let node = files;
        for (const dir of segments.slice(0, -1)) {
            node[dir] = node[dir] || { files: {} };
            node = node[dir].files;
        }
        node[segments.at(-1)] = { size: buf.length, offset: String(offset) };
        contents.push(buf);
        offset += buf.length;
    }
    const json = Buffer.from(JSON.stringify({ files }));
    const padded = Math.ceil(json.length / 4) * 4;
    const headerPickle = Buffer.alloc(8 + padded);
    headerPickle.writeUInt32LE(4 + padded, 0);
    headerPickle.writeUInt32LE(json.length, 4);
    json.copy(headerPickle, 8);
    const sizePickle = Buffer.alloc(8);
    sizePickle.writeUInt32LE(4, 0);
    sizePickle.writeUInt32LE(headerPickle.length, 4);
    return Buffer.concat([sizePickle, headerPickle, ...contents]);
}

function writeTemp(buf) {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bc-asar-')), 'pkg.asar');
    fs.writeFileSync(file, buf);
    return file;
}

describe('readAsarFile', () => {
    const archive = writeTemp(buildAsar({
        'package.json': JSON.stringify({ name: 'demo', version: '1.2.3', env: 'prod' }),
        'main/pkg.js': 'module.exports = 1;',
    }));

    it('reads a top-level file', () => {
        const json = JSON.parse(readAsarFile(fs, archive, 'package.json').toString());
        expect(json).toEqual({ name: 'demo', version: '1.2.3', env: 'prod' });
    });

    it('reads a nested file', () => {
        expect(readAsarFile(fs, archive, 'main/pkg.js').toString()).toBe('module.exports = 1;');
    });

    it('returns null for missing entries and directories', () => {
        expect(readAsarFile(fs, archive, 'missing.json')).toBeNull();
        expect(readAsarFile(fs, archive, 'main')).toBeNull();
    });

    it('closes the file handle so the archive can be removed afterwards', () => {
        const file = writeTemp(buildAsar({ 'package.json': '{}' }));
        readAsarFile(fs, file, 'package.json');
        fs.rmSync(file);
        expect(fs.existsSync(file)).toBe(false);
    });

    it('throws for a non-existent archive', () => {
        expect(() => readAsarFile(fs, path.join(os.tmpdir(), 'nope.asar'), 'package.json')).toThrow();
    });
});
