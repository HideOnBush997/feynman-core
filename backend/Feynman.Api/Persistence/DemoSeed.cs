using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Feynman.Api.Persistence;

public sealed class DemoSeedOptions
{
    public string TenantName { get; set; } = "演示租户";
    public string AdminUsername { get; set; } = "demo.admin";
    public string AdminPassword { get; set; } = "";
    public string AnnotatorUsername { get; set; } = "demo.annotator";
    public string AnnotatorPassword { get; set; } = "";
    public string VideoUrl { get; set; } = "https://diffusion-policy.cs.columbia.edu/videos/highlight_pusht.mp4";
}

public static class DemoSeed
{
    public static readonly Guid TenantId = Guid.Parse("00000000-0000-0000-0000-000000000101");
    public static readonly Guid TaskId = Guid.Parse("00000000-0000-0000-0000-000000000102");

    public static async Task RunAsync(AppDbContext db, UserManager<ApplicationUser> users, DemoSeedOptions options, CancellationToken cancellationToken = default)
    {
        // One transaction and a database advisory lock make reruns, including concurrent runs, idempotent.
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(729106214)", cancellationToken);
        if (!await db.Tenants.AnyAsync(x => x.Id == TenantId, cancellationToken))
        {
            db.Tenants.Add(new Tenant { Id = TenantId, Name = options.TenantName });
            await db.SaveChangesAsync(cancellationToken);
        }
        await EnsureUserAsync(users, options.AdminUsername, options.AdminPassword, Roles.PlatformAdmin, null);
        await EnsureUserAsync(users, options.AnnotatorUsername, options.AnnotatorPassword, Roles.Annotator, TenantId);
        if (!await db.Tasks.AnyAsync(x => x.Id == TaskId, cancellationToken))
        {
            db.Tasks.Add(new AnnotationTask { Id = TaskId, TenantId = TenantId, Name = "Push-T 片段标注演示", VideoUrl = options.VideoUrl, Status = TaskStates.Available, Instructions = "标出有用的动作片段；视频由浏览器直接播放。" });
            await db.SaveChangesAsync(cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
    }

    private static async Task EnsureUserAsync(UserManager<ApplicationUser> users, string name, string password, string role, Guid? tenantId)
    {
        var existing = await users.FindByNameAsync(name);
        if (existing is not null)
        {
            if (existing.Role != role || existing.TenantId != tenantId)
                throw new InvalidOperationException($"Seed username '{name}' already belongs to a different role or tenant.");
            return;
        }
        var user = new ApplicationUser { UserName = name, Role = role, TenantId = tenantId, MustChangePassword = true };
        var result = await users.CreateAsync(user, password);
        if (!result.Succeeded) throw new InvalidOperationException("Demo seed failed: " + string.Join("; ", result.Errors.Select(x => x.Description)));
    }
}

