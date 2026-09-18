/**
 * Toolkit archive capability wiring.
 *
 * Ships with no decryptors registered: business key derivation stays in the
 * application layer, which registers named decryptors in main at startup.
 */

const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const archive = require('../../libs/archive');
const { getFilePathConfig } = require('../../paths');
const Notice = require('../../../notice/main');
const { createArchiveCapability } = require('./createArchiveCapability');

module.exports = createArchiveCapability({
    archive,
    fs,
    filePathConfig: getFilePathConfig(),
    broadcast: (event, payload) => Notice.broadcast(event, payload),
    randomUUID,
});