/**
 * logger capability：渲染层写主进程日志（`appService.logger.info(...)` 等），以及导出日志供上报。
 *
 * 宿主注册为通用能力。`getLog` 返回的是 `resource://` 地址，需要宿主或包把 `logExportDir`
 * 加入 `serveResource` 的允许根，渲染层才能 fetch 到。
 */
const path = require('path');
const fse = require('fs-extra');
const { createZip } = require('../../libs/archive');
const { getFilePathConfig } = require('../../paths');
const Logger = require('../../libs/logger');
const { buildResourceUrl } = require('../../libs/protocol');

const { log: logDir, temp: tempDir } = getFilePathConfig();

/** 日志导出目录（每次导出前清空），供 serveResource 的允许根使用 */
const logExportDir = path.join(tempDir, 'log-export');

// 导出最近的日志文件个数
const EXPORT_FILE_COUNT = 2;

const levels = {
    trace: Logger.trace,
    debug: Logger.debug,
    info: Logger.info,
    warn: Logger.warn,
    error: Logger.error,
    fatal: Logger.fatal,
};

async function getLogFileList() {
    const names = await fse.readdir(logDir);
    const stated = [];
    for (const name of names) {
        if (!['.log', '.gz'].includes(path.extname(name))) continue;
        const full = path.join(logDir, name);
        const stat = await fse.stat(full);
        if (stat.isFile()) stated.push({ full, ctimeMs: stat.ctimeMs });
    }
    return stated
        .sort((a, b) => b.ctimeMs - a.ctimeMs)
        .slice(0, EXPORT_FILE_COUNT)
        .map(v => v.full);
}

async function writeErrorFallback(err) {
    try {
        const file = path.join(logExportDir, 'log-export-error.txt');
        await fse.outputFile(file, `${err.message}\n${err.stack}`, 'utf8');
        return buildResourceUrl(file);
    } catch {
        return null;
    }
}

/**
 * 把最近的日志文件打成 zip，返回 `resource://` 地址。
 *
 * 文件名带时间戳：`resource://` 走 Chromium 网络栈，固定 URL 会被 fetch 缓存。
 * 汇总失败时把异常写成 txt 照常返回地址，调用方的上报链路无需区分成功 / 失败。
 *
 * @returns {Promise<string|null>} 没有日志文件时为 null
 */
async function getLog() {
    try {
        await fse.emptyDir(logExportDir);
        const sources = await getLogFileList();
        if (!sources.length) return null;
        const output = path.join(logExportDir, `log-${Date.now()}.zip`);
        await createZip({ sources, output });
        return buildResourceUrl(output);
    } catch (err) {
        Logger.error('日志汇总失败', err);
        return writeErrorFallback(err);
    }
}

/**
 * 关闭日志并等待落盘（退出前调用）。
 *
 * @returns {Promise<void>}
 */
function flush() {
    return Logger.shutdown();
}

const serviceSchema = {
    namespace: 'logger',
    handlers: { ...levels, getLog },
};

module.exports = { ...levels, getLog, flush, logExportDir, serviceSchema };
