import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('capability/update optional peers', () => {
    it('loads without sudo-prompt until the privileged installer is used', () => {
        const updatePath = path.resolve(__dirname, '../../../src/capability/update/index.js');
        const script = `
            const Module = require('node:module');
            const originalLoad = Module._load;
            Module._load = function (request, parent, isMain) {
                if (request === '@vscode/sudo-prompt') {
                    throw new Error('optional peer must not load eagerly');
                }
                if (request === 'electron') {
                    return { app: {}, dialog: {}, shell: {} };
                }
                if (request === '../logger') {
                    return { error() {}, info() {}, shutdown() {} };
                }
                if (request === '../os') {
                    return { isLinux: () => false, isLoongnix: () => false, isWindows: () => true };
                }
                if (request === '../../paths') {
                    return { getFilePathConfig: () => ({ updatePackage: '.' }) };
                }
                return originalLoad.call(this, request, parent, isMain);
            };
            require(${JSON.stringify(updatePath)});
        `;

        const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });

        expect(result.status, result.stderr).toBe(0);
    });
});
