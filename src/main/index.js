/**
 * 主进程聚合入口：capability（懒加载）、BaseWindow 与受控路径配置。
 * 包边界为显式子路径导出，无根聚合入口。
 */
module.exports = {
    capability: require('./capability'),
    BaseWindow: require('./enhance/BaseWindow'),
    paths: require('./paths'),
};
