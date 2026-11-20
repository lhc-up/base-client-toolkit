import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const contract = require('../src/main/frameContract');

describe('与 frame 的约定', () => {
    it('frame src/paths.js 断言相同的值，改动须两边同时改', () => {
        expect(contract).toEqual({
            DESCRIPTOR_FILE: 'package.json',
            RESOURCES_DIR: 'resources',
            BUILTIN_PKG_DIR: 'packages',
        });
    });
});
