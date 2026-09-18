/**
 * Controlled scope path rules shared by renderer-facing capabilities.
 *
 * A scope is a logical relative directory under a toolkit controlled root.
 * Callers pass either a '/' separated string or an array of segments;
 * both forms normalize to the same segment list. Renderer-facing DTOs only
 * carry the normalized '/' joined form, never absolute paths.
 */

const path = require('node:path');

function scopeError(code, message) {
    return Object.assign(new Error(message), { code });
}

function normalizeSegments(scope) {
    if (scope === undefined || scope === null) return [];
    const raw = Array.isArray(scope) ? scope : String(scope).split('/');
    const segments = [];
    for (const part of raw) {
        const segment = String(part).trim();
        if (!segment) continue;
        if (segment === '.' || segment === '..') {
            throw scopeError('SCOPE_INVALID', `scope segment "${segment}" is not allowed`);
        }
        if (/[\\:]/.test(segment) || segment.includes('\0')) {
            throw scopeError('SCOPE_INVALID', `scope segment "${segment}" contains illegal characters`);
        }
        segments.push(segment);
    }
    return segments;
}

function normalizeScope(scope) {
    return normalizeSegments(scope).join('/');
}

function resolveScopeDir(root, scope) {
    if (typeof root !== 'string' || !path.isAbsolute(root)) {
        throw scopeError('SCOPE_ROOT_INVALID', 'scope root must be an absolute path');
    }
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(resolvedRoot, ...normalizeSegments(scope));
    if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw scopeError('SCOPE_ESCAPE', 'scope resolves outside the controlled root');
    }
    return resolved;
}

function normalizeFileName(fileName) {
    if (typeof fileName !== 'string' || !fileName.trim()) {
        throw scopeError('FILE_NAME_INVALID', 'fileName must be a non-empty string');
    }
    const name = fileName.trim();
    if (
        name === '.' ||
        name === '..' ||
        /[/\\]/.test(name) ||
        name.includes('\0') ||
        name !== path.basename(name)
    ) {
        throw scopeError('FILE_NAME_INVALID', `fileName "${fileName}" must be a plain file name`);
    }
    return name;
}

module.exports = {
    normalizeSegments,
    normalizeScope,
    resolveScopeDir,
    normalizeFileName,
};