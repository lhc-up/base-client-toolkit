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

let state = null;

function assertInitialized() {
    if (!state) {
        throw new Error('[toolkit/logger] Logger not initialized');
    }
}

function init(opts) {
    throw new Error('[toolkit/logger] init not yet implemented');
}

function shutdown() {
    assertInitialized();
    throw new Error('[toolkit/logger] shutdown not yet implemented');
}

function trace(msg, ...args) {
    assertInitialized();
}

function debug(msg, ...args) {
    assertInitialized();
}

function info(msg, ...args) {
    assertInitialized();
}

function warn(msg, ...args) {
    assertInitialized();
}

function error(msg, ...args) {
    assertInitialized();
}

function fatal(msg, ...args) {
    assertInitialized();
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
