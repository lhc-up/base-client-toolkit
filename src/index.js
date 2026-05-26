const Service = require('./service');
const Notice = require('./notice');
const BaseWindow = require('./window/BaseWindow');
const {
    Factory,
    MainFactory,
    PreloadFactory,
    RendererFactory
} = require('./config');
const shared = require('./shared');

module.exports = {
    // 初始化
    initService: Service.init,
    initNotice: Notice.init,

    // 核心类
    BaseWindow,

    // 配置工厂
    Factory,
    MainFactory,
    PreloadFactory,
    RendererFactory,

    // 共享
    enum: shared.enum,
    utils: shared.utils,

    // 版本
    VERSION: require('../package.json').version
};
