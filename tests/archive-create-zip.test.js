// `libs/archive` 的 `createZip` 测试。
// 重点不只是"能打出 zip"，而是三条契约：
//   ① sources 收文件/目录混合，不要求调用方先凑成一个目录
//   ② 缺源即明确报错，绝不静默产出残缺 zip（这是"打包日志去上报"最坏的失败方式）
//   ③ 原子晋升 —— 失败/取消后 output 不留半截文件
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import archive from '../src/main/libs/archive/index.js';

async function tmpRoot() {
    return fsp.mkdtemp(path.join(os.tmpdir(), 'toolkit-createzip-'));
}

/** 用 extractZip 把产物解回来，顺带验证两个方向互通。 */
async function listZip(zipPath, destinationDir) {
    await archive.extractZip({
        input: fs.createReadStream(zipPath),
        destinationDir,
    });
    const names = [];
    const visit = (dir, prefix) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) visit(path.join(dir, entry.name), rel);
            else names.push(rel);
        }
    };
    visit(destinationDir, '');
    return names.sort();
}

describe('libs/archive createZip', () => {
    it('打包单个文件，并能被 extractZip 解回来', async () => {
        const root = await tmpRoot();
        const file = path.join(root, 'a.log');
        await fsp.writeFile(file, 'hello');

        const out = path.join(root, 'out.zip');
        const result = await archive.createZip({ sources: [file], output: out });

        expect(result.output).toBe(out);
        expect(result.bytes).toBeGreaterThan(0);
        expect(await listZip(out, path.join(root, 'unpacked'))).toEqual(['a.log']);
    });

    it('sources 可以是文件与目录混合，目录以 basename 为 zip 内目录名', async () => {
        const root = await tmpRoot();
        const file = path.join(root, 'top.log');
        await fsp.writeFile(file, 'top');
        const dir = path.join(root, 'nested');
        await fsp.mkdir(path.join(dir, 'deep'), { recursive: true });
        await fsp.writeFile(path.join(dir, 'one.txt'), '1');
        await fsp.writeFile(path.join(dir, 'deep', 'two.txt'), '2');

        const out = path.join(root, 'mixed.zip');
        await archive.createZip({ sources: [file, dir], output: out });

        expect(await listZip(out, path.join(root, 'unpacked'))).toEqual([
            'nested/deep/two.txt',
            'nested/one.txt',
            'top.log',
        ]);
    });

    it('缺源时报 ARCHIVE_SOURCE_MISSING，且不留下 output', async () => {
        const root = await tmpRoot();
        const real = path.join(root, 'real.log');
        await fsp.writeFile(real, 'x');
        const out = path.join(root, 'missing.zip');

        await expect(
            archive.createZip({ sources: [real, path.join(root, 'ghost.log')], output: out }),
        ).rejects.toMatchObject({ code: 'ARCHIVE_SOURCE_MISSING' });

        expect(fs.existsSync(out)).toBe(false);
    });

    it('已 abort 的 signal 直接拒绝，不产出文件', async () => {
        const root = await tmpRoot();
        const file = path.join(root, 'a.log');
        await fsp.writeFile(file, 'hello');
        const out = path.join(root, 'cancelled.zip');
        const controller = new AbortController();
        controller.abort();

        await expect(
            archive.createZip({ sources: [file], output: out, signal: controller.signal }),
        ).rejects.toMatchObject({ code: 'ARCHIVE_CANCELLED' });

        expect(fs.existsSync(out)).toBe(false);
    });

    it('失败后不留 staging 残骸', async () => {
        const root = await tmpRoot();
        const out = path.join(root, 'nope.zip');
        await expect(
            archive.createZip({ sources: [path.join(root, 'ghost.log')], output: out }),
        ).rejects.toMatchObject({ code: 'ARCHIVE_SOURCE_MISSING' });

        const leftovers = fs.readdirSync(root).filter(n => n.includes('staging'));
        expect(leftovers).toEqual([]);
    });

    it('output 的父目录不存在时自动建出来', async () => {
        const root = await tmpRoot();
        const file = path.join(root, 'a.log');
        await fsp.writeFile(file, 'hello');
        const out = path.join(root, 'deep', 'deeper', 'out.zip');

        await archive.createZip({ sources: [file], output: out });
        expect(fs.existsSync(out)).toBe(true);
    });

    it('参数校验：sources 必须是非空绝对路径数组，output 必须绝对，level 0-9', async () => {
        const root = await tmpRoot();
        const file = path.join(root, 'a.log');
        await fsp.writeFile(file, 'x');
        const out = path.join(root, 'o.zip');

        await expect(archive.createZip({ sources: [], output: out })).rejects.toThrow(TypeError);
        await expect(archive.createZip({ output: out })).rejects.toThrow(TypeError);
        await expect(archive.createZip({ sources: ['relative.log'], output: out })).rejects.toThrow(TypeError);
        await expect(archive.createZip({ sources: [file], output: 'relative.zip' })).rejects.toThrow(TypeError);
        await expect(archive.createZip({ sources: [file], output: out, level: 99 })).rejects.toThrow(TypeError);
    });

    it('level 0（仅存储）也能产出可解的 zip', async () => {
        const root = await tmpRoot();
        const file = path.join(root, 'a.log');
        await fsp.writeFile(file, 'hello'.repeat(100));
        const out = path.join(root, 'stored.zip');

        await archive.createZip({ sources: [file], output: out, level: 0 });
        expect(await listZip(out, path.join(root, 'unpacked'))).toEqual(['a.log']);
    });
});
