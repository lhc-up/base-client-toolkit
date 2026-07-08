import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const modulePath = require.resolve('../../../src/capability/logger/index');

function buildLog4jsMock() {
    const loggerInstance = {
        trace: vi.fn(), debug: vi.fn(), info: vi.fn(),
        warn: vi.fn(), error: vi.fn(), fatal: vi.fn(),
    };
    return {
        configure: vi.fn(),
        getLogger: vi.fn(() => loggerInstance),
        shutdown: vi.fn(),
        __loggerInstance: loggerInstance,
    };
}

function buildElectronMock() {
    return { app: { getPath: vi.fn(() => '/tmp/x') } };
}

let log4jsMock;
const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
    delete require.cache[modulePath];

    log4jsMock = buildLog4jsMock();
    const log4jsPath = require.resolve('log4js');
    require.cache[log4jsPath] = {
        id: log4jsPath, filename: log4jsPath, loaded: true,
        exports: log4jsMock, children: [], paths: [],
    };

    const electronPath = require.resolve('electron');
    require.cache[electronPath] = {
        id: electronPath, filename: electronPath, loaded: true,
        exports: buildElectronMock(), children: [], paths: [],
    };

    const fs = require('fs');
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
});

afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
});

describe('capability/logger: dev gating for trace/debug', () => {
    it('NODE_ENV=development: trace and debug DO forward to log4js', () => {
        process.env.NODE_ENV = 'development';
        const logger = require('../../../src/capability/logger/index');
        logger.init({ logDir: '/tmp/x' });

        logger.trace('t');
        logger.debug('d');

        expect(log4jsMock.__loggerInstance.trace).toHaveBeenCalledTimes(1);
        expect(log4jsMock.__loggerInstance.debug).toHaveBeenCalledTimes(1);
    });

    it('NODE_ENV=production: trace and debug are silent', () => {
        process.env.NODE_ENV = 'production';
        const logger = require('../../../src/capability/logger/index');
        logger.init({ logDir: '/tmp/x' });

        logger.trace('t');
        logger.debug('d');

        expect(log4jsMock.__loggerInstance.trace).not.toHaveBeenCalled();
        expect(log4jsMock.__loggerInstance.debug).not.toHaveBeenCalled();
    });

    it('info/warn/error/fatal are NOT gated by NODE_ENV', () => {
        process.env.NODE_ENV = 'production';
        const logger = require('../../../src/capability/logger/index');
        logger.init({ logDir: '/tmp/x' });

        logger.info('i');
        logger.warn('w');
        logger.error('e');
        logger.fatal('f');

        expect(log4jsMock.__loggerInstance.info).toHaveBeenCalledTimes(1);
        expect(log4jsMock.__loggerInstance.warn).toHaveBeenCalledTimes(1);
        expect(log4jsMock.__loggerInstance.error).toHaveBeenCalledTimes(1);
        expect(log4jsMock.__loggerInstance.fatal).toHaveBeenCalledTimes(1);
    });

    it('isDev is snapshotted at init: changing NODE_ENV afterwards has no effect', () => {
        process.env.NODE_ENV = 'production';
        const logger = require('../../../src/capability/logger/index');
        logger.init({ logDir: '/tmp/x' });

        // Change env after init — should have no effect
        process.env.NODE_ENV = 'development';
        logger.trace('t');
        logger.debug('d');

        expect(log4jsMock.__loggerInstance.trace).not.toHaveBeenCalled();
        expect(log4jsMock.__loggerInstance.debug).not.toHaveBeenCalled();
    });
});
