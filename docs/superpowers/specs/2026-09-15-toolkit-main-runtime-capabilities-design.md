# Toolkit 主进程运行时与通用能力设计

**日期**：2026-09-15  
**状态**：已确认，待实施  
**范围**：`@base-client/toolkit` 自身建设，不包含业务项目兼容迁移

## 1. 目标

本次建设从桌面客户端产品的长期架构出发，重新明确 toolkit 的运行环境边界，并建设可供主进程复用、可按需通过 Service/Notice 暴露给 renderer 的通用能力。

能力提炼不以当前已有几个业务消费者为门槛，而按以下条件判断：

- 是否解决桌面客户端普遍存在的问题；
- 是否能去除具体业务语义；
- 输入、输出、错误、生命周期和安全边界是否稳定；
- 提炼后是否降低整体维护成本；
- 是否具备独立测试价值。

不为了目录整齐或预想复用强行拆分。capability 可以复用 libs，也可以保留只属于自身的实现。

## 2. 目录与依赖边界

目标结构：

```text
src/
├── main/
│   ├── capability/          # 希望通过 Service/Notice 提供给 renderer 的完整能力
│   ├── enhance/             # BaseWindow 等主进程增强对象
│   ├── libs/                # 主进程通用实现；简单模块用文件，复杂模块用目录
│   ├── paths.js             # toolkit 路径配置、目录初始化和缓存
│   └── index.js
├── preload/
│   └── index.js             # 应用级 preload 装配入口
├── service/                 # Service IPC 协议的 main/preload 两端
├── notice/                  # Notice IPC 协议的 main/preload 两端
└── shared/                  # main/preload 均可加载的纯共享代码
```

依赖方向：

```text
renderer
  ↓ Service / Notice
main/capability
  ↓（按需）
main/libs
  ↓
shared
```

约束：

- `main/capability` 与 `main/libs` 都在主进程运行；
- capability 是 renderer 可直接使用的一件完整事情，一般包含 `serviceSchema` 和/或 `noticeSchema`；
- libs 是主进程通用实现，不直接暴露给 renderer；
- capability 可复用 libs，但 libs 不得依赖 capability；
- 专属于某个 capability 的逻辑可以留在 capability 内，不强制下沉；
- `main/paths.js` 是基础运行时配置，不放入 libs；
- `shared` 不得依赖 Electron、Node 专属模块、文件系统、网络、全局状态或副作用初始化；
- Service/Notice 继续作为根级通信协议目录；
- Service/Notice 各自的 preload 实现保留在协议目录，应用级 preload 组合放入 `src/preload/`；
- 删除根入口聚合，包只提供明确的子路径 exports。

## 3. 模块重新归类原则

旧 `capability` 目录不能机械搬迁，必须逐项审视：

- `os`：仅供主进程使用，目标为 `main/libs/os.js`；
- `shortcut`、`singleInstance`：按主进程工具归类，不因历史目录名保留为 capability；
- `update`：保留为完整 capability。它通过已有函数的组合实现更新能力，不创建 `libs/update`；
- `logger`、`store` 等模块根据 renderer 消费契约决定是 capability、libs，或 capability + libs 的组合；
- `BaseWindow` 等 Electron 增强对象进入 `main/enhance`；
- 新 capability 不要求与 libs 一一对应。

update 后续只在全局通用能力已经建设完成后，选择合适的 libs 替换自身重复实现；不得以 update 的现状反向设计通用 libs。

## 4. 主进程通用 libs

### 4.1 下载传输 `main/libs/download`

采用 Electron `net.request` 作为网络底座，参考成熟下载库的 API 体验，但不依赖当前 `download@8` 的整包缓冲实现。

主进程接口：

```js
const task = download.start({
    urls,
    destinationPath,
    timeoutMs,
    headers,
    onProgress,
});

const result = await task.promise;
task.cancel();
```

返回对象包含：

```text
promise  下载终态
cancel   取消当前运行任务
```

职责：

- 单 URL 与多个备用 URL；
- HTTP/HTTPS 状态和重定向处理；
- 真正的响应流写盘；
- 进度、超时、取消；
- 临时文件、失败清理和成功提交；
- 只处理 HTTP `Content-Encoding` 的 gzip/deflate/br；
- 不根据扩展名、MIME 或魔数解压下载文件本身。

证书边界：

- 下载库直接使用 Electron 默认 `net.request`；
- 不传入 session，不修改证书策略；
- 全局或 session 证书策略由业务/框架层统一设置；
- 下载库不得调用 `ignore-certificate-errors`、设置 `NODE_TLS_REJECT_UNAUTHORIZED=0` 或自行接受证书错误。

### 4.2 完整性校验 `main/libs/integrity`

完整性计算必须是异步流式实现：

- 禁止用 `readFileSync` 整包读入内存；
- 支持显式算法（至少 SHA-256、MD5）；
- 返回实际 hash 和比对结果；
- 下载、更新包、安装器、资源缓存后续统一复用；
- 现有调用方在该能力完成后统一调整，不在设计阶段提前修改。

### 4.3 SM4 `main/libs/sm4`

SM4 作为独立目录完整实现，暂不建立独立 npm package，但保持未来可替换、可抽包的模块边界。

要求：

- 直接依据 SM4 第一手规范完整实现，不参考或依赖 `sm-crypto`；
- 实现 S 盒、系统参数、轮密钥扩展、32 轮变换、分组加解密、CBC 和 PKCS#7；
- v1 支持 `SM4-CBC`，key 和 iv 均为 16 字节且必须显式传入；
- API 参考 Node `crypto`：`createCipheriv`、`createDecipheriv`、`update`、`final`、`setAutoPadding`；
- Cipher/Decipher 同时是 Node Transform，可直接用于 `pipeline`；
- 流式实现不得缓存整个输入；
- 提供一次性异步 `encrypt/decrypt` 便捷接口；
- 不包含默认业务 key/iv、业务密钥派生、hash、MAC、签名或完整性校验。

### 4.4 归档 `main/libs/archive`

第一版只支持 ZIP，但保留归档格式适配边界，避免 ZIP 细节扩散到 capability 和业务代码。

- 压缩采用成熟的 `archiver`；
- 解压采用 `unzipper.Parse()`，逐 entry 流式处理；
- 参考已通过业务验证的 `E:/code/eachina/questionnaire-answer-v3.0/main/libs/js/zipUtil.js` 的 pipeline、可选解密、临时目录、落盘等待和失败清理策略；
- 不原样复制参考实现中直接 `Extract`、合并目标目录和缺少最终路径校验的部分。

可选解密流程：

```text
输入文件流
  → 可选 SM4/AES 解密 Transform
  → unzipper.Parse()
  → 逐 entry 安全写入
```

解密本身不产生临时 ZIP；是否使用临时目录由解压提交策略决定。

安全和提交规则：

- 调用方传入的是解压结果的父目录；
- 最终目录固定为 `父目录/ZIP基础名称`，每个 ZIP 独占自己的目录；
- 未传父目录时，使用 `ZIP所在目录/ZIP基础名称`；
- 解压先写入独占 staging 目录，成功后替换 ZIP 对应的最终目录；
- 替换不得影响父目录中的其他历史文件或目录；
- entry 的最终解析路径必须位于给定解压根目录内，不能只检查绝对路径或字符串 `..`；
- 不设置单文件大小、总展开大小或压缩比阈值；磁盘不足由文件系统以 `ENOSPC` 等错误报告；
- symlink、hardlink、设备文件和其他特殊 entry 一律失败；
- 错误必须包含具体 entry 类型和路径，明确指出是否因软链接导致失败；
- 任意失败或取消都清理 staging，保留旧最终目录；
- `describe.json`、`main` 入口等业务协议不进入 libs，也不进入通用 toolkit capability。

## 5. Renderer 可用 capability

### 5.1 下载 capability

`main/capability/download` 组合 `main/libs/download`、`main/libs/integrity` 和 toolkit 受控路径规则。

Service：

```text
download.start(options)  → { taskId }
download.cancel(taskId)  → { accepted }
```

Notice：

```text
download.changed
```

规则：

- renderer 不轮询进度或状态，不提供 `getState/getProgress`；
- 所有进度、状态、终态结果和错误只通过 Notice 推送；
- `taskId` 只用于跨进程取消和并发事件关联，不参与文件长期引用或清理；
- Service 返回纯可序列化 DTO，不包装带方法的 task；
- 持久文件以 `scope + fileName` 引用；
- `scope` 支持安全的 `/` 分隔字符串或段数组，内部统一规范化；
- 支持单文件和一批文件落入同一个 scope；
- 不使用 `batchId`、`fileKey`、`relativePath` 或额外 JSON 索引；
- 业务唯一 ID 可直接映射为文件名，toolkit 不理解业务 ID 语义；
- 如果未传文件名而由 toolkit 生成，调用方需要保存返回的文件名才能长期引用。

### 5.2 归档 capability

`main/capability/archive` 组合 `main/libs/archive` 和可选解密实现。

Service：

```text
archive.extract(options) → { taskId }
archive.cancel(taskId)    → { accepted }
```

Notice：

```text
archive.changed
```

renderer 只传受控 `scope + fileName` 和目标父 scope，不接触绝对路径、Node Stream 或明文业务密钥。业务密钥获取、派生和业务归档内容解释均留在具体应用层。

## 6. Notice 使用边界

当前 Notice 是 main → renderer 单向事件机制：

- main 通过 `broadcast/direct` 发送；
- renderer 通过 `appNotice` 订阅；
- main 侧不提供 Notice `on/subscribe`。

下载和归档的进度、状态使用 Notice 被动推送。主进程内部如果需要监听能力事件，使用内部 EventEmitter 或注入回调，不把 Notice 改造成双向或 main 内部总线。

## 7. 非目标

- 不提炼纯版本比较 Service，业务直接使用 semver；
- 不重新设计现有 `getNewestPkg`；
- 暂不讨论业务运行时 artifact 选择；
- 不单独建设通用文件存储 capability 或 `main/libs/storage`；
- 不提炼 environment capability，保留主进程 os 工具和业务环境判断；
- 不把 manifest、更新策略、资源协议、业务密钥派生、监管策略、登录流程或 UI 放进 toolkit；
- 不在本设计中处理业务项目兼容路径。

## 8. 验证要求

- 所有新能力先写失败测试，再实现；
- SM4 使用第一手规范测试向量，并覆盖任意 chunk 边界、padding 错误和大文件有界内存；
- integrity 覆盖大文件流式 hash，验证主线程无同步整包读取；
- download 使用本地 HTTP/HTTPS fixture 覆盖状态码、重定向、fallback、取消、超时、Content-Encoding、写盘失败和清理；
- archive 覆盖普通 ZIP、可选解密、任意输入 chunk、目录替换、路径逃逸、链接/特殊 entry、取消、写盘失败和 staging 清理；
- capability 覆盖 Service DTO、Notice 状态顺序、taskId 关联、取消以及多窗口发送范围；
- toolkit 全量测试和 package exports 检查必须通过。

