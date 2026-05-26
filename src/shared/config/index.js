const proxyList = JSON.parse(process.env.BC_PROXY);
const targetDomainList = proxyList.map(v => v[1]);
module.exports = {
    env: process.env.BC_ENV,
    envName: process.env.BC_ENV_NAME,
    apiContext: process.env.BC_API_CONTEXT,
    pageContext: process.env.BC_PAGE_CONTEXT,
    // 所有目标服务的主机地址，客户端窗口会处理对应的cookie
    targetDomainList,
    // web页面域名
    webDomain: targetDomainList[0],
    injectJsPathWeb: process.env.BC_INJECT_JS_PATH_PREFIX + '/' + process.env.BC_INJECT_JS_PATH_SUFFIX_WEB,
    injectJsPathElectron: process.env.BC_INJECT_JS_PATH_PREFIX + '/' + process.env.BC_INJECT_JS_PATH_SUFFIX_ELECTRON,
    
    // client: {
    //     name: pkgJson.name,
    //     productName: pkgJson.productName,
    //     env: process.env.BC_ENV,
    //     envName: process.env.BC_ENV_NAME,
    //     version: pkgJson.version,
    //     buildTime: Date.now(),
    //     platform: process.env.PLATFORM || process.platform,
    //     arch: process.env.ARCH || process.arch,
    //     child: !!process.env.CHILD,
    //     sign: !!process.env.WIN_CODE_SIGN,
    //     unpack: !!process.env.UNPACK
    // }
    client: JSON.parse(process.env.CORE_PKG || '{}'),

    cdn: {
        preFetchConfigUrl: process.env.BC_PRE_FETCH_CONFIG_URL,
        injectJsPathPrefix: process.env.BC_INJECT_JS_PATH_PREFIX,
        injectJsPathSuffix: {
            web: process.env.BC_INJECT_JS_PATH_SUFFIX_WEB,
            electron: process.env.BC_INJECT_JS_PATH_SUFFIX_CLIENT
        }
    },
    key: {
        headerAuthorization: process.env.BC_HEADER_AUTHORIZATION,
        token: process.env.BC_STORAGE_KEY_TOKEN,
    },
    business: {
        interactiveContext: process.env.BC_BIZ_INTERACTIVE_CONTEXT
    }
}