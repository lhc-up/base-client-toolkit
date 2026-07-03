/**
 * 命名规则的单一真理源（详见架构 §7.4）。
 *
 * namespace / handler 名 / event 名三者均须符合合法 JS 标识符规则，
 * 保证它们作为渲染端 API 属性名参与 dot access（如 appService.foo.bar）
 * 时无一例外用 dot 语法。
 *
 * M2 / M3 registerService / registerSchema 内部通过 validateServiceSchema /
 * validateNoticeSchema 使用此正则；capability 相关测试也 delegate 到这里，
 * 避免正则散在多处漂移。
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
