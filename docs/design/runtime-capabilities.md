# Toolkit 主进程运行时能力设计

`@base-client/toolkit` 的主进程运行时能力分两层：`main/libs` 提供主进程通用实现，`main/capability` 把完整能力通过 Service/Notice 暴露给 renderer。本文件定义各能力的契约与边界；目录结构与模块判定规则见架构设计。

## 1. 下载传输 `main/libs/download`

采用 Electron `net.request` 作为网络底座，真正的响应流写盘，不做整包缓冲。

```js
const task = download.start({ urls, destinationPath, timeoutMs, headers, onProgress });
const result = await task.promise;
task.cancel();
```

职责：

- 单 URL 与多个备用 URL 按序 fallback
- HTTP/HTTPS 状态处理；2xx 以外视为失败并尝试下一 URL
- 进度、超时、取消
- 临时文件写盘，成功后原子晋升，失败清理
- 只处理 HTTP `Content-Encoding` 的压缩语义；不根据扩展名、MIME 或魔数解压文件本身

证书边界：直接使用 Electron 默认 `net.request`，不传入 session，不修改证书策略；证书策略由业务/框架层统一设置；下载库不得调用 `ignore-certificate-errors`、设置 `NODE_TLS_REJECT_UNAUTHORIZED=0` 或自行接受证书错误。

## 2. 完整性校验 `main/libs/integrity`

- 异步流式计算，禁止 `readFileSync` 整包读入内存
- 支持显式算法（SHA-256、MD5）
- 返回实际 hash 与比对结果
- 下载、更新包、安装器、资源缓存统一复用

## 3. SM4 `main/libs/sm4`

- 直接依据 SM4 第一手规范实现：S 盒、系统参数、轮密钥扩展、32 轮变换、分组加解密、CBC、PKCS#7
- v1 支持 `SM4-CBC`，key 和 iv 均为 16 字节且必须显式传入
- API 对齐 Node `crypto`：`createCipheriv` / `createDecipheriv` / `update` / `final` / `setAutoPadding`；Cipher/Decipher 同时是 Node Transform，可直接用于 `pipeline`
- 流式实现不缓存整个输入；提供一次性异步 `encrypt` / `decrypt` 便捷接口
- 不包含默认业务 key/iv、业务密钥派生、hash、MAC、签名或完整性校验
- 保持未来可抽为独立 npm package 的模块边界

## 4. 归档 `main/libs/archive`

第一版只支持 ZIP，保留归档格式适配边界，避免 ZIP 细节扩散到 capability 和业务代码。压缩采用 `archiver`，解压采用 `unzipper.Parse()` 逐 entry 流式处理。

可选解密流程（解密本身不产生中间 ZIP 文件）：

```text
输入文件流 → 可选解密 Transform → unzipper.Parse() → 逐 entry 安全写入
```

安全和提交规则：

- 调用方传入解压结果的父目录；最终目录固定为 `父目录/ZIP基础名称`，每个 ZIP 独占自己的目录
- 解压先写入独占 staging 目录，成功后替换 ZIP 对应的最终目录；替换不影响父目录中的其他历史文件
- entry 的最终解析路径必须位于给定解压根目录内（按 `path.resolve` 结果判断，不做字符串级 `..` 检查）
- 不设置单文件大小、总展开大小或压缩比阈值；磁盘不足由文件系统以 `ENOSPC` 等错误报告
- 不恢复 ZIP 中的 symlink/hardlink 元数据；流式 parser 暴露为普通文件的 entry 按普通文件写入
- 底层 parser 明确暴露未知特殊 entry type 时失败，错误包含 entry 类型和路径
- 任意失败或取消都清理 staging，保留旧最终目录
- `describe.json`、`main` 入口等业务协议不进入 libs，也不进入通用 toolkit capability

## 5. 下载 capability `main/capability/download`

组合 `libs/download`、`libs/integrity` 与受控路径规则。

Service：

```text
download.start(options)  → { taskId }
download.cancel(taskId)  → { accepted }
```

Notice：`download.changed`（`started` / `progress` / `completed` / `failed` / `cancelled`）。

规则：

- renderer 不轮询进度或状态，不提供 `getState` / `getProgress`；进度、状态、终态和错误只通过 Notice 推送
- `taskId` 只用于跨进程取消和并发事件关联，不参与文件长期引用或清理
- 持久文件以 `scope + fileName` 引用；`scope` 支持 `/` 分隔字符串或段数组，内部统一规范化并拒绝逃逸
- 支持单文件和一批文件落入同一个 scope；不使用 `batchId`、`fileKey`、`relativePath` 或额外 JSON 索引
- 业务唯一 ID 可直接映射为文件名，toolkit 不理解业务 ID 语义
- 未传文件名时由 toolkit 生成（URL basename，再缺省 UUID），调用方需从 Notice 载荷保存文件名才能长期引用
- 可选完整性校验：不匹配则删除已下载文件并以 `failed` 终态上报

## 6. 归档 capability `main/capability/archive`

组合 `libs/archive` 与可选解密实现。

Service：

```text
archive.extract(options) → { taskId }
archive.cancel(taskId)    → { accepted }
```

Notice：`archive.changed`（`started` / `completed` / `failed` / `cancelled`）。

renderer 只传受控 `scope + fileName` 和目标父 scope，不接触绝对路径、Node Stream 或明文业务密钥。解密材料不出主进程：业务在主进程注册命名解密器（`registerDecryptor(name, factory)`），renderer 以 `decrypt: { name, params }` 引用；业务密钥获取、派生和业务归档内容解释均留在具体应用层。

## 7. Notice 使用边界

Notice 是 main → renderer 单向事件机制：main 通过 `broadcast` / `direct` 发送，renderer 通过 `appNotice` 订阅，main 侧不提供 `on` / `subscribe`。主进程内部需要监听能力事件时使用内部 EventEmitter 或注入回调，不把 Notice 改造成双向或 main 内部总线。

## 8. 非目标

- 不提炼纯版本比较 Service，业务直接使用 semver
- 不单独建设通用文件存储 capability 或 `main/libs/storage`
- 不提炼 environment capability，保留主进程 os 工具和业务环境判断
- 不把 manifest、更新策略、资源协议、业务密钥派生、监管策略、登录流程或 UI 放进 toolkit
