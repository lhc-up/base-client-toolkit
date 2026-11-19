// `main/libs/logger` 的「永不抛」契约测试。
//
// 写日志是非必要基础设施，失败必须被咽掉、只走次级通道自报（见该模块文件头）。
// 本文件断言的就是这条契约：无论参数多恶劣、appender 是否炸，六级方法与 shutdown
// 都不得把异常抛给调用方。
//
// 导入形态与其它测试一致：vitest 走 ESM import（2.x 拒绝从 CJS require 引入），
// 被测的 CJS 源码用 createRequire 取。`paths.js` 要 electron 的 `app.getPath`，
// 故按 `tests/enhance/_electron-mock.js` 的同一模式注入 require.cache——
// 但那个 helper 只注入 BrowserWindow，这里要的是 app，故就地写。
import { describe, it, expect, vi, afterAll, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';

const require = createRequire(import.meta.url);

const LOG_ROOT = path.join(os.tmpdir(), 'bc-toolkit-logger-test');

const electronPath = require.resolve('electron');
require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: { app: { getPath: () => LOG_ROOT } },
    children: [],
    paths: [],
};

const Logger = require('../src/main/libs/logger');

/** `instanceof Error` 为真、但取 message/stack 就抛 —— 命中 print 的 Error 分支后立刻炸。 */
function hostileError() {
    const err = Object.create(Error.prototype);
    Object.defineProperty(err, 'message', {
        get() { throw new Error('message getter 故意抛'); },
    });
    Object.defineProperty(err, 'stack', {
        get() { throw new Error('stack getter 故意抛'); },
    });
    return err;
}

/** 循环引用，让 JSON.stringify 抛 —— 命中 params.map 里那层 catch。 */
function circular() {
    const o = { name: 'o' };
    o.self = o;
    return o;
}

// info/warn/error/fatal 任何环境都真正走到 appender；
// trace/debug 由 isDev 门控，非 development 下是空操作，故分两组断言。
const LEVELS = ['info', 'warn', 'error', 'fatal'];
const DEV_GATED = ['trace', 'debug'];

describe('main/libs/logger 永不抛契约', () => {
    let errSpy;

    beforeEach(() => {
        errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        errSpy.mockRestore();
    });

    afterAll(async () => {
        Logger.shutdown();
        await fsp.rm(LOG_ROOT, { recursive: true, force: true }).catch(() => {});
    });

    it('六级方法都存在，且 shutdown / print 一并导出', () => {
        for (const name of [...LEVELS, ...DEV_GATED]) {
            expect(typeof Logger[name]).toBe('function');
        }
        expect(typeof Logger.shutdown).toBe('function');
        expect(typeof Logger.print).toBe('function');
    });

    it.each(LEVELS)('%s 收到正常参数不抛', name => {
        expect(() => Logger[name]('普通文本', 1, true, null, { a: 1 })).not.toThrow();
    });

    it.each(LEVELS)('%s 收到 getter 会抛的 Error-like 对象时不抛，并走次级通道', name => {
        expect(() => Logger[name](hostileError())).not.toThrow();
        // 失败必须被自报出去，否则就是静默吞掉、现场无从排查
        expect(errSpy.mock.calls.some(c => String(c[0]).includes('[logger]'))).toBe(true);
    });

    it.each(LEVELS)('%s 收到循环引用时不抛（该参数原样输出，其余照常）', name => {
        expect(() => Logger[name]('前缀', circular(), '后缀')).not.toThrow();
        expect(errSpy.mock.calls.some(c => String(c[0]).includes('参数序列化失败'))).toBe(true);
    });

    it.each(DEV_GATED)('%s 在非 development 下是空操作且不抛', name => {
        expect(() => Logger[name](hostileError())).not.toThrow();
    });

    it('来自其他 JS 上下文的 Error 保留 message 与 stack（不被记成 {}）', () => {
        const vm = require('node:vm');
        const foreign = vm.runInNewContext("new Error('boom')");
        const appender = vi.fn();
        Logger.print(appender, foreign);
        const text = appender.mock.calls[0].join(' | ');
        expect(text).toContain('boom');
        expect(text).not.toContain('{}');
    });

    it('appender 抛错时 print 不抛，并自报', () => {
        const boom = () => { throw new Error('appender 炸了'); };
        expect(() => Logger.print(boom, '随便什么')).not.toThrow();
        expect(errSpy.mock.calls.some(c => String(c[0]).includes('写日志失败'))).toBe(true);
    });

    it('shutdown 可重复调用且不抛', () => {
        expect(() => Logger.shutdown()).not.toThrow();
        expect(() => Logger.shutdown()).not.toThrow();
    });
});


describe('main/libs/loggerConfig', () => {
    it('默认轮转参数为 500K × 10', () => {
        const { DEFAULTS } = require('../src/main/libs/loggerConfig');
        expect(DEFAULTS).toEqual({ maxLogSize: '500K', numBackups: 10 });
    });

    it('setLoggerConfig 覆盖并可重复调用', () => {
        const { setLoggerConfig, getLoggerConfig } = require('../src/main/libs/loggerConfig');
        setLoggerConfig({ maxLogSize: '1M' });
        expect(getLoggerConfig()).toEqual({ maxLogSize: '1M', numBackups: 10 });
        setLoggerConfig({ numBackups: 3 });
        expect(getLoggerConfig()).toEqual({ maxLogSize: '1M', numBackups: 3 });
        setLoggerConfig({ maxLogSize: '500K', numBackups: 10 });
    });
});
