/**
 * 与 frame 的约定：frame 打包时按这几个名字放置文件，toolkit 运行时按同样的名字读取。
 *
 * 两个包互不依赖，无法共享代码（frame 侧定义在 `src/paths.js`）。改动时两边必须同时改，两边的单测都断言这些值。
 */

/** 包描述文件名：包根目录下（以及本地调试时 dev server 根地址下）的描述文件 */
const DESCRIPTOR_FILE = 'package.json';
/** 资源目录：本地调试时为项目根目录下的 resources/，打包后为安装包的 resources/ */
const RESOURCES_DIR = 'resources';
/** 资源目录下放内置包的子目录 */
const BUILTIN_PKG_DIR = 'packages';

module.exports = { DESCRIPTOR_FILE, RESOURCES_DIR, BUILTIN_PKG_DIR };
