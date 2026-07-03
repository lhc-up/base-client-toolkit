import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ad = require('../../../src/shared/serializer/adapters.js');

describe('adapters type predicates', () => {
    it('isPlainObject true for {}', () => {
        expect(ad.isPlainObject({})).toBe(true);
        expect(ad.isPlainObject(Object.create(null))).toBe(true);
    });

    it('isPlainObject false for class instance, array, null', () => {
        class C {}
        expect(ad.isPlainObject(new C())).toBe(false);
        expect(ad.isPlainObject([])).toBe(false);
        expect(ad.isPlainObject(null)).toBe(false);
        expect(ad.isPlainObject(new Date())).toBe(false);
    });

    it('isError detects Error and subclasses', () => {
        expect(ad.isError(new Error())).toBe(true);
        expect(ad.isError(new TypeError())).toBe(true);
        class MyErr extends Error {}
        expect(ad.isError(new MyErr())).toBe(true);
        expect(ad.isError({})).toBe(false);
    });

    it('isBuffer', () => {
        expect(ad.isBuffer(Buffer.alloc(4))).toBe(true);
        expect(ad.isBuffer(new Uint8Array(4))).toBe(false);
        expect(ad.isBuffer({})).toBe(false);
    });

    it('isArrayBuffer', () => {
        expect(ad.isArrayBuffer(new ArrayBuffer(8))).toBe(true);
        expect(ad.isArrayBuffer(Buffer.alloc(4))).toBe(false);
    });

    it('isTypedArray', () => {
        expect(ad.isTypedArray(new Uint8Array(4))).toBe(true);
        expect(ad.isTypedArray(new Float64Array(4))).toBe(true);
        expect(ad.isTypedArray(new DataView(new ArrayBuffer(4)))).toBe(false);
        expect(ad.isTypedArray([])).toBe(false);
    });

    it('isPromise', () => {
        expect(ad.isPromise(Promise.resolve())).toBe(true);
        expect(ad.isPromise({ then: () => {} })).toBe(true);
        expect(ad.isPromise({})).toBe(false);
        expect(ad.isPromise(null)).toBe(false);
    });

    it('isDomNode (synthetic)', () => {
        const fakeNode = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV' };
        expect(ad.isDomNode(fakeNode)).toBe(true);
        expect(ad.isDomNode({ nodeType: 'oops', nodeName: 'x' })).toBe(false);
        expect(ad.isDomNode(null)).toBe(false);
    });

    it('isWindowLike (synthetic)', () => {
        const fakeWin = { document: {} };
        fakeWin.window = fakeWin;
        expect(ad.isWindowLike(fakeWin)).toBe(true);

        expect(ad.isWindowLike({})).toBe(false);
        expect(ad.isWindowLike(null)).toBe(false);
        expect(ad.isWindowLike(42)).toBe(false);

        const throwing = {};
        Object.defineProperty(throwing, 'window', {
            get() { throw new Error('boom'); },
            enumerable: true,
        });
        expect(ad.isWindowLike(throwing)).toBe(false);
    });
});

describe('adapters value transformers', () => {
    it('adaptDate returns ISO string', () => {
        const d = new Date('2026-05-27T10:00:00.000Z');
        expect(ad.adaptDate(d)).toBe('2026-05-27T10:00:00.000Z');
    });

    it('adaptDate returns null for invalid Date', () => {
        const d = new Date('not a date');
        expect(ad.adaptDate(d)).toBeNull();
    });

    it('adaptError returns name/message/stack', () => {
        const e = new TypeError('boom');
        const out = ad.adaptError(e, x => x);
        expect(out.name).toBe('TypeError');
        expect(out.message).toBe('boom');
        expect(typeof out.stack).toBe('string');
    });

    it('adaptError includes code if present', () => {
        const e = new Error('x');
        e.code = 'EMOCK';
        const out = ad.adaptError(e, x => x);
        expect(out.code).toBe('EMOCK');
    });

    it('adaptError recurses cause via callback', () => {
        const inner = new Error('inner');
        const outer = new Error('outer');
        outer.cause = inner;
        const out = ad.adaptError(outer, () => 'CAUSE_PLACEHOLDER');
        expect(out.cause).toBe('CAUSE_PLACEHOLDER');
    });

    it('adaptMap with string keys returns plain object', () => {
        const m = new Map([['a', 1], ['b', 2]]);
        const out = ad.adaptMap(m, x => x);
        expect(out).toEqual({ a: 1, b: 2 });
    });

    it('adaptMap with non-string key returns entries array', () => {
        const m = new Map([[1, 'one'], ['b', 2]]);
        const out = ad.adaptMap(m, x => x);
        expect(out).toEqual([[1, 'one'], ['b', 2]]);
    });

    it('adaptSet returns array', () => {
        const s = new Set([1, 2, 3]);
        expect(ad.adaptSet(s, x => x)).toEqual([1, 2, 3]);
    });

    it('adaptRegExp returns source + flags', () => {
        const r = /abc/gi;
        expect(ad.adaptRegExp(r)).toEqual({ source: 'abc', flags: 'gi' });
    });
});
