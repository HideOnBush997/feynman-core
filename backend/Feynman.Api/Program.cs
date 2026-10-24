using System.Text.Json;
using System.Threading.RateLimiting;
using Feynman.Api;
using Feynman.Api.Auth;
using Feynman.Api.Persistence;
using Feynman.Api.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true).AddEnvironmentVariables();
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = builder.Configuration.GetValue<long?>("Http:MaxRequestBodyBytes") ?? 1_048_576);
builder.Services.Configure<Microsoft.AspNetCore.Routing.RouteHandlerOptions>(o => o.ThrowOnBadRequest = true);
builder.Services.AddDbContext<AppDbContext>(o => o.UseNpgsql(builder.Configuration.GetConnectionString("Database") ?? throw new InvalidOperationException("ConnectionStrings:Database required.")));
builder.Services.AddFeynmanAuth(builder.Configuration);
builder.Services.AddScoped<BusinessService>(); builder.Services.AddScoped<TaskService>(); builder.Services.AddScoped<StatisticsService>();
builder.Services.AddRateLimiter(o =>
{
    o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(h => h.Request.Path.StartsWithSegments("/api/v1/auth") && h.Request.Method == "POST"
        ? RateLimitPartition.GetFixedWindowLimiter(h.Connection.RemoteIpAddress?.ToString() ?? "local", _ => new FixedWindowRateLimiterOptions
        { PermitLimit = builder.Configuration.GetValue<int?>("Http:AuthRequestsPerMinute") ?? 60, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 })
        : RateLimitPartition.GetNoLimiter("business"));
    o.OnRejected = async (context, ct) => await Errors.Write(context.HttpContext, 429, "rate_limit_exceeded", "请求过于频繁，请稍后重试。", ct: ct);
});
var app = builder.Build();
app.Use(async (h, next) =>
{
    try { await next(); }
    catch (Exception ex) when (!h.Response.HasStarted)
    {
        var (status, code, detail) = ex switch
        {
            AppException e => (e.Status, e.Code, e.Message),
            BadHttpRequestException e => (e.StatusCode, e.StatusCode == 413 ? "request_too_large" : "validation_failed", "请求格式或字段类型无效。"),
            JsonException => (400, "validation_failed", "JSON 格式无效。"),
            DbUpdateConcurrencyException => (409, "concurrency_conflict", "任务版本已变化，请刷新后重试。"),
            PostgresException { SqlState: "40P01" or "40001" } => (409, "concurrency_conflict", "并发事务冲突，请刷新后重试。"),
            DbUpdateException { InnerException: PostgresException { SqlState: "40P01" or "40001" } } => (409, "concurrency_conflict", "并发事务冲突，请刷新后重试。"),
            DbUpdateException { InnerException: PostgresException { SqlState: "23505" } } => (409, "unique_conflict", "记录已存在。"),
            _ => (500, "internal_error", "服务暂时不可用，请稍后重试。")
        };
        if (status == 500) app.Logger.LogError(ex, "Request failed {TraceId}", h.TraceIdentifier);
        await Errors.Write(h, status, code, detail, (ex as AppException)?.Errors);
    }
});
app.UseStatusCodePages(async ctx =>
{
    var status = ctx.HttpContext.Response.StatusCode;
    await Errors.Write(ctx.HttpContext, status, status switch { 401 => "token_expired", 403 => "role_forbidden", 404 => "resource_not_found", 405 => "method_not_allowed", 413 => "request_too_large", _ => "request_failed" }, "请求未能完成。");
});
app.UseCors("Spa"); app.UseRateLimiter(); app.UseAuthentication(); app.UseMiddleware<ActiveUserMiddleware>(); app.UseAuthorization();
app.MapGet("/health", () => new { status = "ok" });
app.MapFeynmanAuth();
var api = app.MapGroup("/api/v1").RequireAuthorization();
api.MapGet("/tenants", (HttpContext h, BusinessService s) => s.Tenants(h));
api.MapGet("/tenants/{id:guid}", (HttpContext h, Guid id, BusinessService s) => s.Tenant(h, id));
api.MapPost("/tenants", (HttpContext h, TenantInput input, BusinessService s) => s.CreateTenant(h, input));
api.MapPost("/tenants/{id:guid}/deactivate", (HttpContext h, Guid id, BusinessService s) => s.DeactivateTenant(h, id));
api.MapGet("/users", (HttpContext h, BusinessService s) => s.Accounts(h));
api.MapPost("/users", (HttpContext h, UserInput input, BusinessService s) => s.CreateAccount(h, input));
api.MapPost("/users/{id:guid}/deactivate", (HttpContext h, Guid id, BusinessService s) => s.DeactivateAccount(h, id));
api.MapGet("/tasks", (HttpContext h, TaskService s) => s.List(h, "all"));
api.MapGet("/tasks/available", (HttpContext h, TaskService s) => s.List(h, "available"));
api.MapGet("/tasks/mine", (HttpContext h, TaskService s) => s.List(h, "mine"));
api.MapPost("/tasks", (HttpContext h, TaskInput input, TaskService s) => s.Create(h, input));
api.MapGet("/tasks/{id:guid}", (HttpContext h, Guid id, TaskService s) => s.Detail(h, id));
api.MapPatch("/tasks/{id:guid}", (HttpContext h, Guid id, JsonElement input, TaskService s) => s.Patch(h, id,
    input.Deserialize<TaskPatch>(new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? throw new AppException(400, "validation_failed", "请求体必填。"),
    input.TryGetProperty("instructions", out _), input.TryGetProperty("dueAtLocal", out _)));
foreach (var action in new[] { "publish", "claim", "return", "recall", "cancel", "reject", "reassign", "submit" })
{
    var command = action;
    api.MapPost($"/tasks/{{id:guid}}/{command}", (HttpContext h, Guid id, Command input, TaskService s) => s.Transition(h, id, command, input));
}
api.MapGet("/tasks/{id:guid}/segments", (HttpContext h, Guid id, TaskService s) => s.Segments(h, id));
api.MapPost("/tasks/{id:guid}/segments", (HttpContext h, Guid id, SegmentInput input, TaskService s) => s.Segment(h, id, null, input));
api.MapPut("/tasks/{id:guid}/segments/{segmentId:guid}", (HttpContext h, Guid id, Guid segmentId, SegmentInput input, TaskService s) => s.Segment(h, id, segmentId, input));
api.MapDelete("/tasks/{id:guid}/segments/{segmentId:guid}", async (HttpContext h, Guid id, Guid segmentId, TaskService s) =>
{
    var value = h.Request.Query["expectedVersion"].FirstOrDefault() ?? h.Request.Headers.IfMatch.FirstOrDefault()?.Trim('"');
    if (!long.TryParse(value, out var version)) throw new AppException(400, "validation_failed", "删除片段需要 expectedVersion 或 If-Match。");
    return await s.Segment(h, id, segmentId, new SegmentInput(0, 0, version, null), true);
});
api.MapGet("/statistics/daily", (HttpContext h, StatisticsService s) => s.Daily(h));
if (args.Contains("--seed", StringComparer.Ordinal))
{
    using var scope = app.Services.CreateScope();
    await DemoSeed.RunAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>(), scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>(),
        builder.Configuration.GetSection("DemoSeed").Get<DemoSeedOptions>() ?? new());
    return;
}
await app.RunAsync();

public partial class Program;

internal static class Errors
{
    public static Task Write(HttpContext h, int status, string code, string detail, IDictionary<string, string[]>? errors = null, CancellationToken ct = default)
    {
        h.Response.StatusCode = status;
        return h.Response.WriteAsJsonAsync(new
        {
            Type = $"urn:feynman:problem:{code}",
            Title = code,
            Status = status,
            Detail = detail,
            Instance = h.Request.Path.Value,
            Code = code,
            Errors = errors ?? (status == 400 ? new Dictionary<string, string[]> { ["request"] = [detail] } : null),
            TraceId = h.TraceIdentifier
        }, options: (JsonSerializerOptions?)null, contentType: "application/problem+json", cancellationToken: ct);
    }
}
