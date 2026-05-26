/**
 * Service Bridge
 * 动态生成 window.appService API
 */

const { contextBridge, ipcRenderer } = require('electron');
let serviceSchema = null;
let appService = null;

/**
 * 初始化 Service 桥接
 * 首次 IPC 调用时从主进程获取 schema，动态生成 window.appService
 */
function initServiceBridge() {
    // 提供一个懒加载的 appService，首次调用时获取 schema
    contextBridge.exposeInMainWorld(
        'appService',
        new Proxy(
            {},
            {
                get: (target, namespace) => {
                    // 首次访问 namespace 时，触发 schema 获取
                    if (!serviceSchema) {
                        // 同步等待 schema 获取
                        serviceSchema = ipcRenderer.sendSync(
                            'service:getServiceList'
                        );
                        buildAppService();
                    }

                    if (!appService[namespace]) {
                        console.warn(
                            `[Preload] Service namespace "${namespace}" not found`
                        );
                        return {};
                    }

                    return appService[namespace];
                }
            }
        )
    );
}

/**
 * 根据 schema 动态生成 appService API
 */
function buildAppService() {
    appService = {};

    for (const svc of serviceSchema) {
        const { namespace, handlers } = svc;
        appService[namespace] = {};

        for (const handler of handlers) {
            // 异步调用
            appService[namespace][handler] = (...args) => {
                return ipcRenderer.invoke(`${namespace}:${handler}`, ...args);
            };

            // 同步调用
            appService[namespace][`${handler}Sync`] = (...args) => {
                return ipcRenderer.sendSync(`${namespace}:${handler}`, ...args);
            };
        }
    }
}

module.exports = { initServiceBridge };
