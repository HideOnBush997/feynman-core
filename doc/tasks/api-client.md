# API 客户端

## 最小任务

- [x] 配置统一 API Base URL 和 JSON 请求/响应编解码。
- [x] 为受保护请求注入会话模块提供的 Bearer Access Token；按认证契约设置 Cookie credentials。
- [x] 解析 RFC 9457 Problem Details，并保留稳定业务错误码供界面分支处理。
- [x] 实现一次 401 刷新后重试原请求；刷新后仍失败时不循环重试。
- [x] 实现页码分页参数和默认值；遵循服务端默认 20、上限 100 的约定。
- [x] 为常用 HTTP 方法提供类型安全的请求封装及 fetch mock 单元测试。

## 完成条件

- 测试覆盖 Bearer、credentials、JSON、Problem Details、分页、401 单次刷新重试及并发刷新协调。
- 网络错误、验证错误和未预期错误均能被调用方区分并展示。

