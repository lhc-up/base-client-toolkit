import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { okEnvelope, errorEnvelope } = require('../../src/shared/envelope');

describe('shared/envelope', () => {
    describe('okEnvelope', () => {
        it('wraps data with ok:true', () => {
            expect(okEnvelope({ a: 1 })).toEqual({ ok: true, data: { a: 1 } });
        });
        it('preserves undefined data', () => {
            const env = okEnvelope(undefined);
            expect(env.ok).toBe(true);
            expect(env.data).toBeUndefined();
        });
        it('preserves null data', () => {
            expect(okEnvelope(null)).toEqual({ ok: true, data: null });
        });
        it('accepts primitive data', () => {
            expect(okEnvelope(42)).toEqual({ ok: true, data: 42 });
            expect(okEnvelope('str')).toEqual({ ok: true, data: 'str' });
        });
    });
    describe('errorEnvelope', () => {
        it('wraps error with ok:false', () => {
            expect(errorEnvelope('boom')).toEqual({ ok: false, error: 'boom' });
        });
        it('preserves serialized Error shape', () => {
            const err = { name: 'TypeError', message: 'x', stack: 's' };
            expect(errorEnvelope(err)).toEqual({ ok: false, error: err });
        });
    });
});
