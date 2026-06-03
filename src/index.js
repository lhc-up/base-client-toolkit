const Service = require('./service');
const Notice = require('./notice');
const BaseWindow = require('./window/BaseWindow');
const shared = require('./shared');

module.exports = {
    // 初始化
    Service,
    Notice,

    // 核心类
    BaseWindow,

    // 共享
    shared,

    // 版本
    VERSION: require('../package.json').version
};
