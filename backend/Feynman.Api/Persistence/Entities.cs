using Microsoft.AspNetCore.Identity;

namespace Feynman.Api.Persistence;

public static class Roles
{
    public const string PlatformAdmin = "PlatformAdmin";
    public const string Annotator = "Annotator";
}

public static class TaskStates
{
    public const string Draft = "Draft";
    public const string Available = "Available";
    public const string Claimed = "Claimed";
    public const string Submitted = "Submitted";
    public const string Correction = "Correction";
    public const string Cancelled = "Cancelled";
}

public sealed class Tenant
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public string Name { get; set; } = "";
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? DeactivatedAtUtc { get; set; }
}

public sealed class ApplicationUser : IdentityUser<Guid>
{
    public ApplicationUser() { Id = Guid.CreateVersion7(); }
    public string Role { get; set; } = Roles.Annotator;
    public Guid? TenantId { get; set; }
    public Tenant? Tenant { get; set; }
    public bool IsActive { get; set; } = true;
    public bool MustChangePassword { get; set; } = true;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? DeactivatedAtUtc { get; set; }
}

public sealed class AnnotationTask
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Tenant Tenant { get; set; } = null!;
    public string Name { get; set; } = "";
    public string VideoUrl { get; set; } = "";
    public string? Instructions { get; set; }
    public DateTime? DueAtUtc { get; set; }
    public string Status { get; set; } = TaskStates.Draft;
    public Guid? AssigneeUserId { get; set; }
    public ApplicationUser? AssigneeUser { get; set; }
    public Guid? LatestSubmitterUserId { get; set; }
    public ApplicationUser? LatestSubmitterUser { get; set; }
    public DateTime? SubmittedAtUtc { get; set; }
    public DateTime? RejectedAtUtc { get; set; }
    public string? RejectionReason { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
    public long RowVersion { get; set; } = 1;
    public ICollection<Segment> Segments { get; set; } = new List<Segment>();
}

public sealed class Segment
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TaskId { get; set; }
    public AnnotationTask Task { get; set; } = null!;
    public long StartMs { get; set; }
    public long EndMs { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}

public sealed class RefreshTokenFamily
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid UserId { get; set; }
    public ApplicationUser User { get; set; } = null!;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime AbsoluteExpiresAtUtc { get; set; }
    public DateTime? RevokedAtUtc { get; set; }
}

public sealed class RefreshToken
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid FamilyId { get; set; }
    public RefreshTokenFamily Family { get; set; } = null!;
    public byte[] TokenHash { get; set; } = [];
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime IdleExpiresAtUtc { get; set; }
    public DateTime? ConsumedAtUtc { get; set; }
    public DateTime? RevokedAtUtc { get; set; }
    public Guid? ReplacedById { get; set; }
    public RefreshToken? ReplacedBy { get; set; }
}

public sealed class RotationReceipt
{
    public Guid TokenId { get; set; }
    public RefreshToken Token { get; set; } = null!;
    public byte[] EncryptedResponse { get; set; } = [];
    public DateTime ExpiresAtUtc { get; set; }
}
