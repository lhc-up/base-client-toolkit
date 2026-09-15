/**
 * Toolkit capability 统一入口。
 *
 * 聚合所有 capability 子模块，支持两种接入方式：
 *   1. 统一入口：require('@base-client/toolkit/main/capability')
 *   2. 精确子路径：require('@base-client/toolkit/main/capability/update')
 *
 * 新增 capability 时只需在 capabilityLoaders 中登记，无需改动根入口。
 * getter 保持子模块懒加载，未使用 capability 的 optional peer 不会阻塞聚合入口。
 */

const capabilityLoaders = {
    example: () => require('./example'),
    update: () => require('./update'),
};

module.exports = Object.defineProperties({}, Object.fromEntries(
    Object.entries(capabilityLoaders).map(([name, load]) => [name, {
        enumerable: true,
        get: load,
    }]),
));
