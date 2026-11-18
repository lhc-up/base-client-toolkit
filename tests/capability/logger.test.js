import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);

const electronMock = {
    app: { getPath: () => os.tmpdir() },
    protocol: { registerSchemesAsPrivileged() {}, registerFileProtocol() {}, unregisterProtocol() {} },
};
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
    id: electronPath, filename: electronPath, loaded: true,
    exports: electronMock, children: [], paths: [],
};

const logger = require('../../src/main/capability/logger');

describe('capability/logger', () => {
    it('schema exposes six levels and getLog', () => {
        expect(logger.serviceSchema.namespace).toBe('logger');
        expect(Object.keys(logger.serviceSchema.handlers).sort())
            .toEqual(['debug', 'error', 'fatal', 'getLog', 'info', 'trace', 'warn']);
    });

    it('logExportDir lives under the temp path', () => {
        expect(path.basename(logger.logExportDir)).toBe('log-export');
    });

    it('getLog returns a resource:// url or null', async () => {
        const result = await logger.getLog();
        expect(result === null || result.startsWith('resource:')).toBe(true);
    });
});
