/**
 * @base-client/toolkit 根入口（详见架构 §5）。
 *
 * 便利层：聚合各模块的主端导出。用户也可直接通过 subpath 精确 import
 * 各模块（如 require('@base-client/toolkit/service')）。
 *
 * @module @base-client/toolkit
 */

const Service = require('./service/main');
const Notice = require('./notice/main');
const BaseWindow = require('./enhance/BaseWindow');
const shared = require('./shared');

module.exports = {
    Service,
    Notice,
    BaseWindow,
    shared,
    /** toolkit 版本号，来自 package.json */
    VERSION: require('../package.json').version,
};
