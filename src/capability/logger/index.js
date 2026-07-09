const path = require('path');
const log4js = require('log4js');
const { app } = require('electron');

let initialized = false;
let opts = null;
let logger = null;
let isDev = false;

// bake logUtil.js print：Error 展开 stack；object → JSON.stringify；
// 失败（含循环引用）console.log(err, v) 后 raw 透传给 log4js
function print(fn, ...args) {
    let params = [];
    for (const arg of args) {
        if (arg instanceof Error) {
            const { message, stack } = arg;
            if (stack && stack.includes(message)) {
                params.push(stack);
            } else {
                params.push(message, stack);
            }
        } else {
            params.push(arg);
        }
    }
    params = params.map(v => {
        try {
            if (typeof v === 'object') {
                return JSON.stringify(v);
            }
            return v;
        } catch (err) {
            console.log(err, v);
            return v;
        }
    });
    fn(...params);
}

function assertInitialized() {
    if (!initialized) {
        throw new Error('[toolkit/logger] Logger not initialized');
    }
}

function init(userOpts) {
    if (initialized) {
        throw new Error('[toolkit/logger] Logger already initialized');
    }
    opts = userOpts || {};
    const logDir = opts.logDir || path.join(app.getPath('userData'), 'Logs');
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
    logger = log4js.getLogger();
    isDev = process.env.NODE_ENV === 'development';
    initialized = true;
}

function shutdown() {
    assertInitialized();
    log4js.shutdown();
}

// 各方法 .bind(logger) 传给 print，避免 log4js 方法作为回调时丢 this
function trace(msg, ...args) {
    assertInitialized();
    if (isDev) {
        print(logger.trace.bind(logger), msg, ...args);
    }
}

function debug(msg, ...args) {
    assertInitialized();
    if (isDev) {
        print(logger.debug.bind(logger), msg, ...args);
    }
}

function info(msg, ...args) {
    assertInitialized();
    print(logger.info.bind(logger), msg, ...args);
}

function warn(msg, ...args) {
    assertInitialized();
    print(logger.warn.bind(logger), msg, ...args);
}

function error(msg, ...args) {
    assertInitialized();
    print(logger.error.bind(logger), msg, ...args);
}

function fatal(msg, ...args) {
    assertInitialized();
    print(logger.fatal.bind(logger), msg, ...args);
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
