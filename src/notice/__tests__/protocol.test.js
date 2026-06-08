import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const protocol = require('../protocol');

describe('protocol channel constants', () => {
    it('EVENT_CHANNEL is "notice:event"', () => {
        expect(protocol.EVENT_CHANNEL).toBe('notice:event');
    });
    it('META_GET_SCHEMA_CHANNEL is "notice:getSchema"', () => {
        expect(protocol.META_GET_SCHEMA_CHANNEL).toBe('notice:getSchema');
    });
});

describe('envelope helpers', () => {
    it('okEnvelope wraps data', () => {
        expect(protocol.okEnvelope({ a: 1 })).toEqual({ ok: true, data: { a: 1 } });
    });
    it('okEnvelope preserves undefined data', () => {
        const env = protocol.okEnvelope(undefined);
        expect(env.ok).toBe(true);
        expect(env.data).toBeUndefined();
    });
    it('errorEnvelope wraps error', () => {
        expect(protocol.errorEnvelope('boom')).toEqual({ ok: false, error: 'boom' });
    });
});
