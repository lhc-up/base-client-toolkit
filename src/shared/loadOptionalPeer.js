function loadOptionalPeer(name) {
    // eval('require') 绕开打包器静态分析，让 optional peer 不进入依赖图，
    // 未安装对应 peer 的业务也能正常加载本模块。
    const runtimeRequire = eval('require');
    return runtimeRequire(name);
}

module.exports = { loadOptionalPeer };
