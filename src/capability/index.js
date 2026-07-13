/**
 * Toolkit capability 统一入口。
 *
 * 聚合所有 capability 子模块，支持两种接入方式：
 *   1. 统一入口：require('@base-client/toolkit/capability')
 *   2. 精确子路径：require('@base-client/toolkit/capability/logger')
 *
 * 新增 capability 时只需在此文件添加一行 require，无需改动根入口。
 */

const logger = require('./logger');
const os = require('./os');
const shortcut = require('./shortcut');
const singleInstance = require('./singleInstance');
const store = require('./store');
const update = require('./update');

module.exports = {
    logger,
    os,
    shortcut,
    singleInstance,
    store,
    update,
};
