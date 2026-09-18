import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('capability aggregate optional peers', () => {
    it('can enumerate capabilities without loading their optional peers', () => {
        const capabilityPath = path.resolve(__dirname, '../../../src/main/capability/index.js');
        const script = `
            const Module = require('node:module');
            const optionalPeers = new Set([
                '@vscode/sudo-prompt', 'download', 'electron-store', 'log4js', 'semver',
            ]);
            const originalLoad = Module._load;
            Module._load = function (request, parent, isMain) {
                if (optionalPeers.has(request)) throw new Error('unexpected optional peer: ' + request);
                return originalLoad.call(this, request, parent, isMain);
            };
            const capability = require(${JSON.stringify(capabilityPath)});
            const expected = ['archive', 'download', 'example', 'update'];
            if (JSON.stringify(Object.keys(capability).sort()) !== JSON.stringify(expected)) process.exit(2);
        `;

        const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });

        expect(result.status, result.stderr).toBe(0);
    });
});
