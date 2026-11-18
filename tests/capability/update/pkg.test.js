import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const nodePath = require('node:path');
const { createUpdateCapability } = require('../../../src/main/capability/update/createUpdateCapability');

const UPDATES = '/updates';
const BUILTIN = '/resources/packages';

/**
 * 内存文件系统：目录条目由已登记的文件路径推导；`xxx.asar/package.json` 按描述文件登记。
 */
function createHarness({ builtinPackageDir = BUILTIN, pkgs = [], locked = [] } = {}) {
    const calls = [];
    const files = new Map();
    let uuid = 0;
    for (const { dir, file, json } of pkgs) {
        const asar = nodePath.join(dir, file);
        files.set(asar, Buffer.from('asar'));
        files.set(nodePath.join(asar, 'package.json'), json);
    }
    // 测试在 Windows 上跑时 path 为 win32，'/updates' 与 join 出的 '\updates' 要规范化后再比
    const same = (a, b) => nodePath.normalize(a) === nodePath.normalize(b);
    const listDir = dir => [...new Set([...files.keys()]
        .filter(f => same(nodePath.dirname(f), dir))
        .map(f => nodePath.basename(f)))];

    const fse = {
        ensureDirSync: dir => calls.push(['ensureDir', dir]),
        readdirSync: dir => listDir(dir),
        existsSync: file => files.has(nodePath.normalize(file))
            || [...files.keys()].some(f => same(nodePath.dirname(f), file)),
        readJSONSync: file => files.get(file),
        readFileSync: file => files.get(file),
        copyFileSync: (from, to) => files.set(to, files.get(from)),
        renameSync: (from, to) => {
            calls.push(['rename', from, to]);
            for (const key of [...files.keys()]) {
                if (key === from || key.startsWith(from + nodePath.sep)) {
                    files.set(to + key.slice(from.length), files.get(key));
                    files.delete(key);
                }
            }
        },
        removeSync: file => {
            calls.push(['remove', file]);
            // 模拟 Windows 下被 Electron 持有句柄的包：removeSync 静默不删
            if (locked.includes(file)) return;
            for (const key of [...files.keys()]) {
                if (key === file || key.startsWith(file + nodePath.sep)) files.delete(key);
            }
        },
    };
    const update = createUpdateCapability({
        path: nodePath,
        fse,
        semver: require('semver'),
        startDownload: ({ destinationPath }) => ({
            promise: (async () => { files.set(destinationPath, Buffer.from('payload')); })(),
            cancel: () => true,
        }),
        randomUUID: () => `uuid-${++uuid}`,
        createHash,
        execFile: vi.fn(),
        app: { exit: vi.fn() },
        dialog: { showErrorBox: vi.fn() },
        shell: { openPath: vi.fn() },
        logger: { info: vi.fn(), error: vi.fn(), shutdown: vi.fn() },
        os: { isLinux: () => false, isLoongnix: () => false, isWindows: () => true, isMacOS: () => false },
        filePathConfig: { updatePackage: UPDATES, temp: 'C:\\Temp' },
        loadSudoPrompt: () => ({ exec: vi.fn() }),
        setTimeout: fn => fn(),
        builtinPackageDir,
        readPkgDescriptor: pkgPath => {
            calls.push(['readDescriptor', pkgPath]);
            return files.get(nodePath.join(pkgPath, 'package.json')) || null;
        },
    });
    return { calls, files, update };
}

const pkg = (dir, name, version, env = 'prod') => ({
    dir,
    file: `${name}-${env}-v${version}.asar`,
    json: { name, version, env },
});

describe('update.findPkg', () => {
    it('returns newest matching package across builtin and download dirs', () => {
        const { update } = createHarness({ pkgs: [
            pkg(BUILTIN, 'demo', '1.0.0'),
            pkg(UPDATES, 'demo', '1.0.2'),
            pkg(UPDATES, 'demo', '1.0.1'),
            pkg(UPDATES, 'other', '9.0.0'),
        ] });
        const found = update.findPkg({ name: 'demo', env: 'prod' });
        expect(found).toMatchObject({ version: '1.0.2', type: 'update' });
        expect(found.path).toBe(nodePath.join(UPDATES, 'demo-prod-v1.0.2.asar'));
    });

    it('matches exact version when given', () => {
        const { update } = createHarness({ pkgs: [
            pkg(BUILTIN, 'demo', '1.0.0'),
            pkg(UPDATES, 'demo', '1.0.2'),
        ] });
        expect(update.findPkg({ name: 'demo', env: 'prod', version: '1.0.0' }))
            .toMatchObject({ version: '1.0.0', type: 'builtin' });
        expect(update.findPkg({ name: 'demo', env: 'prod', version: '2.0.0' })).toBeNull();
    });

    it('never matches another env', () => {
        const { update } = createHarness({ pkgs: [pkg(UPDATES, 'demo', '1.0.0', 'test')] });
        expect(update.findPkg({ name: 'demo', env: 'prod' })).toBeNull();
    });

    it('prefers builtin package on the same version', () => {
        const { update } = createHarness({ pkgs: [
            pkg(UPDATES, 'demo', '1.0.0'),
            pkg(BUILTIN, 'demo', '1.0.0'),
        ] });
        expect(update.findPkg({ name: 'demo', env: 'prod' }).type).toBe('builtin');
    });

    it('skips missing builtin dir and non-asar entries', () => {
        const { files, update } = createHarness({ builtinPackageDir: '/missing', pkgs: [
            pkg(UPDATES, 'demo', '1.0.0'),
        ] });
        files.set(nodePath.join(UPDATES, 'uuid-tmp'), Buffer.from('partial'));
        expect(update.findPkg({ name: 'demo', env: 'prod' })).toMatchObject({ version: '1.0.0' });
    });

    it('requires name and env', () => {
        const { update } = createHarness();
        expect(() => update.findPkg({ env: 'prod' })).toThrow(TypeError);
        expect(() => update.findPkg({ name: 'demo' })).toThrow(TypeError);
    });
});

describe('update.cleanupPkgs', () => {
    it('removes other versions of the same name, keeps the given one and builtin', () => {
        const { files, update } = createHarness({ pkgs: [
            pkg(BUILTIN, 'demo', '1.0.0'),
            pkg(UPDATES, 'demo', '1.0.1'),
            pkg(UPDATES, 'demo', '1.0.2'),
            pkg(UPDATES, 'other', '1.0.0'),
        ] });
        const keepPath = nodePath.join(UPDATES, 'demo-prod-v1.0.2.asar');
        expect(update.cleanupPkgs({ name: 'demo', keepPath })).toEqual({ removed: 1 });

        expect(files.has(nodePath.join(UPDATES, 'demo-prod-v1.0.1.asar'))).toBe(false);
        expect(files.has(keepPath)).toBe(true);
        expect(files.has(nodePath.join(BUILTIN, 'demo-prod-v1.0.0.asar'))).toBe(true);
        expect(files.has(nodePath.join(UPDATES, 'other-prod-v1.0.0.asar'))).toBe(true);
    });

    it('logs and skips a package whose file is still held (silent removeSync)', () => {
        const held = nodePath.join(UPDATES, 'demo-prod-v1.0.1.asar');
        const { files, update } = createHarness({
            pkgs: [pkg(UPDATES, 'demo', '1.0.1'), pkg(UPDATES, 'demo', '1.0.0')],
            locked: [held],
        });
        expect(update.cleanupPkgs({ name: 'demo' })).toEqual({ removed: 1 });
        expect(files.has(held)).toBe(true);
    });

    it('reads descriptors through readPkgDescriptor, never through fs-extra', () => {
        const { calls, update } = createHarness({ pkgs: [pkg(UPDATES, 'demo', '1.0.0')] });
        update.findPkg({ name: 'demo', env: 'prod' });
        expect(calls).toContainEqual(['readDescriptor', nodePath.join(UPDATES, 'demo-prod-v1.0.0.asar')]);
    });
});

describe('update.downloadPkg replacing an existing package', () => {
    it('removes the old .asar before promoting the new one', async () => {
        const { calls, files, update } = createHarness({ pkgs: [pkg(UPDATES, 'demo', '1.0.1')] });
        const finalPath = nodePath.join(UPDATES, 'demo-prod-v1.0.1.asar');
        await expect(update.downloadPkg({ url: 'https://example.test/demo-prod-v1.0.1.asar' }))
            .resolves.toBe(finalPath);
        expect(calls).toContainEqual(['remove', finalPath]);
        expect(files.get(finalPath).toString()).toBe('payload');
    });

    it('fails clearly when the old .asar is held, keeping it intact', async () => {
        const finalPath = nodePath.join(UPDATES, 'demo-prod-v1.0.1.asar');
        const { files, update } = createHarness({
            pkgs: [pkg(UPDATES, 'demo', '1.0.1')],
            locked: [finalPath],
        });
        await expect(update.downloadPkg({ url: 'https://example.test/demo-prod-v1.0.1.asar' }))
            .rejects.toThrow(/被占用/);
        expect(files.get(finalPath).toString()).toBe('asar');
    });

    it('accepts .asax urls and stores them as .asar', async () => {
        const { files, update } = createHarness();
        const finalPath = nodePath.join(UPDATES, 'demo-prod-v1.0.2.asar');
        await expect(update.downloadPkg({ url: 'https://example.test/demo-prod-v1.0.2.asax' }))
            .resolves.toBe(finalPath);
        expect(files.has(finalPath)).toBe(true);
    });

    it('rejects other extensions', async () => {
        const { update } = createHarness();
        await expect(update.downloadPkg({ url: 'https://example.test/demo.zip' })).rejects.toThrow(/\.asax/);
    });
});
