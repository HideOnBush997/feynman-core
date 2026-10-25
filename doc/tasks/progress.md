# 实现进度

依据：[`proposal.md`](../proposal.md)、[`high-level-design.md`](../high-level-design.md)、[`detailed-design.md`](../detailed-design.md)

模块全部子任务完成并通过对应验收后，才勾选模块。子任务状态见各模块文件。

## 前端模块

- [x] [会话模块](session.md)
- [x] [API 客户端](api-client.md)
- [x] [管理员工作区](admin-workspace.md)
- [x] [标注员工作区](annotator-workspace.md)
- [x] [视频播放器](video-player.md)
- [x] [片段编辑器](segment-editor.md)

## 后端模块

- [x] [Auth](auth.md)
- [x] [Tenant](tenant.md)
- [x] [Account](account.md)
- [x] [Task](task.md)
- [x] [Annotation](annotation.md)
- [x] [Submission](submission.md)
- [x] [Statistics](statistics.md)
- [x] [Persistence](persistence.md)

## 端到端验收

- [x] 本地环境可按启动说明启动，演示管理员、租户和标注员可用。
- [x] 完成管理员创建租户/标注员、发布任务，标注员领取/标注/提交，管理员退回、修正/改派、重新提交及每日统计核对的完整流程。
- [x] 验证跨租户访问拒绝、并发领取、收回/取消与保存/提交竞争、停用、逾期及取消状态限制。
- [x] 验证视频边界可用与不可用两种情况，以及毫秒片段规则和 Asia/Shanghai 统计日期。

## 验证记录（2026-10-24）

- .NET 10 / PostgreSQL 18 真实数据库：Persistence 11、Auth 13、API/Domain 38，共 62 项通过，0 跳过。
- 前端 TypeScript/Vite 构建、Prettier 检查通过；Vitest 29 项通过。
- Playwright HTTPS E2E 2 项通过；管理员到标注员再到修正重提和统计流程、跨租户/并发/停用/逾期/取消限制已验收。
- scripts/setup.ps1 实际重复执行成功：证书、工具恢复、迁移、幂等 Seed、依赖安装均通过。
- 最终交付与截图：D:\Codex\Outputs\feynman-platform；启动方式及演示凭据位置见根目录 README.md。

## 问题修复与复测（2026-10-25）

- 修复统计筛选变化后请求失败仍显示旧数字的问题；加载/失败显示不可用，提供当前条件重试，并阻止过期请求覆盖新结果。
- 修复重复用户名被解释为状态冲突的问题；前后端均提供中文重名提示，其他片段业务错误保留其具体含义。
- 账号列表接口返回租户名称，停用且无任务的租户不再导致其账号归属名称丢失；创建表单仍只允许启用租户。
- 修复前新增回归测试已复现问题；修复后真实PostgreSQL后端70、前端48、隔离HTTPS E2E5项全部通过，构建、格式及Git空白检查通过。
- Chrome DevTools MCP实际完成断网切换租户、恢复重试、停用租户名称、重复账号提示4项验证。
- 本地7043 API已重启加载修复，5173前端可用；原6任务保留，本轮临时数据库与应用服务已清理。
- 报告、截图和日志：D:\Codex\Outputs\feynman-audit-fixes-20261025。

