using Feynman.Api.Persistence;

namespace Feynman.Api.Services;

public sealed record TenantInput(string Name);
public sealed record UserInput(string Username, string Role, Guid? TenantId, string TemporaryPassword);
public sealed record TaskInput(Guid TenantId, string Name, string VideoUrl, string? Instructions, string? DueAtLocal);
public sealed record TaskPatch(long ExpectedVersion, Guid? TenantId, string? Name, string? VideoUrl, string? Instructions, string? DueAtLocal);
public sealed record Command(long ExpectedVersion, Guid? AssigneeUserId = null, string? Reason = null, long? VideoDurationMs = null);
public sealed record SegmentInput(long StartMs, long EndMs, long ExpectedVersion, long? VideoDurationMs);
public sealed record SegmentDto(Guid Id, Guid TaskId, long StartMs, long EndMs, long DurationMs);
public sealed record TaskDto(Guid Id, Guid TenantId, string Name, string VideoUrl, string? Instructions,
    DateTime? DueAtUtc, string Status, Guid? AssigneeUserId, Guid? LatestSubmitterUserId, DateTime? SubmittedAtUtc,
    long Version, bool IsOverdue, IReadOnlyList<SegmentDto> Segments, long DurationMs, bool VideoBoundaryVerified,
    string[] Warnings, string? RejectionReason, DateTime? RejectedAtUtc)
{
    public static TaskDto From(AnnotationTask task, bool verified = false) => new(task.Id, task.TenantId, task.Name,
        task.VideoUrl, task.Instructions, task.DueAtUtc, task.Status, task.AssigneeUserId, task.LatestSubmitterUserId,
        task.SubmittedAtUtc, task.RowVersion, task.DueAtUtc < DateTime.UtcNow,
        task.Segments.OrderBy(s => s.StartMs).ThenBy(s => s.Id).Select(s => new SegmentDto(s.Id, s.TaskId, s.StartMs, s.EndMs, s.EndMs - s.StartMs)).ToArray(),
        task.Segments.Sum(s => s.EndMs - s.StartMs), verified, verified ? [] : ["video_duration_unavailable"], task.RejectionReason, task.RejectedAtUtc);
}
