# Runtime Boundaries

## 结论

toolkit 按运行环境和消费方式分层，而不是按历史目录名机械移动：

```text
renderer
  ↓ Service/Notice
main/capability
  ↓ 可选复用
main/libs
  ↓
shared
```

`main/capability` 和 `main/libs` 都在主进程运行。区别是 capability 通过 IPC 给 renderer 提供完整能力，libs 是主进程内部实现。旧 `capability` 中的 `os`、快捷键、单实例等主进程工具不应因为历史目录名继续留在 capability；update 可以保留为完整 capability，不为 update 专门制造 `libs/update`。

## 根入口

不保留模糊的根聚合入口。调用方使用明确子路径：

```text
@base-client/toolkit/main/...
@base-client/toolkit/service
@base-client/toolkit/notice
@base-client/toolkit/preload
@base-client/toolkit/shared
```

`main/paths.js` 是 toolkit 基础路径配置，不是普通 libs。
