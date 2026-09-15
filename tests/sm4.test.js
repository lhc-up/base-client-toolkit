import { describe, expect, it } from 'vitest';
import { pipeline } from 'node:stream/promises';
import { Readable, PassThrough } from 'node:stream';
import sm4 from '../src/main/libs/sm4/index.js';

const key = Buffer.from('0123456789abcdeffedcba9876543210', 'hex');
const iv = Buffer.from('00000000000000000000000000000000', 'hex');
const standardPlaintext = Buffer.from('0123456789abcdeffedcba9876543210', 'hex');
const standardCiphertext = Buffer.from('681edf34d206965e86b3e94f536e4246', 'hex');

describe('SM4-CBC', () => {
    it('matches the standard single-block vector', async () => {
        const cipher = sm4.createCipheriv('SM4-CBC', key, iv);
        const actual = Buffer.concat([cipher.update(standardPlaintext), cipher.final()]);
        expect(actual.subarray(0, 16)).toEqual(standardCiphertext);
        expect(actual.length).toBe(32);
        const decipher = sm4.createDecipheriv('SM4-CBC', key, iv);
        const restored = Buffer.concat([decipher.update(actual), decipher.final()]);
        expect(restored).toEqual(standardPlaintext);
    });

    it('supports arbitrary chunk boundaries through a Transform pipeline', async () => {
        const source = Buffer.from('SM4 streaming data '.repeat(200));
        const input = Readable.from([source.subarray(0, 7), source.subarray(7, 101), source.subarray(101)]);
        const encrypted = new PassThrough();
        const encryptedChunks = [];
        encrypted.on('data', chunk => encryptedChunks.push(chunk));
        await pipeline(input, sm4.createCipheriv('SM4-CBC', key, iv), encrypted);
        const decryptInput = Readable.from(encryptedChunks.map(chunk => chunk.subarray(0)));
        const output = new PassThrough();
        const plainChunks = [];
        output.on('data', chunk => plainChunks.push(chunk));
        await pipeline(decryptInput, sm4.createDecipheriv('SM4-CBC', key, iv), output);
        expect(Buffer.concat(plainChunks)).toEqual(source);
    });

    it('rejects invalid key and iv lengths', () => {
        expect(() => sm4.createCipheriv('SM4-CBC', Buffer.alloc(15), iv)).toThrow(/key/i);
        expect(() => sm4.createCipheriv('SM4-CBC', key, Buffer.alloc(15))).toThrow(/iv/i);
    });

    it('rejects invalid padding on final decrypt', () => {
        const decipher = sm4.createDecipheriv('SM4-CBC', key, iv);
        decipher.update(Buffer.alloc(16));
        expect(() => decipher.final()).toThrow(/padding/i);
    });
});
