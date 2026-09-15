# SM4 Independent Implementation

## 设计决策

SM4 单独放在 `main/libs/sm4`，暂不拆成 npm 包，但按未来可替换、可抽包的边界设计。实现直接依据 SM4 第一手规范，不依赖 `sm-crypto`。

## API 方向

参考 Node `crypto`：

```javascript
sm4.createCipheriv('SM4-CBC', key, iv)
sm4.createDecipheriv('SM4-CBC', key, iv)
cipher.update(chunk)
cipher.final()
```

Cipher/Decipher 同时作为 Node Transform，支持真正的分块处理和 `stream/promises.pipeline`。一次性异步 `encrypt/decrypt` 作为便捷 API，但不能用整包缓存伪装成流式实现。

## 边界

v1 只支持 `SM4-CBC + PKCS#7`，key/iv 显式传入。模块不负责完整性、MAC、签名、业务密钥派生、默认 key/iv、资源协议或归档语义。
