import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);

const { installElectronMock, reset, lastInstance } = require('./_electron-mock');
installElectronMock(vi);
const BaseWindow = require('../../src/main/enhance/BaseWindow');

class W extends BaseWindow {
    getPageUrl() { return 'app://x.html'; }
}

describe('BaseWindow.create() Linux 默认窗口图标', () => {
    const originalPlatform = process.platform;
    const originalResourcesPath = process.resourcesPath;
    let resourcesDir;

    function setPlatform(value) {
        Object.defineProperty(process, 'platform', { value, configurable: true });
    }

    beforeEach(() => {
        reset();
        resourcesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-base-window-icon-'));
        process.resourcesPath = resourcesDir;
    });

    afterEach(() => {
        setPlatform(originalPlatform);
        process.resourcesPath = originalResourcesPath;
        fs.rmSync(resourcesDir, { recursive: true, force: true });
    });

    it('Linux 且资源根目录有 app-icon.png 时默认设 icon', () => {
        setPlatform('linux');
        fs.writeFileSync(path.join(resourcesDir, 'app-icon.png'), 'x');
        new W().create();
        expect(lastInstance().options.icon).toBe(path.join(resourcesDir, 'app-icon.png'));
    });

    it('Linux 但文件不存在时不设 icon', () => {
        setPlatform('linux');
        new W().create();
        expect('icon' in lastInstance().options).toBe(false);
    });

    it('非 Linux 不设 icon（用可执行文件自带图标）', () => {
        setPlatform('win32');
        fs.writeFileSync(path.join(resourcesDir, 'app-icon.png'), 'x');
        new W().create();
        expect('icon' in lastInstance().options).toBe(false);
    });

    it('项目写了 icon 时以项目为准', () => {
        setPlatform('linux');
        fs.writeFileSync(path.join(resourcesDir, 'app-icon.png'), 'x');
        class Custom extends BaseWindow {
            getPageUrl() { return 'app://x.html'; }
            getWindowOptions() { return { icon: '/custom/icon.png' }; }
        }
        new Custom().create();
        expect(lastInstance().options.icon).toBe('/custom/icon.png');
    });
});
