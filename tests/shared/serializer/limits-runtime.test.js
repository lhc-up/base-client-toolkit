import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { serialize } = require('../../../src/shared/serializer/index.js');
const { _resetForTest, configureSerializer } = require('../../../src/shared/serializer/limits.js');

describe('serialize limits', () => {
    beforeEach(() => _resetForTest());

    it('truncates long string', () => {
        const s = 'a'.repeat(100);
        const out = serialize(s, { maxStringLength: 10 });
        expect(out.startsWith('aaaaaaaaaa')).toBe(true);
        expect(out).toContain('...[truncated 90 chars]');
    });

    it('truncates long array', () => {
        const a = Array.from({ length: 100 }, (_, i) => i);
        const out = serialize(a, { maxArrayLength: 5 });
        expect(out.length).toBe(6);
        expect(out[0]).toBe(0);
        expect(out[4]).toBe(4);
        expect(out[5]).toBe('...[truncated 95 items]');
    });

    it('truncates many keys', () => {
        const obj = {};
        for (let i = 0; i < 100; i++) obj['k' + i] = i;
        const out = serialize(obj, { maxKeys: 3 });
        expect(Object.keys(out).filter(k => k !== '__truncated').length).toBe(3);
        expect(out.__truncated).toBe('97 more keys');
    });

    it('caps recursion depth', () => {
        let cur = {};
        const root = cur;
        for (let i = 0; i < 10; i++) {
            cur.next = {};
            cur = cur.next;
        }
        const out = serialize(root, { maxDepth: 3 });
        expect(out.next.next.next).toBe('[MaxDepth]');
    });

    it('configureSerializer applies to global', () => {
        configureSerializer({ maxStringLength: 5 });
        const out = serialize('aaaaaaaaaa');
        expect(out).toContain('...[truncated 5 chars]');
    });

    it('per-call opts override configured global', () => {
        configureSerializer({ maxStringLength: 5 });
        const out = serialize('aaaaaaaaaa', { maxStringLength: 100 });
        expect(out).toBe('aaaaaaaaaa');
    });
});
