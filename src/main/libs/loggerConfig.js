/**
 * 日志轮转参数。`logger` 在顶层即 `log4js.configure`，因此 `setLoggerConfig` 必须在
 * 任何模块 require `main/libs/logger` **之前**调用；晚于它则无效且不报错（与 `setPathConfig` 同一时序约束）。
 *
 * 默认 500K × 10（约 5 MB）：单文件更大，一个时段的事故日志不会被切成多段跨文件。
 * 原默认 100K × 20 实测（考场密度）留存窗口仅约 4 小时。
 */
const DEFAULTS = Object.freeze({ maxLogSize: '500K', numBackups: 10 });

let current = { ...DEFAULTS };

/**
 * @param {{ maxLogSize?: string, numBackups?: number }} [config]
 */
function setLoggerConfig(config = {}) {
    current = { ...current, ...config };
}

function getLoggerConfig() {
    return { ...current };
}

module.exports = { setLoggerConfig, getLoggerConfig, DEFAULTS };
