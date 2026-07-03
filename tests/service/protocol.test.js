import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const protocol = require('../../src/service/protocol');

describe('protocol channel constants', () => {
    it('META_LIST_CHANNEL is "service:getServiceList"', () => {
        expect(protocol.META_LIST_CHANNEL).toBe('service:getServiceList');
    });
});

describe('channel builders', () => {
    it('asyncChannel composes "{ns}:{name}"', () => {
        expect(protocol.asyncChannel('foo', 'bar')).toBe('foo:bar');
    });
    it('syncChannel composes "{ns}:{name}Sync"', () => {
        expect(protocol.syncChannel('foo', 'log')).toBe('foo:logSync');
    });
    it('async and sync channels are distinct', () => {
        expect(protocol.asyncChannel('a', 'b'))
            .not.toBe(protocol.syncChannel('a', 'b'));
    });
});
