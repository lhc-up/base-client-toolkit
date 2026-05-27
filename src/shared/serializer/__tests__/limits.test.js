import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DEFAULTS, configureSerializer, resolveOpts, _resetForTest } = require('../limits.js');

describe('limits.resolveOpts', () => {
    beforeEach(() => _resetForTest());

    it('returns defaults when no opts given', () => {
        const r = resolveOpts();
        expect(r.maxDepth).toBe(DEFAULTS.maxDepth);
        expect(r.maxStringLength).toBe(DEFAULTS.maxStringLength);
        expect(r.maxArrayLength).toBe(DEFAULTS.maxArrayLength);
        expect(r.maxKeys).toBe(DEFAULTS.maxKeys);
    });

    it('per-call opts override defaults', () => {
        const r = resolveOpts({ maxDepth: 5 });
        expect(r.maxDepth).toBe(5);
        expect(r.maxStringLength).toBe(DEFAULTS.maxStringLength);
    });

    it('configureSerializer mutates global defaults', () => {
        configureSerializer({ maxDepth: 10 });
        expect(resolveOpts().maxDepth).toBe(10);
    });

    it('per-call still overrides after configure', () => {
        configureSerializer({ maxDepth: 10 });
        expect(resolveOpts({ maxDepth: 99 }).maxDepth).toBe(99);
    });

    it('onError defaults to null', () => {
        expect(resolveOpts().onError).toBeNull();
    });

    it('strict default reflects NODE_ENV', () => {
        const r = resolveOpts();
        const expected = process.env.NODE_ENV !== 'production';
        expect(r.strict).toBe(expected);
    });
});
