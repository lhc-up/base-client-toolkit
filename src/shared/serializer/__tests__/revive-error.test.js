import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { reviveError } = require('../reviveError.js');
const { serialize } = require('../index.js');

describe('reviveError', () => {
    it('returns Error instance from serialized Error', () => {
        const orig = new TypeError('boom');
        const s = serialize(orig);
        const e = reviveError(s);
        expect(e).toBeInstanceOf(Error);
        expect(e).toBeInstanceOf(TypeError);
        expect(e.message).toBe('boom');
        expect(e.name).toBe('TypeError');
    });

    it('preserves stack', () => {
        const orig = new Error('x');
        const s = serialize(orig);
        const e = reviveError(s);
        expect(e.stack).toBe(orig.stack);
    });

    it('preserves code', () => {
        const orig = new Error('x');
        orig.code = 'EMOCK';
        const s = serialize(orig);
        const e = reviveError(s);
        expect(e.code).toBe('EMOCK');
    });

    it('recurses cause', () => {
        const inner = new Error('inner');
        const outer = new Error('outer');
        outer.cause = inner;
        const s = serialize(outer);
        const e = reviveError(s);
        expect(e.cause).toBeInstanceOf(Error);
        expect(e.cause.message).toBe('inner');
    });

    it('unknown error name falls back to Error', () => {
        const s = { name: 'MyCustomError', message: 'x', stack: 's' };
        const e = reviveError(s);
        expect(e).toBeInstanceOf(Error);
        expect(e.name).toBe('MyCustomError');
        expect(e.message).toBe('x');
    });

    it('falsy input becomes Error(String(input))', () => {
        expect(reviveError(null).message).toBe('null');
        expect(reviveError(undefined).message).toBe('undefined');
        expect(reviveError('plain string').message).toBe('plain string');
    });
});
