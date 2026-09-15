import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const modulePath = require.resolve('../../../src/main/capability/example/index');
const fs = require('fs');

describe('capability/example: zero side effects on require', () => {
    beforeEach(() => {
        delete require.cache[modulePath];
    });

    afterEach(() => {
        delete require.cache[modulePath];
    });

    it('require() does not throw', () => {
        expect(() => require('../../../src/main/capability/example/index')).not.toThrow();
    });

    it('module source contains no Service/Notice/electron require()', () => {
        // 文本扫描：M5 §2.4 副作用约束的最直接可断言形式。
        // 运行时无法证否——CJS loader 自身就要走 fs 读模块；textual scan 是唯一能稳定证明
        // 模块未通过 require() 引入 IPC/electron 的方法。
        const source = fs.readFileSync(modulePath, 'utf8');
        expect(source).not.toMatch(/require\(['"][^'"]*\/service['"]\)/);
        expect(source).not.toMatch(/require\(['"][^'"]*\/notice['"]\)/);
        expect(source).not.toMatch(/require\(['"]electron['"]\)/);
        expect(source).not.toMatch(/require\(['"][^'"]*\/notice\/preload['"]\)/);
        expect(source).not.toMatch(/require\(['"][^'"]*\/service\/preload['"]\)/);
    });

    it('require() does not mutate global state', () => {
        const before = Object.keys(globalThis).sort().join(',');
        require('../../../src/main/capability/example/index');
        const after = Object.keys(globalThis).sort().join(',');
        expect(after).toBe(before);
    });

    it('within a single load, echo identity holds (handlers.echo === top-level echo)', () => {
        const a = require('../../../src/main/capability/example/index');
        delete require.cache[modulePath];
        const b = require('../../../src/main/capability/example/index');
        expect(a).not.toBe(b);
        expect(a.echo).not.toBe(b.echo);
        expect(Object.is(a.serviceSchema.handlers.echo, a.echo)).toBe(true);
        expect(Object.is(b.serviceSchema.handlers.echo, b.echo)).toBe(true);
    });
});
