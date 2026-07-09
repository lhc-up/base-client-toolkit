/**
 * Toolkit T-07: capability/store
 *
 * 完全照搬 base-client.bake src/main/libs/store.js。
 * 顶层：new Store({ cwd: filePathConfig.store, name: '__store__' })。
 * 无 init —— 业务侧要改 store 目录，在 require 本模块之前调 shared/paths.setPathConfig({ store: '...' })。
 */

const fse = require('fs-extra');
const path = require('path');
const logger = require('../logger');
const { getFilePathConfig } = require('../../paths');

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
