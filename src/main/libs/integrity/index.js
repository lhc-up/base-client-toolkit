const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const ALGORITHMS = new Set(['sha256', 'md5']);

function normalizeAlgorithm(value) {
    const algorithm = String(value || 'sha256').toLowerCase().replace(/-/g, '');
    if (!ALGORITHMS.has(algorithm)) {
        throw Object.assign(new TypeError(`Unsupported integrity algorithm: ${value}`), {
            code: 'INTEGRITY_ALGORITHM_UNSUPPORTED',
        });
    }
    return algorithm;
}

async function digestFile(filePath, algorithm) {
    const hash = createHash(algorithm);
    let size = 0;
    try {
        for await (const chunk of fs.createReadStream(filePath)) {
            size += chunk.length;
            hash.update(chunk);
        }
    } catch (cause) {
        throw Object.assign(new Error(`Unable to read integrity target: ${filePath}`, { cause }), {
            code: 'INTEGRITY_FILE_READ_FAILED',
        });
    }
    return { actual: hash.digest('hex'), size };
}

async function verify({ filePath, algorithm = 'sha256', expected } = {}) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
        throw Object.assign(new TypeError('Integrity filePath must be absolute'), {
            code: 'INTEGRITY_PATH_INVALID',
        });
    }
    const normalized = normalizeAlgorithm(algorithm);
    // 允许带算法前缀（如 sha256-xxx、md5-xxx）
    const normalizedExpected = String(expected || '').replace(new RegExp(`^${normalized}-`, 'i'), '').toLowerCase();
    const { actual, size } = await digestFile(filePath, normalized);
    return {
        valid: actual === normalizedExpected,
        algorithm: normalized,
        expected: normalizedExpected,
        actual,
        size,
    };
}

module.exports = { digestFile, normalizeAlgorithm, verify };
