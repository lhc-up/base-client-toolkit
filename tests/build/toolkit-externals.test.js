import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { toolkitExternals, toolkitExpression } = require('../../src/build');
const { HOST_RUNTIME_KEY, TOOLKIT_KEY } = require('../../src/shared/hostKeys');

function run(request) {
    let result;
    toolkitExternals({ request }, (err, value, type) => { result = { err, value, type }; });
    return result;
}

describe('toolkitExternals', () => {
    it('maps toolkit subpaths to a host runtime expression', () => {
        const { value, type } = run('@base-client/toolkit/main/libs/logger');
        expect(type).toBe('var');
        expect(value).toBe(toolkitExpression('main/libs/logger'));
    });

    it('expression reads the anchor table at runtime', () => {
        const table = { 'main/libs/logger': { tag: 'logger' } };
        const runtime = { [Symbol.for(TOOLKIT_KEY)]: table };
        const evaluate = new Function('globalThis', `return ${toolkitExpression('main/libs/logger')};`);
        expect(evaluate({ [Symbol.for(HOST_RUNTIME_KEY)]: runtime })).toBe(table['main/libs/logger']);
    });

    it.each([
        'electron',
        'lodash',
        '@base-client/toolkit',
        '@base-client/toolkit/host',
        '@base-client/toolkit/runtime',
        '@base-client/toolkit/build',
        '@base-client/toolkit/package.json',
        '@base-client/toolkit/preload',
        '@base-client/toolkit/service/preload',
        '@base-client/toolkit/notice/preload',
    ])('leaves %s untouched', request => {
        const { err, value, type } = run(request);
        expect([err, value, type]).toEqual([undefined, undefined, undefined]);
    });
});
