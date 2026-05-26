const Service = require('./service');
const Notice = require('./notice');
const BaseWindow = require('./window/BaseWindow');
const shared = require('./shared');

module.exports = {
    // 初始化
    initService: Service.init,
    initNotice: Notice.init,

    // 核心类
    BaseWindow,

    // 共享
    shared,

    // 版本
    VERSION: require('../package.json').version
};
