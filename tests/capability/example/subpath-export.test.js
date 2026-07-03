import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fs = require('fs');

describe('capability/example: subpath export wiring', () => {
    it('physical structure matches §2.1 (directory + index.js)', () => {
        const dir = path.resolve(__dirname, '../../../src/capability/example');
        expect(fs.statSync(dir).isDirectory()).toBe(true);
        const entry = path.join(dir, 'index.js');
        expect(fs.existsSync(entry)).toBe(true);
        expect(fs.statSync(entry).isFile()).toBe(true);
        expect(path.basename(dir)).toBe('example');
    });

    it('directory name equals serviceSchema.namespace and noticeSchema.namespace', () => {
        const dir = path.resolve(__dirname, '../../../src/capability/example');
        const dirName = path.basename(dir);
        const example = require('../../../src/capability/example/index');
        expect(example.serviceSchema.namespace).toBe(dirName);
        expect(example.noticeSchema.namespace).toBe(dirName);
    });

    it('package.json declares ./capability/* wildcard export pointing into src', () => {
        const pkgPath = path.resolve(__dirname, '../../../package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        expect(pkg.exports).toBeTruthy();
        const cap = pkg.exports['./capability/*'];
        expect(cap).toBeTruthy();
        const target = typeof cap === 'string' ? cap : cap.default;
        expect(target).toMatch(/\.\/src\/capability\/\*\/index\.js$/);
    });

    it('relative require and absolute require yield the same module object', () => {
        const directRequire = require('../../../src/capability/example/index');
        const viaPath = require(path.resolve(__dirname, '../../../src/capability/example/index.js'));
        expect(viaPath).toBe(directRequire);
        expect(Object.keys(viaPath).sort()).toEqual(
            ['echo', 'noticeSchema', 'serviceSchema'],
        );
    });
});
