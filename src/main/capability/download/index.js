/**
 * Toolkit download capability wiring.
 *
 * Real dependencies are assembled here; behavior lives in createDownloadCapability
 * so tests can inject transport, storage root and notice sinks without Electron.
 */

const { randomUUID } = require('node:crypto');
const fsp = require('node:fs/promises');
const { createDownload } = require('../../libs/download');
const { getFilePathConfig } = require('../../paths');
const Notice = require('../../../notice/main');
const { createDownloadCapability } = require('./createDownloadCapability');

module.exports = createDownloadCapability({
    download: createDownload(),
    fsp,
    filePathConfig: getFilePathConfig(),
    broadcast: (event, payload) => Notice.broadcast(event, payload),
    randomUUID,
});