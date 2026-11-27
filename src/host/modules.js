/**
 * toolkit 全量子包表（宿主运行时使用）。
 *
 * 由 `scripts/hostModules.js` 根据 package.json#exports 生成，勿手改；
 * 新增或删除子包后执行 `npm run gen:host-modules`。
 *
 * getter 惰性加载：首次访问才 require，未用到的子包不执行顶层代码。
 * 静态 require 让 webpack 把全量 toolkit 打进宿主 bundle。
 */
module.exports = {
    get "main"() { return require("../main/index.js"); },
    get "main/capability"() { return require("../main/capability/index.js"); },
    get "main/capability/archive"() { return require("../main/capability/archive/index.js"); },
    get "main/capability/download"() { return require("../main/capability/download/index.js"); },
    get "main/capability/env"() { return require("../main/capability/env/index.js"); },
    get "main/capability/example"() { return require("../main/capability/example/index.js"); },
    get "main/capability/logger"() { return require("../main/capability/logger/index.js"); },
    get "main/capability/store"() { return require("../main/capability/store/index.js"); },
    get "main/capability/update"() { return require("../main/capability/update/index.js"); },
    get "main/enhance/BaseWindow"() { return require("../main/enhance/BaseWindow.js"); },
    get "main/libs/archive"() { return require("../main/libs/archive/index.js"); },
    get "main/libs/download"() { return require("../main/libs/download/index.js"); },
    get "main/libs/integrity"() { return require("../main/libs/integrity/index.js"); },
    get "main/libs/logger"() { return require("../main/libs/logger.js"); },
    get "main/libs/loggerConfig"() { return require("../main/libs/loggerConfig.js"); },
    get "main/libs/os"() { return require("../main/libs/os.js"); },
    get "main/libs/pkg"() { return require("../main/libs/pkg/index.js"); },
    get "main/libs/protocol"() { return require("../main/libs/protocol.js"); },
    get "main/libs/resourceRoot"() { return require("../main/libs/resourceRoot.js"); },
    get "main/libs/scope"() { return require("../main/libs/scope/index.js"); },
    get "main/libs/shortcut"() { return require("../main/libs/shortcut.js"); },
    get "main/libs/singleInstance"() { return require("../main/libs/singleInstance.js"); },
    get "main/libs/sm4"() { return require("../main/libs/sm4/index.js"); },
    get "main/libs/store"() { return require("../main/libs/store.js"); },
    get "main/libs/userDataDir"() { return require("../main/libs/userDataDir.js"); },
    get "main/paths"() { return require("../main/paths.js"); },
    get "notice"() { return require("../notice/main.js"); },
    get "service"() { return require("../service/main.js"); },
    get "shared"() { return require("../shared/index.js"); },
};
