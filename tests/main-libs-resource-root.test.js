import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nodePath = require('node:path');
const { HOST_RUNTIME_KEY } = require('../src/shared/hostKeys');
const { isHostDev, getResourceRoot, resolveResource } = require('../src/main/libs/resourceRoot');

const key = Symbol.for(HOST_RUNTIME_KEY);
const original = { runtime: globalThis[key], resourcesPath: process.resourcesPath };

afterEach(() => {
    if (original.runtime === undefined) delete globalThis[key]; else globalThis[key] = original.runtime;
    process.resourcesPath = original.resourcesPath;
});

describe('main/libs/resourceRoot', () => {
    it('宿主本地调试：<项目根目录>/resources', () => {
        globalThis[key] = { isHostDev: true };
        expect(isHostDev()).toBe(true);
        expect(getResourceRoot()).toBe(nodePath.join(process.cwd(), 'resources'));
        expect(resolveResource('packages')).toBe(nodePath.join(process.cwd(), 'resources', 'packages'));
    });

    it('打包运行或未建立宿主运行时：process.resourcesPath', () => {
        process.resourcesPath = 'C:\App\resources';
        globalThis[key] = { isHostDev: false };
        expect(getResourceRoot()).toBe('C:\App\resources');
        delete globalThis[key];
        expect(isHostDev()).toBe(false);
        expect(resolveResource('icons')).toBe(nodePath.join('C:\App\resources', 'icons'));
    });

    it('非 Electron 且非本地调试：null', () => {
        delete globalThis[key];
        process.resourcesPath = undefined;
        expect(getResourceRoot()).toBeNull();
        expect(resolveResource('packages')).toBeNull();
    });
});
