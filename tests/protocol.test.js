import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const require = createRequire(import.meta.url);

const handlers = new Map();
const electronMock = {
    app: { getPath: () => os.tmpdir() },
    protocol: {
        registerSchemesAsPrivileged: vi.fn(),
        registerFileProtocol: vi.fn((scheme, fn) => { handlers.set(scheme, fn); return true; }),
        unregisterProtocol: vi.fn(scheme => { handlers.delete(scheme); return true; }),
    },
};
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
    id: electronPath, filename: electronPath, loaded: true,
    exports: electronMock, children: [], paths: [],
};

const P = require('../src/main/libs/protocol');

const root = path.join(os.tmpdir(), 'bc-protocol-root');
const other = path.join(os.tmpdir(), 'bc-protocol-other');

function call(scheme, requestUrl) {
    let result;
    handlers.get(scheme)({ url: requestUrl }, r => { result = r; });
    return result;
}

beforeEach(() => {
    handlers.clear();
});

describe('declareSchemes', () => {
    it('declares default schemes plus extras once', () => {
        P.declareSchemes([{ scheme: 'extra', privileges: { standard: true } }]);
        const list = electronMock.protocol.registerSchemesAsPrivileged.mock.calls[0][0];
        expect(list.map(s => s.scheme)).toEqual(['iframe-resource', 'resource', 'extra']);
        expect(list[0].privileges).toEqual({ standard: true, secure: true });
        expect(list[1].privileges).toEqual({ supportFetchAPI: true });
    });

    it('throws on second call', () => {
        expect(() => P.declareSchemes()).toThrow(/只能调用一次/);
    });
});

describe('serveResource', () => {
    it('serves files inside roots and denies escapes', () => {
        P.serveResource({ roots: [root] });
        const inside = path.join(root, 'a b.png');
        expect(call('resource', P.buildResourceUrl(inside))).toBe(inside);
        expect(call('resource', P.buildResourceUrl(path.join(other, 'x.png')))).toEqual({ error: -10 });
    });

    it('returns a disposer that unregisters the scheme', () => {
        const dispose = P.serveResource({ roots: [root] });
        dispose();
        expect(handlers.has('resource')).toBe(false);
    });

    it('requires absolute roots', () => {
        expect(() => P.serveResource({ roots: ['relative'] })).toThrow(TypeError);
        expect(() => P.serveResource({})).toThrow(TypeError);
    });
});

describe('serveIframeResource', () => {
    it('serves pkg-* hosts inside roots', () => {
        P.serveIframeResource({ roots: [root] });
        const file = path.join(root, 'index.html');
        expect(call('iframe-resource', P.buildIframeResourceUrl(file, 'ABC'))).toBe(file);
    });

    it('rejects non pkg-* hosts', () => {
        P.serveIframeResource({ roots: [root] });
        const pathname = url.pathToFileURL(path.join(root, 'index.html')).pathname;
        expect(call('iframe-resource', `iframe-resource://evil${pathname}`)).toEqual({ error: -6 });
    });

    it('denies paths outside roots', () => {
        P.serveIframeResource({ roots: [root] });
        const file = path.join(other, 'index.html');
        expect(call('iframe-resource', P.buildIframeResourceUrl(file, 'abc'))).toEqual({ error: -10 });
    });
});

describe('buildIframeResourceUrl', () => {
    it.each([undefined, null, '', ' ', 'a/b', 'a?b', 'a:1'])('rejects invalid id %s', id => {
        expect(() => P.buildIframeResourceUrl(path.join(root, 'x'), id)).toThrow(/不合法/);
    });
});
