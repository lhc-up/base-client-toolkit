import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nodePath = require('node:path');
const os = require('node:os');
const fse = require('fs-extra');
const { createPkgSource } = require('../src/main/libs/pkgSource');

let root;
let copyDir;
let logger;
let update;
let descriptors;

function make() {
    return createPkgSource({
        path: nodePath,
        fse,
        logger,
        update,
        readPkgDescriptor: p => descriptors.get(p) || null,
        getCopyDir: () => copyDir,
    });
}

function writePkg(file, descriptor) {
    fse.outputFileSync(file, 'archive');
    descriptors.set(file, descriptor);
}

const logs = level => logger[level].mock.calls.map(c => c[0]).join('\n');

beforeEach(() => {
    root = fse.mkdtempSync(nodePath.join(os.tmpdir(), 'pkg-source-'));
    copyDir = nodePath.join(root, 'copies');
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    update = { findPkg: vi.fn(() => null) };
    descriptors = new Map();
});
afterEach(() => fse.removeSync(root));

describe('pkgSource.parseDevPkgSources', () => {
    it('空值视为未配置', () => {
        const ps = make();
        expect(ps.parseDevPkgSources('')).toEqual({});
        expect(ps.parseDevPkgSources(undefined)).toEqual({});
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('支持多行 JSON；非法项忽略并记错误，合法项保留', () => {
        const ps = make();
        const result = ps.parseDevPkgSources(`{
            "a": { "type": "devServer", "main": "/a/main/pkg.js", "url": "http://localhost:1/" },
            "b": { "type": "file", "path": "/b.asax" },
            "c": { "type": "semver" },
            "d": { "type": "dev" },
            "e": { "type": "file" }
        }`);
        expect(Object.keys(result)).toEqual(['a', 'b', 'c']);
        expect(logs('error')).toMatch(/d\.type 无效/);
        expect(logs('error')).toMatch(/e（type=file）缺少 path/);
    });

    it('整体不是合法 JSON / 不是对象：全部按默认来源', () => {
        const ps = make();
        expect(ps.parseDevPkgSources('{bad')).toEqual({});
        expect(ps.parseDevPkgSources('[1]')).toEqual({});
        expect(logger.error).toHaveBeenCalledTimes(2);
    });
});

describe('pkgSource.decide', () => {
    it('打包运行：一律 semver，忽略配置', () => {
        const ps = make();
        const source = ps.decide({
            name: 'self', isSelf: true, isHostDev: false,
            devPkgSources: { self: { type: 'file', path: '/x.asax' } },
        });
        expect(source).toEqual({ type: 'semver', from: 'default' });
        expect(logs('info')).toMatch(/self：打包运行，默认来源，type=semver/);
    });

    it('本地调试：自身默认 devServer，其他包默认 semver', () => {
        const main = nodePath.join(root, 'app/main/pkg.js');
        fse.outputFileSync(main, '');
        const ps = make();
        expect(ps.decide({ name: 'self', isSelf: true, isHostDev: true, selfDevServer: { main, url: 'http://localhost:8066/' } }))
            .toEqual({ type: 'devServer', main, url: 'http://localhost:8066/', from: 'default' });
        expect(ps.decide({ name: 'other', isSelf: false, isHostDev: true }))
            .toEqual({ type: 'semver', from: 'default' });
    });

    it('本地调试：配置覆盖默认（自身也可以覆盖为 semver）', () => {
        const ps = make();
        const source = ps.decide({
            name: 'self', isSelf: true, isHostDev: true,
            devPkgSources: { self: { type: 'semver' } },
            selfDevServer: { main: '/none', url: 'http://x/' },
        });
        expect(source).toEqual({ type: 'semver', from: 'config' });
        expect(logs('info')).toMatch(/依据配置 BC_DEV_PKG_SOURCES，type=semver/);
    });

    it('devServer 的 main / file 的 path 不存在时明确报错', () => {
        const ps = make();
        expect(() => ps.decide({
            name: 'a', isSelf: false, isHostDev: true,
            devPkgSources: { a: { type: 'devServer', main: nodePath.join(root, 'none.js'), url: 'http://x/' } },
        })).toThrow(/main 不存在/);
        expect(() => ps.decide({
            name: 'b', isSelf: false, isHostDev: true,
            devPkgSources: { b: { type: 'file', path: nodePath.join(root, 'none.asax') } },
        })).toThrow(/file 指定的包不存在/);
    });

    it('本地调试首次决定前清理旧的临时副本', () => {
        fse.outputFileSync(nodePath.join(copyDir, 'old-1-2.asar'), 'stale');
        const ps = make();
        ps.decide({ name: 'other', isSelf: false, isHostDev: true });
        expect(fse.readdirSync(copyDir)).toEqual([]);
    });
});

describe('pkgSource.prepareFile', () => {
    it('.asax 复制为 .asar 副本；同一文件只复制一次', () => {
        const file = nodePath.join(root, 'Downloads/demo-test-v1.0.0.asax');
        writePkg(file, { name: 'demo', env: 'test', version: '1.0.0' });
        const ps = make();
        const first = ps.prepareFile({ name: 'demo', path: file, env: 'test' });
        expect(first.path).toMatch(/demo-test-v1\.0\.0-\d+-\d+\.asar$/);
        expect(nodePath.dirname(first.path)).toBe(copyDir);
        expect(fse.readFileSync(first.path, 'utf8')).toBe('archive');
        expect(first.sourcePath).toBe(file);
        expect(ps.prepareFile({ name: 'demo', path: file, env: 'test' }).path).toBe(first.path);
        expect(fse.readdirSync(copyDir)).toHaveLength(1);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('.asar 原样加载；名称 / 环境 / 版本不符时照常加载并警告', () => {
        const file = nodePath.join(root, 'demo-prod-v2.0.0.asar');
        writePkg(file, { name: 'demo', env: 'prod', version: '2.0.0' });
        const ps = make();
        const result = ps.prepareFile({ name: 'demo', path: file, env: 'test', version: '1.0.0' });
        expect(result.path).toBe(file);
        expect(logs('warn')).toMatch(/env=prod（预期 test），version=2\.0\.0（预期 1\.0\.0）/);
    });

    it('读不到描述文件时报错', () => {
        const file = nodePath.join(root, 'broken.asax');
        fse.outputFileSync(file, '');
        expect(() => make().prepareFile({ name: 'x', path: file })).toThrow(/不是有效的应用包/);
    });
});

describe('pkgSource.findSemver', () => {
    it('未命中返回 null 并记录期望的环境与版本', () => {
        const ps = make();
        expect(ps.findSemver({ name: 'demo', env: 'test', version: '1.0.0' })).toBeNull();
        expect(update.findPkg).toHaveBeenCalledWith({ name: 'demo', env: 'test', version: '1.0.0' });
        expect(logs('info')).toMatch(/demo：内置目录与下载目录均未命中（期望 test v1\.0\.0）/);
    });

    it('下载目录命中 .asar：原样返回', () => {
        const file = nodePath.join(root, 'updates/demo-test-v1.0.0.asar');
        update.findPkg.mockReturnValue({ name: 'demo', env: 'test', version: '1.0.0', path: file, type: 'update' });
        const found = make().findSemver({ name: 'demo', env: 'test' });
        expect(found).toMatchObject({ path: file, sourcePath: file, type: 'update' });
        expect(logs('info')).toMatch(/demo：下载目录命中 demo-test-v1\.0\.0\.asar/);
    });

    it('本地调试内置目录命中 .asax：复制为副本后返回可加载路径', () => {
        const file = nodePath.join(root, 'resources/packages/demo-test-v1.0.0.asax');
        fse.outputFileSync(file, 'archive');
        update.findPkg.mockReturnValue({ name: 'demo', env: 'test', version: '1.0.0', path: file, type: 'builtin' });
        const found = make().findSemver({ name: 'demo', env: 'test', version: '1.0.0' });
        expect(found.path.endsWith('.asar')).toBe(true);
        expect(found.sourcePath).toBe(file);
        expect(found.type).toBe('builtin');
        expect(logs('info')).toMatch(/内置目录命中 demo-test-v1\.0\.0\.asax/);
    });
});
