import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const childProcess = require('node:child_process');
const nodeOs = require('node:os');

// os.js 加载时解构 execSync，spy 必须在 require 之前装好
const execSync = vi.spyOn(childProcess, 'execSync');
const spawn = vi.spyOn(childProcess, 'spawn');
const platform = vi.spyOn(nodeOs, 'platform');

const loggerMock = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
const loggerPath = require.resolve('../src/main/libs/logger.js');
require.cache[loggerPath] = {
    id: loggerPath, filename: loggerPath, loaded: true,
    exports: loggerMock, children: [], paths: [],
};

const toolkitOs = require('../src/main/libs/os.js');

beforeEach(() => {
    execSync.mockReset();
    spawn.mockReset();
    platform.mockReset();
    loggerMock.error.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.info.mockClear();
});

afterAll(() => {
    execSync.mockRestore();
    spawn.mockRestore();
    platform.mockRestore();
    delete require.cache[loggerPath];
});

describe('main/libs/os：Linux 信息返回去掉换行的字符串（K17）', () => {
    it('linuxArch / linuxCore / lsbRelease 返回 trim 后的字符串', () => {
        platform.mockReturnValue('linux');
        execSync.mockImplementation((command) => {
            if (command === 'uname -m') return 'x86_64\n';
            if (command === 'uname -r') return '5.10.0-8-amd64\n';
            if (command === 'lsb_release -i -s') return 'Ubuntu\n';
            throw new Error(`unexpected ${command}`);
        });
        expect(toolkitOs.linuxArch()).toBe('x86_64');
        expect(toolkitOs.linuxCore()).toBe('5.10.0-8-amd64');
        expect(toolkitOs.lsbRelease()).toBe('Ubuntu');
        for (const call of execSync.mock.calls) {
            expect(call[1]).toEqual({ encoding: 'utf8' });
        }
    });

    it('命令失败返回空串并记 error 日志', () => {
        platform.mockReturnValue('linux');
        execSync.mockImplementation(() => { throw new Error('not found'); });
        expect(toolkitOs.lsbRelease()).toBe('');
        expect(toolkitOs.isLoongnix()).toBe(false);
        expect(loggerMock.error).toHaveBeenCalledTimes(2);
    });

    it('isLoongnix 按发行版名判断', () => {
        platform.mockReturnValue('linux');
        execSync.mockReturnValue('Loongnix\n');
        expect(toolkitOs.isLoongnix()).toBe(true);
        execSync.mockReturnValue('Ubuntu\n');
        expect(toolkitOs.isLoongnix()).toBe(false);
    });

    it('非 Linux 不执行命令，返回空串 / false', () => {
        platform.mockReturnValue('win32');
        expect(toolkitOs.linuxArch()).toBe('');
        expect(toolkitOs.linuxCore()).toBe('');
        expect(toolkitOs.lsbRelease()).toBe('');
        expect(toolkitOs.isLoongnix()).toBe(false);
        expect(execSync).not.toHaveBeenCalled();
    });
});

describe('main/libs/os：openDateTimeSettings（F7-R3）', () => {
    const { EventEmitter } = require('node:events');

    function fakeChild() {
        const child = new EventEmitter();
        child.unref = vi.fn();
        return child;
    }

    it('非 Windows 返回 unsupported-platform，不执行任何命令', async () => {
        for (const name of ['linux', 'darwin']) {
            platform.mockReturnValue(name);
            await expect(toolkitOs.openDateTimeSettings()).resolves.toEqual({
                opened: false,
                reason: 'unsupported-platform',
            });
        }
        expect(spawn).not.toHaveBeenCalled();
        expect(loggerMock.warn).toHaveBeenCalledTimes(2);
    });

    it('Windows：进程启动即返回 opened: true，不等进程结束', async () => {
        platform.mockReturnValue('win32');
        const child = fakeChild();
        spawn.mockReturnValue(child);
        const result = toolkitOs.openDateTimeSettings();
        child.emit('spawn');
        await expect(result).resolves.toEqual({ opened: true });
        expect(spawn).toHaveBeenCalledWith(
            'rundll32.exe',
            ['shell32.dll,Control_RunDLL', 'timedate.cpl'],
            { stdio: 'ignore' },
        );
        expect(child.unref).toHaveBeenCalled();
    });

    it('Windows：启动失败返回 open-failed 并记 error 日志', async () => {
        platform.mockReturnValue('win32');
        const child = fakeChild();
        spawn.mockReturnValue(child);
        const result = toolkitOs.openDateTimeSettings();
        child.emit('error', new Error('spawn ENOENT'));
        await expect(result).resolves.toEqual({ opened: false, reason: 'open-failed' });
        expect(loggerMock.error).toHaveBeenCalledTimes(1);
    });

    it('Windows：spawn 同步抛异常也返回 open-failed', async () => {
        platform.mockReturnValue('win32');
        spawn.mockImplementation(() => { throw new Error('EPERM'); });
        await expect(toolkitOs.openDateTimeSettings()).resolves.toEqual({
            opened: false,
            reason: 'open-failed',
        });
        expect(loggerMock.error).toHaveBeenCalledTimes(1);
    });
});
