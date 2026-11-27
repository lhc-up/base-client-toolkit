import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

describe('libs/userDataDir', () => {
    it('设为 <appData>/<name>；名字为空或含路径分隔符时报错', () => {
        const app = { getPath: vi.fn(() => path.resolve('/AppData')), setPath: vi.fn() };
        const modulePath = require.resolve('../src/main/libs/userDataDir.js');
        delete require.cache[modulePath];
        const electronPath = require.resolve('electron');
        require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: { app } };
        try {
            const { setUserDataDirByName } = require(modulePath);
            expect(setUserDataDirByName('questionaire')).toBe(path.join(path.resolve('/AppData'), 'questionaire'));
            expect(app.setPath).toHaveBeenCalledWith('userData', path.join(path.resolve('/AppData'), 'questionaire'));
            expect(() => setUserDataDirByName('')).toThrow(/无效/);
            expect(() => setUserDataDirByName('a/b')).toThrow(/无效/);
        } finally {
            delete require.cache[electronPath];
            delete require.cache[modulePath];
        }
    });
});
