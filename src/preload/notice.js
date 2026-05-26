/**
 * Notice Bridge
 * 提供 window.preload.notice 事件订阅 API
 */

const { contextBridge, ipcRenderer } = require('electron');

// 订阅映射: event -> Set<callback>
const listeners = new Map();

/**
 * 初始化 Notice 桥接
 */
function initNoticeBridge() {
    // 监听主进程发来的事件
    ipcRenderer.on('notice:event', (event, noticeEvent, data) => {
        const cbs = listeners.get(noticeEvent);
        if (cbs) {
            cbs.forEach(cb => cb(data));
        }
    });

    // 暴露 API 到 window.preload.notice
    contextBridge.exposeInMainWorld('preload', {
        notice: {
            /**
             * 订阅事件
             * @param {string} event - 事件名，如 'update.progress'
             * @param {Function} callback - 回调函数
             * @returns {Function} 取消订阅的函数
             */
            on: (event, callback) => {
                if (!listeners.has(event)) {
                    listeners.set(event, new Set());
                }
                listeners.get(event).add(callback);

                // 返回取消订阅函数
                return () => {
                    off(event, callback);
                };
            },

            /**
             * 单次订阅
             * @param {string} event - 事件名
             * @param {Function} callback - 回调函数
             * @returns {Function} 取消订阅的函数
             */
            once: (event, callback) => {
                const wrapper = data => {
                    off(event, wrapper);
                    callback(data);
                };
                if (!listeners.has(event)) {
                    listeners.set(event, new Set());
                }
                listeners.get(event).add(wrapper);

                return () => {
                    off(event, wrapper);
                };
            },

            /**
             * 取消订阅
             * @param {string} event - 事件名
             * @param {Function} [callback] - 特定回调，不传则取消该事件所有订阅
             */
            off: (event, callback) => {
                if (!callback) {
                    // 取消该事件所有订阅
                    listeners.delete(event);
                } else {
                    const cbs = listeners.get(event);
                    if (cbs) {
                        cbs.delete(callback);
                        if (cbs.size === 0) {
                            listeners.delete(event);
                        }
                    }
                }
            }
        }
    });
}

/**
 * 取消订阅（内部使用，由 on/once 返回的函数调用）
 */
function off(event, callback) {
    const cbs = listeners.get(event);
    if (cbs) {
        cbs.delete(callback);
        if (cbs.size === 0) {
            listeners.delete(event);
        }
    }
}

module.exports = { initNoticeBridge };
