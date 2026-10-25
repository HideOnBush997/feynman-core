# 费曼智核 · 视频片段标注平台

React / TypeScript / Vite 前端，ASP.NET Core 10 API，EF Core 10 + PostgreSQL 18。浏览器直接播放公开视频；应用不上传、下载、代理或保存视频。产品规则见 `doc/`，验收状态见 `doc/tasks/progress.md`。

[个人仓库](https://github.com/HideOnBush997/feynman-core) · [实现决策、AI使用与验收报告](report.md) · [界面设计规范](design-system/feynman-core/MASTER.md)

## 环境与启动

需要 Windows PowerShell 7、Node.js 24、.NET SDK 10、Docker Desktop Linux containers。开发端口：PostgreSQL 5432、API HTTPS 7043、前端 HTTPS 5173。端口及源站为开发配置；生产参数需另行注入。

```powershell
# 仓库根目录；Docker Desktop 需已启动
./scripts/setup.ps1
# 分别在两个终端运行
./scripts/start-api.ps1
./scripts/start-web.ps1
```

访问 https://localhost:5173。setup 生成独立随机密钥到被忽略的 `backend/Feynman.Api/appsettings.Local.json`，启动数据库并等待健康检查，信任开发 HTTPS 证书、导出前端 PEM、恢复 EF 工具、显式迁移、幂等 Seed 和安装前端依赖。证书、NuGet/npm 缓存和浏览器测试工具保存在 `D:\Codex\Work`。脚本兼容本机安装在 `D:\Codex\Work\dotnet` 的 SDK，也可使用 PATH 中的 SDK 10。

首次信任开发证书时 Windows 可能显示系统证书信任对话框。若浏览器仍显示证书错误，重新执行 `dotnet dev-certs https --trust` 并重启浏览器。

演示账号默认名为 `demo.admin` 和 `demo.annotator`，登录后直接进入工作台。账号密码只要求至少 6 位，可使用纯数字或字母。新环境 setup 为管理员、标注员和数据库生成独立随机口令，仅写入被忽略的本地配置。账号初始口令可在本机 `backend/Feynman.Api/appsettings.Local.json` 的 `DemoSeed` 中查看；已改密账号使用自己设置的密码。Seed 不重置已有密码、不覆盖业务数据。

默认演示视频来自 [Diffusion Policy 官方项目](https://diffusion-policy.cs.columbia.edu/)，直链为 [Push-T 视频](https://diffusion-policy.cs.columbia.edu/videos/highlight_pusht.mp4)。2026-10-24 检查返回 HTTP 200、video/mp4 和 Accept-Ranges，大小约 5 MB。外部源不可用时页面会显示播放失败和 `video_duration_unavailable`，其他规则继续由服务器校验。

## 手动步骤

复制 `backend/Feynman.Api/appsettings.Local.example.json` 为 `appsettings.Local.json`，将数据库、演示账号口令及三个占位密钥替换为独立随机值，并把数据库配置同步到被忽略的 `.env`；签名及 HMAC 密钥不少于 32 字节，加密密钥必须为 32 随机字节的 Base64。不要提交该文件。

```powershell
docker compose up -d --wait
dotnet tool restore
dotnet ef database update --project backend/Feynman.Api
dotnet run --project backend/Feynman.Api -- --seed
```

应用正常启动不会自动迁移。环境变量 `ConnectionStrings__Database`、`Auth__SigningKey` 等覆盖本地配置。`Auth:AllowedOrigins` 必须为不含路径和尾斜杠的准确源站；本地默认只允许 `https://localhost:5173`。同站 Cookie 为 Lax；跨站部署须使用 None、HTTPS 及准确 CORS 白名单。配置示例包含可调的登录/刷新限速和请求大小设置（未填写时为每分钟 60 次认证请求、1 MiB 请求体）。

前端默认通过 Vite `/api` 代理调用本地 HTTPS API。独立部署时用 `VITE_API_BASE_URL` 设置包含 `/api/v1` 的 API 根地址，构建 `npm run build`；API 不托管前端静态文件。

## 测试与验收

后端测试连接真实 PostgreSQL 18，为各用例创建独立临时数据库，并在结束后删除。默认从被忽略的本地配置读取数据库账号，也可用 `FEYNMAN_TEST_DATABASE` 设置有 CREATE DATABASE 权限的 PostgreSQL 管理连接。不要将该变量指向生产环境。

```powershell
dotnet test Feynman.slnx
dotnet format Feynman.slnx --verify-no-changes
cd frontend
npm run build
npm test
npm run format:check
# 启动 API 与前端后
$env:PLAYWRIGHT_BROWSERS_PATH = 'D:\Codex\Work\playwright-browsers'
npx playwright install chromium
npm run e2e
```

E2E 使用环境变量 `E2E_ADMIN_USERNAME` / `E2E_ADMIN_PASSWORD` 或被忽略的 `frontend/.env.e2e.local` 登录现有管理员；无需首次登录改密。E2E 会创建测试租户、账号和任务，应使用独立测试环境。测试账号临时口令仅属于测试夹具，不用作管理员或数据库口令。具体测试与实际执行结果见 [report.md](report.md) 及进度文档。

2026-10-25 验收：后端 70 项、前端组件/客户端 48 项、浏览器 E2E 5 项通过，均无跳过。新增回归覆盖统计筛选失败后的旧数据清理与重试、重复用户名中文提示，以及停用无任务租户后的账号归属显示。后端启用编译警告视为错误，并使用 `packages.lock.json`；前端依赖使用 `package-lock.json`。可用 `dotnet restore --locked-mode` 和 `npm ci` 重现依赖。

## 关键实现选择

- 任务聚合写操作在事务中锁定同一任务行、比较 `row_version` 并递增。领取、片段保存、提交、收回和取消竞争由同一版本裁决，失败事务整体回滚。
- 当前用户及租户状态每次受保护请求重新读取。写操作对用户/租户持共享锁，防止停用与写入交错造成越权。
- 片段保存和提交使用相同校验器；整数毫秒、非负、正长度、无重复/重叠，相邻合法；未知视频时长只跳过边界检查。
- Access Token 15 分钟且仅存前端内存。Refresh Token 高熵随机，数据库存 HMAC 指纹，7 天空闲/30 天绝对期限；轮换响应仅在短幂等窗口内加密保存。默认窗口 10 秒。
- 统计按 Shanghai 日界线转 UTC 半开区间，在同一 Repeatable Read 快照计算当前 Submitted 总量与分页详情。日期/租户/人员汇总包含全部符合条件任务；任务和片段叶节点只展示当前页，因此分页不改变汇总。
- 不包含生产部署、视频存储/代理、片段历史、统计预聚合或已提交任务取消。
