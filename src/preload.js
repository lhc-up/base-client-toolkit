// preload 聚合入口（per overview §8.2）
// 关键契约：若主端未 init Service/Notice，preload 必须在 opts 中 opt-out 对应 bridge，
// 否则 buildAppService/buildAppNotice 内的 sendSync 元通道因无 listener 而永久阻塞渲染进程。
// init() 应只调用一次——同名 exposeInMainWorld 二次调用会抛错；属违规，不做防护。

const { contextBridge } = require('electron');
const buildAppService = require('./service/preload');
const buildAppNotice = require('./notice/preload');

function exposeAPI(name, api) {
    if (process.contextIsolated) {
        contextBridge.exposeInMainWorld(name, api);
    } else {
        window[name] = api;
    }
}

function init(opts = {}) {
    const { service = true, notice = true } = opts;
    if (service) exposeAPI('appService', buildAppService());
    if (notice) exposeAPI('appNotice', buildAppNotice());
}

module.exports = { init, exposeAPI };
