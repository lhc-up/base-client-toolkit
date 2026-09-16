# Download and Archive

## Download

主进程下载实现进入 `main/libs/download`，默认使用 Electron `net.request`，但不修改证书策略。下载 capability 再组合下载、完整性校验和受控落盘，对 renderer 提供：

```text
download.start(options) → { taskId }
download.cancel(taskId) → { accepted }
Notice: download.changed
```

renderer 不轮询状态，不接触绝对路径；`taskId` 只用于取消和事件关联。HTTP `Content-Encoding` 由传输层处理，下载文件本身的压缩格式交给 archive。

## Archive

archive 第一版只支持 ZIP。参考已通过业务验证的 `E:/code/eachina/questionnaire-answer-v3.0/main/libs/js/zipUtil.js` 的流式解密、`pipeline`、临时目录和清理策略，但不复制其业务入口语义。

实现使用：

```text
输入流 → 可选 SM4 Transform → unzipper.Parse() → entry 安全写入
```

调用方传入解压结果的父目录，最终目录由 ZIP 基础名称生成并独占。替换只影响这个 ZIP 对应的目录，不影响父目录下其他历史内容。磁盘不足由文件系统报错；不设置人工容量阈值。

entry 安全规则：最终 `path.resolve(root, entryPath)` 必须仍位于 root。第一版不恢复 ZIP symlink/hardlink 元数据；流式 parser 将其暴露为普通文件时按普通文件写入。若 parser 暴露未知特殊 entry type，则失败并明确指出类型和路径。
