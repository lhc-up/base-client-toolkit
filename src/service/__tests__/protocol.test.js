import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const protocol = require('../protocol');

describe('protocol channel constants', () => {
    it('META_LIST_CHANNEL is "service:getServiceList"', () => {
        expect(protocol.META_LIST_CHANNEL).toBe('service:getServiceList');
    });
});

describe('channel builders', () => {
    it('asyncChannel composes "{ns}:{name}"', () => {
        expect(protocol.asyncChannel('foo', 'bar')).toBe('foo:bar');
    });
    it('syncChannel composes "{ns}:{name}Sync"', () => {
        expect(protocol.syncChannel('foo', 'log')).toBe('foo:logSync');
    });
    it('async and sync channels are distinct', () => {
        expect(protocol.asyncChannel('a', 'b'))
            .not.toBe(protocol.syncChannel('a', 'b'));
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
