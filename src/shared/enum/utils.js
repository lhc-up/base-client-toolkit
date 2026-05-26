/**
 * 根据code列表获取对应的枚举子项
 * @param {Object} enumObj 枚举对象
 * @param {String[]} codeList 枚举子项code列表
 * @returns 根据codeList筛选后的枚举
 */
function getEnumsByCodeList(enumObj, codeList = []) {
    const ret = {};
    Object.keys(enumObj).forEach(key => {
        const code = enumObj[key].code;
        if (codeList.includes(code)) {
            ret[key] = enumObj[key];
        }
    });
    return ret;
}

/**
 * 把枚举对象转换为供下拉列表使用的数组
 * @param {Object} enumObj 枚举对象
 * @param {String} codeKey 下拉选项值的key
 * @param {String} descKey 下拉选项描述的key
 */
function getSelectListByEnum(enumObj = {}, codeKey = 'value', descKey = 'label') {
    return Object.keys(enumObj).map(key => {
        const { code, desc } = enumObj[key];
        return {
            [codeKey]: code,
            [descKey]: desc
        };
    });
}

/**
 * 把枚举对象转换为code->desc映射
 * @param {Object} enumObj
 */
function getMapByEnum(enumObj = {}) {
    const map = {};
    Object.keys(enumObj).forEach(key => {
        const { code, desc } = enumObj[key];
        map[code] = desc;
    });
    return map;
}

/**
 * 根据code获取枚举的子项
 * @param {Object} enumObj 枚举对象
 * @param {String} code 枚举子项的code
 */
function getEnumByCode(enumObj = {}, code) {
    const key = Object.keys(enumObj).find(k => enumObj[k].code === code);
    return key ? enumObj[key] : {};
}

module.exports = {
    getEnumsByCodeList,
    getSelectListByEnum,
    getMapByEnum,
    getEnumByCode
};
