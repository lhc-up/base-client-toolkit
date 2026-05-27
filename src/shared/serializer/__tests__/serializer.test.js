import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { serialize } = require('../index.js');
const { _resetForTest } = require('../limits.js');

describe('serialize basic types', () => {
    beforeEach(() => _resetForTest());

    it('passes through string/number/boolean', () => {
        expect(serialize('abc')).toBe('abc');
        expect(serialize(42)).toBe(42);
        expect(serialize(true)).toBe(true);
        expect(serialize(false)).toBe(false);
    });

    it('passes through null/undefined', () => {
        expect(serialize(null)).toBeNull();
        expect(serialize(undefined)).toBeUndefined();
    });

    it('NaN/Infinity become placeholders', () => {
        expect(serialize(NaN)).toBe('[Number: NaN]');
        expect(serialize(Infinity)).toBe('[Number: Infinity]');
        expect(serialize(-Infinity)).toBe('[Number: -Infinity]');
    });

    it('bigint becomes placeholder', () => {
        expect(serialize(42n)).toBe('[BigInt: 42]');
    });

    it('symbol becomes placeholder', () => {
        expect(serialize(Symbol('x'))).toBe('[Symbol(x)]');
    });

    it('function becomes placeholder', () => {
        function named() {}
        expect(serialize(named)).toBe('[Function: named]');
    });
});

describe('serialize plain object/array', () => {
    beforeEach(() => _resetForTest());

    it('deep copies plain object', () => {
        const input = { a: 1, b: { c: 2 } };
        const out = serialize(input);
        expect(out).toEqual({ a: 1, b: { c: 2 } });
        out.b.c = 99;
        expect(input.b.c).toBe(2);
    });

    it('deep copies array', () => {
        const input = [1, [2, [3]]];
        expect(serialize(input)).toEqual([1, [2, [3]]]);
    });

    it('mixed nested', () => {
        const input = { a: [1, { b: 'c' }] };
        expect(serialize(input)).toEqual({ a: [1, { b: 'c' }] });
    });
});

describe('serialize special types', () => {
    beforeEach(() => _resetForTest());

    it('Date -> ISO string', () => {
        const d = new Date('2026-05-27T00:00:00.000Z');
        expect(serialize(d)).toBe('2026-05-27T00:00:00.000Z');
    });

    it('Error -> plain object', () => {
        const e = new TypeError('boom');
        const out = serialize(e);
        expect(out.name).toBe('TypeError');
        expect(out.message).toBe('boom');
        expect(typeof out.stack).toBe('string');
    });

    it('Error with cause recurses', () => {
        const inner = new Error('inner');
        const outer = new Error('outer');
        outer.cause = inner;
        const out = serialize(outer);
        expect(out.cause.message).toBe('inner');
    });

    it('Map string keys -> object', () => {
        const m = new Map([['a', 1], ['b', 2]]);
        expect(serialize(m)).toEqual({ a: 1, b: 2 });
    });

    it('Map mixed keys -> entries array', () => {
        const m = new Map([[1, 'one']]);
        expect(serialize(m)).toEqual([[1, 'one']]);
    });

    it('Set -> array', () => {
        expect(serialize(new Set([1, 2, 3]))).toEqual([1, 2, 3]);
    });

    it('RegExp -> { source, flags }', () => {
        expect(serialize(/abc/gi)).toEqual({ source: 'abc', flags: 'gi' });
    });

    it('Buffer -> placeholder', () => {
        expect(serialize(Buffer.alloc(64))).toBe('[Buffer: 64 bytes]');
    });

    it('ArrayBuffer -> placeholder', () => {
        expect(serialize(new ArrayBuffer(32))).toBe('[Buffer: 32 bytes]');
    });

    it('TypedArray -> array of numbers', () => {
        const u = new Uint8Array([1, 2, 3]);
        expect(serialize(u)).toEqual([1, 2, 3]);
    });

    it('Promise -> placeholder', () => {
        expect(serialize(Promise.resolve(1))).toBe('[Promise]');
    });

    it('WeakMap/WeakSet -> placeholder', () => {
        expect(serialize(new WeakMap())).toBe('[WeakMap]');
        expect(serialize(new WeakSet())).toBe('[WeakSet]');
    });

    it('class instance -> plain copy without __type', () => {
        class User {
            constructor(id, name) { this.id = id; this.name = name; }
            greet() { return 'hi'; }
        }
        const u = new User(1, 'alice');
        const out = serialize(u);
        expect(out).toEqual({ id: 1, name: 'alice' });
        expect(out.__type).toBeUndefined();
    });
});

describe('serialize toJSON convention', () => {
    beforeEach(() => _resetForTest());

    it('respects toJSON()', () => {
        const obj = { x: 1, toJSON() { return { x: 'replaced' }; } };
        expect(serialize(obj)).toEqual({ x: 'replaced' });
    });

    it('falls back when toJSON throws (strict=false)', () => {
        const obj = { x: 1, toJSON() { throw new Error('nope'); } };
        const out = serialize(obj, { strict: false });
        expect(out).toEqual({ x: 1 });
    });
});

describe('serialize JSON-safety guarantee', () => {
    beforeEach(() => _resetForTest());

    it('output is always JSON.stringify-safe', () => {
        const weird = {
            fn: () => {},
            sym: Symbol('x'),
            big: 99n,
            buf: Buffer.alloc(1),
            map: new Map([[1, 'a']]),
            set: new Set([1]),
            re: /x/,
            date: new Date(0),
            nan: NaN,
        };
        expect(() => JSON.stringify(serialize(weird))).not.toThrow();
    });
});

describe('serialize shared leaf references (not cycles)', () => {
    beforeEach(() => _resetForTest());

    it('same Date shared in two fields outputs ISO twice', () => {
        const d = new Date('2026-01-01T00:00:00.000Z');
        const out = serialize({ a: d, b: d });
        expect(out.a).toBe('2026-01-01T00:00:00.000Z');
        expect(out.b).toBe('2026-01-01T00:00:00.000Z');
        expect(JSON.stringify(out.b)).not.toContain('Circular');
    });

    it('same Error shared in two fields outputs full both times', () => {
        const e = new Error('boom');
        const out = serialize({ a: e, b: e });
        expect(out.a.message).toBe('boom');
        expect(out.b.message).toBe('boom');
    });

    it('same RegExp shared', () => {
        const r = /x/;
        const out = serialize({ r1: r, r2: r });
        expect(out.r1).toEqual({ source: 'x', flags: '' });
        expect(out.r2).toEqual({ source: 'x', flags: '' });
    });

    it('same Buffer shared', () => {
        const buf = Buffer.alloc(4);
        const out = serialize({ b1: buf, b2: buf });
        expect(out.b1).toBe('[Buffer: 4 bytes]');
        expect(out.b2).toBe('[Buffer: 4 bytes]');
    });

    it('shared plain object IS still treated as cycle on second occurrence', () => {
        // Two distinct fields referencing the same plain object:
        // this IS a DAG, and current behavior is to treat the second
        // occurrence as Circular (acceptable defensive default).
        // This test pins down that intentional behavior.
        const shared = { value: 1 };
        const out = serialize({ a: shared, b: shared });
        expect(out.a).toEqual({ value: 1 });
        expect(out.b).toBe('[Circular: $.a]');
    });
});
