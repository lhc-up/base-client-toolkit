import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const nodePath = require('node:path');
const { createUpdateCapability } = require('../../../src/main/capability/update/createUpdateCapability');

// 按当前系统生成的绝对路径：Windows 上是 <当前盘>:\Temp 等，macOS / Linux 上是 /Temp 等。
// 功能代码校验安装程序路径时按模拟的平台用 path.win32 / path.posix，拼接与解析暂存目录时用当前系统的 path；
// 写死的 Windows 盘符路径在 macOS / Linux 上不是绝对路径，会被拼上当前目录。/Temp 这类路径对 path.win32 也是绝对路径
const TEMP = nodePath.resolve('/Temp');
const INCOMING = nodePath.resolve('/incoming');
const OUTSIDE = nodePath.resolve('/outside');
const PACKAGES = nodePath.resolve('/home/u/.config/app/UserData/Packages');
const RESULT_FILE = nodePath.join(PACKAGES, '.install-result.json');

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
        randomUUID: () => 'temp-id',
        createHash,
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
        filePathConfig: {
            temp: platform === 'win32' ? TEMP : '/tmp',
            updatePackage: PACKAGES,
        },
        debInstaller: {
            installDeb: vi.fn(async options => ({ started: true, method: 'installer', program: '/usr/bin/kylin-installer', options })),
        },
        ...overrides,
    };
    return { calls, files, deps, update: createUpdateCapability(deps) };
}

describe('capability/update 退出', () => {
    it('installApp 等日志 shutdown 完成后才退出', async () => {
        let finishShutdown;
        const { calls, update } = createHarness('win32', {
            logger: {
                info: () => {},
                error: () => {},
                shutdown: () => new Promise(resolve => { finishShutdown = resolve; }),
            },
        });
        const pending = update.installApp(nodePath.join(TEMP, 'setup.exe'));
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(calls.some(c => c[0] === 'exit')).toBe(false);
        finishShutdown();
        await pending;
        expect(calls).toContainEqual(['exit', 1]);
    });
});

describe('capability/update platform contract', () => {
    it.each(['win32', 'darwin'])('%s 使用 shell.openPath 启动安装器并退出旧进程', async platform => {
        const { calls, update } = createHarness(platform);
        const installer = platform === 'win32' ? nodePath.join(TEMP, 'setup.exe') : '/tmp/setup.pkg';
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
        await expect(update.installApp(nodePath.join(TEMP, 'setup.exe'))).resolves.toEqual({
            started: false,
            reason: 'open-failed',
            message: 'access denied',
        });
        expect(calls.some(call => call[0] === 'dialog')).toBe(true);
    });

    it('rejects relative paths and installer extensions for another platform', async () => {
        const { calls, update } = createHarness('win32');
        await expect(update.installApp('setup.exe')).rejects.toThrow(/absolute/);
        await expect(update.installApp(nodePath.join(TEMP, 'payload.deb'))).rejects.toThrow(/installer/);
        expect(calls.some(call => call[0] === 'openPath')).toBe(false);
    });

    it('Linux：交给 deb-installer 的 installDeb，传入期望值、结果文件与重启命令；交出后退出客户端', async () => {
        const { calls, update } = createHarness('linux');
        const relaunch = { command: '/usr/bin/questionaire' };
        const result = await update.installApp('/tmp/installer-x.deb', { packageName: 'questionaire', version: '2.8.0', relaunch });
        expect(result).toEqual({ started: true, method: 'installer' });
        expect(calls).toContainEqual(['exit', 1]);
    });

    it('Linux：installDeb 收到的参数', async () => {
        const installDeb = vi.fn(async () => ({ started: true, method: 'terminal' }));
        const { update } = createHarness('linux', { debInstaller: { installDeb } });
        await update.installApp('/tmp/installer-x.deb', { packageName: 'p', version: '1.0', relaunch: { command: '/usr/bin/p' } });
        const [options] = installDeb.mock.calls[0];
        expect(options).toMatchObject({
            debPath: '/tmp/installer-x.deb',
            packageName: 'p',
            version: '1.0',
            resultFile: RESULT_FILE,
            relaunch: { command: '/usr/bin/p' },
        });
        expect(typeof options.logger.info).toBe('function');
    });

    it('Linux：没能交出安装时提示并退出，返回 deb-installer 的原因', async () => {
        const installDeb = vi.fn(async () => ({ started: false, reason: 'no-pkexec', detail: 'x' }));
        const { calls, update } = createHarness('linux', { debInstaller: { installDeb } });
        await expect(update.installApp('/tmp/app.deb')).resolves.toEqual({ started: false, reason: 'no-pkexec', detail: 'x' });
        expect(calls.some(call => call[0] === 'dialog')).toBe(true);
        expect(calls).toContainEqual(['exit', 1]);
    });

    it('Linux：不传 options 也能调用', async () => {
        const installDeb = vi.fn(async () => ({ started: true, method: 'installer' }));
        const { update } = createHarness('linux', { debInstaller: { installDeb } });
        await update.installApp('/tmp/app.deb');
        expect(installDeb.mock.calls[0][0]).toMatchObject({ debPath: '/tmp/app.deb', packageName: undefined, relaunch: undefined });
    });

    it('consumeInstallResult：读取并删除结果文件；没有时返回 null；无法解析时返回 null 并删除', () => {
        const file = RESULT_FILE;
        const { files, update } = createHarness('linux');
        expect(update.consumeInstallResult()).toBeNull();
        files.set(file, { status: 'failed', code: 0 });
        expect(update.consumeInstallResult()).toEqual({ status: 'failed', code: 0 });
        expect(files.has(file)).toBe(false);
        const bad = createHarness('linux');
        bad.files.set(file, 'x');
        const badUpdate = createUpdateCapability({
            ...bad.deps,
            fse: { ...bad.deps.fse, readJSONSync: () => { throw new Error('bad json'); } },
        });
        expect(badUpdate.consumeInstallResult()).toBeNull();
        expect(bad.files.has(file)).toBe(false);
    });
});

describe('capability/update staged installer', () => {
    it('copies, verifies, re-verifies, and launches a staged Windows installer', async () => {
        const { calls, files, update } = createHarness();
        const sourcePath = nodePath.join(INCOMING, 'setup.exe');
        const payload = Buffer.from('trusted installer');
        const integrity = createHash('sha256').update(payload).digest('hex');
        const stagedPath = nodePath.join(
            TEMP,
            'base-client-toolkit-installers',
            'temp-id',
            'setup.exe',
        );
        files.set(sourcePath, payload);

        const staged = await update.stageLocalInstaller({ sourcePath, integrity });
        expect(staged).toEqual({ filePath: stagedPath, integrity, fileName: 'setup.exe' });
        expect(calls).toContainEqual(['copy', sourcePath, stagedPath]);
        expect(files.get(sourcePath)).toBe(payload);

        await expect(update.installStagedInstaller(staged)).resolves.toEqual({ started: true });
        expect(calls).toContainEqual(['openPath', stagedPath]);
        expect(calls).toContainEqual(['exit', 1]);
    });

    it('rejects invalid installer inputs before copying', async () => {
        const { calls, update } = createHarness();
        await expect(update.stageLocalInstaller({
            sourcePath: 'relative.exe',
            integrity: '0'.repeat(64),
        })).rejects.toThrow(/absolute/);
        await expect(update.stageLocalInstaller({
            sourcePath: nodePath.join(INCOMING, 'setup.deb'),
            integrity: '0'.repeat(64),
        })).rejects.toThrow(/installer/);
        await expect(update.stageLocalInstaller({
            sourcePath: nodePath.join(INCOMING, 'setup.exe'),
            integrity: 'bad',
        })).rejects.toThrow(/SHA-256/);
        expect(calls.some(call => call[0] === 'copy')).toBe(false);

        const unsupported = createHarness('freebsd');
        await expect(unsupported.update.stageLocalInstaller({
            sourcePath: '/tmp/setup.deb',
            integrity: '0'.repeat(64),
        })).rejects.toThrow(/unsupported/);
        expect(unsupported.calls.some(call => call[0] === 'copy')).toBe(false);
    });

    it('refuses a staged installer that was replaced after staging', async () => {
        const { calls, files, update } = createHarness();
        const sourcePath = nodePath.join(INCOMING, 'setup.exe');
        const payload = Buffer.from('trusted installer');
        const integrity = createHash('sha256').update(payload).digest('hex');
        files.set(sourcePath, payload);
        const staged = await update.stageLocalInstaller({ sourcePath, integrity });
        files.set(staged.filePath, Buffer.from('replaced installer'));

        await expect(update.installStagedInstaller(staged)).rejects.toThrow(/integrity/);
        expect(calls.some(call => call[0] === 'openPath')).toBe(false);
    });

    it('rejects forged staged paths outside the controlled temp namespace', async () => {
        const { calls, files, update } = createHarness();
        const filePath = nodePath.join(OUTSIDE, 'setup.exe');
        const payload = Buffer.from('outside installer');
        const integrity = createHash('sha256').update(payload).digest('hex');
        files.set(filePath, payload);

        await expect(update.installStagedInstaller({ filePath, integrity, fileName: 'setup.exe' }))
            .rejects.toThrow(/staged installer/);
        expect(calls.some(call => call[0] === 'openPath')).toBe(false);
    });

    it('discards only a controlled staged installer directory and is idempotent', async () => {
        const { calls, files, update } = createHarness();
        const sourcePath = nodePath.join(INCOMING, 'setup.exe');
        const payload = Buffer.from('trusted installer');
        const integrity = createHash('sha256').update(payload).digest('hex');
        files.set(sourcePath, payload);
        const staged = await update.stageLocalInstaller({ sourcePath, integrity });
        const stageDir = nodePath.dirname(staged.filePath);

        expect(update.discardStagedInstaller(staged)).toBe(true);
        expect(update.discardStagedInstaller(staged)).toBe(true);
        expect(calls.filter(call => call[0] === 'remove' && call[1] === stageDir)).toHaveLength(2);
        expect(() => update.discardStagedInstaller({
            filePath: nodePath.join(OUTSIDE, 'setup.exe'),
            integrity,
        })).toThrow(/staged installer/);
    });

    it('cleans its controlled directory when installer copying fails', async () => {
        const failure = new Error('copy failed');
        const calls = [];
        const { update } = createHarness('win32', {
            fse: {
                ensureDirSync: dir => calls.push(['ensureDir', dir]),
                copyFileSync: () => { throw failure; },
                removeSync: file => calls.push(['remove', file]),
            },
        });

        await expect(update.stageLocalInstaller({
            sourcePath: nodePath.join(INCOMING, 'setup.exe'),
            integrity: '0'.repeat(64),
        })).rejects.toBe(failure);
        expect(calls).toContainEqual([
            'remove',
            nodePath.join(TEMP, 'base-client-toolkit-installers', 'temp-id'),
        ]);
    });

    it('cleans only expired entries from the controlled installer namespace', () => {
        const calls = [];
        const stageRoot = nodePath.join(TEMP, 'base-client-toolkit-installers');
        const now = 2_000_000;
        const { update } = createHarness('win32', {
            fse: {
                ensureDirSync: dir => calls.push(['ensureDir', dir]),
                readdirSync: dir => {
                    expect(dir).toBe(stageRoot);
                    return ['expired-id', 'recent-id'];
                },
                statSync: entry => ({
                    mtimeMs: entry.endsWith('expired-id') ? now - 10_000 : now - 100,
                }),
                removeSync: entry => calls.push(['remove', entry]),
            },
        });

        expect(update.cleanupStagedInstallers({ maxAgeMs: 1_000, now })).toEqual({ removed: 1 });
        expect(calls).toContainEqual(['remove', nodePath.join(stageRoot, 'expired-id')]);
        expect(calls).not.toContainEqual(['remove', nodePath.join(stageRoot, 'recent-id')]);
    });
});
