# Auth（认证与会话）

## 最小任务

- [x] 配置 ASP.NET Core Identity 用户认证基础和密码哈希存储，禁止明文密码持久化。
- [x] 实现账号密码登录、停用账号拒绝、角色声明和首次登录改密标记。
- [x] 实现 15 分钟 JWT Bearer Access Token 签发及声明验证。
- [x] 实现不透明高熵 Refresh Token、数据库仅存指纹、7 天空闲期和 30 天绝对期限。
- [x] 实现刷新令牌轮换、登出撤销和停用账号时令牌族撤销。
- [x] 实现同会话短暂幂等窗口，窗口内并发刷新返回同一轮换结果。
- [x] 实现窗口外 Refresh Token 重放时撤销对应令牌族。
- [x] 配置刷新端点 Origin/Referer 校验、双提交 CSRF Token、Cookie SameSite/Secure 参数及显式 CORS allowlist。
- [x] 统一认证错误为 RFC 9457 Problem Details 和稳定业务错误码。
- [x] 测试登录、首次改密、过期、轮换、并发幂等、重放撤销、登出、停用和 Cookie/CSRF 行为。

## 完成条件

- Access Token 仅经响应提供给前端内存管理；Refresh Token 不出现在 JSON 或持久化明文中。
- 用户或租户停用后，旧 Access Token 的受保护请求和 Refresh Token 均被拒绝。

