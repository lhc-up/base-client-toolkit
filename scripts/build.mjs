// 极简 build：src → dist 直接复制（排除测试与 __example）
// 源已是合法 CJS、依赖（electron / lodash.merge / fs-extra）由 runtime 解析，
// 无需 bundler 转换。Rollup 对 "纯 CJS 源 + CJS 输出" 强制加 lazy-require 包装，
// 反而产生臃肿的 *2.js / _virtual/ 结构，不如直接 copy。

import { copy, remove } from 'fs-extra';
import path from 'node:path';

const SRC = 'src';
const DIST = 'dist';
const EXCLUDE_DIRS = ['__tests__', '__example'];

await remove(DIST);
await copy(SRC, DIST, {
    filter: src => {
        const norm = src.replaceAll(path.sep, '/');
        for (const dir of EXCLUDE_DIRS) {
            if (norm.includes(`/${dir}/`) || norm.endsWith(`/${dir}`)) return false;
        }
        return true;
    },
});
console.log(`build: ${SRC}/ → ${DIST}/ (excluding ${EXCLUDE_DIRS.join(', ')})`);
