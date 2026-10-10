const fs = require('node:fs');
const path = require('node:path');
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

describe('toolkit runtime package boundary', () => {
    it('exposes explicit runtime subpaths without a root aggregate export', () => {
        const exports = packageJson.exports;
        expect(exports['.']).toBeUndefined();
        expect(exports['./main']).toBe('./src/main/index.js');
        expect(exports['./main/capability/*']).toBe('./src/main/capability/*/index.js');
        expect(exports['./main/enhance/*']).toBe('./src/main/enhance/*.js');
        expect(exports['./main/libs/archive']).toBe('./src/main/libs/archive/index.js');
        expect(exports['./main/libs/download']).toBe('./src/main/libs/download/index.js');
        expect(exports['./main/libs/integrity']).toBe('./src/main/libs/integrity/index.js');
        expect(exports['./main/libs/scope']).toBe('./src/main/libs/scope/index.js');
        expect(exports['./main/libs/sm4']).toBe('./src/main/libs/sm4/index.js');
        expect(exports['./main/libs/*']).toBe('./src/main/libs/*.js');
        expect(exports['./main/paths']).toBe('./src/main/paths.js');
        expect(exports['./service']).toBe('./src/service/main.js');
        expect(exports['./notice']).toBe('./src/notice/main.js');
        expect(exports['./shared']).toBe('./src/shared/index.js');
        expect(exports['./preload']).toBe('./src/preload/index.js');
    });

    it('has separate main and preload entry files', () => {
        expect(fs.existsSync(path.join(root, 'src/main/index.js'))).toBe(true);
        expect(fs.existsSync(path.join(root, 'src/preload/index.js'))).toBe(true);
    });

    // unzipper 必须走深层子路径，**原因是构建硬约束、不是体积优化**：根入口
    // `unzipper/unzip.js` 的 `exports.Open = require('./lib/Open')` 链上要
    // `@aws-sdk/client-s3`（支持直读 S3 上的 zip），那是 unzipper 的 optional 依赖、
    // 默认不装，webpack 静态解析找不到即报错 —— 消费方的 main 分段会直接编译失败。
    // 2026-10-09 实测验证过：改成根导入后业务仓 `dev:app` 的 main 编译立刻挂掉。
    // 本条断言连同这段说明一起保留，避免再有人"为了可读性"把它改回根导入。
    // archiver 没有这个问题，用根导入。
    it('imports unzipper via deep path to avoid its optional @aws-sdk dependency', () => {
        const source = fs.readFileSync(path.join(root, 'src/main/libs/archive/index.js'), 'utf8');
        expect(source).toContain("require('unzipper/lib/parse')");
        expect(source).not.toMatch(/require\('unzipper'\)/);
        expect(source).toContain("require('archiver')");
    });

    it('keeps shared modules free of runtime-only imports', () => {
        const sharedRoot = path.join(root, 'src/shared');
        const files = [];
        const visit = directory => {
            for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                const filePath = path.join(directory, entry.name);
                if (entry.isDirectory()) visit(filePath);
                else if (entry.name.endsWith('.js')) files.push(filePath);
            }
        };
        visit(sharedRoot);
        for (const filePath of files) {
            const source = fs.readFileSync(filePath, 'utf8');
            expect(source).not.toMatch(/require\(['"](?:electron|node:|fs|fs-extra|child_process|path|crypto)/);
        }
    });
});
