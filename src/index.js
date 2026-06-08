// 根入口：便利层（per overview §8.1）
// 用户也可直接通过 subpath import 各模块（./service / ./notice / ./enhance/BaseWindow / ./capability/*）

const Service = require('./service/main');
const Notice = require('./notice/main');
const BaseWindow = require('./enhance/BaseWindow');
const shared = require('./shared');

module.exports = {
    Service,
    Notice,
    BaseWindow,
    shared,
    VERSION: require('../package.json').version,
};
