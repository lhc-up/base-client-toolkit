import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const modulePath = require.resolve('../../../src/capability/logger/index');
const fs = require('fs');

describe('capability/logger: zero side effects on require', () => {
    beforeEach(() => {
        delete require.cache[modulePath];
    });

    afterEach(() => {
        delete require.cache[modulePath];
    });

    it('require() does not throw', () => {
        expect(() => require('../../../src/capability/logger/index')).not.toThrow();
    });

    it('module source contains no top-level require of electron / log4js / service / notice', () => {
        // 文本扫描：M5 §2.4 副作用约束的最直接可断言形式。
        // T-01 spec §2.3 / §3.2 明确要求 log4js 与 electron 延迟到 init 时刻 require；
        // 这里断言模块顶层没有这两者的 require 语句。
        const source = fs.readFileSync(modulePath, 'utf8');
        // 顶层无 electron require（"顶层" = 行首无缩进；init 函数体内 require 因缩进而豁免）
        expect(source).not.toMatch(/^(?:(?:const|let|var)\s+)?[^\s\n][^\n]*require\(['"]electron['"]\)/m);
        // 顶层无 log4js require
        expect(source).not.toMatch(/^(?:(?:const|let|var)\s+)?[^\s\n][^\n]*require\(['"]log4js['"]\)/m);
        // 无 service / notice 依赖
        expect(source).not.toMatch(/require\(['"][^'"]*\/service['"]\)/);
        expect(source).not.toMatch(/require\(['"][^'"]*\/notice['"]\)/);
        // 允许在 init 内部 require —— 用 "init" 函数体内的 require 是允许的
        // 断言方式：electron 与 log4js 的 require 若存在，必须出现在 "function init" 之后
        const initIdx = source.indexOf('function init');
        expect(initIdx).toBeGreaterThan(-1);
        const electronReqIdx = source.search(/require\(['"]electron['"]\)/);
        const log4jsReqIdx = source.search(/require\(['"]log4js['"]\)/);
        if (electronReqIdx > -1) expect(electronReqIdx).toBeGreaterThan(initIdx);
        if (log4jsReqIdx > -1) expect(log4jsReqIdx).toBeGreaterThan(initIdx);
    });

    it('require() does not mutate global state', () => {
        const before = Object.keys(globalThis).sort().join(',');
        require('../../../src/capability/logger/index');
        const after = Object.keys(globalThis).sort().join(',');
        expect(after).toBe(before);
    });

    it('handler identity holds within a single load', () => {
        const mod = require('../../../src/capability/logger/index');
        for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
            expect(Object.is(mod.serviceSchema.handlers[level], mod[level])).toBe(true);
        }
    });
});
