const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

let initialized = false;
let opts = null;
let store = null;

function assertInitialized() {
    if (!initialized) {
        throw new Error('[toolkit/store] Store not initialized');
    }
}

function reportError(err) {
    if (opts.logger && typeof opts.logger.error === 'function') {
        opts.logger.error(err);
    } else {
        console.error(err);
    }
}

/**
 * @param {object} userOpts
 * @param {string} userOpts.storeDir 必填。KV 配置文件与文件形式 KV 的落盘目录（绝对路径）
 * @param {string} [userOpts.storeName='__store__'] electron-store 配置文件名（不含扩展名）
 * @param {object} [userOpts.logger] 具备 error 方法的 logger 实例
 */
function init(userOpts) {
    if (initialized) {
        throw new Error('[toolkit/store] Store already initialized');
    }
    opts = userOpts || {};
    if (!opts.storeDir || typeof opts.storeDir !== 'string') {
        throw new Error('[toolkit/store] init requires opts.storeDir');
    }
    store = new Store({
        cwd: opts.storeDir,
        name: opts.storeName || '__store__',
    });
    initialized = true;
}

// —— KV 级：electron-store ——
function set(key, value) {
    assertInitialized();
    store.set(key, value);
}

function get(key) {
    assertInitialized();
    return store.get(key);
}

function remove(key) {
    assertInitialized();
    return store.delete(key);
}

// —— 文件级：以 key 为文件名的 KV（bake 语义保留） ——
// TODO: 加解密？（bake 原注释）
function setFile(key, value) {
    assertInitialized();
    const filePath = path.join(opts.storeDir, key);
    const _v = typeof value === 'string' ? value : JSON.stringify(value);
    fs.writeFileSync(filePath, _v);
}

function getFile(key) {
    assertInitialized();
    try {
        const filePath = path.join(opts.storeDir, key);
        if (fs.existsSync(filePath)) {
            return fs.readFileSync(filePath).toString();
        }
        return null;
    } catch (err) {
        reportError(err);
    }
}

function removeFile(key) {
    assertInitialized();
    const filePath = path.join(opts.storeDir, key);
    fs.rmSync(filePath, { force: true, recursive: true });
}

module.exports = {
    init,
    set,
    get,
    remove,
    setFile,
    getFile,
    removeFile,
};
