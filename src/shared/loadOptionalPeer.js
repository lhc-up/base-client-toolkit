function loadOptionalPeer(name) {
    // Keep optional, platform-specific peers out of webpack's static dependency graph.
    const runtimeRequire = eval('require');
    return runtimeRequire(name);
}

module.exports = { loadOptionalPeer };
