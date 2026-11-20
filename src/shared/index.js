/**
 * shared 聚合入口：main 与 preload 共用的纯 JS 基础设施。
 * - serializer: IPC 安全序列化与 Error 还原
 * - envelope: IPC 应答信封
 * - naming: namespace / handler / event 命名规则
 * - PKG_SOURCE: 包来源常量
 *
 * 本目录只允许无 Node/Electron 依赖的纯 JS 模块。
 */

const serializer = require('./serializer');
const { reviveError } = require('./serializer/reviveError');
const envelope = require('./envelope');
const naming = require('./naming');
const { PKG_SOURCE } = require('./pkgSource');

module.exports = {
    serializer: {
        serialize: serializer.serialize,
        safeStringify: serializer.safeStringify,
        configureSerializer: serializer.configureSerializer,
        serializeForIpc: serializer.serializeForIpc,
        reviveError,
    },
    envelope,
    naming,
    PKG_SOURCE,
};
