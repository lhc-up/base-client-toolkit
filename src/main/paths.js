/**
 * 路径配置：toolkit 内所有 capability 消费的默认路径规范。
 *
 * 首次 require 本模块或首次调用 getFilePathConfig() 时：
 * - 读 electron.app.getPath('userData') 决定基础目录
 * - fse.ensureDirSync 建齐所有 Store/Resource/Packages/Logs 目录
 * - 缓存结果
 *
 * 业务侧可在**任何 capability 首次被 require 之前**调用 setPathConfig(override) 覆盖部分字段。
 * 覆盖后再调 getFilePathConfig() 返回合并后的配置。
 */

const { app } = require('electron');
const path = require('path');
const fse = require('fs-extra');
const { getResourceRoot } = require('./libs/resourceRoot');

let cachedConfig = null;

function computeDefault() {
    const USER_DATA_PATH = app.getPath('userData');
    const resolve = p => path.join(USER_DATA_PATH, 'UserData', p);
    const cfg = {
        // 本地存储：localStorage、单独文件形式的 localStorage
        store: resolve('Store'),
        // 资源缓存
        storageResource: resolve('Resource'),
        updatePackage: resolve('Packages'),
        log: resolve('Logs'),
        temp: app.getPath('temp'),
        // 资源根目录：与 main/libs/resourceRoot 同一概念（本地调试为项目的 resources/，打包运行为 process.resourcesPath）
        appResource: getResourceRoot(),
    };
    return cfg;
}

function ensureAll(cfg) {
    fse.ensureDirSync(cfg.store);
    fse.ensureDirSync(cfg.storageResource);
    fse.ensureDirSync(cfg.updatePackage);
    fse.ensureDirSync(cfg.log);
}

/**
 * 覆盖默认路径。必须在任何 capability 被 require 之前调用。
 * 只需传要覆盖的字段。
 * @param {Partial<{ store: string, storageResource: string, updatePackage: string, log: string, temp: string, appResource: string }>} override
 */
function setPathConfig(override) {
    if (!override || typeof override !== 'object') return;
    const base = cachedConfig || computeDefault();
    cachedConfig = { ...base, ...override };
    ensureAll(cachedConfig);
}

/**
 * 返回当前生效的路径配置。首次调用时求值并 ensureDirSync 所有子目录。
 * @returns {{ store: string, storageResource: string, updatePackage: string, log: string, temp: string, appResource: string }}
 */
function getFilePathConfig() {
    if (!cachedConfig) {
        cachedConfig = computeDefault();
        ensureAll(cachedConfig);
    }
    return cachedConfig;
}

module.exports = {
    getFilePathConfig,
    setPathConfig,
};
