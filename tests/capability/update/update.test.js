import { createRequire } from 'node:module';
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
            renameSync: (from, to) => calls.push(['rename', from, to]),
            removeSync: file => calls.push(['remove', file]),
        },
        semver: require('semver'),
        download: async (url, dir, options) => calls.push(['download', url, dir, options]),
        randomUUID: () => 'temp-id',
        exec: vi.fn(),
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
        await expect(update.installApp('/tmp/setup.pkg')).resolves.toEqual({ started: true });
        expect(calls).toContainEqual(['openPath', '/tmp/setup.pkg']);
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
});
