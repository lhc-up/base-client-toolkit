/**
 * 用户数据目录按客户端区分：`<系统应用数据目录>/<name>`（name 为 package.json 的 name）。
 *
 * Electron 默认用 `<appData>/<productName>`；productName 相同的不同客户端会共用它，导致：
 * - 单实例锁按用户数据目录加，两个客户端不能同时运行；
 * - 本地存储、资源缓存、热更新包、日志混在一起；
 * - Windows 卸载其中一个时删除 `%APPDATA%\<productName>`，另一个的数据一并被删。
 *
 * 宿主必须在**任何读取用户数据目录的代码之前**调用（单实例检查、toolkit 的 paths / logger / store 等），
 * 一般放在主进程入口的最前面。不迁移旧目录中的数据。
 * Windows 卸载程序（升级除外）会删除 `%APPDATA%\<name>`（electron-builder 的 APP_FILENAME / APP_PACKAGE_NAME），新目录随卸载删除。
 */
const path = require('path');
const { app } = require('electron');

/**
 * @param {string} name 客户端标识（package.json 的 name）
 * @returns {string} 设置后的用户数据目录
 */
function setUserDataDirByName(name) {
    if (typeof name !== 'string' || !name.trim() || /[\/]/.test(name)) {
        throw new TypeError(`用户数据目录名无效：${name}`);
    }
    const dir = path.join(app.getPath('appData'), name);
    app.setPath('userData', dir);
    return dir;
}

module.exports = { setUserDataDirByName };
