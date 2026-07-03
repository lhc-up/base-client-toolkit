/**
 * shared 命名空间聚合入口。
 *
 * 导出跨模块共享基础设施（详见架构 §5、§8）：
 * - serializer: IPC 安全序列化 + reviveError + serializeForIpc（§7.2 / §7.3）
 * - envelope: IPC 应答信封（§7.1）
 * - naming: 命名规则（§7.4）
 *
 * shared/config、shared/enum、shared/utils、shared/constant 已删除
 * （违反 §8 shared/ 准入规则）。
 */

const serializer = require('./serializer');
const { reviveError } = require('./serializer/reviveError');
const envelope = require('./envelope');
const naming = require('./naming');

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
};
