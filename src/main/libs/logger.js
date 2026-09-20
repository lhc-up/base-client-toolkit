/**
 * 日志库：log4js 封装，六级方法 + print 原样输出 + shutdown。
 * 顶层即完成 log4js.configure，无 init。
 * 坑：业务侧要覆盖日志目录，必须在 require 本模块之前调用 setPathConfig({ log: '...' })。
 */

const log4js = require('log4js');
const path = require('path');
const { getFilePathConfig } = require('../paths');

const { log: logDir } = getFilePathConfig();

function getLogPath(name) {
    return path.join(logDir, name);
}

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
            filename: getLogPath('log'),
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

const logger = log4js.getLogger();
const isDev = process.env.NODE_ENV === 'development';

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

// 1、logger 的各个函数都绑定 logger 实例，避免作为回调时 this 找不到
// 2、预处理各类型的参数
module.exports = {
    trace(msg, ...args) {
        if (isDev) {
            print(logger.trace.bind(logger), msg, ...args);
        }
    },
    debug(msg, ...args) {
        if (isDev) {
            print(logger.debug.bind(logger), msg, ...args);
        }
    },
    info(msg, ...args) {
        print(logger.info.bind(logger), msg, ...args);
    },
    warn(msg, ...args) {
        print(logger.warn.bind(logger), msg, ...args);
    },
    error(msg, ...args) {
        print(logger.error.bind(logger), msg, ...args);
    },
    fatal(msg, ...args) {
        print(logger.fatal.bind(logger), msg, ...args);
    },
    shutdown() {
        log4js.shutdown();
    },
    // print 供其它模块原样输出共用
    print,
};
