import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { requestMetaSync } = require('../../src/shared/metaChannel');
const { okEnvelope, errorEnvelope } = require('../../src/shared/envelope');

function ipcReturning(value) {
    return { sendSync: vi.fn(() => value) };
}

describe('shared/metaChannel: requestMetaSync', () => {
    it('信封（成功 / 失败）判为已 init，原样返回', () => {
        const ok = okEnvelope([]);
        expect(requestMetaSync(ipcReturning(ok), 'ch')).toEqual({ initialized: true, envelope: ok });
        const failed = errorEnvelope({ message: 'x' });
        expect(requestMetaSync(ipcReturning(failed), 'ch')).toEqual({ initialized: true, envelope: failed });
    });

    it('主进程无 listener 时 Electron 返回的 { error } 判为未 init，原因取 error', () => {
        const meta = requestMetaSync(ipcReturning({ error: 'reply was never sent' }), 'ch');
        expect(meta).toEqual({ initialized: false, reason: 'reply was never sent' });
    });

    it('sendSync 抛异常判为未 init，原因取异常 message', () => {
        const ipc = { sendSync: vi.fn(() => { throw new Error('boom'); }) };
        expect(requestMetaSync(ipc, 'ch')).toEqual({ initialized: false, reason: 'boom' });
    });

    it('undefined / null / 非信封对象判为未 init', () => {
        expect(requestMetaSync(ipcReturning(undefined), 'ch'))
            .toEqual({ initialized: false, reason: 'unexpected reply: undefined' });
        expect(requestMetaSync(ipcReturning(null), 'ch'))
            .toEqual({ initialized: false, reason: 'unexpected reply: null' });
        expect(requestMetaSync(ipcReturning({ data: [] }), 'ch'))
            .toEqual({ initialized: false, reason: 'unexpected reply: object' });
    });

    it('请求的是传入的通道', () => {
        const ipc = ipcReturning(okEnvelope([]));
        requestMetaSync(ipc, 'service:getServiceList');
        expect(ipc.sendSync).toHaveBeenCalledWith('service:getServiceList');
    });
});
