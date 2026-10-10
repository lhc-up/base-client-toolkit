/**
 * 日志库：log4js 封装，六级方法 + print 原样输出 + shutdown。
 * 顶层即完成 log4js.configure，无 init。
 * 坑：业务侧要覆盖日志目录，必须在 require 本模块之前调用 setPathConfig({ log: '...' })。
 *
 * ## 契约：六级方法与 shutdown **永不抛**
 *
 * 写日志是非必要基础设施，**它失败绝不能影响主流程** —— 一个会把宿主打挂的 logger
 * 比一个会丢行的 logger 糟糕得多。业界一致如此收敛（log4j2 `ignoreExceptions=true`、
 * Python logging 生产态 `raiseExceptions=False`、Serilog SelfLog、
 * OpenTelemetry「never throw」）。
 *
 * 失败时走**次级通道**自报（`console.error` → stderr / 主进程终端），不再走日志自身，
 * 否则会递归。调用方因此可以 fire-and-forget，**尤其是经 Service 跨进程调用的渲染层**：
 * handler 一抛就是渲染端一个 unhandled rejection，而业务的 `unhandledrejection`
 * 处理器通常又会打一条日志 —— 失败若是持续性的（磁盘满、无权限），就自激成循环。
 * 在本模块把失败咽掉，是切断那条回路最省的位置。
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

/**
 * 次级通道：日志系统自身失败时唯一的去处。不能再走日志（会递归）。
 * 连 console 都不可用时彻底放弃 —— 没有第三条路，而抛出去就违反本模块的永不抛契约。
 */
function selfReport(reason, err) {
    try {
        console.error(`[logger] ${reason}`, err);
    } catch {
        /* noop */
    }
}

function print(fn, ...args) {
    // **整体 try 包住，不只包 JSON.stringify**：两处都可能抛 ——
    // ① 下面取 `arg.message` / `arg.stack`：Error-like 对象可能是带 throwing getter 的
    //    Proxy（跨进程来的参数通常已被 serializer 摊平，但主端内部直接调用没这层保障）；
    // ② `fn(...params)`：log4js 在 category 失效、shutdown 后继续写等情况下会抛。
    try {
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
                // 单个参数序列化失败不该连累整条：原样交给 appender，其余参数照常
                selfReport('参数序列化失败，该参数原样输出', err);
                return v;
            }
        });
        fn(...params);
    } catch (err) {
        selfReport('写日志失败，该条已丢弃', err);
    }
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
    /**
     * 关闭所有 appender，**返回 Promise 以便调用方等 flush 真正完成**。
     *
     * ## 为什么必须能等
     *
     * `log4js.shutdown(cb)` 是**异步**的：回调在所有 appender drain 完后触发
     * （`log4js/lib/log4js.js:106`），dateFile appender 底下是 streamroller 的流式写。
     * 本函数原先是裸调 `log4js.shutdown()`、把回调丢了，于是调用方无从知道何时写完。
     *
     * **实测（写 2000 条后立刻收尾，看文件实际落盘行数）**：
     *
     * | 场景 | 落盘 |
     * |---|---|
     * | 纯 Node，不调 `process.exit()` | 2000/2000 |
     * | 纯 Node，`process.exit(0)` | 0/2000 |
     * | Electron `will-quit` 裸调 shutdown、不拦退出 | **2/2000** |
     * | Electron `will-quit` `preventDefault()` + 等本函数 resolve | **2000/2000** |
     *
     * **根因是宿主的退出语义，不是 Node 的异步模型**：纯 Node 只要不主动调
     * `process.exit()`，pending I/O 会把事件循环撑着、自然写完 —— 那一行不需要等。
     * 需要等是因为 **Electron 的 `app.quit()` 本身就是主动终止**，语义等价于
     * `process.exit()`，不给事件循环排空的机会。所以宿主是 Electron 时，
     * `will-quit` 里必须 `preventDefault()` 并 await 本函数。
     *
     * ## 不等的后果是「静默丢失」，不是「报错」—— 这是本条最该记住的一点
     *
     * 同一次实测里，不拦退出那组：**零 `uncaughtException`、零
     * `unhandledRejection`、零 stream error，退出码仍是 0**。外部完全看不出异常，
     * 故障不可见 —— 比抛异常难查得多。所以这件事不能靠"出问题会报出来"兜。
     *
     * 另一半是**丢的是「完成通知」而非一律丢数据**：同次实测里一个 64MB 的
     * `fs.writeFile` 照样写满了盘、只是回调没执行 —— 已交给 OS 的 I/O 由 OS 做完。
     * 真正会丢的是**还在 JS 侧排队、尚未交给 OS 的那部分**，而 log4js 正是
     * 排队 + 分批 flush，所以它受影响最大（2/2000 而非 64MB 那种 100%）。
     * 这个区分决定了「哪些异步操作需要等、哪些不用」。
     *
     * 顺带已排除的一项：不等**不会写坏文件** —— `.log` 尾部是完整行，
     * 不拦退出那组根本没产生 `.gz`（数据丢在压缩之前、压缩没机会开始）。
     * 仅为本次观察，不等于"已证明不可能"：轮转恰好卡在退出瞬间是个无法稳定复现的竞态。
     *
     * 同样纳入永不抛契约：它通常挂在退出路径上，抛出去会打断宿主的退出流程。
     * **drain 期间的 appender 错误不 reject**，只走次级通道自报 —— 对调用方而言
     * 「日志没写全」不是需要分支处理的事，而退出流程不能因此卡住。
     *
     * @returns {Promise<void>} appender 全部结束后 resolve；**不会 reject**
     */
    shutdown() {
        return new Promise(resolve => {
            try {
                log4js.shutdown(err => {
                    if (err) selfReport('shutdown 期间 appender 报错', err);
                    resolve();
                });
            } catch (err) {
                selfReport('shutdown 调用失败', err);
                resolve();
            }
        });
    },
    // print 供其它模块原样输出共用
    print,
};
