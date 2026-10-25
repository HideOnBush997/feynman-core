using Feynman.Api.Domain;
using Feynman.Api.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Feynman.Api.Services;

public sealed class TaskService(AppDbContext db, BusinessService business)
{
    private static AppException Conflict(string code = "task_state_conflict") => new(409, code, "任务状态或版本已变化，请刷新后重试。");
    private static void Annotator(ApplicationUser user)
    {
        if (user.Role != Roles.Annotator) throw new AppException(403, "role_forbidden", "需要标注员身份。");
    }
    private async Task<ApplicationUser> LockActor(HttpContext h, bool admin = false)
    {
        var actor = await business.Actor(h, admin);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM application_users WHERE id={actor.Id} FOR SHARE");
        if (actor.TenantId is Guid tenantId) await db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM tenants WHERE id={tenantId} FOR SHARE");
        return await business.Actor(h, admin);
    }
    private async Task<AnnotationTask> Load(Guid id, ApplicationUser actor, bool locked = false, bool claiming = false)
    {
        var q = locked ? db.Tasks.FromSqlInterpolated($"SELECT * FROM tasks WHERE id={id} FOR UPDATE") : db.Tasks.AsQueryable();
        var task = await q.SingleOrDefaultAsync(t => t.Id == id) ?? throw BusinessService.Missing();
        if (actor.Role != Roles.PlatformAdmin && task.TenantId != actor.TenantId) throw BusinessService.Missing();
        if (!claiming && actor.Role != Roles.PlatformAdmin && task.Status != TaskStates.Available && task.AssigneeUserId != actor.Id)
            throw BusinessService.Missing();
        await db.Entry(task).Collection(t => t.Segments).LoadAsync();
        return task;
    }
    private static void Version(AnnotationTask task, long version)
    {
        if (version != task.RowVersion) throw Conflict("concurrency_conflict");
    }
    private static void Editable(AnnotationTask task, ApplicationUser actor)
    {
        Annotator(actor);
        if (task.AssigneeUserId != actor.Id || task.Status is not (TaskStates.Claimed or TaskStates.Correction)) throw Conflict();
    }
    private async Task<TaskDto> Save(AnnotationTask task, bool verified = false)
    {
        task.RowVersion = checked(task.RowVersion + 1); task.UpdatedAtUtc = DateTime.UtcNow;
        await db.SaveChangesAsync(); return TaskDto.From(task, verified);
    }
    private static void Fields(AnnotationTask task)
    {
        task.Name = task.Name?.Trim() ?? "";
        if (task.Name.Length is < 1 or > 200 || task.Instructions?.Length > 4000)
            throw new AppException(400, "validation_failed", "任务名称为 1–200 字，说明最多 4000 字。");
        if (task.VideoUrl?.Length > 2048 || !Uri.TryCreate(task.VideoUrl, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
            throw new AppException(400, "invalid_video_url", "请提供 HTTP/HTTPS 绝对视频直链。");
    }
    private async Task Tenant(Guid id)
    {
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM tenants WHERE id={id} FOR SHARE");
        if (!await db.Tenants.AnyAsync(t => t.Id == id && t.IsActive)) throw new AppException(403, "tenant_disabled", "租户不存在或已停用。");
    }
    public async Task<TaskDto> Create(HttpContext h, TaskInput input)
    {
        await using var tx = await db.Database.BeginTransactionAsync(); await LockActor(h, true); await Tenant(input.TenantId);
        var task = new AnnotationTask
        {
            TenantId = input.TenantId,
            Name = input.Name,
            VideoUrl = input.VideoUrl,
            Instructions = input.Instructions,
            DueAtUtc = ShanghaiTime.ParseLocal(input.DueAtLocal)
        };
        Fields(task); db.Tasks.Add(task); await db.SaveChangesAsync(); await tx.CommitAsync(); return TaskDto.From(task);
    }
    public async Task<TaskDto> Detail(HttpContext h, Guid id) => TaskDto.From(await Load(id, await business.Actor(h)));
    public async Task<object> List(HttpContext h, string mode)
    {
        var actor = await business.Actor(h, mode == "all");
        var q = db.Tasks.AsNoTracking().AsQueryable();
        if (mode != "all")
        {
            Annotator(actor); q = q.Where(t => t.TenantId == actor.TenantId);
            q = mode == "available" ? q.Where(t => t.Status == TaskStates.Available) :
                q.Where(t => t.AssigneeUserId == actor.Id && (t.Status == TaskStates.Claimed || t.Status == TaskStates.Correction || t.Status == TaskStates.Submitted));
        }
        else if (BusinessService.GuidFilter(h, "tenantId") is Guid tenant) q = q.Where(t => t.TenantId == tenant);
        if (h.Request.Query["name"].FirstOrDefault() is { Length: > 0 } name) q = q.Where(t => t.Name.Contains(name));
        if (h.Request.Query["status"].FirstOrDefault() is { Length: > 0 } status) q = q.Where(t => t.Status == status);
        if (bool.TryParse(h.Request.Query["overdue"], out var overdue)) q = q.Where(t => (t.DueAtUtc != null && t.DueAtUtc < DateTime.UtcNow) == overdue);
        foreach (var key in new[] { "dueFromUtc", "dueToUtc" })
        {
            if (string.IsNullOrEmpty(h.Request.Query[key])) continue;
            if (!DateTimeOffset.TryParse(h.Request.Query[key], System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal, out var parsed))
                throw new AppException(400, "validation_failed", "截止时间筛选无效。");
            var date = parsed.UtcDateTime;
            q = key == "dueFromUtc" ? q.Where(t => t.DueAtUtc >= date) : q.Where(t => t.DueAtUtc < date);
        }
        var sort = h.Request.Query["sort"].FirstOrDefault() ?? "createdAtUtc";
        q = sort switch { "createdAtUtc" => q.OrderByDescending(t => t.CreatedAtUtc).ThenBy(t => t.Id), "dueAtUtc" => q.OrderBy(t => t.DueAtUtc).ThenBy(t => t.Id), "name" => q.OrderBy(t => t.Name).ThenBy(t => t.Id), _ => throw new AppException(400, "validation_failed", "排序字段无效。") };
        var (page, size) = BusinessService.Pagination(h); var total = await q.LongCountAsync();
        var items = await q.Skip((page - 1) * size).Take(size).Include(t => t.Segments).ToListAsync();
        return new PagedResult<TaskDto>(items.Select(t => TaskDto.From(t)).ToArray(), page, size, total);
    }
    public async Task<TaskDto> Patch(HttpContext h, Guid id, TaskPatch patch, bool hasInstructions = true, bool hasDueAtLocal = true)
    {
        await using var tx = await db.Database.BeginTransactionAsync(); var actor = await LockActor(h, true); var task = await Load(id, actor, true);
        Version(task, patch.ExpectedVersion); if (task.Status != TaskStates.Draft) throw Conflict();
        if (patch.TenantId.HasValue) task.TenantId = patch.TenantId.Value;
        await Tenant(task.TenantId);
        task.Name = patch.Name ?? task.Name; task.VideoUrl = patch.VideoUrl ?? task.VideoUrl;
        if (hasInstructions) task.Instructions = patch.Instructions;
        if (hasDueAtLocal) task.DueAtUtc = ShanghaiTime.ParseLocal(patch.DueAtLocal);
        Fields(task);
        var result = await Save(task); await tx.CommitAsync(); return result;
    }
    public async Task<TaskDto> Transition(HttpContext h, Guid id, string action, Command input)
    {
        await using var tx = await db.Database.BeginTransactionAsync();
        var admin = action is "publish" or "recall" or "cancel" or "reject" or "reassign";
        var actor = await LockActor(h, admin); var task = await Load(id, actor, true, action == "claim"); Version(task, input.ExpectedVersion);
        if (!admin || action is "publish" or "reassign") await Tenant(task.TenantId);
        switch (action)
        {
            case "publish":
                if (task.Status != TaskStates.Draft) throw Conflict(); Fields(task); task.Status = TaskStates.Available; break;
            case "claim":
                Annotator(actor); if (task.Status != TaskStates.Available) throw Conflict("task_already_claimed");
                task.Status = TaskStates.Claimed; task.AssigneeUserId = actor.Id; break;
            case "return":
                Editable(task, actor); if (task.Status != TaskStates.Claimed) throw Conflict();
                task.Status = TaskStates.Available; task.AssigneeUserId = null; break;
            case "recall":
                if (task.Status is not (TaskStates.Claimed or TaskStates.Correction)) throw Conflict();
                task.Status = TaskStates.Available; task.AssigneeUserId = null; break;
            case "cancel":
                if (task.Status is not (TaskStates.Draft or TaskStates.Available or TaskStates.Claimed)) throw Conflict();
                task.Status = TaskStates.Cancelled; task.AssigneeUserId = null; break;
            case "reject":
                if (task.Status != TaskStates.Submitted) throw Conflict();
                if (input.Reason?.Length > 4000) throw new AppException(400, "validation_failed", "退回说明最多 4000 字。");
                task.Status = TaskStates.Correction; task.RejectedAtUtc = DateTime.UtcNow; task.RejectionReason = input.Reason; break;
            case "reassign":
                if (task.Status != TaskStates.Correction) throw Conflict();
                if (input.AssigneeUserId is not Guid target) throw new AppException(400, "validation_failed", "请选择标注员。");
                await db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM application_users WHERE id={target} FOR SHARE");
                if (!await db.Users.AnyAsync(u => u.Id == target && u.TenantId == task.TenantId && u.Role == Roles.Annotator && u.IsActive))
                    throw new AppException(400, "validation_failed", "目标必须是本租户启用的标注员。");
                task.AssigneeUserId = target; break;
            case "submit":
                Editable(task, actor); SegmentRules.Validate(task.Segments.Select(s => new Interval(s.StartMs, s.EndMs)), input.VideoDurationMs, true);
                task.Status = TaskStates.Submitted; task.SubmittedAtUtc = DateTime.UtcNow; task.LatestSubmitterUserId = actor.Id; break;
            default: throw BusinessService.Missing();
        }
        var result = await Save(task, action == "submit" && input.VideoDurationMs.HasValue); await tx.CommitAsync(); return result;
    }
    public async Task<object> Segments(HttpContext h, Guid id)
    {
        var actor = await business.Actor(h); var task = await Load(id, actor);
        if (actor.Role != Roles.PlatformAdmin && task.AssigneeUserId != actor.Id) throw BusinessService.Missing();
        var dto = TaskDto.From(task); return new { Items = dto.Segments, dto.Version, dto.VideoBoundaryVerified, dto.Warnings };
    }
    public async Task<TaskDto> Segment(HttpContext h, Guid taskId, Guid? segmentId, SegmentInput input, bool delete = false)
    {
        await using var tx = await db.Database.BeginTransactionAsync(); var actor = await LockActor(h); var task = await Load(taskId, actor, true);
        Version(task, input.ExpectedVersion); Editable(task, actor); await Tenant(task.TenantId);
        Segment? segment = null;
        if (segmentId.HasValue) segment = task.Segments.SingleOrDefault(s => s.Id == segmentId) ?? throw BusinessService.Missing();
        if (delete) { task.Segments.Remove(segment!); db.Segments.Remove(segment!); }
        else
        {
            if (segment is null) { segment = new Segment { TaskId = task.Id }; task.Segments.Add(segment); db.Segments.Add(segment); }
            segment.StartMs = input.StartMs; segment.EndMs = input.EndMs; segment.UpdatedAtUtc = DateTime.UtcNow;
        }
        SegmentRules.Validate(task.Segments.Select(s => new Interval(s.StartMs, s.EndMs)), input.VideoDurationMs);
        var result = await Save(task, input.VideoDurationMs.HasValue); await tx.CommitAsync(); return result;
    }
}
