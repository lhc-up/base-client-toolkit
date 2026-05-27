import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { serialize } = require('../index.js');
const { _resetForTest } = require('../limits.js');

function throwingGetter(name) {
    const obj = {};
    Object.defineProperty(obj, name, {
        enumerable: true,
        get() { throw new Error('getter boom'); }
    });
    return obj;
}

describe('serialize never throws (strict=false)', () => {
    beforeEach(() => _resetForTest());

    it('getter that throws -> placeholder', () => {
        const obj = throwingGetter('bad');
        const out = serialize(obj, { strict: false });
        expect(out.bad).toContain('Unserializable');
    });

    it('toJSON that throws -> falls back', () => {
        const obj = { good: 1, toJSON() { throw new Error('no'); } };
        expect(() => serialize(obj, { strict: false })).not.toThrow();
    });

    it('Proxy with throwing getter trap', () => {
        const p = new Proxy({}, {
            get() { throw new Error('proxy boom'); },
            ownKeys() { return ['x']; },
            getOwnPropertyDescriptor() { return { enumerable: true, configurable: true }; },
        });
        expect(() => serialize(p, { strict: false })).not.toThrow();
    });

    it('combined: cycle + throwing getter + deep', () => {
        const root = {};
        root.self = root;
        Object.defineProperty(root, 'bad', {
            enumerable: true,
            get() { throw new Error('x'); },
        });
        let cur = root;
        for (let i = 0; i < 50; i++) {
            cur.next = {};
            cur = cur.next;
        }
        expect(() => serialize(root, { strict: false })).not.toThrow();
    });

    it('onError invoked on unexpected exception', () => {
        const onError = vi.fn();
        const obj = throwingGetter('x');
        serialize(obj, { strict: false, onError });
        expect(onError).toHaveBeenCalled();
        const [reason, path] = onError.mock.calls[0];
        expect(reason).toContain('getter boom');
        expect(path).toBe('$.x');
    });

    it('onError NOT invoked on lossy conversion (function/symbol)', () => {
        const onError = vi.fn();
        serialize({ f: () => {}, s: Symbol('x') }, { strict: false, onError });
        expect(onError).not.toHaveBeenCalled();
    });
});

describe('serialize strict mode', () => {
    beforeEach(() => _resetForTest());

    it('rethrows on unexpected exception', () => {
        const obj = throwingGetter('x');
        expect(() => serialize(obj, { strict: true })).toThrow();
    });

    it('does NOT throw on lossy conversion in strict', () => {
        expect(() => serialize({ f: () => {} }, { strict: true })).not.toThrow();
    });
});
