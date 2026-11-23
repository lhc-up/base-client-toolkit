import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const fse = require('fs-extra');
const semver = require('semver');
const { createPkgLib } = require('../src/main/libs/pkg/createPkgLib');
const { PKG_SOURCE } = require('../src/shared/pkgSource');

/**
 * 真实临时目录 + 注入的描述文件读取：包文件内容即描述文件 JSON（不必构造真实归档）。
 */
function createHarness({ runtime = {}, fetchJson, startDownload } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-pkg-'));
    const dirs = {
        builtin: path.join(root, 'resources/packages'),
        update: path.join(root, 'Packages'),
        copies: path.join(root, 'copies'),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const downloads = [];
    const lib = createPkgLib({
        path,
        fse,
        semver,
        logger,
        readPkgDescriptor: file => {
            const text = fs.readFileSync(file, 'utf8');
            return text ? JSON.parse(text) : null;
        },
        fetchJson: fetchJson || (async () => { throw new Error('ECONNREFUSED'); }),
        startDownload: startDownload || (({ urls, destinationPath, onProgress, headers }) => {
            downloads.push({ urls, destinationPath, onProgress, headers });
            return { promise: Promise.resolve(), cancel: () => true };
        }),
        randomUUID: () => 'temp-id',
        createHash,
        toFileUrl: file => pathToFileURL(file).href,
        getHostRuntime: () => runtime,
        getBuiltinDir: () => dirs.builtin,
        getUpdateDir: () => dirs.update,
        getCopyDir: () => dirs.copies,
    });
    const write = (dir, file, descriptor) => {
        const filePath = path.join(dir, file);
        fse.outputFileSync(filePath, JSON.stringify(descriptor));
        return filePath;
    };
    return { root, dirs, lib, logger, downloads, write };
}

const descriptorOf = (name, version, extra = {}) => ({
    name, version, env: 'prod', main: 'main/pkg.js', renderer: 'renderer/index.html', ...extra,
});

let harness;
afterEach(() => {
    if (harness) fse.removeSync(harness.root);
    harness = null;
});

describe('libs/pkg parseDevSources', () => {
    beforeEach(() => { harness = createHarness(); });

    it('合法项保留；devServer 需要 url，file 需要 path；格式错误的项忽略', () => {
        const result = harness.lib.parseDevSources(JSON.stringify({
            a: { type: 'devServer', url: 'http://localhost:8023/' },
            b: { type: 'file', path: 'D:/x.asax' },
            c: { type: 'semver' },
            d: { type: 'devServer', main: 'D:/app/main/pkg.js' },
            e: { type: 'unknown' },
        }));
        expect(Object.keys(result)).toEqual(['a', 'b', 'c']);
        expect(harness.logger.error).toHaveBeenCalledTimes(2);
    });

    it('空值视为未配置；非法 JSON 整体忽略', () => {
        expect(harness.lib.parseDevSources(undefined)).toEqual({});
        expect(harness.lib.parseDevSources('  ')).toEqual({});
        expect(harness.lib.parseDevSources('{')).toEqual({});
    });
});

describe('libs/pkg get：semver', () => {
    beforeEach(() => { harness = createHarness(); });

    it('给版本找该版本，同版本内置优先；入口按包根目录拼成完整值', async () => {
        const { dirs, lib, write } = harness;
        const builtin = write(dirs.builtin, 'demo-prod-v1.0.0.asar', descriptorOf('demo', '1.0.0', { update: 'renderer/update.html' }));
        write(dirs.update, 'demo-prod-v1.0.0.asar', descriptorOf('demo', '1.0.0'));

        const pkg = await lib.get('demo', { env: 'prod', version: '1.0.0' });
        expect(pkg).toEqual({
            name: 'demo',
            version: '1.0.0',
            env: 'prod',
            source: PKG_SOURCE.SEMVER,
            main: path.join(builtin, 'main/pkg.js'),
            renderer: pathToFileURL(path.join(builtin, 'renderer/index.html')).href,
            update: pathToFileURL(path.join(builtin, 'renderer/update.html')).href,
        });
    });

    it('不给版本取最新；没有启动页时不带 update', async () => {
        const { dirs, lib, write } = harness;
        write(dirs.builtin, 'demo-prod-v1.0.0.asar', descriptorOf('demo', '1.0.0'));
        const newer = write(dirs.update, 'demo-prod-v1.1.0.asar', descriptorOf('demo', '1.1.0'));

        const pkg = await lib.get('demo', { env: 'prod' });
        expect(pkg.version).toBe('1.1.0');
        expect(pkg.main).toBe(path.join(newer, 'main/pkg.js'));
        expect('update' in pkg).toBe(false);
    });

    it('名称、环境、版本不符或目录为空时返回 null', async () => {
        const { dirs, lib, write } = harness;
        write(dirs.builtin, 'other-prod-v1.0.0.asar', descriptorOf('other', '1.0.0'));
        write(dirs.update, 'demo-test-v1.0.0.asar', { ...descriptorOf('demo', '1.0.0'), env: 'test' });
        expect(await lib.get('demo', { env: 'prod' })).toBeNull();
        expect(await lib.get('demo', { env: 'prod', version: '9.9.9' })).toBeNull();
    });

    it('内置目录中的 .asax 复制为 .asar 副本后加载；下载目录不认 .asax', async () => {
        const { dirs, lib, write } = harness;
        write(dirs.builtin, 'demo-prod-v1.0.0.asax', descriptorOf('demo', '1.0.0'));
        write(dirs.update, 'demo-prod-v2.0.0.asax', descriptorOf('demo', '2.0.0'));

        const pkg = await lib.get('demo', { env: 'prod' });
        expect(pkg.version).toBe('1.0.0');
        expect(path.dirname(path.dirname(pkg.main))).toMatch(/demo-prod-v1\.0\.0-\d+-\d+\.asar$/);
        expect(path.dirname(path.dirname(pkg.main)).startsWith(dirs.copies)).toBe(true);
    });

    it('描述文件缺少入口时报错', async () => {
        const { dirs, lib, write } = harness;
        write(dirs.builtin, 'demo-prod-v1.0.0.asar', { name: 'demo', version: '1.0.0', env: 'prod', main: 'main/pkg.js' });
        await expect(lib.get('demo', { env: 'prod' })).rejects.toThrow(/描述文件缺少 renderer/);
    });

    it('打包运行忽略 devPkgSources', async () => {
        harness = createHarness({ runtime: { isHostDev: false, devPkgSources: { demo: { type: 'devServer', url: 'http://x/' } } } });
        harness.write(harness.dirs.builtin, 'demo-prod-v1.0.0.asar', descriptorOf('demo', '1.0.0'));
        const pkg = await harness.lib.get('demo', { env: 'prod' });
        expect(pkg.source).toBe(PKG_SOURCE.SEMVER);
    });
});

describe('libs/pkg get：devServer / file', () => {
    it('devServer：读 dev server 根地址下的描述文件，入口原样使用，忽略版本', async () => {
        const fetchJson = vi.fn(async () => ({
            name: 'demo', version: '1.0.0', env: 'prod',
            main: 'D:/proj/app/main/pkg.js',
            renderer: 'http://localhost:8023/index.html',
            update: 'http://localhost:8023/update.html',
        }));
        harness = createHarness({
            runtime: { isHostDev: true, devPkgSources: { demo: { type: 'devServer', url: 'http://localhost:8023/' } } },
            fetchJson,
        });
        const pkg = await harness.lib.get('demo', { env: 'prod', version: '9.9.9' });
        expect(fetchJson).toHaveBeenCalledWith('http://localhost:8023/package.json');
        expect(pkg).toEqual({
            name: 'demo', version: '1.0.0', env: 'prod',
            source: PKG_SOURCE.DEV_SERVER,
            main: 'D:/proj/app/main/pkg.js',
            renderer: 'http://localhost:8023/index.html',
            update: 'http://localhost:8023/update.html',
        });
    });

    it('调用方指定来源时不按来源规则', async () => {
        const fetchJson = vi.fn(async () => descriptorOf('demo', '1.0.0', {
            main: 'D:/proj/app/main/pkg.js', renderer: 'http://localhost:8066/index.html',
        }));
        harness = createHarness({ runtime: { isHostDev: true, devPkgSources: {} }, fetchJson });
        const pkg = await harness.lib.get('demo', {
            env: 'prod', source: { type: PKG_SOURCE.DEV_SERVER, url: 'http://localhost:8066/' },
        });
        expect(fetchJson).toHaveBeenCalledWith('http://localhost:8066/package.json');
        expect(pkg.source).toBe(PKG_SOURCE.DEV_SERVER);
    });

    it('devServer：dev server 未启动时明确报错', async () => {
        harness = createHarness({
            runtime: { isHostDev: true, devPkgSources: { demo: { type: 'devServer', url: 'http://localhost:8023/' } } },
        });
        await expect(harness.lib.get('demo', { env: 'prod' })).rejects.toThrow(/dev server 未启动或不可访问：http:\/\/localhost:8023\/package\.json/);
    });

    it('file：读指定的包（.asax 复制为副本），与预期不符时照常加载并警告；文件不存在时报错', async () => {
        const runtime = { isHostDev: true, devPkgSources: {} };
        harness = createHarness({ runtime });
        const file = harness.write(harness.root, 'x/demo-test-v3.0.0.asax', { ...descriptorOf('demo', '3.0.0'), env: 'test' });
        runtime.devPkgSources.demo = { type: 'file', path: file };

        const pkg = await harness.lib.get('demo', { env: 'prod', version: '1.0.0' });
        expect(pkg.source).toBe(PKG_SOURCE.FILE);
        expect(pkg.version).toBe('3.0.0');
        expect(path.dirname(path.dirname(pkg.main)).startsWith(harness.dirs.copies)).toBe(true);
        expect(harness.logger.warn).toHaveBeenCalledWith(expect.stringContaining('env=test（预期 prod）'));

        fs.rmSync(file);
        await expect(harness.lib.get('demo', { env: 'prod' })).rejects.toThrow(/file 指定的包不存在/);
    });
});

/** 下载目录中的正式文件（不含下载中的临时目录 .downloading） */
const listUpdate = dir => fs.readdirSync(dir).filter(name => name !== '.downloading');

describe('libs/pkg download', () => {
    /** 下载底座把描述文件写到临时文件 */
    function downloader(descriptor, calls = []) {
        return ({ urls, destinationPath, onProgress, headers }) => {
            calls.push({ urls, destinationPath, onProgress, headers });
            fse.outputFileSync(destinationPath, JSON.stringify(descriptor));
            return { promise: Promise.resolve(), cancel: () => true };
        };
    }

    it('下载到下载目录并改名为 .asar，返回包信息；默认 no-cache，透传 onProgress', async () => {
        const calls = [];
        harness = createHarness({ startDownload: downloader(descriptorOf('demo', '1.2.0'), calls) });
        const onProgress = () => {};
        const pkg = await harness.lib.download({
            url: 'https://x/demo-prod-v1.2.0.asax?sig=1', name: 'demo', env: 'prod', version: '1.2.0', onProgress,
        });
        const finalPath = path.join(harness.dirs.update, 'demo-prod-v1.2.0.asar');
        expect(pkg).toMatchObject({ name: 'demo', version: '1.2.0', source: PKG_SOURCE.SEMVER, main: path.join(finalPath, 'main/pkg.js') });
        expect(listUpdate(harness.dirs.update)).toEqual(['demo-prod-v1.2.0.asar']);
        expect(calls[0]).toMatchObject({
            urls: ['https://x/demo-prod-v1.2.0.asax?sig=1'],
            destinationPath: path.join(harness.dirs.update, '.downloading', 'temp-id'),
            onProgress,
            headers: { 'Cache-Control': 'no-cache' },
        });
    });

    it('下载的包与预期不符时删除文件并抛错', async () => {
        harness = createHarness({ startDownload: downloader(descriptorOf('demo', '1.1.0')) });
        await expect(harness.lib.download({ url: 'https://x/demo-prod-v1.2.0.asax', name: 'demo', env: 'prod', version: '1.2.0' }))
            .rejects.toThrow(/version=1\.1\.0（预期 1\.2\.0）/);
        expect(listUpdate(harness.dirs.update)).toEqual([]);
    });

    it('下载失败时删除临时文件并透传异常', async () => {
        const failure = new Error('network down');
        harness = createHarness({
            startDownload: ({ destinationPath }) => {
                fse.outputFileSync(destinationPath, 'partial');
                return { promise: Promise.reject(failure), cancel: () => true };
            },
        });
        await expect(harness.lib.download({ url: 'https://x/a.asax', name: 'demo', env: 'prod' })).rejects.toBe(failure);
        expect(listUpdate(harness.dirs.update)).toEqual([]);
        expect(fs.readdirSync(path.join(harness.dirs.update, '.downloading'))).toEqual([]);
    });

    it('给了 integrity 时校验，不符时不落盘', async () => {
        const descriptor = descriptorOf('demo', '1.2.0');
        harness = createHarness({ startDownload: downloader(descriptor) });
        const digest = createHash('sha256').update(JSON.stringify(descriptor)).digest('hex');
        await expect(harness.lib.download({ url: 'https://x/a.asax', name: 'demo', env: 'prod', integrity: `sha256-${digest}` }))
            .resolves.toMatchObject({ version: '1.2.0' });
        await expect(harness.lib.download({ url: 'https://x/b.asax', name: 'demo', env: 'prod', integrity: '0'.repeat(64) }))
            .rejects.toThrow(/完整性校验失败/);
        expect(listUpdate(harness.dirs.update)).toEqual(['a.asar']);
    });

    it('第一次下载前清空 .downloading/ 并删除旧版本留下的临时文件，正式的包保留', async () => {
        harness = createHarness({ startDownload: downloader(descriptorOf('demo', '1.2.0')) });
        const { update } = harness.dirs;
        const uuid = '1c9fd8e3-09d1-4fae-9084-08d0f4831f27';
        fse.outputFileSync(path.join(update, '.downloading', 'stale'), 'partial');
        fse.outputFileSync(path.join(update, `${uuid}.tmp-879d1432-4cac-46f3-9a6e-4904d0bc4318`), 'partial');
        fse.outputFileSync(path.join(update, uuid), 'partial');
        harness.write(update, 'old-prod-v1.0.0.asar', descriptorOf('old', '1.0.0'));
        fse.outputFileSync(path.join(update, 'notes.txt'), 'keep');

        await harness.lib.download({ url: 'https://x/demo-prod-v1.2.0.asax', name: 'demo', env: 'prod' });

        expect(listUpdate(update).sort()).toEqual(['demo-prod-v1.2.0.asar', 'notes.txt', 'old-prod-v1.0.0.asar']);
        expect(fs.readdirSync(path.join(update, '.downloading'))).toEqual([]);
    });

    it('同一次运行只在第一次下载前清理，之后的下载不再清（可能有下载正在写入）', async () => {
        harness = createHarness({ startDownload: downloader(descriptorOf('demo', '1.2.0')) });
        const staging = path.join(harness.dirs.update, '.downloading');
        await harness.lib.download({ url: 'https://x/a.asax', name: 'demo', env: 'prod' });
        fse.outputFileSync(path.join(staging, 'in-progress'), 'writing');
        await harness.lib.download({ url: 'https://x/b.asax', name: 'demo', env: 'prod' });
        expect(fs.readdirSync(staging)).toEqual(['in-progress']);
    });

    it('选包时不认下载中的临时目录', async () => {
        harness = createHarness();
        fse.outputFileSync(path.join(harness.dirs.update, '.downloading', 'x.asar'), JSON.stringify(descriptorOf('demo', '9.9.9')));
        await expect(harness.lib.get('demo', { env: 'prod' })).resolves.toBeNull();
    });

    it('只接受 .asax / .asar 地址', async () => {
        harness = createHarness();
        await expect(harness.lib.download({ url: 'https://x/a.zip', name: 'demo', env: 'prod' })).rejects.toThrow(/只接受/);
    });
});

describe('libs/pkg removeOtherVersions', () => {
    beforeEach(() => { harness = createHarness(); });

    it('删除下载目录中同名的其他版本，保留该版本、其他包与内置目录', async () => {
        const { dirs, lib, write } = harness;
        write(dirs.builtin, 'demo-prod-v1.0.0.asar', descriptorOf('demo', '1.0.0'));
        write(dirs.update, 'demo-prod-v1.1.0.asar', descriptorOf('demo', '1.1.0'));
        write(dirs.update, 'demo-prod-v1.2.0.asar', descriptorOf('demo', '1.2.0'));
        write(dirs.update, 'other-prod-v1.0.0.asar', descriptorOf('other', '1.0.0'));

        const pkg = await lib.get('demo', { env: 'prod', version: '1.2.0' });
        expect(lib.removeOtherVersions(pkg)).toEqual({ removed: 1 });
        expect(fs.readdirSync(dirs.update).sort()).toEqual(['demo-prod-v1.2.0.asar', 'other-prod-v1.0.0.asar']);
        expect(fs.readdirSync(dirs.builtin)).toEqual(['demo-prod-v1.0.0.asar']);
    });

    it('非 semver 来源不处理', () => {
        const { dirs, lib, write } = harness;
        write(dirs.update, 'demo-prod-v1.1.0.asar', descriptorOf('demo', '1.1.0'));
        expect(lib.removeOtherVersions({ name: 'demo', version: '1.0.0', source: PKG_SOURCE.DEV_SERVER })).toEqual({ removed: 0 });
        expect(fs.readdirSync(dirs.update)).toEqual(['demo-prod-v1.1.0.asar']);
    });
});
