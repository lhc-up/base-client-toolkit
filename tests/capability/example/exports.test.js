import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const example = require('../../../src/main/capability/example/index');

describe('capability/example: export shape', () => {
    it('exports an object', () => {
        expect(example).not.toBeNull();
        expect(typeof example).toBe('object');
    });

    it('exposes echo as a function', () => {
        expect(typeof example.echo).toBe('function');
    });

    it('exposes a serviceSchema object', () => {
        expect(example.serviceSchema).not.toBeNull();
        expect(typeof example.serviceSchema).toBe('object');
    });

    it('exposes a noticeSchema object', () => {
        expect(example.noticeSchema).not.toBeNull();
        expect(typeof example.noticeSchema).toBe('object');
    });

    it('serviceSchema and noticeSchema are objects, not API methods', () => {
        expect(typeof example.serviceSchema).not.toBe('function');
        expect(typeof example.noticeSchema).not.toBe('function');
    });
});

describe('capability/example: behavioral identity', () => {
    it('echo returns its argument verbatim', () => {
        expect(example.echo('hi')).toBe('hi');
        expect(example.echo(42)).toBe(42);
        expect(example.echo(null)).toBe(null);
        expect(example.echo(undefined)).toBe(undefined);
        const obj = { a: 1 };
        expect(example.echo(obj)).toBe(obj);
    });

    it('echo is a pure synchronous function (no thenable)', () => {
        const out = example.echo('x');
        expect(out && typeof out.then).not.toBe('function');
    });

    it('serviceSchema.handlers.echo IS the same function reference as example.echo', () => {
        expect(Object.is(example.serviceSchema.handlers.echo, example.echo)).toBe(true);
    });

    it('namespaces match across both schemas and the directory name', () => {
        expect(example.serviceSchema.namespace).toBe('example');
        expect(example.noticeSchema.namespace).toBe('example');
        expect(example.serviceSchema.namespace).toBe(example.noticeSchema.namespace);
    });
});
