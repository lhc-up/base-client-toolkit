/**
 * Preload Bridge 入口
 * 由 BaseWindow 在创建窗口时自动加载
 * 渲染进程通过 window.appService、window.appNotice 访问
 */
const { contextBridge } = require('electron');
const buildAppService = require('./service');
const buildAppNotice = require('./notice');

function exposeAPI(name, api) {
    if (process.contextIsolated) {
        try {
            contextBridge.exposeInMainWorld(name, api);
        } catch (error) {
            console.error(error);
        }
    } else {
        window[name] = api;
    }
}

exposeAPI('appService', buildAppService());
exposeAPI('appNotice', buildAppNotice());

module.exports = {
    exposeAPI,
    buildAppService,
    buildAppNotice
};
