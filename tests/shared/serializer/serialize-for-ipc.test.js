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

    it('result is JSON-safe', () => {
        const weird = {
            fn: () => {},
            sym: Symbol('s'),
            big: BigInt(42),
            toJSON() { throw new Error('bad'); },
        };
        expect(() => JSON.stringify(serializeForIpc(weird))).not.toThrow();
    });

    it('handles circular references without throwing', () => {
        const obj = {};
        obj.self = obj;
        expect(() => serializeForIpc(obj)).not.toThrow();
    });
});
