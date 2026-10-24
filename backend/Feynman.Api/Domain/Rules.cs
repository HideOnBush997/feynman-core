using System.Globalization;

namespace Feynman.Api.Domain;

public readonly record struct Interval(long StartMs, long EndMs);

public static class SegmentRules
{
    public static void Validate(IEnumerable<Interval> source, long? videoDurationMs, bool requireSegment = false)
    {
        var segments = source.OrderBy(s => s.StartMs).ThenBy(s => s.EndMs).ToArray();
        if (videoDurationMs is <= 0) throw new AppException(400, "validation_failed", "视频时长必须为正整数毫秒。");
        if (requireSegment && segments.Length == 0) throw new AppException(409, "submission_requires_segment", "至少添加一个有效片段后才能提交。");
        for (var i = 0; i < segments.Length; i++)
        {
            var segment = segments[i];
            if (segment.StartMs < 0 || segment.EndMs <= segment.StartMs)
                throw new AppException(400, "validation_failed", "片段必须满足 0 ≤ 起点 < 终点。");
            if (videoDurationMs.HasValue && segment.EndMs > videoDurationMs)
                throw new AppException(400, "segment_out_of_bounds", "片段超出视频时长。");
            if (i == 0) continue;
            if (segments[i - 1] == segment) throw new AppException(409, "segment_duplicate", "不能添加完全重复的片段。");
            if (segments[i - 1].EndMs > segment.StartMs) throw new AppException(409, "segment_overlap", "片段不能重叠，首尾相接允许。");
        }
        try { _ = segments.Aggregate(0L, (sum, s) => checked(sum + (s.EndMs - s.StartMs))); }
        catch (OverflowException) { throw new AppException(400, "validation_failed", "总时长超出整数范围。"); }
    }
}

public static class ShanghaiTime
{
    public static readonly TimeZoneInfo Zone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Shanghai");
    public static DateTime ToUtc(DateOnly day) => TimeZoneInfo.ConvertTimeToUtc(day.ToDateTime(TimeOnly.MinValue), Zone);
    public static (DateTime From, DateTime Until) Range(DateOnly from, DateOnly to)
    {
        if (to < from || to == DateOnly.MaxValue) throw new AppException(400, "validation_failed", "日期区间无效。");
        return (ToUtc(from), ToUtc(to.AddDays(1)));
    }
    public static DateOnly Date(DateTime utc) => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(utc, Zone));
    public static DateTime? ParseLocal(string? value)
    {
        if (value is null) return null;
        if (!DateTime.TryParseExact(value, "yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture, DateTimeStyles.None, out var local))
            throw new AppException(400, "validation_failed", "截止时间请使用 Shanghai 本地时间 yyyy-MM-ddTHH:mm:ss。");
        return TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(local, DateTimeKind.Unspecified), Zone);
    }
}

public sealed record PagedResult<T>(IReadOnlyList<T> Items, int Page, int PageSize, long TotalItems)
{
    public long TotalPages => (TotalItems + PageSize - 1) / PageSize;
}

