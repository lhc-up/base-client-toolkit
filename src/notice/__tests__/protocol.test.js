import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const protocol = require('../protocol');

describe('protocol channel constants', () => {
    it('EVENT_CHANNEL is "notice:event"', () => {
        expect(protocol.EVENT_CHANNEL).toBe('notice:event');
    });
    it('META_GET_SCHEMA_CHANNEL is "notice:getSchema"', () => {
        expect(protocol.META_GET_SCHEMA_CHANNEL).toBe('notice:getSchema');
    });
});

