// Task 8: runtime export integration checks.
// Verifies public subpaths actually resolve through package exports (not just the
// package.json text), the root aggregate stays unavailable, preload only installs
// Service/Notice bridges, and renderer-facing entries never import main-only code.

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const PUBLIC_SUBPATHS = [
    './main',
    './main/capability',
    './main/capability/example',
    './main/capability/update',
    './main/capability/download',
    './main/capability/archive',
    './main/capability/store',
    './main/capability/env',
    './main/capability/logger',
    './main/enhance/BaseWindow',
    './main/paths',
    './main/libs/archive',
    './main/libs/download',
    './main/libs/integrity',
    './main/libs/logger',
    './main/libs/os',
    './main/libs/protocol',
    './main/libs/scope',
    './main/libs/shortcut',
    './main/libs/singleInstance',
    './main/libs/sm4',
    './main/libs/store',
    './preload',
    './service',
    './service/preload',
    './notice',
    './notice/preload',
    './shared',
    './host',
    './runtime',
    './build',
];

function collectJsFiles(entry) {
    const files = [];
    const visit = target => {
        const stat = fs.statSync(target);
        if (stat.isDirectory()) {
            for (const name of fs.readdirSync(target)) visit(path.join(target, name));
        } else if (target.endsWith('.js')) {
            files.push(target);
        }
    };
    visit(target0(entry));
    return files;
    function target0(p) { return path.join(root, p); }
}

describe('runtime package exports', () => {
    it('resolves every public subpath through package self-reference', () => {
        const script = `
            const subpaths = ${JSON.stringify(PUBLIC_SUBPATHS)};
            const failures = [];
            for (const sub of subpaths) {
                try {
                    require.resolve('@base-client/toolkit' + sub.slice(1));
                } catch (error) {
                    failures.push(sub + ' -> ' + error.code);
                }
            }
            try {
                require.resolve('@base-client/toolkit');
                failures.push('root aggregate import is not blocked');
            } catch (error) {
                if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED' && error.code !== 'MODULE_NOT_FOUND') {
                    failures.push('root import failed unexpectedly: ' + error.code);
                }
            }
            if (failures.length) {
                console.error(failures.join('\\n'));
                process.exit(1);
            }
        `;
        const result = spawnSync(process.execPath, ['-e', script], {
            cwd: root,
            encoding: 'utf8',
        });
        expect(result.status, result.stderr).toBe(0);
    });

    it('preload entry only wires Service and Notice bridges', () => {
        const source = fs.readFileSync(path.join(root, 'src/preload/index.js'), 'utf8');
        const requires = [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)]
            .map(m => m[1])
            .sort();
        expect(requires).toEqual(['../notice/preload', '../service/preload', 'electron']);
    });

    it('renderer-facing entries never import main-only modules', () => {
        const files = [
            ...collectJsFiles('src/preload'),
            ...collectJsFiles('src/shared'),
            path.join(root, 'src/service/preload.js'),
            path.join(root, 'src/notice/preload.js'),
        ];
        for (const filePath of files) {
            const source = fs.readFileSync(filePath, 'utf8');
            const requires = [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map(m => m[1]);
            for (const specifier of requires) {
                expect(specifier, `${filePath} must not import main-only code`)
                    .not.toMatch(/(^|\/)main(\/|$)/);
            }
        }
    });

    it('main aggregate stays main-scoped and has no root aggregate export', () => {
        const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        expect(packageJson.exports['.']).toBeUndefined();
        const mainSource = fs.readFileSync(path.join(root, 'src/main/index.js'), 'utf8');
        expect(mainSource).toContain("require('./capability')");
    });
});