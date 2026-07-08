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

    it('module source has no require of service / notice (capability 模块间独立性)', () => {
        // M5 §5.2：capability 不得依赖 M2 Service / M3 Notice 或其它 capability。
        // electron 与 log4js 允许顶层 require（logger 天生绑定 Electron + log4js 环境，
        // require 时 fail-fast 比延迟到 init 更清晰；M5 §2.4 未禁止此类 require）。
        const source = fs.readFileSync(modulePath, 'utf8');
        expect(source).not.toMatch(/require\(['"][^'"]*\/service['"]\)/);
        expect(source).not.toMatch(/require\(['"][^'"]*\/notice['"]\)/);
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
