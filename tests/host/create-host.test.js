import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function buildElectronMock() {
    const handlers = new Map();
    const listeners = new Map();
    return {
        app: { getPath: () => require('node:os').tmpdir() },
        ipcMain: {
            handle: vi.fn((channel, fn) => { handlers.set(channel, fn); }),
            on: vi.fn((channel, fn) => { listeners.set(channel, fn); }),
            removeHandler: vi.fn(channel => { handlers.delete(channel); }),
            removeAllListeners: vi.fn(channel => { listeners.delete(channel); }),
            __handlers: handlers,
        },
        BrowserWindow: { getAllWindows: () => [], fromId: () => null },
    };
}
const electronMock = buildElectronMock();
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
    id: electronPath, filename: electronPath, loaded: true,
    exports: electronMock, children: [], paths: [],
};

const Service = require('../../src/service/main');
const Notice = require('../../src/notice/main');
const { asyncChannel } = require('../../src/service/protocol');
const { createHost } = require('../../src/host');
const { definePkg } = require('../../src/runtime');
const { ipcMain } = electronMock;

const logger = { serviceSchema: { namespace: 'logger', handlers: { info() {} } } };
const store = { serviceSchema: { namespace: 'store', handlers: { get() {} } } };

function cap(namespace, withNotice = false) {
    return {
        serviceSchema: { namespace, handlers: { run() {} } },
        ...(withNotice ? { noticeSchema: { namespace, events: ['changed'] } } : {}),
    };
}

beforeEach(() => {
    Service.cleanup();
    Notice.cleanup();
    ipcMain.__handlers.clear();
});

describe('createHost', () => {
    it('registers host capabilities on creation', () => {
        createHost({ capabilities: [logger, store] });
        expect(ipcMain.__handlers.has(asyncChannel('logger', 'info'))).toBe(true);
        expect(ipcMain.__handlers.has(asyncChannel('store', 'get'))).toBe(true);
    });

    it('mount registers provides then activates; unmount reverses', async () => {
        const host = createHost({ capabilities: [logger] });
        const order = [];
        const pkg = definePkg({
            name: 'demo',
            uses: ['logger'],
            provides: [cap('foo', true)],
            activate: () => {
                order.push(['activate', ipcMain.__handlers.has(asyncChannel('foo', 'run'))]);
            },
            deactivate: () => {
                order.push(['deactivate', ipcMain.__handlers.has(asyncChannel('foo', 'run'))]);
            },
        });

        await host.mount(pkg);
        expect(host.mounted()).toEqual(['demo']);
        expect(() => Notice.broadcast('foo.changed')).not.toThrow();

        expect(await host.unmount('demo')).toBe(true);
        expect(ipcMain.__handlers.has(asyncChannel('foo', 'run'))).toBe(false);
        expect(() => Notice.broadcast('foo.changed')).toThrow(/not registered/);
        expect(order).toEqual([['activate', true], ['deactivate', true]]);
        expect(host.mounted()).toEqual([]);
    });

    it('rejects missing uses', async () => {
        const host = createHost({ capabilities: [logger] });
        const pkg = definePkg({ name: 'demo', uses: ['logger', 'store', 'window'] });
        await expect(host.mount(pkg)).rejects.toThrow(/store, window/);
    });

    it('rejects provides that conflict with host capabilities', async () => {
        const host = createHost({ capabilities: [logger] });
        const pkg = definePkg({ name: 'demo', provides: [cap('logger')] });
        await expect(host.mount(pkg)).rejects.toThrow(/重名：logger/);
    });

    it('rejects provides that conflict with another mounted pkg', async () => {
        const host = createHost();
        await host.mount(definePkg({ name: 'a', provides: [cap('foo')] }));
        await expect(host.mount(definePkg({ name: 'b', provides: [cap('foo')] })))
            .rejects.toThrow(/重名：foo/);
    });

    it('allows several pkgs mounted together', async () => {
        const host = createHost();
        await host.mount(definePkg({ name: 'a', provides: [cap('foo')] }));
        await host.mount(definePkg({ name: 'b', provides: [cap('bar')] }));
        expect(host.mounted()).toEqual(['a', 'b']);
    });

    it('rejects mounting the same pkg twice', async () => {
        const host = createHost();
        const pkg = definePkg({ name: 'a' });
        await host.mount(pkg);
        await expect(host.mount(pkg)).rejects.toThrow(/已挂载/);
    });

    it('rolls back registrations when activate throws', async () => {
        const host = createHost();
        const pkg = definePkg({
            name: 'a',
            provides: [cap('foo', true)],
            activate: () => { throw new Error('boom'); },
        });
        await expect(host.mount(pkg)).rejects.toThrow('boom');
        expect(ipcMain.__handlers.has(asyncChannel('foo', 'run'))).toBe(false);
        expect(host.mounted()).toEqual([]);
        // 回滚后可以重新挂载同名包
        await expect(host.mount(definePkg({ name: 'a', provides: [cap('foo')] }))).resolves.toBeUndefined();
    });

    it('still unregisters when deactivate throws', async () => {
        const host = createHost();
        await host.mount(definePkg({
            name: 'a',
            provides: [cap('foo')],
            deactivate: () => { throw new Error('boom'); },
        }));
        expect(await host.unmount('a')).toBe(true);
        expect(ipcMain.__handlers.has(asyncChannel('foo', 'run'))).toBe(false);
    });

    it('re-mount after unmount re-runs activate', async () => {
        const host = createHost();
        const activate = vi.fn();
        const pkg = definePkg({ name: 'a', provides: [cap('foo')], activate });
        await host.mount(pkg);
        await host.unmount('a');
        await host.mount(pkg);
        expect(activate).toHaveBeenCalledTimes(2);
    });

    it('unmount of unknown pkg returns false', async () => {
        const host = createHost();
        expect(await host.unmount('missing')).toBe(false);
    });
});
