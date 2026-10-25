using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Feynman.Api.Domain;
using Feynman.Api.Persistence;
using Feynman.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Microsoft.IdentityModel.Tokens;
using Xunit;

namespace Feynman.Api.Tests;

public sealed class ApiTests : IAsyncLifetime
{
    private readonly string database = "feynman_api_test_" + Guid.NewGuid().ToString("N");
    private static string AdminConnection => DatabaseConnection.TestAdmin();
    private string Connection => new NpgsqlConnectionStringBuilder(AdminConnection) { Database = database }.ToString();
    private TestFactory factory = null!;
    private HttpClient admin = null!, alice = null!, bob = null!, foreign = null!;
    private Guid tenantId, foreignTenantId, aliceId, bobId;
    private const string Password = "Testing_2026!";

    public async Task InitializeAsync()
    {
        await using (var connection = new NpgsqlConnection(AdminConnection))
        {
            await connection.OpenAsync();
            await using var cmd = new NpgsqlCommand($"CREATE DATABASE {database}", connection);
            await cmd.ExecuteNonQueryAsync();
        }
        factory = new TestFactory(Connection);
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Database.MigrateAsync();
            var one = new Tenant { Name = "Tenant One" }; var two = new Tenant { Name = "Tenant Two" };
            db.Tenants.AddRange(one, two); await db.SaveChangesAsync();
            tenantId = one.Id; foreignTenantId = two.Id;
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            foreach (var (name, role, tenant) in new[] { ("admin", Roles.PlatformAdmin, (Guid?)null), ("alice", Roles.Annotator, (Guid?)tenantId), ("bob", Roles.Annotator, (Guid?)tenantId), ("foreign", Roles.Annotator, (Guid?)foreignTenantId) })
            {
                var user = new ApplicationUser { UserName = name, Role = role, TenantId = tenant, MustChangePassword = false };
                Assert.True((await users.CreateAsync(user, Password)).Succeeded);
                if (name == "alice") aliceId = user.Id;
                if (name == "bob") bobId = user.Id;
            }
        }
        admin = await Login("admin"); alice = await Login("alice"); bob = await Login("bob"); foreign = await Login("foreign");
    }
    public async Task DisposeAsync()
    {
        admin?.Dispose(); alice?.Dispose(); bob?.Dispose(); foreign?.Dispose();
        if (factory is not null) await factory.DisposeAsync();
        NpgsqlConnection.ClearAllPools();
        await using var connection = new NpgsqlConnection(AdminConnection);
        await connection.OpenAsync();
        await using var cmd = new NpgsqlCommand($"DROP DATABASE {database} WITH (FORCE)", connection);
        await cmd.ExecuteNonQueryAsync();
    }
    private HttpClient Client() => factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), HandleCookies = true });
    private async Task<HttpClient> Login(string name, string password = Password)
    {
        var client = Client();
        var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { username = name, password });
        Assert.True(login.IsSuccessStatusCode, await login.Content.ReadAsStringAsync());
        var body = await login.Content.ReadFromJsonAsync<JsonElement>();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", body.GetProperty("accessToken").GetString());
        return client;
    }
    private static async Task<T> Body<T>(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return (await response.Content.ReadFromJsonAsync<T>())!;
    }
    private static async Task Error(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var value = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(code, value.GetProperty("code").GetString());
        foreach (var property in new[] { "type", "title", "status", "detail", "instance", "traceId" }) Assert.True(value.TryGetProperty(property, out _));
        Assert.False(value.TryGetProperty("stackTrace", out _));
    }
    private async Task<TaskDto> Create(Guid? tenant = null, string? due = null) => await Body<TaskDto>(await admin.PostAsJsonAsync("/api/v1/tasks", new TaskInput(tenant ?? tenantId, "Example", "https://example.com/video.mp4", "Instructions", due)));
    private static async Task<TaskDto> Command(HttpClient client, TaskDto task, string action, Guid? assignee = null, long? duration = null) =>
        await Body<TaskDto>(await client.PostAsJsonAsync($"/api/v1/tasks/{task.Id}/{action}", new Command(task.Version, assignee, "Correction requested", duration)));
    private async Task<TaskDto> Claimed(HttpClient? owner = null)
    {
        var task = await Create(); task = await Command(admin, task, "publish"); return await Command(owner ?? alice, task, "claim");
    }
    private static async Task<TaskDto> AddSegment(HttpClient client, TaskDto task, long start = 0, long end = 1000, long? duration = null) =>
        await Body<TaskDto>(await client.PostAsJsonAsync($"/api/v1/tasks/{task.Id}/segments", new SegmentInput(start, end, task.Version, duration)));
    private async Task<JsonElement> Stats(DateOnly day) => await Body<JsonElement>(await admin.GetAsync($"/api/v1/statistics/daily?fromDate={day:yyyy-MM-dd}&toDate={day:yyyy-MM-dd}"));

    [Theory]
    [InlineData("/tasks?tenantId=invalid")]
    [InlineData("/users?tenantId=invalid")]
    [InlineData("/statistics/daily?fromDate=2026-10-24&toDate=2026-10-24&tenantId=invalid")]
    [InlineData("/statistics/daily?fromDate=2026-10-24&toDate=2026-10-24&annotatorId=invalid")]
    public async Task MalformedTenantAndAnnotatorFiltersDoNotSilentlyReturnUnfilteredData(string path)
    {
        await Create();
        await Error(await admin.GetAsync("/api/v1" + path), HttpStatusCode.BadRequest, "validation_failed");
    }

    [Fact]
    public async Task SelectorOptionsHideInactiveEmptyRecordsButKeepHistoricalFilters()
    {
        await Claimed(alice);
        await Body<JsonElement>(await admin.PostAsJsonAsync($"/api/v1/users/{bobId}/deactivate", new { }));
        await Body<JsonElement>(await admin.PostAsJsonAsync($"/api/v1/tenants/{tenantId}/deactivate", new { }));
        await Body<JsonElement>(await admin.PostAsJsonAsync($"/api/v1/tenants/{foreignTenantId}/deactivate", new { }));
        var active = await Body<JsonElement>(await admin.PostAsJsonAsync("/api/v1/tenants", new TenantInput("新团队")));
        var tenants = await Body<JsonElement>(await admin.GetAsync("/api/v1/tenants?optionsOnly=true"));
        var tenantIds = tenants.GetProperty("items").EnumerateArray().Select(t => t.GetProperty("id").GetGuid()).ToArray();
        Assert.Contains(tenantId, tenantIds);
        Assert.Contains(active.GetProperty("id").GetGuid(), tenantIds);
        Assert.DoesNotContain(foreignTenantId, tenantIds);
        var accounts = await Body<JsonElement>(await admin.GetAsync("/api/v1/users?optionsOnly=true&role=Annotator"));
        var names = accounts.GetProperty("items").EnumerateArray().Select(u => u.GetProperty("username").GetString()).ToArray();
        Assert.Equal(new[] { "alice" }, names);
        var management = await Body<JsonElement>(await admin.GetAsync("/api/v1/tenants"));
        Assert.Equal(3, management.GetProperty("totalItems").GetInt64());
    }

    [Fact]
    public async Task AccountListKeepsTenantNameWhenInactiveEmptyTenantIsExcludedFromOptions()
    {
        await Body<JsonElement>(await admin.PostAsJsonAsync($"/api/v1/tenants/{foreignTenantId}/deactivate", new { }));
        var options = await Body<JsonElement>(await admin.GetAsync("/api/v1/tenants?optionsOnly=true"));
        Assert.DoesNotContain(options.GetProperty("items").EnumerateArray(), item => item.GetProperty("id").GetGuid() == foreignTenantId);
        var accounts = await Body<JsonElement>(await admin.GetAsync("/api/v1/users?username=foreign"));
        var account = Assert.Single(accounts.GetProperty("items").EnumerateArray());
        Assert.Equal(foreignTenantId, account.GetProperty("tenantId").GetGuid());
        Assert.Equal("Tenant Two", account.GetProperty("tenantName").GetString());
        var admins = await Body<JsonElement>(await admin.GetAsync("/api/v1/users?role=PlatformAdmin"));
        Assert.Equal(JsonValueKind.Null, Assert.Single(admins.GetProperty("items").EnumerateArray()).GetProperty("tenantName").ValueKind);
    }

    [Fact]
    public async Task DuplicateUsernameReturnsConflictWithChineseExplanationWithoutCreatingAnotherAccount()
    {
        var response = await admin.PostAsJsonAsync("/api/v1/users", new UserInput("ALICE", Roles.Annotator, tenantId, Password));
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("username_conflict", problem.GetProperty("code").GetString());
        Assert.Equal("用户名已存在，请更换用户名。", problem.GetProperty("detail").GetString());
        var accounts = await Body<JsonElement>(await admin.GetAsync("/api/v1/users"));
        Assert.Equal(4, accounts.GetProperty("totalItems").GetInt64());
    }

    [Fact]
    public async Task CorsPreflightAllowsOnlyExactConfiguredOriginWithCredentialsAndRequiredHeaders()
    {
        using var client = Client();
        using var allowed = new HttpRequestMessage(HttpMethod.Options, "/api/v1/auth/refresh");
        allowed.Headers.Add("Origin", "https://localhost:5173");
        allowed.Headers.Add("Access-Control-Request-Method", "POST");
        allowed.Headers.Add("Access-Control-Request-Headers", "authorization,content-type,x-csrf-token,if-match");
        var response = await client.SendAsync(allowed);
        Assert.True(response.IsSuccessStatusCode);
        Assert.Equal("https://localhost:5173", Assert.Single(response.Headers.GetValues("Access-Control-Allow-Origin")));
        Assert.Equal("true", Assert.Single(response.Headers.GetValues("Access-Control-Allow-Credentials")));
        var headers = string.Join(",", response.Headers.GetValues("Access-Control-Allow-Headers")).ToLowerInvariant();
        foreach (var header in new[] { "authorization", "content-type", "x-csrf-token", "if-match" }) Assert.Contains(header, headers);
        using var denied = new HttpRequestMessage(HttpMethod.Options, "/api/v1/auth/refresh");
        denied.Headers.Add("Origin", "https://evil.example");
        denied.Headers.Add("Access-Control-Request-Method", "POST");
        var rejection = await client.SendAsync(denied);
        Assert.False(rejection.Headers.Contains("Access-Control-Allow-Origin"));
        Assert.False(rejection.Headers.Contains("Access-Control-Allow-Credentials"));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task ExpiredOrForgedJwtProducesConsistentProblemDetails(bool expired)
    {
        using var client = Client();
        var signingKey = expired ? new string('s', 64) : new string('x', 64);
        var token = new JwtSecurityToken("Feynman.Api", "Feynman.Spa", [new Claim("sub", aliceId.ToString()), new Claim("role", Roles.Annotator)],
            DateTime.UtcNow.AddMinutes(-30), expired ? DateTime.UtcNow.AddMinutes(-15) : DateTime.UtcNow.AddMinutes(15),
            new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey)), SecurityAlgorithms.HmacSha256));
        client.DefaultRequestHeaders.Authorization = new("Bearer", new JwtSecurityTokenHandler().WriteToken(token));
        await Error(await client.GetAsync("/api/v1/auth/me"), HttpStatusCode.Unauthorized, "token_expired");
    }

    [Fact]
    public async Task UsernamesNormalizeCompatibilityCharactersTrimWhitespaceAndRemainCaseInsensitive()
    {
        var created = await Body<JsonElement>(await admin.PostAsJsonAsync("/api/v1/users", new UserInput("　Ｔｅｓｔ Ｕｓｅｒ　", Roles.Annotator, tenantId, Password)));
        Assert.Equal("Test User", created.GetProperty("username").GetString());
        await Error(await admin.PostAsJsonAsync("/api/v1/users", new UserInput(" test user ", Roles.Annotator, tenantId, Password)), HttpStatusCode.Conflict, "username_conflict");
        using var client = await Login("　ＴＥＳＴ ＵＳＥＲ　");
        var me = await Body<JsonElement>(await client.GetAsync("/api/v1/auth/me"));
        Assert.Equal(created.GetProperty("id").GetGuid(), me.GetProperty("id").GetGuid());
    }

    [Theory]
    [InlineData("PlatformAdmin", true)]
    [InlineData("Annotator", false)]
    [InlineData("UnrecognizedRole", false)]
    public async Task UserRoleAndTenantBindingAreValidated(string role, bool withTenant) =>
        await Error(await admin.PostAsJsonAsync("/api/v1/users", new UserInput("new.user", role, withTenant ? tenantId : null, Password)), HttpStatusCode.BadRequest, "validation_failed");

    [Fact]
    public async Task AnnotatorCannotBeBoundToMissingTenant() =>
        await Error(await admin.PostAsJsonAsync("/api/v1/users", new UserInput("new.user", Roles.Annotator, Guid.NewGuid(), Password)), HttpStatusCode.BadRequest, "tenant_disabled");

    [Fact]
    public async Task AuthorizationAndCrossTenantProtectionCoverEveryResourceRoute()
    {
        var own = await Command(admin, await Create(), "publish");
        var other = await Command(admin, await Create(foreignTenantId), "publish");
        using var anonymous = Client();
        await Error(await anonymous.GetAsync("/api/v1/tasks/available"), HttpStatusCode.Unauthorized, "token_expired");
        foreach (var route in new[] { "/api/v1/tenants", "/api/v1/users", "/api/v1/tasks", "/api/v1/statistics/daily?fromDate=2026-10-24&toDate=2026-10-24" })
            await Error(await alice.GetAsync(route), HttpStatusCode.Forbidden, "role_forbidden");
        var list = await Body<JsonElement>(await alice.GetAsync($"/api/v1/tasks/available?tenantId={foreignTenantId}"));
        Assert.All(list.GetProperty("items").EnumerateArray(), item => Assert.Equal(tenantId, item.GetProperty("tenantId").GetGuid()));
        Assert.Contains(list.GetProperty("items").EnumerateArray(), item => item.GetProperty("id").GetGuid() == own.Id);
        await Error(await alice.GetAsync($"/api/v1/tasks/{other.Id}"), HttpStatusCode.NotFound, "resource_not_found");
        await Error(await alice.GetAsync($"/api/v1/tasks/{other.Id}/segments"), HttpStatusCode.NotFound, "resource_not_found");
        foreach (var action in new[] { "claim", "return", "submit" })
            await Error(await alice.PostAsJsonAsync($"/api/v1/tasks/{other.Id}/{action}", new Command(other.Version)), HttpStatusCode.NotFound, "resource_not_found");
        var segment = Guid.NewGuid();
        await Error(await alice.PostAsJsonAsync($"/api/v1/tasks/{other.Id}/segments", new SegmentInput(0, 10, other.Version, null)), HttpStatusCode.NotFound, "resource_not_found");
        await Error(await alice.PutAsJsonAsync($"/api/v1/tasks/{other.Id}/segments/{segment}", new SegmentInput(0, 10, other.Version, null)), HttpStatusCode.NotFound, "resource_not_found");
        await Error(await alice.DeleteAsync($"/api/v1/tasks/{other.Id}/segments/{segment}?expectedVersion={other.Version}"), HttpStatusCode.NotFound, "resource_not_found");
        await Error(await alice.PostAsJsonAsync("/api/v1/tenants", new { name = "Unauthorized" }), HttpStatusCode.Forbidden, "role_forbidden");
    }

    [Theory]
    [InlineData("pageSize=101")]
    [InlineData("pageSize=0")]
    [InlineData("page=-1")]
    [InlineData("pageSize=oops")]
    public async Task PaginationRejectsInvalidParameters(string query) => await Error(await admin.GetAsync("/api/v1/tasks?" + query), HttpStatusCode.BadRequest, "invalid_pagination");

    [Fact]
    public async Task PaginationDefaultsAndMalformedJsonProduceContractResponses()
    {
        var list = await Body<JsonElement>(await admin.GetAsync("/api/v1/tasks"));
        Assert.Equal(20, list.GetProperty("pageSize").GetInt32());
        Assert.Equal(1, list.GetProperty("page").GetInt32());
        await Error(await admin.PostAsync("/api/v1/tasks", new StringContent("{broken", Encoding.UTF8, "application/json")), HttpStatusCode.BadRequest, "validation_failed");
        await Error(await admin.GetAsync("/api/v1/tasks?sort=arbitrary_sql"), HttpStatusCode.BadRequest, "validation_failed");
    }

    [Fact]
    public async Task DisabledUsersAndTenantsInvalidateAlreadyIssuedAccessAndRefreshFamilies()
    {
        var claimed = await Claimed();
        await Body<JsonElement>(await admin.PostAsJsonAsync($"/api/v1/users/{aliceId}/deactivate", new { }));
        await Error(await alice.GetAsync("/api/v1/auth/me"), HttpStatusCode.Forbidden, "account_disabled");
        var retained = await Body<TaskDto>(await admin.GetAsync($"/api/v1/tasks/{claimed.Id}"));
        Assert.Equal(aliceId, retained.AssigneeUserId);
        await Body<JsonElement>(await admin.PostAsJsonAsync($"/api/v1/tenants/{tenantId}/deactivate", new { }));
        await Error(await bob.GetAsync("/api/v1/tasks/available"), HttpStatusCode.Forbidden, "tenant_disabled");
        await using var scope = factory.Services.CreateAsyncScope();
        Assert.False(await scope.ServiceProvider.GetRequiredService<AppDbContext>().RefreshTokenFamilies.AnyAsync(f => (f.UserId == aliceId || f.UserId == bobId) && f.RevokedAtUtc == null));
    }

    [Fact]
    public async Task AdministratorCanRecallDisabledTenantTaskWhilePreservingHistoricalSegments()
    {
        var task = await AddSegment(alice, await Claimed());
        var segmentId = Assert.Single(task.Segments).Id;
        await Body<JsonElement>(await admin.PostAsJsonAsync($"/api/v1/tenants/{tenantId}/deactivate", new { }));
        task = await Command(admin, task, "recall");
        Assert.Equal(TaskStates.Available, task.Status);
        Assert.Null(task.AssigneeUserId);
        Assert.Equal(segmentId, Assert.Single(task.Segments).Id);
    }

    [Fact]
    public async Task NewAccountsAcceptSimplePasswordsAndCanUseWorkspaceImmediately()
    {
        await Error(await admin.PostAsJsonAsync("/api/v1/users", new UserInput("short", Roles.Annotator, tenantId, "12345")), HttpStatusCode.BadRequest, "validation_failed");
        var created = await Body<JsonElement>(await admin.PostAsJsonAsync("/api/v1/users", new UserInput("新 用户!", Roles.Annotator, tenantId, "123456")));
        Assert.False(created.GetProperty("mustChangePassword").GetBoolean());
        using var client = await Login("新 用户!", "123456");
        await Body<JsonElement>(await client.GetAsync("/api/v1/tasks/available"));
        await Error(await admin.PostAsJsonAsync("/api/v1/users", new UserInput("新 用户!", Roles.Annotator, tenantId, Password)), HttpStatusCode.Conflict, "username_conflict");
    }

    [Fact]
    public async Task LegacyPasswordChangeFlagDoesNotBlockLoginOrBusinessRequests()
    {
        await using (var scope = factory.Services.CreateAsyncScope())
            await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.Where(u => u.Id == aliceId).ExecuteUpdateAsync(s => s.SetProperty(u => u.MustChangePassword, true));
        using var client = await Login("alice");
        var me = await Body<JsonElement>(await client.GetAsync("/api/v1/auth/me"));
        Assert.False(me.GetProperty("mustChangePassword").GetBoolean());
        await Body<JsonElement>(await client.GetAsync("/api/v1/tasks/available"));
    }

    [Fact]
    public async Task FullReturnCorrectionReassignmentResubmissionFlowKeepsStableSegmentsAndCurrentStatistics()
    {
        var today = ShanghaiTime.Date(DateTime.UtcNow);
        var task = await Create(due: "2020-01-01T00:00:00");
        Assert.True(task.IsOverdue);
        task = await Command(admin, task, "publish"); task = await Command(alice, task, "claim");
        task = await AddSegment(alice, task, 1000, 2000, 10000);
        var segmentId = Assert.Single(task.Segments).Id;
        task = await Command(alice, task, "return");
        Assert.Null(task.AssigneeUserId); Assert.Equal(segmentId, Assert.Single(task.Segments).Id);
        task = await Command(bob, task, "claim"); task = await Command(bob, task, "submit");
        Assert.False(task.VideoBoundaryVerified); Assert.Contains("video_duration_unavailable", task.Warnings);
        Assert.Equal(1000, (await Stats(today)).GetProperty("totalDurationMs").GetInt64());
        await Error(await admin.PostAsJsonAsync($"/api/v1/tasks/{task.Id}/cancel", new Command(task.Version)), HttpStatusCode.Conflict, "task_state_conflict");
        task = await Command(admin, task, "reject");
        Assert.Equal(0, (await Stats(today)).GetProperty("totalDurationMs").GetInt64());
        await Error(await admin.PostAsJsonAsync($"/api/v1/tasks/{task.Id}/cancel", new Command(task.Version)), HttpStatusCode.Conflict, "task_state_conflict");
        task = await Command(admin, task, "reassign", aliceId);
        Assert.Equal(segmentId, Assert.Single(task.Segments).Id);
        task = await Body<TaskDto>(await alice.PutAsJsonAsync($"/api/v1/tasks/{task.Id}/segments/{segmentId}", new SegmentInput(1000, 3500, task.Version, 10000)));
        task = await Command(alice, task, "submit", duration: 10000);
        Assert.True(task.VideoBoundaryVerified); Assert.Equal(aliceId, task.LatestSubmitterUserId);
        var stats = await Stats(today);
        Assert.Equal(2500, stats.GetProperty("totalDurationMs").GetInt64()); Assert.Equal(1, stats.GetProperty("totalItems").GetInt64());
        var entry = Assert.Single(stats.GetProperty("items").EnumerateArray());
        Assert.Equal(2500, entry.GetProperty("durationMs").GetInt64()); Assert.Equal(segmentId, Assert.Single(entry.GetProperty("segments").EnumerateArray()).GetProperty("id").GetGuid());
        await Error(await alice.PostAsJsonAsync($"/api/v1/tasks/{task.Id}/segments", new SegmentInput(4000, 4500, task.Version, null)), HttpStatusCode.Conflict, "task_state_conflict");
    }

    [Fact]
    public async Task ResubmissionMovesCurrentTotalsToNewShanghaiDateAndUsesHalfOpenBoundaries()
    {
        var today = ShanghaiTime.Date(DateTime.UtcNow);
        var yesterday = today.AddDays(-1);
        var task = await Command(alice, await AddSegment(alice, await Claimed()), "submit");
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Tasks.Where(t => t.Id == task.Id).ExecuteUpdateAsync(s => s.SetProperty(t => t.SubmittedAtUtc, ShanghaiTime.ToUtc(yesterday)));
            var before = new AnnotationTask { TenantId = tenantId, Name = "Before range", VideoUrl = "https://example.com/video.mp4", Status = TaskStates.Submitted, AssigneeUserId = aliceId, LatestSubmitterUserId = aliceId, SubmittedAtUtc = ShanghaiTime.ToUtc(yesterday).AddTicks(-10) };
            var after = new AnnotationTask { TenantId = tenantId, Name = "After range", VideoUrl = "https://example.com/video.mp4", Status = TaskStates.Submitted, AssigneeUserId = aliceId, LatestSubmitterUserId = aliceId, SubmittedAtUtc = ShanghaiTime.ToUtc(today) };
            db.Tasks.AddRange(before, after);
            db.Segments.AddRange(new Segment { TaskId = before.Id, StartMs = 0, EndMs = 700 }, new Segment { TaskId = after.Id, StartMs = 0, EndMs = 900 });
            await db.SaveChangesAsync();
        }
        Assert.Equal(1000, (await Stats(yesterday)).GetProperty("totalDurationMs").GetInt64());
        Assert.Equal(900, (await Stats(today)).GetProperty("totalDurationMs").GetInt64());
        task = await Command(admin, task, "reject");
        Assert.Equal(0, (await Stats(yesterday)).GetProperty("totalDurationMs").GetInt64());
        task = await Command(admin, task, "reassign", bobId);
        task = await Command(bob, task, "submit");
        Assert.Equal(0, (await Stats(yesterday)).GetProperty("totalDurationMs").GetInt64());
        Assert.Equal(1900, (await Stats(today)).GetProperty("totalDurationMs").GetInt64());
        Assert.Equal(bobId, task.LatestSubmitterUserId);
    }

    [Fact]
    public async Task SegmentVersionConflictsAndValidationNeverPartiallyWrite()
    {
        var initial = await Claimed();
        var task = await AddSegment(alice, initial, 0, 1000);
        await Error(await alice.PostAsJsonAsync($"/api/v1/tasks/{task.Id}/segments", new SegmentInput(1000, 2000, initial.Version, null)), HttpStatusCode.Conflict, "concurrency_conflict");
        await Error(await alice.PostAsJsonAsync($"/api/v1/tasks/{task.Id}/segments", new SegmentInput(500, 2000, task.Version, null)), HttpStatusCode.Conflict, "segment_overlap");
        await Error(await alice.PostAsJsonAsync($"/api/v1/tasks/{task.Id}/segments", new SegmentInput(0, 1000, task.Version, null)), HttpStatusCode.Conflict, "segment_duplicate");
        var current = await Body<TaskDto>(await alice.GetAsync($"/api/v1/tasks/{task.Id}"));
        Assert.Equal(task.Version, current.Version); Assert.Single(current.Segments);
        task = await AddSegment(alice, task, 1000, 2000);
        var deleteId = task.Segments[0].Id;
        task = await Body<TaskDto>(await alice.DeleteAsync($"/api/v1/tasks/{task.Id}/segments/{deleteId}?expectedVersion={task.Version}"));
        Assert.Single(task.Segments); Assert.DoesNotContain(task.Segments, s => s.Id == deleteId);
    }

    [Fact]
    public async Task ConcurrentClaimHasExactlyOneWinner()
    {
        var task = await Command(admin, await Create(), "publish");
        var responses = await Task.WhenAll(alice.PostAsJsonAsync($"/api/v1/tasks/{task.Id}/claim", new Command(task.Version)), bob.PostAsJsonAsync($"/api/v1/tasks/{task.Id}/claim", new Command(task.Version)));
        Assert.Single(responses, r => r.IsSuccessStatusCode);
        var current = await Body<TaskDto>(await admin.GetAsync($"/api/v1/tasks/{task.Id}"));
        Assert.Equal(task.Version + 1, current.Version); Assert.Contains(current.AssigneeUserId, new Guid?[] { aliceId, bobId });
    }

    [Theory]
    [InlineData("recall")]
    [InlineData("cancel")]
    public async Task SaveVersusRecallOrCancelSerializesAggregateWithoutPartialWrites(string action)
    {
        var task = await Claimed();
        var responses = await Task.WhenAll(alice.PostAsJsonAsync($"/api/v1/tasks/{task.Id}/segments", new SegmentInput(0, 1000, task.Version, null)), admin.PostAsJsonAsync($"/api/v1/tasks/{task.Id}/{action}", new Command(task.Version)));
        Assert.Single(responses, r => r.IsSuccessStatusCode);
        var current = await Body<TaskDto>(await admin.GetAsync($"/api/v1/tasks/{task.Id}"));
        Assert.Equal(task.Version + 1, current.Version);
        if (responses[0].IsSuccessStatusCode) { Assert.Equal(TaskStates.Claimed, current.Status); Assert.Single(current.Segments); }
        else { Assert.Equal(action == "recall" ? TaskStates.Available : TaskStates.Cancelled, current.Status); Assert.Null(current.AssigneeUserId); Assert.Empty(current.Segments); }
    }

    [Fact]
    public async Task SubmitVersusCancelCommitsOnlyOneTransitionAndKeepsSegments()
    {
        var task = await AddSegment(alice, await Claimed());
        var responses = await Task.WhenAll(alice.PostAsJsonAsync($"/api/v1/tasks/{task.Id}/submit", new Command(task.Version)), admin.PostAsJsonAsync($"/api/v1/tasks/{task.Id}/cancel", new Command(task.Version)));
        Assert.Single(responses, r => r.IsSuccessStatusCode);
        var current = await Body<TaskDto>(await admin.GetAsync($"/api/v1/tasks/{task.Id}"));
        Assert.Equal(task.Version + 1, current.Version); Assert.Single(current.Segments);
        Assert.Equal(responses[0].IsSuccessStatusCode ? TaskStates.Submitted : TaskStates.Cancelled, current.Status);
        Assert.Equal(responses[0].IsSuccessStatusCode ? aliceId : (Guid?)null, current.LatestSubmitterUserId);
    }

    private sealed class TestFactory(string connection) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Database"] = connection,
                ["Auth:SigningKey"] = new string('s', 64),
                ["Auth:HmacKey"] = new string('h', 64),
                ["Auth:ReceiptEncryptionKey"] = Convert.ToBase64String(new byte[32]),
                ["Auth:AllowedOrigins:0"] = "https://localhost:5173",
                ["Http:AuthRequestsPerMinute"] = "10000"
            }));
        }
    }
}
