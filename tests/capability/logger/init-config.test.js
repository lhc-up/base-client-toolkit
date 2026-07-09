import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const modulePath = require.resolve('../../../src/capability/logger/index');

function buildLog4jsMock() {
    return {
        configure: vi.fn(),
        getLogger: vi.fn(() => ({
            trace: vi.fn(), debug: vi.fn(), info: vi.fn(),
            warn: vi.fn(), error: vi.fn(), fatal: vi.fn(),
        })),
        shutdown: vi.fn(),
    };
}

function buildElectronMock(userDataPath = '/tmp/mock-user-data') {
    return {
        app: {
            getPath: vi.fn((name) => {
                if (name === 'userData') return userDataPath;
                return '/tmp';
            }),
        },
    };
}

let log4jsMock;
let electronMock;

beforeEach(async () => {
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

describe('capability/logger: init opts.logDir handling', () => {
    it('when opts is omitted, uses <userData>/Logs and log4js.configure sees that filename', () => {
        const logger = require('../../../src/capability/logger/index');
        logger.init();
        expect(electronMock.app.getPath).toHaveBeenCalledWith('userData');
        const cfg = log4jsMock.configure.mock.calls[0][0];
        expect(String(cfg.appenders.logs.filename)).toMatch(/mock-user-data[\\/]Logs[\\/]log$/);
    });

    it('when opts.logDir is provided, uses it verbatim and does NOT call app.getPath', () => {
        const logger = require('../../../src/capability/logger/index');
        logger.init({ logDir: '/custom/log/path' });
        expect(electronMock.app.getPath).not.toHaveBeenCalled();
        const cfg = log4jsMock.configure.mock.calls[0][0];
        expect(String(cfg.appenders.logs.filename)).toMatch(/^[\\/]custom[\\/]log[\\/]path[\\/]log$/);
    });

    it('log4js.configure receives filename under the resolved logDir', () => {
        const logger = require('../../../src/capability/logger/index');
        logger.init({ logDir: '/custom/log/path' });
        expect(log4jsMock.configure).toHaveBeenCalledTimes(1);
        const cfg = log4jsMock.configure.mock.calls[0][0];
        // 路径分隔符跨平台：Windows path.join 将 '/' 全部规范化为 '\'
        expect(cfg.appenders.logs.filename).toMatch(/^[\\/]custom[\\/]log[\\/]path[\\/]log$/);
    });

    it('log4js.configure passes照搬 spec §7.1 的默认值', () => {
        const logger = require('../../../src/capability/logger/index');
        logger.init({ logDir: '/tmp/x' });
        const cfg = log4jsMock.configure.mock.calls[0][0];
        expect(cfg.appenders.console.type).toBe('console');
        expect(cfg.appenders.logs.type).toBe('dateFile');
        expect(cfg.appenders.logs.pattern).toBe('yyyy-MM-dd.log');
        expect(cfg.appenders.logs.maxLogSize).toBe('100K');
        expect(cfg.appenders.logs.numBackups).toBe(20);
        expect(cfg.appenders.logs.compress).toBe(true);
        expect(cfg.appenders.logs.alwaysIncludePattern).toBe(true);
        expect(cfg.categories.default.appenders).toEqual(['console', 'logs']);
        expect(cfg.categories.default.level).toBe('trace');
    });
});
