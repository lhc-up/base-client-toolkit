import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const nodePath = require('node:path');
const { createUpdateCapability } = require('../../../src/capability/update/createUpdateCapability');

function createHarness(platform = 'win32', overrides = {}) {
    const calls = [];
    const files = new Map();
    const deps = {
        path: nodePath,
        fse: {
            ensureDirSync: dir => calls.push(['ensureDir', dir]),
            readdirSync: () => [],
            existsSync: file => files.has(file),
            readJSONSync: file => files.get(file),
            readFileSync: file => files.get(file),
            copyFileSync: (from, to) => {
                calls.push(['copy', from, to]);
                files.set(to, files.get(from));
            },
            renameSync: (from, to) => {
                calls.push(['rename', from, to]);
                files.set(to, files.get(from));
                files.delete(from);
            },
            removeSync: file => {
                calls.push(['remove', file]);
                files.delete(file);
            },
        },
        semver: require('semver'),
        download: async (url, dir, options) => {
            calls.push(['download', url, dir, options]);
            files.set(nodePath.join(dir, options.filename), Buffer.from('payload'));
        },
        randomUUID: () => 'temp-id',
        createHash,
        execFile: vi.fn((_file, _args, callback) => callback(null, '', '')),
        app: { exit: code => calls.push(['exit', code]) },
        dialog: { showErrorBox: (...args) => calls.push(['dialog', ...args]) },
        shell: { openPath: async file => { calls.push(['openPath', file]); return ''; } },
        logger: {
            info: (...args) => calls.push(['info', ...args]),
            error: (...args) => calls.push(['error', ...args]),
            shutdown: () => calls.push(['shutdown']),
        },
        os: {
            isLinux: () => platform === 'linux',
            isLoongnix: () => false,
            isWindows: () => platform === 'win32',
            isMacOS: () => platform === 'darwin',
        },
        filePathConfig: { updatePackage: '/updates' },
        loadSudoPrompt: () => ({ exec: vi.fn() }),
        setTimeout: fn => fn(),
        ...overrides,
    };
    return { calls, files, update: createUpdateCapability(deps) };
}

describe('capability/update platform contract', () => {
    it.each(['win32', 'darwin'])('%s 使用 shell.openPath 启动安装器并退出旧进程', async platform => {
        const { calls, update } = createHarness(platform);
        const installer = platform === 'win32' ? 'C:\\Temp\\setup.exe' : '/tmp/setup.pkg';
        await expect(update.installApp(installer)).resolves.toEqual({ started: true });
        expect(calls).toContainEqual(['openPath', installer]);
        expect(calls).toContainEqual(['exit', 1]);
    });

    it('未知平台明确返回 unsupported，不静默成功或退出', async () => {
        const { calls, update } = createHarness('freebsd');
        await expect(update.installApp('/tmp/setup.bin')).resolves.toEqual({
            started: false,
            reason: 'unsupported-platform',
        });
        expect(calls.some(call => call[0] === 'openPath')).toBe(false);
        expect(calls.some(call => call[0] === 'exit')).toBe(false);
    });

    it('shell.openPath 返回错误时显示错误并返回失败', async () => {
        const shell = { openPath: vi.fn(async () => 'access denied') };
        const { calls, update } = createHarness('win32', { shell });
        await expect(update.installApp('C:\\Temp\\setup.exe')).resolves.toEqual({
            started: false,
            reason: 'open-failed',
            message: 'access denied',
        });
        expect(calls.some(call => call[0] === 'dialog')).toBe(true);
    });

    it('rejects relative paths and installer extensions for another platform', async () => {
        const { calls, update } = createHarness('win32');
        await expect(update.installApp('setup.exe')).rejects.toThrow(/absolute/);
        await expect(update.installApp('C:\\Temp\\payload.deb')).rejects.toThrow(/installer/);
        expect(calls.some(call => call[0] === 'openPath')).toBe(false);
    });

    it('passes Linux installer paths as execFile arguments without shell interpolation', async () => {
        const execFile = vi.fn((_file, _args, callback) => callback(null, '', ''));
        const { update } = createHarness('linux', { execFile });
        const installer = "/tmp/release name';touch owned;.deb";
        await expect(update.installApp(installer)).resolves.toEqual({ started: true });
        expect(execFile).toHaveBeenCalledWith('xdg-open', [installer], expect.any(Function));
    });
});

describe('capability/update package storage', () => {
    it('扫描前创建 updatePackage 目录，空目录返回空数组', () => {
        const { calls, update } = createHarness();
        expect(update.getUpdatePkgList({ name: 'demo', version: '1.0.0' })).toEqual([]);
        expect(calls[0]).toEqual(['ensureDir', '/updates']);
    });

    it('从 URL pathname 推导安全 .asar 文件名并原子改名', async () => {
        const { calls, update } = createHarness();
        await expect(update.downloadPkg({
            url: 'https://example.test/releases/prod-v1.2.0.asax?signature=abc',
        })).resolves.toBe(nodePath.join('/updates', 'prod-v1.2.0.asar'));
        expect(calls).toContainEqual(['ensureDir', '/updates']);
        expect(calls).toContainEqual(['download',
            'https://example.test/releases/prod-v1.2.0.asax?signature=abc',
            '/updates',
            { filename: 'temp-id' },
        ]);
        expect(calls).toContainEqual([
            'rename',
            nodePath.join('/updates', 'temp-id'),
            nodePath.join('/updates', 'prod-v1.2.0.asar'),
        ]);
    });

    it('下载失败时删除随机临时文件并透传异常', async () => {
        const failure = new Error('network down');
        const { calls, update } = createHarness('win32', {
            download: async () => { throw failure; },
        });
        await expect(update.downloadPkg({ url: 'https://example.test/a.asax' })).rejects.toBe(failure);
        expect(calls).toContainEqual(['remove', nodePath.join('/updates', 'temp-id')]);
    });

    it('verifies optional SHA-256 integrity before promoting a download', async () => {
        const { calls, update } = createHarness();
        await expect(update.downloadPkg({
            url: 'https://example.test/a.asax',
            integrity: 'sha256-' + createHash('sha256').update('payload').digest('hex'),
        })).resolves.toBe(nodePath.join('/updates', 'a.asar'));
        await expect(update.downloadPkg({
            url: 'https://example.test/b.asax',
            integrity: '0'.repeat(64),
        })).rejects.toThrow(/integrity/);
        expect(calls).toContainEqual(['remove', nodePath.join('/updates', 'temp-id')]);
    });

    it('stages a trusted local .asax through a verified temporary file', async () => {
        const { calls, files, update } = createHarness();
        const sourcePath = 'C:\\incoming\\prod-v1.2.0.asax';
        const payload = Buffer.from('local update');
        const integrity = createHash('sha256').update(payload).digest('hex');
        files.set(sourcePath, payload);

        await expect(update.stageLocalPkg({ sourcePath, integrity }))
            .resolves.toBe(nodePath.join('/updates', 'prod-v1.2.0.asar'));
        expect(calls).toContainEqual(['copy', sourcePath, nodePath.join('/updates', 'temp-id')]);
        expect(calls).toContainEqual([
            'rename',
            nodePath.join('/updates', 'temp-id'),
            nodePath.join('/updates', 'prod-v1.2.0.asar'),
        ]);
        expect(files.get(sourcePath)).toBe(payload);
    });

    it('rejects relative and non-asax local package paths before copying', async () => {
        const { calls, update } = createHarness();
        await expect(update.stageLocalPkg({ sourcePath: 'relative.asax', integrity: '0'.repeat(64) }))
            .rejects.toThrow(/absolute/);
        await expect(update.stageLocalPkg({ sourcePath: 'C:\\incoming\\payload.zip', integrity: '0'.repeat(64) }))
            .rejects.toThrow(/\.asax/);
        expect(calls.some(call => call[0] === 'copy')).toBe(false);
    });

    it('keeps an existing final package when staged content fails integrity', async () => {
        const { calls, files, update } = createHarness();
        const sourcePath = 'C:\\incoming\\prod-v1.2.0.asax';
        const finalPath = nodePath.join('/updates', 'prod-v1.2.0.asar');
        files.set(sourcePath, Buffer.from('corrupt'));
        files.set(finalPath, Buffer.from('known good'));

        await expect(update.stageLocalPkg({ sourcePath, integrity: '0'.repeat(64) }))
            .rejects.toThrow(/integrity/);
        expect(files.get(finalPath).toString()).toBe('known good');
        expect(calls).toContainEqual(['remove', nodePath.join('/updates', 'temp-id')]);
        expect(calls).not.toContainEqual(['remove', finalPath]);
    });

    it('cleans the temporary file when copying a local package fails', async () => {
        const failure = new Error('copy failed');
        const copyFileSync = vi.fn(() => { throw failure; });
        const { calls, update } = createHarness('win32', {
            fse: {
                ensureDirSync: dir => calls.push(['ensureDir', dir]),
                copyFileSync,
                removeSync: file => calls.push(['remove', file]),
            },
        });
        await expect(update.stageLocalPkg({
            sourcePath: 'C:\\incoming\\prod-v1.2.0.asax',
            integrity: '0'.repeat(64),
        })).rejects.toBe(failure);
        expect(calls).toContainEqual(['remove', nodePath.join('/updates', 'temp-id')]);
    });
});
