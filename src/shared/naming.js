/**
 * 命名规则的单一真理源。
 *
 * namespace / handler 名 / event 名均须为合法 JS 标识符，保证渲染端始终
 * 可以用 dot 语法访问（如 appService.foo.bar）。Service / Notice 的 schema
 * 校验共用此正则，避免多处漂移。
 */

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * 判断字符串是否为合法 JS 标识符。
 * @param {*} s 任意值（非字符串一律 false）
 * @returns {boolean}
 */
function isValidIdentifier(s) {
    return typeof s === 'string' && IDENTIFIER_RE.test(s);
}

module.exports = { IDENTIFIER_RE, isValidIdentifier };
