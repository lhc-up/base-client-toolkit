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
        filePathConfig: {
            temp: platform === 'win32' ? TEMP : '/tmp',
        },
        loadSudoPrompt: () => ({ exec: vi.fn() }),
        ...overrides,
    };
    return { calls, files, update: createUpdateCapability(deps) };
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

    it('Linux（非龙芯）交给 xdg-open 后不退出客户端（与业务项目原实现一致）', async () => {
        const { calls, update } = createHarness('linux');
        await expect(update.installApp('/tmp/app.deb')).resolves.toEqual({ started: true });
        expect(calls.some(call => call[0] === 'exit')).toBe(false);
    });

    it('龙芯用 xterm 终端安装：标题、提示与 sleep 3 同业务项目原实现，路径作为 sh 的 $1 传入；安装结束后退出', async () => {
        const execFile = vi.fn((_file, _args, callback) => callback(null, '', ''));
        const { calls, update } = createHarness('linux', {
            execFile,
            os: { isLinux: () => true, isLoongnix: () => true, isWindows: () => false, isMacOS: () => false },
        });
        const installer = "/tmp/release name';touch owned;.deb";
        await expect(update.installApp(installer)).resolves.toEqual({ started: true });
        expect(execFile).toHaveBeenCalledWith(
            'xterm',
            ['-T', '安装更新', '-e', 'sh', '-c', 'sudo dpkg -i "$1" && echo 安装完成，3s后退出安装程序\nsleep 3', 'sh', installer],
            expect.any(Function),
        );
        expect(calls).toContainEqual(['exit', 1]);
    });

    it('Linux 安装启动失败时提示并退出', async () => {
        const execFile = vi.fn((_file, _args, callback) => callback(new Error('fail'), '', ''));
        const sudoExec = vi.fn((_cmd, _opts, callback) => callback(new Error('denied')));
        const { calls, update } = createHarness('linux', { execFile, loadSudoPrompt: () => ({ exec: sudoExec }) });
        await expect(update.installApp('/tmp/app.deb')).resolves.toEqual({ started: false, reason: 'open-failed' });
        expect(calls.some(call => call[0] === 'dialog')).toBe(true);
        expect(calls).toContainEqual(['exit', 1]);
    });

    it('passes Linux installer paths as execFile arguments without shell interpolation', async () => {
        const execFile = vi.fn((_file, _args, callback) => callback(null, '', ''));
        const { update } = createHarness('linux', { execFile });
        const installer = "/tmp/release name';touch owned;.deb";
        await expect(update.installApp(installer)).resolves.toEqual({ started: true });
        expect(execFile).toHaveBeenCalledWith('xdg-open', [installer], expect.any(Function));
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
