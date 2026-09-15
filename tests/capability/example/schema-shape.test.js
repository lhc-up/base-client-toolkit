import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const example = require('../../../src/main/capability/example/index');

const NAMESPACE_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const EVENT_NAME_RE = /^[A-Za-z0-9_-]+$/;

describe('serviceSchema shape (M2 protocol form)', () => {
    const { serviceSchema } = example;

    it('namespace is a non-empty string matching the allowed pattern', () => {
        expect(typeof serviceSchema.namespace).toBe('string');
        expect(serviceSchema.namespace.length).toBeGreaterThan(0);
        expect(NAMESPACE_RE.test(serviceSchema.namespace)).toBe(true);
    });

    it('handlers is a non-null object whose every value is a function', () => {
        expect(serviceSchema.handlers).not.toBeNull();
        expect(typeof serviceSchema.handlers).toBe('object');
        const entries = Object.entries(serviceSchema.handlers);
        expect(entries.length).toBeGreaterThan(0);
        for (const [name, fn] of entries) {
            expect(typeof fn).toBe('function');
            expect(EVENT_NAME_RE.test(name)).toBe(true);
        }
    });

    it('sync (if present) is an array of strings', () => {
        if (serviceSchema.sync === undefined) return;
        expect(Array.isArray(serviceSchema.sync)).toBe(true);
        for (const name of serviceSchema.sync) {
            expect(typeof name).toBe('string');
        }
    });

    it('every entry in sync is also a handler key', () => {
        if (!serviceSchema.sync) return;
        const handlerKeys = Object.keys(serviceSchema.handlers);
        for (const name of serviceSchema.sync) {
            expect(handlerKeys).toContain(name);
        }
    });

    it('needsEvent (if present) is an array of strings; each is a handler key', () => {
        if (serviceSchema.needsEvent === undefined) return;
        expect(Array.isArray(serviceSchema.needsEvent)).toBe(true);
        const handlerKeys = Object.keys(serviceSchema.handlers);
        for (const name of serviceSchema.needsEvent) {
            expect(typeof name).toBe('string');
            expect(handlerKeys).toContain(name);
        }
    });
});

describe('noticeSchema shape (M3 protocol form)', () => {
    const { noticeSchema } = example;

    it('namespace is a non-empty string matching the allowed pattern', () => {
        expect(typeof noticeSchema.namespace).toBe('string');
        expect(noticeSchema.namespace.length).toBeGreaterThan(0);
        expect(NAMESPACE_RE.test(noticeSchema.namespace)).toBe(true);
    });

    it('events is a non-empty array of strings matching event name pattern', () => {
        expect(Array.isArray(noticeSchema.events)).toBe(true);
        expect(noticeSchema.events.length).toBeGreaterThan(0);
        for (const name of noticeSchema.events) {
            expect(typeof name).toBe('string');
            expect(EVENT_NAME_RE.test(name)).toBe(true);
        }
    });

    it('events have no duplicates', () => {
        const set = new Set(noticeSchema.events);
        expect(set.size).toBe(noticeSchema.events.length);
    });
});

describe('contract: at least one schema must be present (§2.2 约束)', () => {
    it('example has both schemas defined', () => {
        expect(example.serviceSchema || example.noticeSchema).toBeTruthy();
    });
});
