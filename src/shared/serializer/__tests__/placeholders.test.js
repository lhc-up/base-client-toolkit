import { describe, it, expect } from 'vitest';
import * as ph from '../placeholders.js';

describe('placeholders', () => {
    it('fnPlaceholder uses fn.name when present', () => {
        function foo() {}
        expect(ph.fnPlaceholder(foo)).toBe('[Function: foo]');
    });

    it('fnPlaceholder uses anonymous when name empty', () => {
        const f = (() => () => {})();
        Object.defineProperty(f, 'name', { value: '' });
        expect(ph.fnPlaceholder(f)).toBe('[Function: anonymous]');
    });

    it('symbolPlaceholder with description', () => {
        expect(ph.symbolPlaceholder(Symbol('hello'))).toBe('[Symbol(hello)]');
    });

    it('symbolPlaceholder without description', () => {
        expect(ph.symbolPlaceholder(Symbol())).toBe('[Symbol]');
    });

    it('bigintPlaceholder formats decimal', () => {
        expect(ph.bigintPlaceholder(12345n)).toBe('[BigInt: 12345]');
    });

    it('bufferPlaceholder uses byteLength', () => {
        const buf = Buffer.alloc(128);
        expect(ph.bufferPlaceholder(buf)).toBe('[Buffer: 128 bytes]');
    });

    it('bufferPlaceholder uses ArrayBuffer.byteLength', () => {
        const ab = new ArrayBuffer(64);
        expect(ph.bufferPlaceholder(ab)).toBe('[Buffer: 64 bytes]');
    });

    it('circularPlaceholder includes path', () => {
        expect(ph.circularPlaceholder('$.a.b')).toBe('[Circular: $.a.b]');
    });

    it('maxDepthPlaceholder', () => {
        expect(ph.maxDepthPlaceholder()).toBe('[MaxDepth]');
    });

    it('numberPlaceholder normal numbers passthrough', () => {
        expect(ph.numberPlaceholder(42)).toBe(42);
        expect(ph.numberPlaceholder(0)).toBe(0);
        expect(ph.numberPlaceholder(-1.5)).toBe(-1.5);
    });

    it('numberPlaceholder handles NaN', () => {
        expect(ph.numberPlaceholder(NaN)).toBe('[Number: NaN]');
    });

    it('numberPlaceholder handles Infinity', () => {
        expect(ph.numberPlaceholder(Infinity)).toBe('[Number: Infinity]');
        expect(ph.numberPlaceholder(-Infinity)).toBe('[Number: -Infinity]');
    });

    it('truncatedStringSuffix', () => {
        expect(ph.truncatedStringSuffix(123)).toBe('...[truncated 123 chars]');
    });

    it('truncatedArrayItem', () => {
        expect(ph.truncatedArrayItem(50)).toBe('...[truncated 50 items]');
    });

    it('truncatedKeysValue', () => {
        expect(ph.truncatedKeysValue(7)).toBe('7 more keys');
    });

    it('promisePlaceholder', () => {
        expect(ph.promisePlaceholder()).toBe('[Promise]');
    });

    it('weakMapPlaceholder', () => {
        expect(ph.weakMapPlaceholder()).toBe('[WeakMap]');
    });

    it('weakSetPlaceholder', () => {
        expect(ph.weakSetPlaceholder()).toBe('[WeakSet]');
    });

    it('domPlaceholder uses tagName', () => {
        const node = { tagName: 'DIV', nodeName: 'DIV', nodeType: 1 };
        expect(ph.domPlaceholder(node)).toBe('[DOM: DIV]');
    });

    it('domPlaceholder fallback to nodeName', () => {
        const node = { nodeName: '#text', nodeType: 3 };
        expect(ph.domPlaceholder(node)).toBe('[DOM: #text]');
    });

    it('windowPlaceholder', () => {
        expect(ph.windowPlaceholder()).toBe('[Window]');
    });

    it('unserializablePlaceholder', () => {
        expect(ph.unserializablePlaceholder('boom')).toBe('[Unserializable: boom]');
    });
});
