// `main/libs/store` 的契约测试：简单值存储（electron-store）+ 文件存储（自行实现）。
//
// 重点在文件存储的三条契约：**能存二进制**、**读回 Buffer 不替调用方解码**、
// **落点与 `__store__.json` 隔离**。前两条是这次重写的直接目的（上一版
// `JSON.stringify` + `.toString()` 存不了二进制），第三条是安全要求——
// `key` 常来自外部，而 `normalizeFileName` 挡得住路径逃逸、挡不住
// `__store__.json` 这个名字。
//
// 导入形态与其它测试一致：vitest 走 ESM import，被测 CJS 源码用 createRequire 取；
// `paths.js` 要 electron 的 `app.getPath`，按 `tests/logger.test.js` 的同一模式
// 注入 require.cache。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';

const require = createRequire(import.meta.url);

const STORE_ROOT = path.join(os.tmpdir(), 'bc-toolkit-store-test');

const electronPath = require.resolve('electron');
require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: { app: { getPath: () => STORE_ROOT } },
    children: [],
    paths: [],
};

const { setPathConfig } = require('../src/main/paths');
setPathConfig({ store: path.join(STORE_ROOT, 'Store') });
const store = require('../src/main/libs/store');

const STORE_DIR = path.join(STORE_ROOT, 'Store');

afterAll(async () => {
    await fsp.rm(STORE_ROOT, { recursive: true, force: true }).catch(() => {});
});

describe('文件存储：能存二进制', () => {
    it('小 Buffer 原样往返 —— 覆盖 Buffer 共享池陷阱', async () => {
        // 小于 Buffer.poolSize/2 的分配来自 8KB 共享池，`.buffer` 是整个池。
        // 若实现写成 Buffer.from(view.buffer) 就会写出一坨池内容，**只在小数据上暴露**
        const data = Buffer.from('interactive-answer-测试');
        await store.setFile('small.bin', data);
        const got = await store.getFile('small.bin');
        expect(Buffer.isBuffer(got)).toBe(true);
        expect(got.equals(data)).toBe(true);
    });

    it('1MB 二进制原样往返', async () => {
        const data = Buffer.alloc(1024 * 1024);
        for (let i = 0; i < data.length; i += 1) data[i] = i % 256;
        await store.setFile('big.bin', data);
        const got = await store.getFile('big.bin');
        expect(got.length).toBe(data.length);
        expect(got.equals(data)).toBe(true);
    });

    it('带 byteOffset 的 TypedArray 视图只写视图范围', async () => {
        const base = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
        const view = base.subarray(2, 5); // [2,3,4]
        await store.setFile('view.bin', view);
        const got = await store.getFile('view.bin');
        expect([...got]).toEqual([2, 3, 4]);
    });

    it('ArrayBuffer 可直接写入', async () => {
        await store.setFile('ab.bin', new Uint8Array([9, 8, 7]).buffer);
        expect([...(await store.getFile('ab.bin'))]).toEqual([9, 8, 7]);
    });
});

describe('文件存储：读回 Buffer，不替调用方解码', () => {
    it('字符串按 utf8 写入，读回 Buffer，由调用方 toString', async () => {
        await store.setFile('text.txt', '你好 world');
        const got = await store.getFile('text.txt');
        expect(Buffer.isBuffer(got)).toBe(true);
        expect(got.toString('utf8')).toBe('你好 world');
    });

    it('对象按 JSON 写入，由调用方 JSON.parse', async () => {
        await store.setFile('obj.json', { a: 1, b: ['x'] });
        const got = await store.getFile('obj.json');
        expect(JSON.parse(got.toString('utf8'))).toEqual({ a: 1, b: ['x'] });
    });

    it('不存在的 key 返回 null', async () => {
        expect(await store.getFile('never-written.bin')).toBeNull();
    });

    it('null / undefined 拒绝写入', async () => {
        await expect(store.setFile('x.bin', null)).rejects.toThrow(/must not be null/);
        await expect(store.setFile('x.bin', undefined)).rejects.toThrow(/must not be null/);
    });
});

describe('文件存储：落点与安全', () => {
    it('文件落在 files/ 子目录，不与 __store__.json 同级', async () => {
        await store.setFile('located.bin', Buffer.from('x'));
        expect(fs.existsSync(path.join(STORE_DIR, 'files', 'located.bin'))).toBe(true);
        expect(fs.existsSync(path.join(STORE_DIR, 'located.bin'))).toBe(false);
        expect(store.fileDir).toBe(path.join(STORE_DIR, 'files'));
    });

    it('即便 key 叫 __store__.json 也动不到值存储', async () => {
        store.set('canary', 'alive');
        await store.setFile('__store__.json', Buffer.from('overwritten'));
        expect(store.get('canary')).toBe('alive');
    });

    it('路径逃逸被拒：相对路径 / 绝对路径 / 分隔符', async () => {
        for (const bad of ['../escaped.bin', 'a/b.bin', 'a\\b.bin', 'C:/Windows/win.ini', '.', '..']) {
            await expect(store.setFile(bad, Buffer.from('x'))).rejects.toThrow();
        }
        expect(fs.existsSync(path.join(STORE_DIR, 'files', '..', 'escaped.bin'))).toBe(false);
    });

    it('空 key 被拒', async () => {
        await expect(store.setFile('', Buffer.from('x'))).rejects.toThrow();
        await expect(store.setFile('   ', Buffer.from('x'))).rejects.toThrow();
    });
});

describe('删除：单个与批量都支持', () => {
    it('removeFile 收字符串', async () => {
        await store.setFile('to-remove.bin', Buffer.from('x'));
        await store.removeFile('to-remove.bin');
        expect(await store.getFile('to-remove.bin')).toBeNull();
    });

    it('removeFile 收数组', async () => {
        await store.setFile('r1.bin', Buffer.from('1'));
        await store.setFile('r2.bin', Buffer.from('2'));
        await store.removeFile(['r1.bin', 'r2.bin']);
        expect(await store.getFile('r1.bin')).toBeNull();
        expect(await store.getFile('r2.bin')).toBeNull();
    });

    it('删除不存在的文件静默成功（删除本就幂等）', async () => {
        await expect(store.removeFile('not-there.bin')).resolves.toBeUndefined();
        await expect(store.removeFile(['a.bin', 'b.bin'])).resolves.toBeUndefined();
    });

    it('批量里有非法 key → 先校验完才动手，已有文件一个都不少', async () => {
        await store.setFile('keep-me.bin', Buffer.from('x'));
        await expect(store.removeFile(['keep-me.bin', '../bad.bin'])).rejects.toThrow();
        // 非法 key 属入参错误，此时不应已经删掉前面那个
        expect(await store.getFile('keep-me.bin')).not.toBeNull();
    });

    it('remove（值存储）同样收字符串与数组', () => {
        store.set('d1', 1);
        store.set('d2', 2);
        store.remove('d1');
        expect(store.get('d1')).toBeUndefined();
        store.set('d3', 3);
        store.remove(['d2', 'd3']);
        expect(store.get('d2')).toBeUndefined();
        expect(store.get('d3')).toBeUndefined();
    });
});

describe('简单值存储（electron-store）未受影响', () => {
    it('set / get / remove 往返', () => {
        store.set('k1', { n: 1 });
        expect(store.get('k1')).toEqual({ n: 1 });
        store.remove('k1');
        expect(store.get('k1')).toBeUndefined();
    });

    it('get 是同步的 —— 旧契约依赖这一点', () => {
        store.set('k2', 'v2');
        const v = store.get('k2'); // 不 await
        expect(v).toBe('v2');
    });

    it('支持点路径嵌套', () => {
        store.set('a.b.c', 42);
        expect(store.get('a.b.c')).toBe(42);
        expect(store.get('a')).toEqual({ b: { c: 42 } });
    });

    it('值存储与文件存储互不干扰（同名 key）', async () => {
        store.set('same-name', 'from-kv');
        await store.setFile('same-name', Buffer.from('from-file'));
        expect(store.get('same-name')).toBe('from-kv');
        expect((await store.getFile('same-name')).toString()).toBe('from-file');
    });
});
