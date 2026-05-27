const { ipcRenderer } = require('electron');

/**
 * 根据 schema 动态生成 appService API
 */
function buildAppService() {
    const serviceSchema = ipcRenderer.sendSync('service:getServiceList');
    console.log('serviceSchema', serviceSchema)
    const appService = {};

    for (const service of serviceSchema) {
        const { namespace, handlers } = service;
        appService[namespace] = {};

        for (const handler of handlers) {
            // 异步调用
            appService[namespace][handler] = (...args) => {
                return ipcRenderer.invoke(`${namespace}:${handler}`, ...args);
            };

            // 同步调用
            appService[namespace][`${handler}Sync`] = (...args) => {
                return ipcRenderer.sendSync(`${namespace}:${handler}Sync`, ...args);
            };
        }
    }

    return appService;
}

module.exports = buildAppService;
