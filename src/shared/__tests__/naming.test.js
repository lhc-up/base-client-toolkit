import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { IDENTIFIER_RE, isValidIdentifier } = require('../naming');

describe('shared/naming', () => {
    describe('IDENTIFIER_RE', () => {
        it('accepts letter-start alphanumeric with underscore', () => {
            for (const v of ['foo', 'foo123', 'some_name', 'X']) {
                expect(IDENTIFIER_RE.test(v)).toBe(true);
            }
        });
        it('accepts underscore-start', () => {
            for (const v of ['_bar', '_']) {
                expect(IDENTIFIER_RE.test(v)).toBe(true);
            }
        });
        it('rejects digit-start', () => {
            for (const v of ['1foo', '9']) {
                expect(IDENTIFIER_RE.test(v)).toBe(false);
            }
        });
        it('rejects dash', () => {
            for (const v of ['foo-bar', '-foo']) {
                expect(IDENTIFIER_RE.test(v)).toBe(false);
            }
        });
        it('rejects dot', () => {
            expect(IDENTIFIER_RE.test('foo.bar')).toBe(false);
        });
        it('rejects empty string', () => {
            expect(IDENTIFIER_RE.test('')).toBe(false);
        });
        it('rejects whitespace', () => {
            for (const v of ['foo bar', ' foo']) {
                expect(IDENTIFIER_RE.test(v)).toBe(false);
            }
        });
    });

    describe('isValidIdentifier', () => {
        it('returns true for valid names', () => {
            expect(isValidIdentifier('foo')).toBe(true);
            expect(isValidIdentifier('_bar')).toBe(true);
        });
        it('returns false for non-string', () => {
            for (const v of [null, undefined, 123, {}, []]) {
                expect(isValidIdentifier(v)).toBe(false);
            }
        });
        it('returns false for invalid names', () => {
            for (const v of ['1foo', 'foo-bar', '']) {
                expect(isValidIdentifier(v)).toBe(false);
            }
        });
    });
});
