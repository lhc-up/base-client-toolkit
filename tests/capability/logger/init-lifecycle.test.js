import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const modulePath = require.resolve('../../../src/capability/logger/index');

// Mock log4js
function buildLog4jsMock() {
    const loggerInstance = {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
    };
    return {
        configure: vi.fn(),
        getLogger: vi.fn(() => loggerInstance),
        shutdown: vi.fn(),
        __loggerInstance: loggerInstance,
    };
}

// Mock electron
function buildElectronMock() {
    return {
        app: {
            getPath: vi.fn((name) => {
                if (name === 'userData') return '/tmp/mock-user-data';
                return '/tmp';
            }),
        },
    };
}

let log4jsMock;
let electronMock;

beforeEach(() => {
    delete require.cache[modulePath];

    log4jsMock = buildLog4jsMock();
    const log4jsPath = require.resolve('log4js');
    require.cache[log4jsPath] = {
        id: log4jsPath, filename: log4jsPath, loaded: true,
        exports: log4jsMock, children: [], paths: [],
    };

    electronMock = buildElectronMock();
    const electronPath = require.resolve('electron');
    require.cache[electronPath] = {
        id: electronPath, filename: electronPath, loaded: true,
        exports: electronMock, children: [], paths: [],
    };
});

describe('capability/logger: init/shutdown lifecycle', () => {
    it('before init: every level method throws "not initialized"', () => {
        const logger = require('../../../src/capability/logger/index');
        for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
            expect(() => logger[level]('msg')).toThrow(/not initialized/i);
        }
    });

    it('before init: shutdown throws "not initialized"', () => {
        const logger = require('../../../src/capability/logger/index');
        expect(() => logger.shutdown()).toThrow(/not initialized/i);
    });

    it('init() with default opts configures log4js and does not throw', () => {
        const logger = require('../../../src/capability/logger/index');
        expect(() => logger.init()).not.toThrow();
        expect(log4jsMock.configure).toHaveBeenCalledTimes(1);
        expect(log4jsMock.getLogger).toHaveBeenCalledTimes(1);
    });

    it('after init: info() forwards to log4js.getLogger().info', () => {
        const logger = require('../../../src/capability/logger/index');
        logger.init();
        logger.info('hello');
        expect(log4jsMock.__loggerInstance.info).toHaveBeenCalledTimes(1);
    });

    it('calling init a second time throws "already initialized"', () => {
        const logger = require('../../../src/capability/logger/index');
        logger.init();
        expect(() => logger.init()).toThrow(/already initialized/i);
    });

    it('shutdown() after init calls log4js.shutdown', () => {
        const logger = require('../../../src/capability/logger/index');
        logger.init();
        logger.shutdown();
        expect(log4jsMock.shutdown).toHaveBeenCalledTimes(1);
    });

    it('shutdown does NOT reset state — re-init still throws already initialized', () => {
        const logger = require('../../../src/capability/logger/index');
        logger.init();
        logger.shutdown();
        expect(() => logger.init()).toThrow(/already initialized/i);
    });

    it('error message uses [toolkit/logger] prefix', () => {
        const logger = require('../../../src/capability/logger/index');
        expect(() => logger.info('x')).toThrow(/\[toolkit\/logger\]/);
    });
});
