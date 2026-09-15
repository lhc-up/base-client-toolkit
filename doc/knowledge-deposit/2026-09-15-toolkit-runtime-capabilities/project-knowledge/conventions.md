# 已确认约定

## 目录和依赖

- `main/capability` 只放希望通过 Service/Notice 给 renderer 使用的完整能力。
- `main/libs` 放主进程通用实现；capability 可以复用 libs，libs 不得依赖 capability。
- 不为了目录对称或预想复用强行下沉代码；先按桌面客户端通用性、业务语义、边界稳定性、维护收益和独立测试价值审视。
- `main/paths.js` 是路径配置和目录初始化，不放入 libs。
- `service`、`notice`、`preload`、`shared` 是明确的根级运行时边界。
- `shared` 不能依赖 Electron、Node 专属模块、文件系统、网络或全局状态。
- toolkit 删除根聚合入口，使用明确子路径 exports。

## IPC 和任务

- Service 返回纯可序列化 DTO，不返回函数、Promise、Node Stream 或绝对路径。
- 长任务通过 `{ taskId }` 跨进程取消和关联事件。
- renderer 不轮询任务状态；进度、状态和终态结果通过 Notice 推送。
- main 内部监听使用 EventEmitter/回调，不把 Notice 变成 main 内部总线。

## 下载和归档

- 下载默认使用 Electron `net.request`，不在下载器内部修改证书策略。
- 证书策略由业务或框架全局配置；下载器不忽略证书错误。
- 下载层只处理 HTTP `Content-Encoding`，不解压下载文件本身的 ZIP/GZ 等格式。
- archive 第一版只支持 ZIP；压缩使用成熟库，解压使用流式 parser。
- 可选解密 Transform 直接接入解压管道，不产生中间解密文件。
- 解压结果按“父目录 + ZIP 基础名称”建立独占目录，避免把新内容合并到用户传入的父目录。
- entry 的最终解析路径必须位于解压根目录；symlink、hardlink 和特殊文件直接失败并明确报错。
- `describe.json`、`main` 入口和业务密钥派生属于具体业务应用，不属于 toolkit archive。

## 完整性和加密

- 完整性校验必须使用异步流式读取，禁止整包 `readFileSync`。
- SM4 独立放在 `main/libs/sm4`，直接按第一手规范完整实现，不依赖 `sm-crypto`。
- SM4 v1 为 `SM4-CBC + PKCS#7`，接口参考 Node `crypto` 的 `createCipheriv/createDecipheriv/update/final`。
- SM4 只负责算法，不负责 hash、MAC、签名、业务密钥派生或默认业务 key/iv。
