import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const logger = require('../../../src/capability/logger/index');

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

describe('capability/logger: export shape', () => {
    it('exports an object', () => {
        expect(logger).not.toBeNull();
        expect(typeof logger).toBe('object');
    });

    it('exposes init and shutdown as functions', () => {
        expect(typeof logger.init).toBe('function');
        expect(typeof logger.shutdown).toBe('function');
    });

    it.each(LEVELS)('exposes %s as a function', (level) => {
        expect(typeof logger[level]).toBe('function');
    });

    it('exposes a serviceSchema object', () => {
        expect(logger.serviceSchema).not.toBeNull();
        expect(typeof logger.serviceSchema).toBe('object');
    });

    it('does NOT expose a noticeSchema', () => {
        expect(logger.noticeSchema).toBeUndefined();
    });

    it('serviceSchema is not a function', () => {
        expect(typeof logger.serviceSchema).not.toBe('function');
    });
});

describe('capability/logger: identity between top-level methods and serviceSchema.handlers', () => {
    it.each(LEVELS)('serviceSchema.handlers.%s IS the same function reference as top-level', (level) => {
        expect(Object.is(logger.serviceSchema.handlers[level], logger[level])).toBe(true);
    });

    it('serviceSchema.namespace is "logger"', () => {
        expect(logger.serviceSchema.namespace).toBe('logger');
    });
});
