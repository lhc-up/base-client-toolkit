import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { serialize } = require('../index.js');
const { _resetForTest } = require('../limits.js');

describe('serialize circular references', () => {
    beforeEach(() => _resetForTest());

    it('direct self-reference', () => {
        const a = { name: 'a' };
        a.self = a;
        const out = serialize(a);
        expect(out.name).toBe('a');
        expect(out.self).toBe('[Circular: $]');
    });

    it('indirect cycle', () => {
        const a = { name: 'a' };
        const b = { name: 'b' };
        a.b = b;
        b.a = a;
        const out = serialize(a);
        expect(out.name).toBe('a');
        expect(out.b.name).toBe('b');
        expect(out.b.a).toBe('[Circular: $]');
    });

    it('cycle inside array', () => {
        const a = [];
        a.push(a);
        const out = serialize(a);
        expect(out).toEqual(['[Circular: $]']);
    });

    it('cycle path is recorded', () => {
        const root = {};
        const child = { name: 'child' };
        root.child = child;
        child.back = root;
        const out = serialize(root);
        expect(out.child.back).toBe('[Circular: $]');
    });

    it('JSON.stringify on circular output never throws', () => {
        const a = { x: 1 };
        a.self = a;
        expect(() => JSON.stringify(serialize(a))).not.toThrow();
    });
});
