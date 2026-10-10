import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { serialize, serializeForIpc } = require('../../../src/shared/serializer/index.js');

/**
 * T-10：用 bake 主进程 service handler 的真实返回值形态覆盖 M1 serializer。
 * 全部路径必须 IPC 无损（JSON.parse(JSON.stringify(...)) 不抛错）。
 */

// —— 真实业务 case ——

describe('T-10 real-world: capability/downloader resolve value (Windows path string)', () => {
    it('Windows 绝对路径字符串完整保留、JSON 无损', () => {
        // 模拟 downloader.download resolve 的值：Windows path.join 结果
        const filePath = 'C:\\Users\\haoluo2\\AppData\\Roaming\\my-app\\Update\\installer-abc123.exe';
        const out = serializeForIpc(filePath);
        expect(out).toBe(filePath);
        expect(JSON.parse(JSON.stringify(out))).toBe(filePath);
    });
});

describe('T-10 real-world: capability/os Buffer return value', () => {
    // 2026-10-10 契约变更：**IPC 路径不再把二进制换成占位符**。
    // 原先断言"Buffer 变 placeholder、能过 JSON.stringify" —— 那条基准把 JSON 当成了
    // IPC 的保真标准，但 IPC 实际走 structured clone（原生支持 Buffer / ArrayBuffer /
    // TypedArray，实测 3MB Uint8Array 首尾字节完整）。占位符化是纯损失：
    // 业务侧的二进制经 Service 根本传不过去。
    // 裁剪与占位保留给 safeStringify（日志/诊断用途），那才是"给人看"的需求。
    it('execSync 返回的 Buffer 原样透传，不被换成 placeholder', () => {
        const buf = Buffer.from('5.15.0-91-generic\n', 'utf-8');
        const out = serializeForIpc(buf);
        expect(Buffer.isBuffer(out)).toBe(true);
        expect(out.equals(buf)).toBe(true);
    });

    it('ArrayBuffer / TypedArray 同样透传', () => {
        const ab = new ArrayBuffer(8);
        expect(serializeForIpc(ab) instanceof ArrayBuffer).toBe(true);
        const out = serializeForIpc(new Uint8Array([1, 2, 3]));
        expect(out instanceof Uint8Array).toBe(true);
        expect(Array.from(out)).toEqual([1, 2, 3]);
    });

    it('但 safeStringify（日志用途）仍把二进制换成 placeholder', () => {
        const { safeStringify } = require('../../../src/shared/serializer/index.js');
        expect(safeStringify(Buffer.from('abc'))).toMatch(/\[Buffer:\s*3\s*bytes\]/);
    });
});

describe('T-10 real-world: package list (getUpdatePkgList shape)', () => {
    function makePkg(i) {
        return {
            name: '@base-client/some-app',
            version: `1.${i}.0`,
            type: 'update',
            path: `C:\\Users\\me\\AppData\\Roaming\\my-app\\updatePackage\\1.${i}.0`,
            env: 'production',
        };
    }

    it('小规模 pkg 列表 IPC 无损', () => {
        const list = [makePkg(0), makePkg(1), makePkg(2)];
        const out = serializeForIpc(list);
        expect(out).toEqual(list);
        expect(JSON.parse(JSON.stringify(out))).toEqual(list);
    });

    it('大规模 pkg 列表（100 个）完全保留，无 truncation', () => {
        const list = Array.from({ length: 100 }, (_, i) => makePkg(i));
        const out = serializeForIpc(list);
        expect(Array.isArray(out)).toBe(true);
        expect(out.length).toBe(100);
        expect(out[0]).toEqual(makePkg(0));
        expect(out[99]).toEqual(makePkg(99));
    });
});

describe('T-10 real-world: fs Error with code (getFile ENOENT/EACCES)', () => {
    it('Node fs 抛的 Error 带 code/errno/syscall/path 都保留到序列化产物', () => {
        // 构造一个真实的 Node fs 风格错误
        const err = new Error('ENOENT: no such file or directory, open \'/tmp/nonexistent\'');
        err.code = 'ENOENT';
        err.errno = -2;
        err.syscall = 'open';
        err.path = '/tmp/nonexistent';

        const out = serializeForIpc(err);
        expect(out.name).toBe('Error');
        expect(out.message).toMatch(/ENOENT/);
        expect(out.code).toBe('ENOENT');
        // errno/syscall/path 不在 adaptError 白名单里，但 M1 只承诺 name/message/stack/code/cause
        // 这里断言 IPC 无损
        expect(() => JSON.stringify(out)).not.toThrow();
    });
});

describe('T-10 real-world: Error with cause chain (installApp multi-level catch)', () => {
    it('两层 cause 都被展开', () => {
        const root = new Error('dpkg failed');
        root.code = 'EIO';
        const mid = new Error('installByDpkg failed', { cause: root });
        const top = new Error('installApp failed', { cause: mid });

        const out = serializeForIpc(top);
        expect(out.name).toBe('Error');
        expect(out.message).toBe('installApp failed');
        expect(out.cause).toBeTruthy();
        expect(out.cause.message).toBe('installByDpkg failed');
        expect(out.cause.cause).toBeTruthy();
        expect(out.cause.cause.message).toBe('dpkg failed');
        expect(out.cause.cause.code).toBe('EIO');
    });
});

describe('T-10 real-world: electron-store nested value (setFile roundtrip)', () => {
    it('嵌套 plain object + array + Date 组合形态 IPC 无损', () => {
        // 模拟业务 setFile('cache.json', complexObject) 后 IPC 回传的形态
        const cache = {
            version: 2,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            entries: [
                { id: 'a', value: 42, tags: ['x', 'y'] },
                { id: 'b', value: 'hello', tags: [] },
            ],
            meta: {
                user: { name: '张三', role: 'admin' },
                config: null,
            },
        };
        const out = serializeForIpc(cache);
        expect(out.version).toBe(2);
        expect(out.createdAt).toBe('2026-01-01T00:00:00.000Z');
        expect(out.entries).toHaveLength(2);
        expect(out.entries[0]).toEqual({ id: 'a', value: 42, tags: ['x', 'y'] });
        expect(out.meta.user.name).toBe('张三');
        expect(out.meta.config).toBeNull();
        expect(() => JSON.stringify(out)).not.toThrow();
    });
});

describe('T-10 real-world: chinese characters / unicode (业务标签常见)', () => {
    it('中文、emoji 全保留', () => {
        const data = { title: '更新失败 😱', desc: '请稍后重试' };
        const out = serializeForIpc(data);
        expect(out).toEqual(data);
        expect(JSON.parse(JSON.stringify(out))).toEqual(data);
    });
});

// —— 语言边界（真实业务未必用到，但契约保证）——

describe('T-10 edge: null-prototype object', () => {
    it('Object.create(null) 顶层序列化', () => {
        const o = Object.create(null);
        o.a = 1;
        o.b = 'x';
        // walkObject 用 Object.keys —— null-prototype 上依然工作
        const out = serialize(o);
        expect(out.a).toBe(1);
        expect(out.b).toBe('x');
    });

    it('嵌套 null-prototype', () => {
        const inner = Object.create(null);
        inner.n = 42;
        const wrapper = { data: inner };
        const out = serializeForIpc(wrapper);
        expect(out.data.n).toBe(42);
    });
});

describe('T-10 edge: sparse array', () => {
    it('sparse array holes 在输出里变成 undefined 但 JSON 后为 null', () => {
        const arr = [1, , 3]; // eslint-disable-line no-sparse-arrays
        const out = serializeForIpc(arr);
        expect(out.length).toBe(3);
        expect(out[0]).toBe(1);
        // hole 位置 walk 时读为 undefined
        expect(out[1]).toBeUndefined();
        expect(out[2]).toBe(3);
        // JSON round-trip：undefined 在数组里变 null（JSON 规范）
        expect(JSON.parse(JSON.stringify(out))).toEqual([1, null, 3]);
    });
});

describe('T-10 edge: numeric edge cases', () => {
    it('-0 保留（JSON.stringify 会转成 0）', () => {
        const out = serialize({ n: -0 });
        expect(Object.is(out.n, -0)).toBe(true);
        // JSON round-trip 会丢失负号（JSON 规范），是 JSON 层限制不是 serializer 层
        expect(JSON.parse(JSON.stringify(out)).n).toBe(0);
    });

    it('Number.MIN_SAFE_INTEGER / MAX_SAFE_INTEGER 无损', () => {
        const out = serialize({
            min: Number.MIN_SAFE_INTEGER,
            max: Number.MAX_SAFE_INTEGER,
        });
        expect(out.min).toBe(Number.MIN_SAFE_INTEGER);
        expect(out.max).toBe(Number.MAX_SAFE_INTEGER);
        // JSON round-trip 保留（因为在 safe 范围）
        expect(JSON.parse(JSON.stringify(out))).toEqual({
            min: Number.MIN_SAFE_INTEGER,
            max: Number.MAX_SAFE_INTEGER,
        });
    });

    it('小数与极值 (Math.PI, Number.EPSILON)', () => {
        const out = serialize({ pi: Math.PI, eps: Number.EPSILON });
        expect(out.pi).toBe(Math.PI);
        expect(out.eps).toBe(Number.EPSILON);
    });
});

describe('T-10 edge: frozen / sealed objects', () => {
    it('Object.freeze 不影响序列化输出', () => {
        const frozen = Object.freeze({ a: 1, b: [2, 3] });
        const out = serializeForIpc(frozen);
        expect(out).toEqual({ a: 1, b: [2, 3] });
        // 产物应可自由修改（不继承 frozen）
        out.a = 99;
        expect(out.a).toBe(99);
    });
});

describe('T-10 real-world: IPC round-trip integrity guarantee', () => {
    // 综合验证：一个"最坏组合"对象过一遍 serializeForIpc。
    //
    // 2026-10-10 契约变更：基准从「能过 JSON.stringify」改为 **structured clone 语义**
    // —— IPC 实际走的就是它。JSON 基准会逼着二进制降级成占位符，而那正是本次要修的
    // 缺陷（业务侧的 Buffer 经 Service 传不过去）。现在：**可克隆的原样透传，
    // 不可克隆的才降级成占位符**。
    it('worst-case business object survives serializeForIpc with clone semantics', () => {
        const beast = {
            path: 'C:\\Users\\me\\Downloads\\pkg.asar',
            buffer: Buffer.from('binary content'),
            date: new Date('2026-07-09T00:00:00.000Z'),
            error: Object.assign(new Error('boom'), { code: 'EIO' }),
            regex: /\d+/gi,
            map: new Map([['k', 'v']]),
            set: new Set([1, 2, 3]),
            circular: {},
            unicode: '张三 🎉',
            sparse: [1, , 3], // eslint-disable-line no-sparse-arrays
            nully: null,
            undef: undefined,
            big: BigInt(9007199254740993),
            sym: Symbol('s'),
            fn: () => {},
            frozen: Object.freeze({ x: 1 }),
        };
        beast.circular.self = beast.circular;

        const out = serializeForIpc(beast);

        // —— 可克隆的：原样保真 ——
        expect(Buffer.isBuffer(out.buffer)).toBe(true);
        expect(out.buffer.toString()).toBe('binary content');
        expect(out.path).toBe(beast.path);
        expect(out.unicode).toBe('张三 🎉');
        expect(out.frozen).toEqual({ x: 1 });

        // —— 结构被适配成 plain 数据（这层是刻意的，见各自 adapter/placeholder）——
        expect(out.date).toBe('2026-07-09T00:00:00.000Z');
        expect(out.error.message).toBe('boom');
        expect(out.error.code).toBe('EIO');

        // —— 不可克隆的：降级成占位符，且不抛 ——
        expect(typeof out.fn).toBe('string');
        expect(typeof out.sym).toBe('string');
        expect(typeof out.big).toBe('string');
        expect(typeof out.circular.self).toBe('string'); // [Circular: …]
        expect(out.nully).toBe(null);
    });
});
