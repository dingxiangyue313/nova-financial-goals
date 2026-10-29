# 模拟R1发布日志脱敏核验

范围：本次工作区生产HTTP日志、API解析失败和服务端模型诊断。不是对任意未来代码或用户自行添加日志的永久保证。原始账单证据数据库不作为发布日志导出。

## 发现并修复

- HTTP path原先包含真实动态参数；现在只记录路由模板，未知/静态路径使用固定占位，不记录query。
- 调用方可提供request-id夹带任意内容；现在由服务端生成关联ID。
- 不记录请求体、Cookie、Authorization、签名、账号与响应体；仅允许事件名、关联ID、受控方法、模板路径、状态码、耗时。
- 畸形JSON由受控错误处理返回固定错误码，避免Express默认stderr打印原文片段。
- DeepSeek诊断只记录HTTP状态、Zod问题code及允许的错误类别；不打印字段路径、用户正文、模型原文或任意Error.name。

## 已执行核验

- release-log-http.test.ts启动真实production服务，将固定合成敏感标记放入path/query/body/header/cookie/request-id/签名及畸形JSON，扫描捕获的stdout/stderr，确认未出现。
- release-log-privacy.test.ts模拟模型响应记录键和值、用户消息、API Key及网络错误名称，确认诊断不打印标记；没有调用真实模型。
- http-hardening.test.ts原CSP/敏感限流与脱敏回归继续保留。
- 生产console输出人工清点：index仅服务地址和固定Worker错误；deepseek-client仅上述受控诊断；http-hardening只写allowlist元数据。测试/本地评测脚本不是生产请求日志。

问题包和对账导出继续使用各自的字段白名单与既有测试。测试只使用合成标记，不扫描或输出用户真实密钥。最终日志位置和全量结果见DEVELOPMENT_CHECKPOINT.md；正式部署仍需使用同一提交复现与PR审查。
