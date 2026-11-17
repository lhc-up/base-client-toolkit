import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { HOST_RUNTIME_KEY, TOOLKIT_KEY } = require('../../src/shared/hostKeys');
const { getHostRuntime, definePkg } = require('../../src/runtime');

// 锚点不可配置，一旦建立就无法在同一进程内撤销，因此按「建立前 → 建立后」顺序断言
describe('host runtime', () => {
    it('getHostRuntime throws before the host exposes the runtime', () => {
        expect(() => getHostRuntime()).toThrow(/exposeHostRuntime/);
    });

    it('exposeHostRuntime builds the anchor with the toolkit table', () => {
        const { exposeHostRuntime } = require('../../src/host');
        const runtime = exposeHostRuntime();
        expect(getHostRuntime()).toBe(runtime);
        expect(globalThis[Symbol.for(HOST_RUNTIME_KEY)]).toBe(runtime);

        const table = runtime[Symbol.for(TOOLKIT_KEY)];
        expect(Object.isFrozen(table)).toBe(true);
        expect(table['main/libs/scope']).toBe(require('../../src/main/libs/scope'));
    });

    it('anchor cannot be replaced or deleted', () => {
        const key = Symbol.for(HOST_RUNTIME_KEY);
        const before = globalThis[key];
        expect(() => { 'use strict'; globalThis[key] = {}; }).toThrow(TypeError);
        expect(() => { 'use strict'; delete globalThis[key]; }).toThrow(TypeError);
        expect(globalThis[key]).toBe(before);
    });

    it('toolkit field cannot be overwritten', () => {
        const { exposeHostRuntime } = require('../../src/host');
        expect(() => exposeHostRuntime({ [Symbol.for(TOOLKIT_KEY)]: {} })).toThrow(TypeError);
    });

    it('business fields are shallowly assigned and overwritable', () => {
        const { exposeHostRuntime } = require('../../src/host');
        exposeHostRuntime({ foo: { a: 1 }, fn: () => 'x' });
        exposeHostRuntime({ foo: { b: 2 } });
        const runtime = getHostRuntime();
        expect(runtime.foo).toEqual({ b: 2 });
        expect(runtime.fn()).toBe('x');
        expect(runtime.missing).toBeUndefined();
    });

    it('toolkit field is not enumerable', () => {
        expect(Object.keys(getHostRuntime())).not.toContain(TOOLKIT_KEY);
    });
});

describe('definePkg', () => {
    const cap = { serviceSchema: { namespace: 'foo', handlers: { a() {} } } };

    it('returns a frozen descriptor with defaults', () => {
        const pkg = definePkg({ name: 'demo', provides: [cap] });
        expect(Object.isFrozen(pkg)).toBe(true);
        expect(pkg.uses).toEqual([]);
        expect(pkg.provides).toEqual([cap]);
    });

    it.each([
        [null, /对象/],
        [{ name: '' }, /name/],
        [{ name: 'demo', uses: [1] }, /uses/],
        [{ name: 'demo', provides: {} }, /provides/],
        [{ name: 'demo', provides: [{}] }, /provides\[0\]/],
        [{ name: 'demo', activate: 1 }, /activate/],
    ])('rejects invalid shape %#', (def, pattern) => {
        expect(() => definePkg(def)).toThrow(pattern);
    });
});
