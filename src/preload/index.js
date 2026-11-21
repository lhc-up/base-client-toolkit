/**
 * preload 聚合入口。
 *
 * 关键契约：若主端未 init Service/Notice，preload 应在 opts 中 opt-out 对应 bridge。
 * 否则元通道 sendSync 没有 listener，preload 会阻塞到主进程 GC（实测约 2–8 秒）后，
 * 对应 bridge 降级（appService 为空对象、appNotice 只有会报错的顶层 API）并 console.warn，
 * 见 `shared/metaChannel.js`。
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
 * 两个 bridge 各自装配：一个抛错不影响另一个，全部尝试后再抛出第一个错误（其余的 console.error）。
 *
 * @throws {Error} 装配失败（主端返回失败信封、namespace 冲突等），或二次调用触发 contextBridge 冲突（违规不防护）
 */
function init(opts = {}) {
    const { service = true, notice = true } = opts;
    const errors = [];
    if (service) {
        try {
            exposeAPI('appService', buildAppService());
        } catch (err) {
            errors.push(err);
        }
    }
    if (notice) {
        try {
            exposeAPI('appNotice', buildAppNotice());
        } catch (err) {
            errors.push(err);
        }
    }
    if (errors.length === 0) return;
    for (const err of errors.slice(1)) {
        console.error('[base-client] preload bridge 装配失败', err);
    }
    throw errors[0];
}

module.exports = { init, exposeAPI };
