import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const logger = require('../../../src/capability/logger/index');
const { IDENTIFIER_RE } = require('../../../src/shared/naming');

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

describe('serviceSchema shape (M2 protocol form)', () => {
    const { serviceSchema } = logger;

    it('namespace is "logger" and matches canonical IDENTIFIER_RE', () => {
        expect(typeof serviceSchema.namespace).toBe('string');
        expect(serviceSchema.namespace).toBe('logger');
        expect(IDENTIFIER_RE.test(serviceSchema.namespace)).toBe(true);
    });

    it('handlers is a non-null object', () => {
        expect(serviceSchema.handlers).not.toBeNull();
        expect(typeof serviceSchema.handlers).toBe('object');
    });

    it('handlers contains exactly the 6 log levels', () => {
        const keys = Object.keys(serviceSchema.handlers).sort();
        expect(keys).toEqual([...LEVELS].sort());
    });

    it.each(LEVELS)('handlers.%s is a function with canonical-valid name', (level) => {
        expect(typeof serviceSchema.handlers[level]).toBe('function');
        expect(IDENTIFIER_RE.test(level)).toBe(true);
    });

    it('does NOT define sync (all methods are async)', () => {
        expect(serviceSchema.sync).toBeUndefined();
    });

    it('does NOT define needsEvent', () => {
        expect(serviceSchema.needsEvent).toBeUndefined();
    });
});

// M5 §2.2 要求 service/notice 至少存在一个 —— logger 无 noticeSchema，靠 serviceSchema 存在满足；
// 上面 describe 已断言 serviceSchema.namespace === 'logger'，即间接证明 serviceSchema 存在，
// 无需在本 describe 内再加冗余的 "at least one" 断言（否则文件顶层的 destructure 就已经把它证死）。
describe('contract: no noticeSchema for logger (per T-01 spec §5.4)', () => {
    it('logger.noticeSchema is undefined', () => {
        expect(logger.noticeSchema).toBeUndefined();
    });
});
