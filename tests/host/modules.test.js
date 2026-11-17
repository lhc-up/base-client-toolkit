import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

const { expandMappedSubpaths, renderModulesFile, OUTPUT } = require('../../scripts/hostModules');
const { NOT_MAPPED } = require('../../src/build');

describe('host modules table', () => {
    it('committed file matches generator output (run npm run gen:host-modules)', () => {
        const expected = renderModulesFile(expandMappedSubpaths(root));
        // 仓库开启了 autocrlf，检出后文件可能是 CRLF，按 LF 比较
        const actual = fs.readFileSync(path.join(root, OUTPUT), 'utf8').replace(/\r\n/g, '\n');
        expect(actual).toBe(expected);
    });

    it('excludes every not-mapped subpath', () => {
        const subpaths = expandMappedSubpaths(root).map(e => e.subpath);
        for (const excluded of NOT_MAPPED) expect(subpaths).not.toContain(excluded);
    });

    it('covers explicit and wildcard exports', () => {
        const subpaths = expandMappedSubpaths(root).map(e => e.subpath);
        expect(subpaths).toEqual(expect.arrayContaining([
            'service',
            'notice',
            'shared',
            'main/paths',
            'main/libs/logger',
            'main/libs/protocol',
            'main/libs/archive',
            'main/capability/update',
            'main/enhance/BaseWindow',
        ]));
    });

    it('every target file exists', () => {
        for (const { target } of expandMappedSubpaths(root)) {
            expect(fs.existsSync(path.join(root, target)), target).toBe(true);
        }
    });

    it('getters are lazy (requiring the table does not load modules)', () => {
        const table = require('../../src/host/modules');
        const descriptor = Object.getOwnPropertyDescriptor(table, 'main/libs/logger');
        expect(typeof descriptor.get).toBe('function');
        expect(descriptor.value).toBeUndefined();
    });
});
