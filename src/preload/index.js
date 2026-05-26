/**
 * Preload Bridge 入口
 * 由 BaseWindow 在创建窗口时自动加载
 * 对用户不可见，渲染进程通过 window.appService 和 window.preload.notice 访问
 */

const { initServiceBridge } = require('./service');
const { initNoticeBridge } = require('./notice');

// 初始化 service 和 notice 桥接
initServiceBridge();
initNoticeBridge();
