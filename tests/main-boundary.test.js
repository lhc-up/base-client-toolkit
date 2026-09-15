const fs = require('node:fs');
const path = require('node:path');
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

describe('toolkit runtime package boundary', () => {
    it('exposes explicit runtime subpaths without a root aggregate export', () => {
        const exports = packageJson.exports;
        expect(exports['.']).toBeUndefined();
        expect(exports['./main']).toBe('./src/main/index.js');
        expect(exports['./main/capability/*']).toBe('./src/main/capability/*/index.js');
        expect(exports['./main/enhance/*']).toBe('./src/main/enhance/*.js');
        expect(exports['./main/libs/*']).toBe('./src/main/libs/*.js');
        expect(exports['./main/paths']).toBe('./src/main/paths.js');
        expect(exports['./service']).toBe('./src/service/main.js');
        expect(exports['./notice']).toBe('./src/notice/main.js');
        expect(exports['./shared']).toBe('./src/shared/index.js');
        expect(exports['./preload']).toBe('./src/preload/index.js');
    });

    it('has separate main and preload entry files', () => {
        expect(fs.existsSync(path.join(root, 'src/main/index.js'))).toBe(true);
        expect(fs.existsSync(path.join(root, 'src/preload/index.js'))).toBe(true);
    });

    it('keeps shared modules free of runtime-only imports', () => {
        const sharedRoot = path.join(root, 'src/shared');
        const files = [];
        const visit = directory => {
            for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                const filePath = path.join(directory, entry.name);
                if (entry.isDirectory()) visit(filePath);
                else if (entry.name.endsWith('.js')) files.push(filePath);
            }
        };
        visit(sharedRoot);
        for (const filePath of files) {
            const source = fs.readFileSync(filePath, 'utf8');
            expect(source).not.toMatch(/require\(['"](?:electron|node:|fs|fs-extra|child_process|path|crypto)/);
        }
    });
});
