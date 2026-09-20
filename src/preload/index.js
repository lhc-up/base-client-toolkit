/**
 * preload 聚合入口。
 *
 * 关键契约：若主端未 init Service/Notice，preload 必须在 opts 中 opt-out 对应 bridge，
 * 否则 buildAppService/buildAppNotice 内的 sendSync 元通道因无 listener
 * 而永久阻塞渲染进程（Electron 无原生 timeout）。
 *
 * init() 应只调用一次 —— 同名 exposeInMainWorld 二次调用会抛错；属违规，不做防护。
 */

const { contextBridge } = require('electron');
const buildAppService = require('../service/preload');
const buildAppNotice = require('../notice/preload');

/**
 * 把一个对象暴露到渲染端 window 命名空间。
 *
 * 兼容 contextIsolation：开启时用 contextBridge，未开启时直接挂到 window。
 * 作为公开辅助函数导出，用户暴露自定义 bridge 时可复用。
 *
 * @param {string} name 渲染端访问名（作为 window[name]）
 * @param {*} api 要暴露的对象或值
 */
function exposeAPI(name, api) {
    if (process.contextIsolated) {
        contextBridge.exposeInMainWorld(name, api);
    } else {
        window[name] = api;
    }
}

/**
 * 装配 toolkit 所有 preload 端 bridge。
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.service=true] 是否装配 appService（对应主端 Service.init）
 * @param {boolean} [opts.notice=true] 是否装配 appNotice（对应主端 Notice.init）
 * @throws {Error} 若二次调用触发 contextBridge 冲突抛错（违规不防护）
 */
function init(opts = {}) {
    const { service = true, notice = true } = opts;
    if (service) exposeAPI('appService', buildAppService());
    if (notice) exposeAPI('appNotice', buildAppNotice());
}

module.exports = { init, exposeAPI };
