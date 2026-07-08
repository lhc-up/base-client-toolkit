import { describe, it, expect, beforeEach, vi } from 'vitest';
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
    return {
        app: {
            getPath: vi.fn(() => '/tmp/x'),
        },
    };
}

let log4jsMock;

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

function withLogger(fn) {
    const logger = require('../../../src/capability/logger/index');
    logger.init({ logDir: '/tmp/x' });
    return fn(logger);
}

describe('serialize: primitives pass through', () => {
    it('string / number / boolean / null / undefined pass through', () => {
        withLogger((logger) => {
            logger.info('hello', 42, true, null, undefined);
            const args = log4jsMock.__loggerInstance.info.mock.calls[0];
            expect(args).toEqual(['hello', 42, true, null, undefined]);
        });
    });
});

describe('serialize: Error expansion', () => {
    it('Error whose stack contains message → pushes stack only', () => {
        withLogger((logger) => {
            const err = new Error('boom');
            // Node 生成的 stack 通常以 "Error: boom\n    at ..." 开头，包含 message
            expect(err.stack.includes(err.message)).toBe(true);
            logger.info('prefix', err);
            const args = log4jsMock.__loggerInstance.info.mock.calls[0];
            expect(args).toEqual(['prefix', err.stack]);
        });
    });

    it('Error whose stack does NOT contain message → pushes message then stack', () => {
        withLogger((logger) => {
            const err = new Error('boom');
            // 手动构造一个 stack 不含 message 的场景
            err.stack = 'at foo (a.js:1:1)\nat bar (b.js:2:2)';
            expect(err.stack.includes(err.message)).toBe(false);
            logger.info(err);
            const args = log4jsMock.__loggerInstance.info.mock.calls[0];
            expect(args).toEqual(['boom', err.stack]);
        });
    });
});

describe('serialize: object serialization', () => {
    it('plain object → JSON.stringify', () => {
        withLogger((logger) => {
            logger.info({ a: 1, b: 'x' });
            const args = log4jsMock.__loggerInstance.info.mock.calls[0];
            expect(args).toEqual(['{"a":1,"b":"x"}']);
        });
    });

    it('array → JSON.stringify', () => {
        withLogger((logger) => {
            logger.info([1, 2, 3]);
            const args = log4jsMock.__loggerInstance.info.mock.calls[0];
            expect(args).toEqual(['[1,2,3]']);
        });
    });

    it('circular reference → falls back to util.inspect (contains [Circular])', () => {
        withLogger((logger) => {
            const obj = { a: 1 };
            obj.self = obj;
            logger.info(obj);
            const args = log4jsMock.__loggerInstance.info.mock.calls[0];
            expect(typeof args[0]).toBe('string');
            expect(args[0]).toMatch(/Circular/);
            expect(args[0]).toMatch(/a:\s*1/);
        });
    });
});

describe('serialize: mixed args', () => {
    it('mix of string + Error + object works', () => {
        withLogger((logger) => {
            const err = new Error('bad');
            logger.error('failed at', err, { userId: 7 });
            const args = log4jsMock.__loggerInstance.error.mock.calls[0];
            // 'failed at' passthrough, err → stack (contains msg), {userId:7} → JSON.stringify
            expect(args[0]).toBe('failed at');
            expect(args[1]).toBe(err.stack);
            expect(args[2]).toBe('{"userId":7}');
        });
    });
});
