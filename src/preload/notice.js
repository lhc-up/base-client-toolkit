const { ipcRenderer } = require('electron');

/**
 * 根据 schema 动态生成 appNotice API
 * 形如 appNotice[namespace][event].on/once/off(callback)
 */
function buildAppNotice() {
    const noticeSchema = ipcRenderer.sendSync('notice:getSchema');
    const appNotice = {};

    // event 全名（namespace.event）-> Set<callback>
    const listeners = new Map();

    // 单一监听器分发到所有订阅
    ipcRenderer.on('notice:event', (_event, fullEvent, data) => {
        const cbs = listeners.get(fullEvent);
        if (cbs) {
            cbs.forEach(cb => cb(data));
        }
    });

    function off(fullEvent, callback) {
        const cbs = listeners.get(fullEvent);
        if (!cbs) return;
        cbs.delete(callback);
        if (cbs.size === 0) {
            listeners.delete(fullEvent);
        }
    }

    for (const { namespace, events } of noticeSchema) {
        appNotice[namespace] = {};

        for (const eventName of Object.keys(events)) {
            const fullEvent = `${namespace}.${eventName}`;

            appNotice[namespace][eventName] = {
                on(callback) {
                    if (!listeners.has(fullEvent)) {
                        listeners.set(fullEvent, new Set());
                    }
                    listeners.get(fullEvent).add(callback);
                    return () => off(fullEvent, callback);
                },

                once(callback) {
                    const wrapper = data => {
                        off(fullEvent, wrapper);
                        callback(data);
                    };
                    if (!listeners.has(fullEvent)) {
                        listeners.set(fullEvent, new Set());
                    }
                    listeners.get(fullEvent).add(wrapper);
                    return () => off(fullEvent, wrapper);
                },

                off(callback) {
                    if (!callback) {
                        listeners.delete(fullEvent);
                    } else {
                        off(fullEvent, callback);
                    }
                }
            };
        }
    }

    return appNotice;
}

module.exports = buildAppNotice;
