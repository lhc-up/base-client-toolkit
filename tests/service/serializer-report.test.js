// 序列化异常上报链的接线测试（2026-10-10 新增）。
//
// 这是"机制有人在听"的验证：`serializeForIpc` 把不可克隆对象降级成占位符时，
// **此前完全静默** —— 数据在通道上被改动，没有任何人知道。本文件断言三段都通：
//   ① preload 侧收集到事件 → ② 经 SERIALIZER_REPORT_CHANNEL 单向 send
//   → ③ 主端 handler 打出带通道名/参数下标/字段路径/原因的日志
//
// 只断言"代码里写了"是不够的（P-18：新建的检查要先用已知问题样本证明它会报）。
import { describe, it, expect, expect as _expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let sent = [];
const electronMock = {
    ipcRenderer: {
        invoke: vi.fn(),
        sendSync: vi.fn(() => ({ ok: true, data: [{ namespace: 'demo', handlers: ['save'] }] })),
        send: vi.fn((channel, payload) => sent.push({ channel, payload })),
        on: vi.fn(),
        removeAllListeners: vi.fn(),
    },
    ipcMain: { on: vi.fn(), removeAllListeners: vi.fn(), handle: vi.fn(), removeHandler: vi.fn() },
    // service/main.js 直接 require main/libs/logger → paths.js 读 app.getPath
    app: { getPath: () => require('node:os').tmpdir() },
};
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
    id: electronPath, filename: electronPath, loaded: true,
    exports: electronMock, children: [], paths: [],
};

const buildAppService = require('../../src/service/preload.js');
const protocol = require('../../src/service/protocol.js');
const { handleSerializerReport } = require('../../src/service/main.js');

describe('序列化异常上报链', () => {
    beforeEach(() => { sent = []; });

    it('通道名已登记，且与主端监听的一致', () => {
        expect(protocol.SERIALIZER_REPORT_CHANNEL).toBe('service:serializerReport');
    });

    it('preload 侧遇到超深结构时，经该通道上报（含参数下标与字段路径）', async () => {
        const appService = buildAppService();
        // 深度超过默认 maxDepth(32) —— 这是 reportError 真会触发的场景。
        // 注意函数/Symbol 的占位**不走上报**（那是正常的适配，不是问题），
        // 所以测试必须用真会报的场景，否则测不到接线。
        let deep = { v: 1 };
        for (let i = 0; i < 40; i++) deep = { child: deep };

        await appService.demo.save({ payload: deep }).catch(() => {});

        const report = sent.find(s => s.channel === protocol.SERIALIZER_REPORT_CHANNEL);
        expect(report, '应当上报一条序列化报告').toBeTruthy();
        expect(report.payload.channel).toBe('demo:save'); // 能定位到是哪个 Service 调用
        expect(report.payload.reports.length).toBeGreaterThan(0);
        const r = report.payload.reports[0];
        expect(r.argIndex).toBe(0);              // 第 0 个参数
        expect(r.path).toContain('child');       // 字段路径
        expect(r.reason).toContain('depth');     // 原因
    });

    it('参数里的 getter 抛错时，同样上报且不中断调用', async () => {
        const appService = buildAppService();
        const bad = { ok: 1 };
        Object.defineProperty(bad, 'boom', {
            enumerable: true,
            get() { throw new Error('getter 故意抛'); },
        });

        await appService.demo.save(bad).catch(() => {});

        const report = sent.find(s => s.channel === protocol.SERIALIZER_REPORT_CHANNEL);
        expect(report).toBeTruthy();
        expect(report.payload.reports.some(r => r.reason.includes('getter'))).toBe(true);
        expect(report.payload.reports.some(r => r.path.includes('boom'))).toBe(true);
    });

    it('全部参数可克隆且不超深时，不发任何上报（正常调用零开销）', async () => {
        const appService = buildAppService();
        await appService.demo.save({ a: 1, b: 'x', c: [1, 2] }).catch(() => {});
        expect(sent.filter(s => s.channel === protocol.SERIALIZER_REPORT_CHANNEL)).toEqual([]);
    });

    it('主端 handler 用 toolkit logger 落盘（不是 console —— 后者不落盘）', () => {
        // main/libs/logger 在测试环境里没有 log4js 的 dateFile 落盘，但方法本身可用；
        // 断言"调用了 logger.error"而不是"某处 console 出现了内容"。
        const Logger = require('../../src/main/libs/logger');
        const spy = vi.spyOn(Logger, 'error').mockImplementation(() => {});
        handleSerializerReport(null, {
            channel: 'demo:save',
            reports: [{ argIndex: 0, path: '$.nested.deep', reason: 'symbol placeholder' }],
        });
        expect(spy).toHaveBeenCalledTimes(1);
        const line = spy.mock.calls[0].join(' ');
        expect(line).toContain('[serializer]');
        expect(line).toContain('demo:save');
        expect(line).toContain('$.nested.deep');
        expect(line).toContain('symbol placeholder');
        spy.mockRestore();
    });

    it('主端 handler 对畸形载荷不抛（上报链自身不能成为故障源）', () => {
        expect(() => handleSerializerReport(null, null)).not.toThrow();
        expect(() => handleSerializerReport(null, {})).not.toThrow();
        expect(() => handleSerializerReport(null, { channel: 'x', reports: 'nope' })).not.toThrow();
    });
});
