# 视频片段标注平台详细设计

> 文档依据：[需求文档](proposal.md)、[概要设计](high-level-design.md)及本轮逐项确认结果。业务规则以需求和确认结果为准；本文的类、接口、字段和实现算法是落实已选技术栈的设计，不构成额外产品功能。

## 1. 设计范围

本设计覆盖 React/TypeScript 前端、ASP.NET Core Web API、EF Core/PostgreSQL 数据结构和本地演示运行。生产部署拓扑、密钥管理、数据库备份恢复策略留待部署设计。

### 1.1 已确认约束

| 项目 | 规则 |
| --- | --- |
| 技术栈 | React + TypeScript + Vite；ASP.NET Core Web API / C#；.NET 10 LTS；Node.js 24 LTS；PostgreSQL 18；EF Core PostgreSQL provider。 |
| 认证 | JWT Bearer Access Token 仅保存在前端内存；Refresh Token 通过 HttpOnly + Secure Cookie 传递。Access Token 15 分钟。Refresh Token 空闲期 7 天、绝对期限 30 天，成功刷新轮换旧令牌。 |
| 并发刷新 | 同一会话使用服务端短暂幂等窗口；窗口内并发重试返回同一轮换结果。窗口外重放撤销该会话令牌族。 |
| Cookie / CORS / CSRF | SameSite 按部署设置：同站 Lax，跨站 None 且 Secure；CORS 使用显式源站 allowlist，携带凭据时禁止通配符；刷新端点校验 Origin/Referer 并用双提交 CSRF Token。 |
| 用户名 / 密码 | 用户名全局唯一；轻量校验：首尾去空白、长度 1–50 字符、大小写不敏感唯一，不施加字符集限制。初始密码由管理员设置为临时密码，首次登录必须修改；密码使用 ASP.NET Identity 默认规则。 |
| 任务 | 创建为草稿；草稿可编辑、可取消；管理员另行发布后成为可领取任务。发布后任务基本信息锁定。名称 1–200 字符、说明最多 4000 字符、视频 URL 最多 2048 字符且只允许 HTTP/HTTPS。截止时间按 Asia/Shanghai 输入并以 UTC 保存。 |
| 片段 | 毫秒整数；每段有稳定 ID；完全重复段禁止；按起点升序返回；无业务数量上限，以请求体大小限制单次操作规模。每次新增、修改、删除立即持久化。 |
| 任务处置 | 管理员“收回”是独立操作，将已领取任务解除分配并恢复可领取；“取消”进入已取消终态。退回任务默认由原标注员修正，管理员可改派；改派保留片段。 |
| 视频时长 | 浏览器可获得时将时长毫秒值随片段保存/提交请求发送；服务端据此校验边界。无法获得时长时跳过边界检查，其他片段规则仍由服务端强制执行。 |
| API | 统一使用 ASP.NET Core Problem Details（RFC 9457）JSON 错误响应并带稳定业务错误码。列表使用页码分页，默认 20 条、上限 100 条，支持排序和筛选。 |
| 本地运行 | PostgreSQL 18 由 Docker Compose 启动；本地演示数据包含虚构管理员、租户和标注员。 |

## 2. 模块边界

### 2.1 前端模块

| 模块 | 职责 | 依赖 / 可独立验证边界 |
| --- | --- | --- |
| 会话模块 | 登录、登出、首次改密、Access Token 内存状态、刷新 Cookie 恢复会话、刷新请求合并。 | 依赖 API 客户端；使用认证 API mock 可单测状态迁移。 |
| API 客户端 | 统一 Base URL、JSON 编解码、Bearer 头、credentials、错误解析、401 刷新后单次重试、分页参数。 | 依赖会话令牌接口；可用 fetch mock 独立测试。 |
| 管理员工作区 | 租户、用户、任务草稿/发布/收回/取消/退回/改派和每日统计查询。 | 只依赖 API 客户端，不含领域裁决。 |
| 标注员工作区 | 查询可领取任务及本人任务、领取/退回、呈现状态和截止信息。 | 依赖任务 API。 |
| 视频播放器 | 直接加载公开视频 URL、读取 `HTMLMediaElement.duration`、报告时长可用/不可用及播放错误。 | 不向后端代理媒体；播放器包装器可替换为测试双对象。 |
| 片段编辑器 | 毫秒时间输入、片段列表、添加/修改/删除、总时长展示、服务端校验反馈。 | 仅通过片段 API 持久化；本地校验只作即时提示。 |

前端路由和组件不决定权限。隐藏操作只属于交互优化，后端每次请求仍从身份和数据库检查授权、账号/租户状态及资源状态。

### 2.2 后端模块

后端按单体 Web API 分层，业务模块可独立测试，不将数据库访问暴露给控制器。

| 模块 | 应用服务 | 职责 |
| --- | --- | --- |
| Auth | `AuthService`, `RefreshTokenService` | 密码验证、令牌签发/轮换/撤销、会话并发幂等、停用账号拒绝认证。 |
| Tenant | `TenantService` | 管理员租户创建、列表、详情、停用；保留历史记录。 |
| Account | `AccountService` | 管理员创建账户、角色和租户绑定、临时密码及停用；停用后撤销 Refresh Token。 |
| Task | `TaskService` | 草稿管理、发布、租户内列表/详情、领取、标注员退回、管理员收回/取消、逾期派生、管理员退回和改派。 |
| Annotation | `SegmentService` | 片段增改删查、版本条件写、毫秒边界/重叠/重复校验。 |
| Submission | `SubmissionService` | 原子提交、锁定、最近提交人/时间更新、管理员退回。 |
| Statistics | `StatisticsService` | 按 Asia/Shanghai 日期范围查询当前有效提交总量和租户/标注员/任务/片段明细。 |
| Persistence | `AppDbContext` + EF Core configurations | 实体映射、唯一约束、迁移、事务及 PostgreSQL 条件更新。 |

依赖方向：HTTP Controllers → 应用服务 → 领域校验 / EF Core。Statistics 只读 Task/Segment/User/Tenant 数据。Task、Segment 和 Submission 的写流程通过同一任务聚合及应用事务协作；认证与账户用 ASP.NET Core Identity 管理凭据，领域用户扩展 Identity 用户记录。

## 3. 领域状态和授权

### 3.1 任务状态

```text
Draft --管理员发布--> Available --标注员领取--> Claimed --标注员提交--> Submitted
  |                       ^                         |                         |
  +--管理员取消--> Cancelled                       +--标注员退回--> Available  +--管理员退回--> Correction
                                                    |                                |
                                                    +--管理员收回--> Available       +--标注员提交--> Submitted
                                                                                     +--管理员改派--> Correction
                                                                                     +--管理员收回--> Available
```

| 当前状态 | 命令 | 操作者 | 下一状态 / 效果 |
| --- | --- | --- | --- |
| Draft | 编辑任务 | 管理员 | Draft；更新任务名称、租户、URL、说明、截止时间。 |
| Draft | 发布 | 管理员 | Available；检查租户有效及必填字段。 |
| Draft | 取消 | 管理员 | Cancelled。 |
| Available | 领取 | 同租户标注员 | Claimed；写入领取人。 |
| Available | 取消 | 管理员 | Cancelled。 |
| Claimed | 保存片段 | 当前领取人 | Claimed；片段写入，任务版本递增。 |
| Claimed | 标注员退回 | 当前领取人 | Available；清除领取人，片段保留。 |
| Claimed | 管理员收回 | 管理员 | Available；清除领取人，片段保留。 |
| Claimed | 管理员取消 | 管理员 | Cancelled；同一事务解除领取并取消。 |
| Claimed | 提交 | 当前领取人 | Submitted；记录本次提交人和 UTC 时间，片段锁定。 |
| Submitted | 管理员退回 | 管理员 | Correction；保留片段，立即退出统计。 |
| Submitted | 管理员取消 | 管理员 | 拒绝；已提交任务不能取消。 |
| Correction | 保存片段 | 当前被分配标注员 | Correction；片段原地更新。 |
| Correction | 提交 | 当前被分配标注员 | Submitted；重新验证片段，更新最近提交者和 UTC 时间。 |
| Correction | 管理员改派 | 管理员 | Correction；更换领取人，保留片段。 |
| Correction | 管理员收回 | 管理员 | Available；清除领取人，片段保留。 |
| Correction | 管理员取消 | 管理员 | 拒绝；已提交后退回的任务仍不可取消。 |
| Cancelled | 任意写命令 | 任意角色 | 拒绝；终态。 |

截止时间不构成状态：`isOverdue = dueAtUtc != null && nowUtc > dueAtUtc`。逾期不阻止领取或提交；该标志只描述当前时刻是否超过截止时间，不改变提交结果。

### 3.2 角色和资源授权

- `PlatformAdmin` 可管理所有租户、账号、任务及统计。每个管理端路由要求管理员策略。
- `Annotator` 必须有 `TenantId`。请求租户范围只由签名身份对应的数据库用户记录推导；不接受客户端 TenantId 作为授权依据。
- 标注员任务列表、详情、领取、保存、删除、提交和退回均同时检查：用户有效、租户有效、任务 TenantId 相同、状态允许、领取人匹配。
- 管理员收回、取消、退回或改派写操作需显式检查状态条件。改派对象必须是有效且属于同一租户的标注员。
- Access Token 验证通过后，授权处理器读取当前用户状态及租户状态；停用立即影响后续 API 请求。Refresh Token 同样检查账号和租户状态。
- 停用不会自动解除领取；管理员需使用收回操作。历史 Task、Segment、提交人和统计追溯数据保留。

## 4. HTTP API 契约

### 4.1 通用约定

- API 根路径为 `/api/v1`；请求和响应使用 UTF-8 JSON，时间戳为 ISO 8601 UTC（`Z`），日期筛选使用 `YYYY-MM-DD`。
- 普通 API 使用 `Authorization: Bearer <access-token>`。登录、刷新、登出及首次改密是认证流程例外；刷新和登出请求携带 Cookie 与 CSRF Token。
- 每个写操作传 `expectedVersion`（任务 `rowVersion`）或 `If-Match` 版本。当前版本不匹配返回 `409 concurrency_conflict`，前端刷新资源后由操作者重新操作，不自动覆盖服务端内容。
- 分页参数：`page` 默认 1，`pageSize` 默认 20、最大 100；越界页大小按 400 错误拒绝。排序字段通过端点白名单枚举，禁止将任意字段名拼入 SQL。响应 `{items, page, pageSize, totalItems, totalPages}`。
- 稳定的业务错误 `code` 使用 `snake_case`；客户端按 HTTP 状态码和 code 分支，不解析英文/中文 detail 文本。
- JSON 错误响应使用 RFC 9457 Problem Details：`type`, `title`, `status`, `detail`, `instance`, `code`, 可选 `errors`（字段校验列表）和 `traceId`。

### 4.2 API 清单

| 方法与路径 | 角色 | 用途 / 请求要点 |
| --- | --- | --- |
| `POST /api/v1/auth/login` | 匿名 | `{username,password}`；成功返回 `{accessToken, expiresAtUtc, user}` 并设置刷新 Cookie。停用账户拒绝。首次登录标记需改密。 |
| `POST /api/v1/auth/refresh` | Cookie + CSRF | 检查 Origin/Referer、双提交 Token、刷新令牌状态；轮换并返回新 Access Token。 |
| `POST /api/v1/auth/logout` | Cookie + CSRF | 撤销当前令牌族并清理 Cookie。重复登出幂等成功。 |
| `POST /api/v1/auth/change-password` | 已认证 | `{currentPassword,newPassword}`；校验 Identity 默认策略，清除 `mustChangePassword`，撤销其他会话令牌族并重新登录。 |
| `GET /api/v1/auth/me` | 已认证 | 返回当前用户、角色、租户和首次改密标志。 |
| `GET /api/v1/tenants` | 管理员 | 分页查询，可按启停状态和名称筛选。 |
| `POST /api/v1/tenants` | 管理员 | `{name}` 创建启用租户。 |
| `GET /api/v1/tenants/{tenantId}` | 管理员 | 查询租户详情。 |
| `POST /api/v1/tenants/{tenantId}/deactivate` | 管理员 | 停用租户；保留关联数据。 |
| `POST /api/v1/users` | 管理员 | `{username,role,tenantId?,temporaryPassword}`；标注员必须提供有效 tenantId；管理员 tenantId 为空。 |
| `GET /api/v1/users` | 管理员 | 分页筛选用户名、角色、租户和启停状态。 |
| `POST /api/v1/users/{userId}/deactivate` | 管理员 | 停用账号并撤销全部刷新令牌。 |
| `POST /api/v1/tasks` | 管理员 | 创建 Draft：`{tenantId,name,videoUrl,instructions?,dueAtLocal?}`；`dueAtLocal` 格式为无偏移的 `YYYY-MM-DDTHH:mm:ss`，按 Asia/Shanghai 解释。 |
| `GET /api/v1/tasks` | 管理员 | 分页查询，支持 tenant、status、overdue、截止时间区间筛选。 |
| `GET /api/v1/tasks/available` | 标注员 | 查询当前租户可领取任务，分页、可按名称和逾期状态筛选。 |
| `GET /api/v1/tasks/mine` | 标注员 | 查询本人 Claimed、Correction 和已提交任务，分页、支持状态筛选。 |
| `GET /api/v1/tasks/{taskId}` | 管理员/授权标注员 | 详情含状态、分配人、版本、片段摘要、视频边界状态。 |
| `PATCH /api/v1/tasks/{taskId}` | 管理员 | 只允许 Draft；部分更新任务字段并检查版本。 |
| `POST /api/v1/tasks/{taskId}/publish` | 管理员 | Draft → Available。 |
| `POST /api/v1/tasks/{taskId}/claim` | 同租户标注员 | Available → Claimed。条件更新保证唯一领取者。 |
| `POST /api/v1/tasks/{taskId}/return` | 当前领取标注员 | Claimed → Available，清除领取人、保留片段。 |
| `POST /api/v1/tasks/{taskId}/recall` | 管理员 | Claimed/Correction → Available，解除分配、保留片段。 |
| `POST /api/v1/tasks/{taskId}/cancel` | 管理员 | Draft/Available/Claimed → Cancelled；领取人清除与状态转换原子完成。Submitted 和 Correction 拒绝取消。 |
| `POST /api/v1/tasks/{taskId}/reject` | 管理员 | Submitted → Correction；请求 `{reason?}`，保存退回时间和可选说明。 |
| `POST /api/v1/tasks/{taskId}/reassign` | 管理员 | Correction 下更换标注员 `{assigneeUserId}`；保留片段。 |
| `GET /api/v1/tasks/{taskId}/segments` | 管理员/当前标注员 | 获取按 `startMs, id` 排序的当前片段集合。 |
| `POST /api/v1/tasks/{taskId}/segments` | 当前标注员 | 新增 `{startMs,endMs,videoDurationMs?,expectedVersion}`；返回保存后的片段及新版本。 |
| `PUT /api/v1/tasks/{taskId}/segments/{segmentId}` | 当前标注员 | 更新 `{startMs,endMs,videoDurationMs?,expectedVersion}`。 |
| `DELETE /api/v1/tasks/{taskId}/segments/{segmentId}` | 当前标注员 | 按稳定 ID 删除，需带版本条件。 |
| `POST /api/v1/tasks/{taskId}/submit` | 当前标注员 | `{videoDurationMs?,expectedVersion}`；服务端重读并完整校验片段后提交。 |
| `GET /api/v1/statistics/daily` | 管理员 | `fromDate,toDate,tenantId?,annotatorId?`；返回日期总毫秒数及分页分组/任务/片段明细。日期闭区间按 Shanghai 日界线换 UTC 半开区间查询。 |

### 4.3 成功响应结构

- 单资源以资源 DTO 直接返回；分页使用通用分页结构。
- 任务 DTO 至少包含 `id, tenantId, name, videoUrl, instructions, dueAtUtc, status, assigneeUserId, latestSubmitterUserId, submittedAtUtc, version, isOverdue`。
- 片段 DTO 为 `{id, taskId, startMs, endMs, durationMs}`；`durationMs` 由服务端计算，不接收客户端提供。
- 统计明细按 `date → tenant → annotator → task → segment` 分组；任务记录 `durationMs` 为所属片段的求和。

## 5. 数据模型与 EF Core

所有主键采用 UUID；应用层生成 UUIDv7 或 UUID 随机值，具体生成器属于实现选择。所有 UTC 时间列使用 PostgreSQL `timestamptz`，毫秒字段使用 `bigint`。表名/列名采用 snake_case。

### 5.1 实体

#### Tenant

| 字段 | PostgreSQL 类型 | 规则 |
| --- | --- | --- |
| `id` | `uuid` | PK。 |
| `name` | `varchar(200)` | 必填；是否需全局唯一未由需求指定，不添加唯一业务约束。 |
| `is_active` | `boolean` | 默认 true。 |
| `created_at_utc` | `timestamptz` | 必填。 |
| `deactivated_at_utc` | `timestamptz null` | 停用时写入。 |

#### ApplicationUser（ASP.NET Identity 扩展用户）

Identity 所需凭据及锁定字段使用框架 schema；扩展字段如下：

| 字段 | PostgreSQL 类型 | 规则 |
| --- | --- | --- |
| `id` | `uuid` | PK。 |
| `normalized_user_name` | `varchar(256)` | 全局唯一索引；用户名先 Unicode 规范化、去首尾空白，再按 Identity 规范化器比较。 |
| `role` | `varchar(32)` | `PlatformAdmin` 或 `Annotator`。 |
| `tenant_id` | `uuid null` | 标注员必填并 FK Tenant；管理员必须为空。 |
| `is_active` | `boolean` | 默认 true。 |
| `must_change_password` | `boolean` | 管理员创建账号时 true；首次改密后 false。 |
| `created_at_utc` | `timestamptz` | 必填。 |
| `deactivated_at_utc` | `timestamptz null` | 停用时间。 |

#### Task

| 字段 | PostgreSQL 类型 | 规则 |
| --- | --- | --- |
| `id` | `uuid` | PK。 |
| `tenant_id` | `uuid` | 必填 FK Tenant；历史租户保留。 |
| `name` | `varchar(200)` | 必填，长度 1–200。 |
| `video_url` | `varchar(2048)` | 必填，绝对 HTTP/HTTPS URL；仅做语法校验，不由后端请求该地址。 |
| `instructions` | `varchar(4000) null` | 可空，最多 4000 字符。 |
| `due_at_utc` | `timestamptz null` | 截止时间；不设则无截止。 |
| `status` | `varchar(20)` | `Draft`, `Available`, `Claimed`, `Submitted`, `Correction`, `Cancelled`。 |
| `assignee_user_id` | `uuid null` | 当前领取/修正负责人 FK User；Available/Cancelled/Draft 时为空。 |
| `latest_submitter_user_id` | `uuid null` | 最近一次有效提交者；提交成功时更新，退回不清除以供审计，但统计只按 Submitted 状态计入。 |
| `submitted_at_utc` | `timestamptz null` | 最近一次成功提交时间；退回期间保留，重提时覆盖。 |
| `created_at_utc` | `timestamptz` | 必填。 |
| `updated_at_utc` | `timestamptz` | 每次写操作更新。 |
| `row_version` | `bigint` | 单调递增并发版本，所有写命令必须比较并递增。 |

#### Segment

| 字段 | PostgreSQL 类型 | 规则 |
| --- | --- | --- |
| `id` | `uuid` | PK，稳定标识。 |
| `task_id` | `uuid` | 必填 FK Task，删除任务采用禁止级联删除。 |
| `start_ms` | `bigint` | 非负。 |
| `end_ms` | `bigint` | 大于 `start_ms`。 |
| `created_at_utc` | `timestamptz` | 必填。 |
| `updated_at_utc` | `timestamptz` | 必填。 |

不保存编辑历史；每个任务仅保留当前一套片段。PostgreSQL CHECK：`start_ms >= 0 AND end_ms > start_ms`。重叠检查为应用事务内跨行验证；区间定义允许首尾相接，因此两个排序后相邻片段仅在 `previous.end_ms > current.start_ms` 时重叠。完全相同的起止组合在任务内禁止。

#### RefreshTokenFamily / RefreshToken

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| Family: `id,user_id,created_at_utc,absolute_expires_at_utc,revoked_at_utc` | UUID / FK / UTC | 每个登录会话一个族；账号停用或重放时撤销该用户全部族或对应族。 |
| Token: `id,family_id,token_hash,created_at_utc,idle_expires_at_utc,consumed_at_utc,revoked_at_utc,replaced_by_id` | UUID / FK / bytea / UTC | 只保存 HMAC-SHA-256 指纹，不保存可重放明文。空闲期限最长 7 天且不得超过 Family 绝对期限。 |
| RotationReceipt: `token_id,encrypted_response,expires_at_utc` | FK / bytea / UTC | 短幂等窗口的临时轮换响应密文，使同一旧令牌的并发重试获得完全相同的新令牌响应；窗口到期后删除。加密密钥由应用配置提供。 |

### 5.2 约束与索引

- 唯一：`application_users(normalized_user_name)`、`segments(task_id,start_ms,end_ms)`、`refresh_tokens(token_hash)`。
- FK：Task → Tenant；Task assignee/latest submitter → User；Segment → Task；RefreshTokenFamily → User；RefreshToken → Family。
- 查询索引：`tasks(tenant_id,status,due_at_utc)`、`tasks(assignee_user_id,status)`、`tasks(status,submitted_at_utc)`、`segments(task_id,start_ms)`、`users(tenant_id,role,is_active)`、`refresh_token_families(user_id,revoked_at_utc)`。
- 启停和状态字段不物理删除；关联用户/租户停用保留 FK 与历史归属。
- 迁移通过 EF Core migrations 管理；应用启动不自动执行生产迁移。本地启动脚本显式执行 `dotnet ef database update`。

## 6. 关键应用逻辑

### 6.1 创建、发布、取消、收回、改派

- 创建只生成 Draft；验证任务名称、租户存在且启用、绝对 HTTP/HTTPS URL、URL 长度及可选字段长度。
- Draft 编辑与发布、取消通过 `row_version` 条件更新。发布仅允许 Draft，发布前复核租户仍启用。
- 领取、收回、取消、退回和改派均是显式命令，不接受客户端直接设置 `status` 或 `assignee_user_id`。
- 管理员收回 Claimed/Correction 时，清除 `assignee_user_id`，转为 Available，保留片段和最近提交元数据。
- 管理员取消 Draft/Available/Claimed 时，原子转为 Cancelled 并清除 `assignee_user_id`；Submitted 和 Correction 状态返回冲突错误。待修正任务曾处于已提交状态，不能通过取消终止。
- 改派仅在 Correction 状态；目标必须为有效、启用且同租户标注员。只替换负责人，不清理片段。

### 6.2 领取并发

应用在事务内执行单条条件更新：

```sql
UPDATE tasks
SET status = 'Claimed', assignee_user_id = @user_id,
    row_version = row_version + 1, updated_at_utc = @now_utc
WHERE id = @task_id
  AND tenant_id = @identity_tenant_id
  AND status = 'Available'
  AND row_version = @expected_version;
```

更新行数为 1 即成功；为 0 时重新读取并按资源不存在/租户隔离/状态冲突/版本冲突映射错误。租户及用户启用状态在同一事务中检查。并发事务中 PostgreSQL 对该行的条件更新串行裁决，因此最多一个请求成功。

### 6.3 片段持久化和校验

每次片段新增、修改、删除均在事务中：

1. 加载 Task 并检查身份用户、租户、状态为 Claimed 或 Correction、负责人匹配、租户和用户仍启用、`row_version` 匹配。
2. 若 `videoDurationMs` 有值，检查其为正整数，且片段 `startMs >= 0`、`endMs <= videoDurationMs`。无时长则记录本次边界未校验状态供响应提示，但不跳过其他校验。
3. 检查所有片段 `startMs < endMs`；对任务剩余片段排序后检测相交区间；`end == next.start` 合法。
4. 检查无重复 `(startMs,endMs)`；单次新增/更新完成后仍需对整组片段验证。
5. 写片段与 `row_version + 1` 同事务提交。冲突后不部分写入。

提交接口再次从数据库读取全部当前片段，不能信任此前前端验证或之前的片段 API 结果。提交必须至少有一个片段；每段正长度、非负且无重叠/重复；如本次请求有视频时长则做边界检查。读取不到时长返回 `videoBoundaryVerified: false` 和提示代码 `video_duration_unavailable`，但只要其他规则有效仍可提交。片段总时长以 `bigint` 毫秒计算：`SUM(end_ms - start_ms)`。

### 6.4 提交 / 退回原子性

提交事务先锁定或条件更新 Task 版本行，再重新验证负责人和状态，加载并校验片段，最后更新 `status=Submitted`、`latest_submitter_user_id`、`submitted_at_utc=nowUtc`、`row_version+1`。任务状态更新失败时整笔回滚。

管理员退回在 `status=Submitted AND row_version=@expected` 条件下更新为 Correction 并递增版本；片段不修改。统计查询只过滤 Submitted，因此事务提交后该任务立即退出统计。重新提交覆盖最近提交者/时间，按新时间和当前片段计入；旧提交时间不再产生一条统计记录。

### 6.5 收回/取消与保存/提交竞争

所有写操作按同一 Task `row_version` 条件更新。收回/取消先成功后，标注员随后请求因负责人或状态不符被拒绝；提交先成功会把状态改为 Submitted，使取消命令失败，管理员须走退回流程。片段写入若和收回/取消竞争，通过版本条件和同一任务行事务序列化；失败请求整体回滚并返回冲突，客户端重新加载任务。

### 6.6 日期统计

统计日期按 `Asia/Shanghai` 计算。应用将 `fromDate 00:00:00` 与 `toDate + 1 day 00:00:00` 在该时区构造，再分别转换 UTC，SQL 使用半开区间 `submitted_at_utc >= fromUtc AND submitted_at_utc < toUtcExclusive`。查询过滤 `status='Submitted'`，关联租户、当前最新提交人和片段，聚合毫秒总量并返回明细。数据库和应用主机本地时区不参与日期边界计算。

初始方案实时聚合，不维护统计预聚合表。每日总量和明细必须来自同一查询快照/事务，确保用户展开时数值和片段一致。日期范围较长时仍分页返回明细；汇总值独立于明细分页计算。

## 7. 认证、安全及错误处理

### 7.1 Access Token

- 签名 JWT 包含 `sub`, `jti`, `iss`, `aud`, `iat`, `nbf`, `exp`, `role`。租户 ID 可作便捷声明，但授权决策以数据库用户记录为准。
- 生命周期固定 15 分钟；签名密钥来自本地开发配置或部署注入，不写入版本控制。
- 每次请求验证签名、Issuer、Audience、时钟偏差和有效期，并通过授权处理器检查账户及租户当前状态。
- 前端内存保存 Access Token，刷新页面后调用 Refresh API 恢复；不得写 localStorage/sessionStorage。

### 7.2 Refresh Token 与 CSRF

- 令牌为密码学安全随机不透明值；Cookie 设置 HttpOnly、Secure、Path 限制和部署指定 SameSite。
- 数据库保存令牌 HMAC 指纹。成功使用时原子消费旧令牌、创建新令牌并滑动 idle expiry，且不超过 30 天绝对期限。
- 对短暂并发幂等窗口内重复的旧令牌，返回已生成的相同轮换响应；返回材料在 RotationReceipt 中加密保存并在窗口到期后清理。窗口外旧令牌重放撤销整个 Family。
- 同一前端标签页通过单一 refresh promise 合并等待者；服务端幂等处理多标签页/网络重试竞争。
- 停用用户或租户拒绝刷新；管理员停用用户时事务撤销其全部 Family。登出撤销当前 Family。
- Refresh/Logout 校验允许 Origin/Referer。双提交 CSRF Token 使用会话 ID 绑定的 HMAC 签名值，由 API 下发可由前端读取的 CSRF Cookie，刷新时同时提交 `X-CSRF-Token` Header；服务端验证签名、会话绑定及 Cookie/Header 相等，令牌轮换时更新 CSRF 值。CSRF Token 不承担认证功能。
- CORS 仅允许部署配置中的确切前端 Origin；启用 credentials 时不允许 `*`。允许的 Header 至少包括 Authorization、Content-Type、X-CSRF-Token、If-Match。

### 7.3 Problem Details 错误映射

| HTTP | 业务错误示例 | 说明 |
| --- | --- | --- |
| 400 | `validation_failed`, `invalid_pagination`, `invalid_video_url` | 请求结构或字段规则不满足。 |
| 401 | `invalid_credentials`, `token_expired`, `refresh_token_invalid` | 未认证或会话无效。 |
| 403 | `account_disabled`, `tenant_disabled`, `role_forbidden` | 用户/租户停用或角色不符。 |
| 404 | `resource_not_found` | 资源不存在；标注员跨租户访问也统一返回 404，避免泄露资源存在性。 |
| 409 | `task_state_conflict`, `task_already_claimed`, `concurrency_conflict`, `segment_overlap`, `segment_duplicate`, `submission_requires_segment` | 当前状态、并发版本或业务集合校验冲突。 |
| 413 | `request_too_large` | 请求体超过配置大小。 |
| 429 | `rate_limit_exceeded` | 登录/刷新等认证端点超过配置限速。 |

验证器提供字段级 `errors`；服务端异常只返回通用 500 Problem Details 和 `traceId`，详细堆栈仅写服务端日志。用户名/密码失败使用不区分账户是否存在的统一错误，避免账户枚举。

## 8. 时间、视频与浏览器交互

- 浏览器直接将 `videoUrl` 赋给原生 `<video>`；不把 URL 发送给 API 代理，不下载或持久化视频文件。
- `loadedmetadata` 且 `duration` 有限时，前端将秒转换为整数毫秒：`Math.round(duration * 1000)`。媒体时长为 `Infinity`、`NaN`、未触发或浏览器读取失败时视为不可用。
- 片段起止值在 UI/API 均为整数毫秒。格式化只影响显示，不改变传输值；时间线拖动后四舍五入到毫秒。
- 每次新增/修改片段和最终提交都携带当前可得的 `videoDurationMs`；服务端校验据此执行。删除片段不需传时长。响应显式返回 `videoBoundaryVerified`，界面在 false 时展示未验证提示。
- 截止时间控件展示 Shanghai 本地时间；输入转换成明确的本地日期时间字段后由服务端按 `Asia/Shanghai` 转 UTC。响应只传 UTC 时间戳，前端按 Shanghai 显示。
- 片段相对视频起点，不进行任何时区转换。

## 9. 本地演示和种子数据

- Docker Compose 仅启动 PostgreSQL 18；前后端分别使用 Node/.NET 开发命令运行，满足独立开发和调试。
- 启动步骤：复制不入库的本地配置模板、启动数据库、执行 EF Core migrations、运行 seed、启动 API 与 Vite。
- Seed 创建一个启用租户、一个平台管理员和一个该租户标注员；用户名及临时密码为虚构演示凭据，明确写入本地启动说明。代码库只放占位模板或本地开发值，不使用用户真实秘密。
- 默认 Push-T 视频作为外部公开直链配置，不下载到应用；示例视频地址的可用性属于演示环境检查项，不作为 API 健康检查依赖。
- 本地 HTTPS 配置应满足 Secure Cookie；若本机证书尚未信任，启动说明需包含开发证书信任步骤。生产证书和 TLS 拓扑不在本文范围。

## 10. 测试设计

后端业务服务通过 PostgreSQL 集成测试验证事务和约束；纯校验器与日期转换使用单元测试；HTTP 授权和 Problem Details 使用 WebApplicationFactory/API 集成测试。每个业务模块均可在不启动前端的情况下独立测试。

| 测试层 | 必测范围 |
| --- | --- |
| Domain / Unit | 片段正长度、负值、重叠拒绝、首尾相接允许、完全重复拒绝、时长已知边界和时长未知跳过、空片段拒绝；状态转换允许表；Shanghai 午夜边界/夏令时无误差转换。 |
| Persistence / Integration | 双用户并发领取只一个成功；任务版本冲突不覆盖；保存与收回/取消竞争原子裁决；提交与取消竞争；数据库唯一用户名和片段重复约束；迁移可从空数据库应用。 |
| API | 标注员跨租户列表/详情/领取/片段/提交均拒绝且不泄露；停用用户或租户现有 Access Token 请求被拒；停用撤销 Refresh Token；Problem Details schema/code；分页页大小默认和上限。 |
| Auth | 登录、首次改密、密码默认规则、Access 15 分钟声明、Refresh 7 天 idle / 30 天 absolute、轮换、幂等并发重试、窗口外重放撤销 family、登出和停用。 |
| Statistics | 只统计 Submitted；退回即移除；再次提交只按新日期计当前片段；按 Shanghai 日期半开区间；租户/标注员/任务/片段明细与毫秒总和一致。 |
| Frontend component | API 客户端 Bearer/credentials/Problem Details/刷新合并；视频 duration 不可用提示；片段增改删调用与状态反馈；提交后编辑入口禁用。 |
| E2E | 本地管理员登录→创建租户/标注员→草稿任务编辑并发布→标注员领取/标注/提交→管理员退回→原标注员修正或管理员改派→重新提交→每日统计核对；并覆盖停用、逾期、收回、草稿/可领取/已领取任务取消，以及待修正和已提交任务取消被拒绝。 |

## 11. 配置边界与未包含项

以下由部署配置或后续部署设计提供，不由业务代码写死：前后端生产域名和 CORS allowlist、SameSite 环境值、TLS 终止点、JWT/令牌指纹及临时响应加密密钥注入、生产 PostgreSQL 地址、连接凭据、密钥轮换、备份恢复、扩缩容和监控告警。

API 请求体大小、登录/刷新限速、JWT issuer/audience、SPA 与 API 本地端口、具体 NuGet/npm 补丁版本应作为配置或依赖锁文件管理。除已确认的 .NET 10、Node.js 24、PostgreSQL 18 外，不在设计中指定未确认的具体包版本。

不实现视频抓取/代理、视频上传、片段历史版本、草稿自动发布、独立统计预聚合、跨租户标注、已提交任务取消、未经管理员退回的已提交编辑。
