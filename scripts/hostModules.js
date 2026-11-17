/**
 * 生成 `src/host/modules.js`：宿主运行时中的 toolkit 全量子包表。
 *
 * 唯一来源是 `package.json#exports`：通配项展开为实际存在的文件，显式项优先，
 * 再去掉不映射的子路径（宿主专用、包专用、构建期与 preload 相关）。
 *
 * 用法：`npm run gen:host-modules`。测试会校验提交的文件与本脚本的计算结果一致。
 */
const fs = require('fs');
const path = require('path');

// 不进入子包表的子路径：直接复用构建期映射的不映射范围，保证两边一致
const { NOT_MAPPED } = require('../src/build');

const OUTPUT = 'src/host/modules.js';

function toPosix(p) {
    return p.split(path.sep).join('/');
}

/**
 * 展开 exports 为 `{ subpath, target }` 列表（target 为相对包根的 posix 路径）。
 *
 * @param {string} rootDir 包根目录
 * @returns {{ subpath: string, target: string }[]} 按 subpath 排序
 */
function expandMappedSubpaths(rootDir) {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    const result = new Map();
    const explicit = new Set();

    const add = (subpath, target, isExplicit) => {
        if (NOT_MAPPED.has(subpath)) return;
        if (!isExplicit && explicit.has(subpath)) return;
        result.set(subpath, toPosix(path.normalize(target)));
    };

    const entries = Object.entries(pkg.exports);
    for (const [key, target] of entries) {
        if (!key.includes('*')) {
            explicit.add(key.slice(2));
            add(key.slice(2), target, true);
        }
    }
    for (const [key, target] of entries) {
        if (!key.includes('*')) continue;
        const [prefix, suffix] = target.split('*');
        const dir = path.join(rootDir, prefix);
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir)) {
            let name;
            if (suffix.startsWith('/')) {
                name = entry;
            } else if (entry.endsWith(suffix)) {
                name = entry.slice(0, -suffix.length);
            } else {
                continue;
            }
            const file = path.join(rootDir, prefix + name + suffix);
            if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
            add(key.slice(2).replace('*', name), prefix + name + suffix, false);
        }
    }

    return [...result.entries()]
        .map(([subpath, target]) => ({ subpath, target }))
        .sort((a, b) => a.subpath.localeCompare(b.subpath));
}

/**
 * 生成 `src/host/modules.js` 的文件内容。
 *
 * @param {{ subpath: string, target: string }[]} list
 * @returns {string}
 */
function renderModulesFile(list) {
    const lines = list.map(({ target, subpath }) => {
        const rel = toPosix(path.posix.relative('src/host', target.replace(/^\.\//, '')));
        const request = rel.startsWith('.') ? rel : `./${rel}`;
        return `    get ${JSON.stringify(subpath)}() { return require(${JSON.stringify(request)}); },`;
    });
    return [
        '/**',
        ' * toolkit 全量子包表（宿主运行时使用）。',
        ' *',
        ' * 由 `scripts/hostModules.js` 根据 package.json#exports 生成，勿手改；',
        ' * 新增或删除子包后执行 `npm run gen:host-modules`。',
        ' *',
        ' * getter 惰性加载：首次访问才 require，未用到的子包不执行顶层代码。',
        ' * 静态 require 让 webpack 把全量 toolkit 打进宿主 bundle。',
        ' */',
        'module.exports = {',
        ...lines,
        '};',
        '',
    ].join('\n');
}

if (require.main === module) {
    const rootDir = path.resolve(__dirname, '..');
    const content = renderModulesFile(expandMappedSubpaths(rootDir));
    fs.mkdirSync(path.join(rootDir, 'src/host'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, OUTPUT), content);
    console.log(`written ${OUTPUT}`);
}

module.exports = { expandMappedSubpaths, renderModulesFile, NOT_MAPPED, OUTPUT };
