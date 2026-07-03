import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DEFAULTS, configureSerializer, resolveOpts, _resetForTest } = require('../../../src/shared/serializer/limits.js');

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

    it('strict default is hardcoded false (§7.2)', () => {
        const r = resolveOpts({});
        expect(r.strict).toBe(false);
    });
    it('strict default is not affected by NODE_ENV', () => {
        const original = process.env.NODE_ENV;
        try {
            process.env.NODE_ENV = 'development';
            expect(resolveOpts({}).strict).toBe(false);
            process.env.NODE_ENV = 'production';
            expect(resolveOpts({}).strict).toBe(false);
        } finally {
            if (original === undefined) {
                delete process.env.NODE_ENV;
            } else {
                process.env.NODE_ENV = original;
            }
        }
    });
});
