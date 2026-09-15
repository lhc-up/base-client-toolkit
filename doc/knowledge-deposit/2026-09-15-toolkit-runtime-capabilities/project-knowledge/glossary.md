# 术语

- **main/libs**：主进程内部通用实现层，不直接暴露给 renderer。
- **main/capability**：面向 renderer 的完整能力层，通常包含 Service/Notice 契约。
- **Service**：renderer 到 main 的请求/响应 IPC 协议。
- **Notice**：main 到 renderer 的被动事件推送协议。
- **taskId**：跨进程临时任务定位符，只用于取消和事件关联，不是文件长期标识。
- **scope**：受控存储的逻辑目录范围，支持安全段数组或 `/` 分隔字符串。
- **fileName**：文件的持久引用和最终文件名；toolkit 不理解其业务 ID 语义。
- **Transform**：Node Stream 中对输入流进行分块转换的处理器，例如 SM4 解密。
- **staging**：解压或下载时使用的临时工作目录，成功后才提交到最终目录。
