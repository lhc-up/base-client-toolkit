/**
 * 宿主运行时的锚点 key。
 *
 * 宿主 bundle 写、包 bundle 读，各 bundle 各有一份本模块，靠字符串相同经 `Symbol.for`
 * 得到同一个 Symbol。两个字符串一经发布不得修改，否则新旧 bundle 互相找不到。
 *
 * toolkit 源码一律引用这里的常量；构建期映射表达式由 `build` 用它们展开生成。
 */

/** 宿主运行时锚点：`globalThis[Symbol.for(HOST_RUNTIME_KEY)]` */
const HOST_RUNTIME_KEY = 'base-client';

/** 锚点上的 toolkit 子包表：`runtime[Symbol.for(TOOLKIT_KEY)]` */
const TOOLKIT_KEY = 'base-client.toolkit';

module.exports = { HOST_RUNTIME_KEY, TOOLKIT_KEY };
