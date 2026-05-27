function fnPlaceholder(fn) {
    const name = fn.name || 'anonymous';
    return `[Function: ${name}]`;
}

function symbolPlaceholder(sym) {
    const desc = sym.description;
    return desc ? `[Symbol(${desc})]` : '[Symbol]';
}

function bigintPlaceholder(v) {
    return `[BigInt: ${v.toString()}]`;
}

function bufferPlaceholder(buf) {
    const len = (typeof buf.byteLength === 'number')
        ? buf.byteLength
        : (typeof buf.length === 'number' ? buf.length : 0);
    return `[Buffer: ${len} bytes]`;
}

function circularPlaceholder(path) {
    return `[Circular: ${path || '$'}]`;
}

function maxDepthPlaceholder() {
    return '[MaxDepth]';
}

function numberPlaceholder(n) {
    if (Number.isNaN(n)) return '[Number: NaN]';
    if (n === Infinity) return '[Number: Infinity]';
    if (n === -Infinity) return '[Number: -Infinity]';
    return n;
}

function truncatedStringSuffix(removed) {
    return `...[truncated ${removed} chars]`;
}

function truncatedArrayItem(removed) {
    return `...[truncated ${removed} items]`;
}

function truncatedKeysValue(removed) {
    return `${removed} more keys`;
}

function promisePlaceholder() { return '[Promise]'; }
function weakMapPlaceholder() { return '[WeakMap]'; }
function weakSetPlaceholder() { return '[WeakSet]'; }

function domPlaceholder(node) {
    const tag = node.tagName || node.nodeName || 'Node';
    return `[DOM: ${tag}]`;
}

function windowPlaceholder() { return '[Window]'; }

function unserializablePlaceholder(reason) {
    return `[Unserializable: ${reason}]`;
}

module.exports = {
    fnPlaceholder,
    symbolPlaceholder,
    bigintPlaceholder,
    bufferPlaceholder,
    circularPlaceholder,
    maxDepthPlaceholder,
    numberPlaceholder,
    truncatedStringSuffix,
    truncatedArrayItem,
    truncatedKeysValue,
    promisePlaceholder,
    weakMapPlaceholder,
    weakSetPlaceholder,
    domPlaceholder,
    windowPlaceholder,
    unserializablePlaceholder,
};
