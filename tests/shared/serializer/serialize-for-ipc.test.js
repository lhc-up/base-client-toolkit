import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { serialize, serializeForIpc } = require('../../../src/shared/serializer/index.js');

describe('serializeForIpc', () => {
    it('serializeForIpc is exported from serializer index', () => {
        expect(typeof serializeForIpc).toBe('function');
    });

    it('serializes plain data identically to serialize', () => {
        const data = { a: 1, b: 'x' };
        expect(serializeForIpc(data)).toEqual(serialize(data, { strict: false }));
    });

    it('does NOT throw on Proxy getter that throws (strict:false enforced)', () => {
        const p = new Proxy({}, {
            get() { throw new Error('proxy boom'); },
            ownKeys() { return ['x']; },
            getOwnPropertyDescriptor() { return { enumerable: true, configurable: true }; },
        });
        expect(() => serializeForIpc(p)).not.toThrow();
    });

    it('does NOT throw on toJSON throwing', () => {
        const obj = { good: 1, toJSON() { throw new Error('toJSON boom'); } };
        expect(() => serializeForIpc(obj)).not.toThrow();
    });

    it('does NOT throw on function/symbol/bigint (lossy conversion)', () => {
        const mixed = { fn: () => {}, sym: Symbol('s'), big: BigInt(9007199254740991) };
        expect(() => serializeForIpc(mixed)).not.toThrow();
    });

    it('result 是 structured-clone 安全的（BigInt / Date 原样保留）', () => {
        const weird = {
            fn: () => {},
            sym: Symbol('s'),
            big: BigInt(42),
            toJSON() { throw new Error('bad'); },
        };
        expect(() => structuredClone(serializeForIpc(weird))).not.toThrow();
    });

    it('Map / Set 保留类型，其中不可克隆的键和值逐项换成占位符（结果可 structured clone）', () => {
        const fn = function named() {};
        const map = new Map([['fn', fn], [Symbol('k'), 1], ['ok', new Date(0)], ['n', NaN]]);
        const set = new Set([1, Promise.resolve(), () => {}]);
        const out = serializeForIpc({ map, set });

        expect(out.map).toBeInstanceOf(Map);
        expect(out.set).toBeInstanceOf(Set);
        expect(out.map.get('fn')).toBe(serialize(fn));
        expect(out.map.get('ok')).toBeInstanceOf(Date);
        expect(Number.isNaN(out.map.get('n'))).toBe(true);
        expect([...out.map.keys()].some(k => typeof k === 'symbol')).toBe(false);
        expect([...out.set].every(v => typeof v !== 'function' && !(v instanceof Promise))).toBe(true);
        expect(() => structuredClone(out)).not.toThrow();
    });

    it('Map / Set 自引用不死循环，结果可 structured clone', () => {
        const map = new Map();
        map.set('self', map);
        const set = new Set();
        set.add(set);
        expect(() => structuredClone(serializeForIpc({ map, set }))).not.toThrow();
    });

    it('handles circular references without throwing', () => {
        const obj = {};
        obj.self = obj;
        expect(() => serializeForIpc(obj)).not.toThrow();
    });
});
