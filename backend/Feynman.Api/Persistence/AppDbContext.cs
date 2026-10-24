using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Feynman.Api.Persistence;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options)
    : IdentityDbContext<ApplicationUser, IdentityRole<Guid>, Guid>(options)
{
    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<AnnotationTask> Tasks => Set<AnnotationTask>();
    public DbSet<Segment> Segments => Set<Segment>();
    public DbSet<RefreshTokenFamily> RefreshTokenFamilies => Set<RefreshTokenFamily>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<RotationReceipt> RotationReceipts => Set<RotationReceipt>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        base.OnModelCreating(model);
        model.Entity<Tenant>(b =>
        {
            b.ToTable("tenants"); b.HasKey(x => x.Id);
            b.Property(x => x.Name).HasMaxLength(200).IsRequired();
            b.Property(x => x.IsActive).HasDefaultValue(true);
        });
        model.Entity<ApplicationUser>(b =>
        {
            b.ToTable("application_users", t => t.HasCheckConstraint("ck_users_role_tenant", "(role = 'PlatformAdmin' AND tenant_id IS NULL) OR (role = 'Annotator' AND tenant_id IS NOT NULL)"));
            b.Property(x => x.Role).HasMaxLength(32).IsRequired();
            b.Property(x => x.NormalizedUserName).HasMaxLength(256).IsRequired();
            b.Property(x => x.IsActive).HasDefaultValue(true);
            b.HasIndex(x => x.NormalizedUserName).IsUnique();
            b.HasIndex(x => new { x.TenantId, x.Role, x.IsActive });
            b.HasOne(x => x.Tenant).WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        });
        model.Entity<AnnotationTask>(b =>
        {
            b.ToTable("tasks", t =>
            {
                t.HasCheckConstraint("ck_tasks_version", "row_version > 0");
                t.HasCheckConstraint("ck_tasks_status", "status IN ('Draft','Available','Claimed','Submitted','Correction','Cancelled')");
                t.HasCheckConstraint("ck_tasks_assignee", "(status IN ('Draft','Available','Cancelled') AND assignee_user_id IS NULL) OR (status IN ('Claimed','Submitted','Correction') AND assignee_user_id IS NOT NULL)");
            });
            b.HasKey(x => x.Id);
            b.Property(x => x.Name).HasMaxLength(200).IsRequired();
            b.Property(x => x.VideoUrl).HasMaxLength(2048).IsRequired();
            b.Property(x => x.Instructions).HasMaxLength(4000);
            b.Property(x => x.RejectionReason).HasMaxLength(4000);
            b.Property(x => x.Status).HasMaxLength(20).IsRequired();
            b.Property(x => x.RowVersion).IsConcurrencyToken();
            b.HasOne(x => x.Tenant).WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
            b.HasOne(x => x.AssigneeUser).WithMany().HasForeignKey(x => x.AssigneeUserId).OnDelete(DeleteBehavior.Restrict);
            b.HasOne(x => x.LatestSubmitterUser).WithMany().HasForeignKey(x => x.LatestSubmitterUserId).OnDelete(DeleteBehavior.Restrict);
            b.HasIndex(x => new { x.TenantId, x.Status, x.DueAtUtc });
            b.HasIndex(x => new { x.AssigneeUserId, x.Status });
            b.HasIndex(x => new { x.Status, x.SubmittedAtUtc });
        });
        model.Entity<Segment>(b =>
        {
            b.ToTable("segments", t => t.HasCheckConstraint("ck_segments_bounds", "start_ms >= 0 AND end_ms > start_ms"));
            b.HasKey(x => x.Id);
            b.HasOne(x => x.Task).WithMany(x => x.Segments).HasForeignKey(x => x.TaskId).OnDelete(DeleteBehavior.Restrict);
            b.HasIndex(x => new { x.TaskId, x.StartMs, x.EndMs }).IsUnique();
            b.HasIndex(x => new { x.TaskId, x.StartMs });
        });
        model.Entity<RefreshTokenFamily>(b =>
        {
            b.ToTable("refresh_token_families"); b.HasKey(x => x.Id);
            b.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
            b.HasIndex(x => new { x.UserId, x.RevokedAtUtc });
        });
        model.Entity<RefreshToken>(b =>
        {
            b.ToTable("refresh_tokens"); b.HasKey(x => x.Id);
            b.Property(x => x.TokenHash).IsRequired(); b.HasIndex(x => x.TokenHash).IsUnique();
            b.HasOne(x => x.Family).WithMany().HasForeignKey(x => x.FamilyId).OnDelete(DeleteBehavior.Restrict);
            b.HasOne(x => x.ReplacedBy).WithMany().HasForeignKey(x => x.ReplacedById).OnDelete(DeleteBehavior.Restrict);
        });
        model.Entity<RotationReceipt>(b =>
        {
            b.ToTable("rotation_receipts"); b.HasKey(x => x.TokenId);
            b.Property(x => x.EncryptedResponse).IsRequired();
            b.HasOne(x => x.Token).WithOne().HasForeignKey<RotationReceipt>(x => x.TokenId).OnDelete(DeleteBehavior.Restrict);
            b.HasIndex(x => x.ExpiresAtUtc);
        });
        model.Entity<IdentityRole<Guid>>().ToTable("identity_roles");
        model.Entity<IdentityUserRole<Guid>>().ToTable("identity_user_roles");
        model.Entity<IdentityUserClaim<Guid>>().ToTable("identity_user_claims");
        model.Entity<IdentityUserLogin<Guid>>().ToTable("identity_user_logins");
        model.Entity<IdentityUserToken<Guid>>().ToTable("identity_user_tokens");
        model.Entity<IdentityRoleClaim<Guid>>().ToTable("identity_role_claims");
        foreach (var entity in model.Model.GetEntityTypes())
        {
            foreach (var property in entity.GetProperties()) property.SetColumnName(SnakeCase(property.Name));
            foreach (var key in entity.GetKeys()) key.SetName(SnakeCase(key.GetName()!));
            foreach (var index in entity.GetIndexes()) index.SetDatabaseName(SnakeCase(index.GetDatabaseName()!));
            foreach (var foreignKey in entity.GetForeignKeys())
            {
                foreignKey.DeleteBehavior = DeleteBehavior.Restrict;
                foreignKey.SetConstraintName(SnakeCase(foreignKey.GetConstraintName()!));
            }
        }
    }

    private static string SnakeCase(string name) => string.Concat(name.Select((c, i) => char.IsUpper(c) ? (i > 0 && name[i - 1] != '_' ? "_" : "") + char.ToLowerInvariant(c) : c.ToString()));
}

public sealed class AppDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args)
    {
        var connection = DatabaseConnection.Resolve();
        return new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(connection).Options);
    }
}
