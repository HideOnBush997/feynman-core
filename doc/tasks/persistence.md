# Persistence（持久化）

## 最小任务

- [x] 建立 ASP.NET Core 后端解决方案分层骨架和 `AppDbContext`，业务控制器不直接访问数据库。
- [x] 映射 Tenant、Identity User 扩展、Task、Segment、RefreshToken 等实体及关系。
- [x] 配置必要唯一约束、外键、索引、并发版本和删除行为，保留历史记录所需数据。
- [x] 创建 EF Core 初始迁移，并验证可从空 PostgreSQL 18 数据库应用。
- [x] 配置 PostgreSQL 事务边界、条件更新及并发领取/任务状态转换所需持久化操作。
- [x] 建立 Docker Compose PostgreSQL 18 本地服务和健康检查。
- [x] 建立本地配置模板与忽略规则；模板不包含真实凭据或生产秘密。
- [x] 实现可重复运行的演示 Seed：虚构管理员、启用租户、标注员及演示凭据配置。
- [x] 编写启动说明：配置、启动数据库、迁移、Seed、启动 API/前端和 HTTPS 开发证书信任。
- [x] 测试迁移空库应用、数据库约束、事务行为和演示 Seed 重复运行。

## 完成条件

- 本地完整启动路径可复现，演示账号为虚构值且只写入本地启动说明/开发配置。
- 数据库不保存 Refresh Token 明文；历史业务数据不会因停用而级联删除。

