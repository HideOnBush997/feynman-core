using System.Data;
using System.Security.Claims;
using System.Text;
using Feynman.Api.Domain;
using Feynman.Api.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Feynman.Api.Services;

public sealed class BusinessService(AppDbContext db, UserManager<ApplicationUser> users)
{
    public async Task<ApplicationUser> Actor(HttpContext http, bool admin = false)
    {
        var id = http.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? http.User.FindFirstValue("sub");
        if (!Guid.TryParse(id, out var userId)) throw new AppException(401, "token_expired", "请先登录。");
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == userId)
            ?? throw new AppException(401, "token_expired", "会话无效。");
        if (!user.IsActive) throw new AppException(403, "account_disabled", "账号已停用。");
        if (user.TenantId is Guid tenantId && !await db.Tenants.AnyAsync(t => t.Id == tenantId && t.IsActive))
            throw new AppException(403, "tenant_disabled", "租户已停用。");
        if (admin && user.Role != "PlatformAdmin") throw new AppException(403, "role_forbidden", "需要管理员权限。");
        return user;
    }

    private async Task<ApplicationUser> LockActor(HttpContext http, bool admin = false)
    {
        var actor = await Actor(http, admin);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM application_users WHERE id={actor.Id} FOR SHARE");
        if (actor.TenantId is Guid tenantId)
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM tenants WHERE id={tenantId} FOR SHARE");
        return await Actor(http, admin);
    }

    public static (int Page, int Size) Pagination(HttpContext http)
    {
        static int Parse(string? text, int fallback) => string.IsNullOrEmpty(text) ? fallback :
            int.TryParse(text, out var n) ? n : throw new AppException(400, "invalid_pagination", "分页参数必须为整数。");
        var page = Parse(http.Request.Query["page"], 1);
        var size = Parse(http.Request.Query["pageSize"], 20);
        if (page < 1 || size is < 1 or > 100 || page > int.MaxValue / size)
            throw new AppException(400, "invalid_pagination", "page ≥ 1，pageSize 范围为 1–100。");
        return (page, size);
    }
    public static Guid? GuidFilter(HttpContext http, string key)
    {
        var value = http.Request.Query[key].FirstOrDefault();
        if (string.IsNullOrEmpty(value)) return null;
        if (!Guid.TryParse(value, out var id)) throw new AppException(400, "validation_failed", $"{key} 必须为有效的 UUID。");
        return id;
    }
    private static async Task<PagedResult<T>> Page<T>(IQueryable<T> query, HttpContext http)
    {
        var (page, size) = Pagination(http);
        return new(await query.Skip((page - 1) * size).Take(size).ToListAsync(), page, size, await query.LongCountAsync());
    }
    private static string Name(string? value, int max)
    {
        var name = value?.Trim() ?? "";
        if (name.Length == 0 || name.Length > max) throw new AppException(400, "validation_failed", $"名称长度必须为 1–{max}。");
        return name;
    }
    private async Task ActiveTenant(Guid id)
    {
        if (!await db.Tenants.AnyAsync(t => t.Id == id && t.IsActive)) throw new AppException(400, "tenant_disabled", "请选择启用的租户。");
    }
    public async Task<object> Tenants(HttpContext h)
    {
        await Actor(h, true);
        var q = db.Tenants.AsNoTracking().AsQueryable();
        if (h.Request.Query["optionsOnly"] == "true")
            q = q.Where(t => t.IsActive || db.Tasks.Any(task => task.TenantId == t.Id));
        if (h.Request.Query["name"].FirstOrDefault() is { Length: > 0 } name) q = q.Where(t => t.Name.Contains(name));
        if (bool.TryParse(h.Request.Query["isActive"], out var active)) q = q.Where(t => t.IsActive == active);
        return await Page(q.OrderBy(t => t.CreatedAtUtc).ThenBy(t => t.Id), h);
    }
    public async Task<object> Tenant(HttpContext h, Guid id)
    {
        await Actor(h, true);
        return await db.Tenants.AsNoTracking().SingleOrDefaultAsync(t => t.Id == id) ?? throw Missing();
    }
    public async Task<object> CreateTenant(HttpContext h, TenantInput input)
    {
        await using var tx = await db.Database.BeginTransactionAsync();
        await LockActor(h, true);
        var tenant = new Tenant { Id = Guid.NewGuid(), Name = Name(input.Name, 200), IsActive = true, CreatedAtUtc = DateTime.UtcNow };
        db.Tenants.Add(tenant); await db.SaveChangesAsync(); await tx.CommitAsync(); return tenant;
    }
    public async Task<object> DeactivateTenant(HttpContext h, Guid id)
    {
        await using var tx = await db.Database.BeginTransactionAsync();
        await LockActor(h, true);
        var tenant = await db.Tenants.FromSqlInterpolated($"SELECT * FROM tenants WHERE id={id} FOR UPDATE").SingleOrDefaultAsync() ?? throw Missing();
        tenant.IsActive = false; tenant.DeactivatedAtUtc ??= DateTime.UtcNow;
        var ids = db.Users.Where(u => u.TenantId == id).Select(u => u.Id);
        await db.RefreshTokenFamilies.Where(f => ids.Contains(f.UserId) && f.RevokedAtUtc == null)
            .ExecuteUpdateAsync(s => s.SetProperty(f => f.RevokedAtUtc, DateTime.UtcNow));
        await db.SaveChangesAsync(); await tx.CommitAsync(); return tenant;
    }
    private static object UserDto(ApplicationUser u) => new { u.Id, Username = u.UserName, u.Role, u.TenantId, u.IsActive, MustChangePassword = false, u.CreatedAtUtc };
    public async Task<object> Accounts(HttpContext h)
    {
        await Actor(h, true);
        var q = db.Users.AsNoTracking().AsQueryable();
        if (h.Request.Query["optionsOnly"] == "true")
            q = q.Where(u => (u.IsActive && (u.TenantId == null || u.Tenant!.IsActive)) ||
                db.Tasks.Any(task => task.AssigneeUserId == u.Id || task.LatestSubmitterUserId == u.Id));
        if (h.Request.Query["username"].FirstOrDefault() is { Length: > 0 } name) q = q.Where(u => u.UserName!.Contains(name));
        if (h.Request.Query["role"].FirstOrDefault() is { Length: > 0 } role) q = q.Where(u => u.Role == role);
        if (GuidFilter(h, "tenantId") is Guid tenant) q = q.Where(u => u.TenantId == tenant);
        if (bool.TryParse(h.Request.Query["isActive"], out var active)) q = q.Where(u => u.IsActive == active);
        return await Page(q.OrderBy(u => u.CreatedAtUtc).ThenBy(u => u.Id).Select(u => new
        {
            u.Id,
            Username = u.UserName,
            u.Role,
            u.TenantId,
            TenantName = u.Tenant == null ? null : u.Tenant.Name,
            u.IsActive,
            MustChangePassword = false,
            u.CreatedAtUtc
        }), h);
    }
    public async Task<object> CreateAccount(HttpContext h, UserInput input)
    {
        await using var tx = await db.Database.BeginTransactionAsync(); await LockActor(h, true);
        if (input.Role is not ("PlatformAdmin" or "Annotator") || (input.Role == "Annotator") != input.TenantId.HasValue)
            throw new AppException(400, "validation_failed", "标注员必须绑定租户；管理员不绑定租户。");
        if (input.TenantId is Guid tenantId)
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM tenants WHERE id={tenantId} FOR SHARE");
            await ActiveTenant(tenantId);
        }
        var username = Name(input.Username?.Normalize(NormalizationForm.FormKC), 50);
        var user = new ApplicationUser
        {
            Id = Guid.NewGuid(),
            UserName = username,
            Role = input.Role,
            TenantId = input.TenantId,
            IsActive = true,
            MustChangePassword = false,
            CreatedAtUtc = DateTime.UtcNow
        };
        var result = await users.CreateAsync(user, input.TemporaryPassword ?? "");
        if (!result.Succeeded)
            throw new AppException(result.Errors.Any(e => e.Code == "DuplicateUserName") ? 409 : 400,
                result.Errors.Any(e => e.Code == "DuplicateUserName") ? "username_conflict" : "validation_failed",
                string.Join(" ", result.Errors.Select(e => e.Description)));
        await tx.CommitAsync(); return UserDto(user);
    }
    public async Task<object> DeactivateAccount(HttpContext h, Guid id)
    {
        await using var tx = await db.Database.BeginTransactionAsync(); await LockActor(h, true);
        var user = await db.Users.FromSqlInterpolated($"SELECT * FROM application_users WHERE id={id} FOR UPDATE").SingleOrDefaultAsync() ?? throw Missing();
        user.IsActive = false; user.DeactivatedAtUtc ??= DateTime.UtcNow;
        await db.RefreshTokenFamilies.Where(f => f.UserId == id && f.RevokedAtUtc == null)
            .ExecuteUpdateAsync(s => s.SetProperty(f => f.RevokedAtUtc, DateTime.UtcNow));
        await db.SaveChangesAsync(); await tx.CommitAsync(); return UserDto(user);
    }
    public static AppException Missing() => new(404, "resource_not_found", "资源不存在。");
}
