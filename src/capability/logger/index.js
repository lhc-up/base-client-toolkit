/**
 * Toolkit T-01: capability/logger
 *
 * M5 契约要点：
 * - 顶层导出 init / shutdown / 6 级日志方法 / serviceSchema
 * - init 前调用 6 级方法或 shutdown 触发 throw
 * - log4js 与 electron 延迟到 init 时 require，保 require 零副作用
 * - serviceSchema.handlers 与顶层方法引用同一份函数
 *
 * 详见 docs/superpowers/specs/2026-07-08-toolkit-t01-logger-design.md
 */

const fs = require('fs');
const path = require('path');

let state = null;

function assertInitialized() {
    if (!state) {
        throw new Error('[toolkit/logger] Logger not initialized');
    }
}

function init(opts) {
    if (state) {
        throw new Error('[toolkit/logger] Logger already initialized');
    }
    const log4js = require('log4js');
    const { app } = require('electron');

    const logDir = (opts && opts.logDir)
        || path.join(app.getPath('userData'), 'Logs');

    fs.mkdirSync(logDir, { recursive: true });

    log4js.configure({
        appenders: {
            console: {
                type: 'console',
                layout: {
                    type: 'pattern',
                    pattern: '[%[%d{yyyy-MM-dd hh:mm:ss}%]] [%[%p%]] - %m%n',
                },
            },
            logs: {
                type: 'dateFile',
                filename: path.join(logDir, 'log'),
                fileNameSep: '-',
                pattern: 'yyyy-MM-dd.log',
                alwaysIncludePattern: true,
                layout: {
                    type: 'pattern',
                    pattern: '[%d{yyyy-MM-dd hh:mm:ss.SSS}] [%p] - %m',
                },
                compress: true,
                maxLogSize: '100K',
                numBackups: 20,
            },
        },
        categories: {
            default: {
                appenders: ['console', 'logs'],
                level: 'trace',
            },
        },
    });

    state = {
        log4js,
        logger: log4js.getLogger(),
        isDev: process.env.NODE_ENV === 'development',
    };
}

function shutdown() {
    assertInitialized();
    state.log4js.shutdown();
}

function trace(msg, ...args) {
    assertInitialized();
    state.logger.trace(msg, ...args);
}

function debug(msg, ...args) {
    assertInitialized();
    state.logger.debug(msg, ...args);
}

function info(msg, ...args) {
    assertInitialized();
    state.logger.info(msg, ...args);
}

function warn(msg, ...args) {
    assertInitialized();
    state.logger.warn(msg, ...args);
}

function error(msg, ...args) {
    assertInitialized();
    state.logger.error(msg, ...args);
}

function fatal(msg, ...args) {
    assertInitialized();
    state.logger.fatal(msg, ...args);
}

const serviceSchema = {
    namespace: 'logger',
    handlers: {
        trace,
        debug,
        info,
        warn,
        error,
        fatal,
    },
};

module.exports = {
    init,
    shutdown,
    trace,
    debug,
    info,
    warn,
    error,
    fatal,
    serviceSchema,
};
