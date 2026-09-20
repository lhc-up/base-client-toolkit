/**
 * 持久存储：electron-store KV + 独立文件两种形态。
 * 顶层即创建 Store 实例（cwd 取 paths 配置的 store 目录），无 init。
 * 坑：业务侧要改存储目录，必须在 require 本模块之前调用 setPathConfig({ store: '...' })。
 */

const fse = require('fs-extra');
const path = require('path');
const logger = require('./logger');
const { getFilePathConfig } = require('../paths');

const filePathConfig = getFilePathConfig();

const Store = require('electron-store');
const store = new Store({
    cwd: filePathConfig.store,
    name: '__store__',
});

function set(key, value) {
    store.set(key, value);
}

function get(key) {
    return store.get(key);
}

function remove(key) {
    return store.delete(key);
}

// TODO: 加解密？
function setFile(key, value) {
    const filePath = path.join(filePathConfig.store, key);
    const _v = typeof value === 'string' ? value : JSON.stringify(value);
    fse.writeFileSync(filePath, _v);
}

function getFile(key) {
    try {
        const filePath = path.join(filePathConfig.store, key);
        if (fse.existsSync(filePath)) {
            return fse.readFileSync(filePath).toString();
        }
        return null;
    } catch (err) {
        logger.error('获取文件失败', err);
    }
}

function removeFile(key) {
    const filePath = path.join(filePathConfig.store, key);
    fse.removeSync(filePath);
}

module.exports = {
    set,
    get,
    remove,
    setFile,
    getFile,
    removeFile,
};
