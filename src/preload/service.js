const { ipcRenderer } = require('electron');
const { serialize } = require('../shared/serializer');
const { reviveError } = require('../shared/serializer/reviveError');

const REPLY_ERROR_KEY = '__ipcError';

function tryParseRemoteError(err) {
    // Electron wraps the main-process thrown Error so that on the renderer side
    // err.message looks like: "Error invoking remote method 'ns:handler': Error: {...json...}"
    if (!err || typeof err.message !== 'string') return null;
    const match = err.message.match(/(\{[\s\S]*\}|\[[\s\S]*\])\s*$/);
    if (!match) return null;
    try {
        return JSON.parse(match[1]);
    } catch (_) {
        return null;
    }
}

function buildAppService() {
    const serviceSchema = ipcRenderer.sendSync('service:getServiceList');
    const appService = {};

    for (const service of serviceSchema) {
        const { namespace, handlers } = service;
        appService[namespace] = {};

        for (const handler of handlers) {
            // 异步
            appService[namespace][handler] = async (...args) => {
                const safeArgs = args.map(a => serialize(a, { strict: false }));
                try {
                    return await ipcRenderer.invoke(`${namespace}:${handler}`, ...safeArgs);
                } catch (e) {
                    const parsed = tryParseRemoteError(e);
                    if (parsed) throw reviveError(parsed);
                    throw e;
                }
            };

            // 同步
            appService[namespace][`${handler}Sync`] = (...args) => {
                const safeArgs = args.map(a => serialize(a, { strict: false }));
                const result = ipcRenderer.sendSync(`${namespace}:${handler}Sync`, ...safeArgs);
                if (result && typeof result === 'object' && result[REPLY_ERROR_KEY]) {
                    throw reviveError(result);
                }
                return result;
            };
        }
    }

    return appService;
}

module.exports = buildAppService;
