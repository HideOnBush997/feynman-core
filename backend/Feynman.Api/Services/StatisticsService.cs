using System.Data;
using Feynman.Api.Domain;
using Feynman.Api.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Feynman.Api.Services;

public sealed class StatisticsService(AppDbContext db, BusinessService business)
{
    public async Task<object> Daily(HttpContext h)
    {
        await business.Actor(h, true);
        if (!DateOnly.TryParseExact(h.Request.Query["fromDate"], "yyyy-MM-dd", out var from) ||
            !DateOnly.TryParseExact(h.Request.Query["toDate"], "yyyy-MM-dd", out var to))
            throw new AppException(400, "validation_failed", "日期格式必须为 YYYY-MM-DD。");
        var (start, until) = ShanghaiTime.Range(from, to); var (page, size) = BusinessService.Pagination(h);
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead);
        var q = db.Tasks.AsNoTracking().Where(t => t.Status == TaskStates.Submitted && t.SubmittedAtUtc >= start && t.SubmittedAtUtc < until);
        if (Guid.TryParse(h.Request.Query["tenantId"], out var tenant)) q = q.Where(t => t.TenantId == tenant);
        if (Guid.TryParse(h.Request.Query["annotatorId"], out var user)) q = q.Where(t => t.LatestSubmitterUserId == user);
        var total = await q.LongCountAsync();
        var summaries = await q.Select(t => new
        {
            t.Id,
            t.TenantId,
            TenantName = t.Tenant.Name,
            AnnotatorId = t.LatestSubmitterUserId,
            Username = t.LatestSubmitterUser!.UserName,
            SubmittedAtUtc = t.SubmittedAtUtc!.Value,
            DurationMs = t.Segments.Sum(s => s.EndMs - s.StartMs)
        }).ToListAsync();
        var items = (await q.OrderBy(t => t.SubmittedAtUtc).ThenBy(t => t.Id).Skip((page - 1) * size).Take(size).Include(t => t.Segments).ToListAsync()).Select(t => TaskDto.From(t)).ToArray();
        var days = summaries.GroupBy(s => ShanghaiTime.Date(s.SubmittedAtUtc)).OrderBy(g => g.Key).Select(day => new
        {
            Date = day.Key.ToString("yyyy-MM-dd"),
            DurationMs = day.Sum(s => s.DurationMs),
            Tenants = day.GroupBy(s => new { s.TenantId, s.TenantName }).Select(t => new
            {
                t.Key.TenantId,
                t.Key.TenantName,
                DurationMs = t.Sum(s => s.DurationMs),
                Annotators = t.GroupBy(s => new { s.AnnotatorId, s.Username }).Select(u => new
                {
                    u.Key.AnnotatorId,
                    u.Key.Username,
                    DurationMs = u.Sum(s => s.DurationMs),
                    Tasks = items.Where(i => u.Any(s => s.Id == i.Id)).ToArray()
                }).ToArray()
            }).ToArray()
        }).ToArray();
        await tx.CommitAsync();
        return new { TotalDurationMs = summaries.Sum(s => s.DurationMs), Days = days, Items = items, Page = page, PageSize = size, TotalItems = total, TotalPages = (total + size - 1) / size };
    }
}
