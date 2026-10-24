using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Feynman.Api;
using Feynman.Api.Auth;
using Feynman.Api.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;

namespace Feynman.Auth.Tests;

public sealed class AuthDatabaseTests : IAsyncLifetime
{
    private readonly string database = "feynman_auth_test_" + Guid.NewGuid().ToString("N");
    private static string Admin => DatabaseConnection.TestAdmin();
    private string Connection => new NpgsqlConnectionStringBuilder(Admin) { Database = database }.ToString();
    private readonly TestClock clock = new();
    private ServiceProvider services = null!;
    private Guid userId;

    public async Task InitializeAsync()
    {
        await using var connection = new NpgsqlConnection(Admin);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand($"CREATE DATABASE {database}", connection);
        await command.ExecuteNonQueryAsync();
        var collection = new ServiceCollection();
        collection.AddLogging();
        collection.AddSingleton(AuthCryptoTests.Options());
        collection.AddSingleton<AuthCrypto>();
        collection.AddSingleton<TimeProvider>(clock);
        collection.AddDbContext<AppDbContext>(o => o.UseNpgsql(Connection));
        collection.AddIdentityCore<ApplicationUser>(o => o.User.AllowedUserNameCharacters = "").AddEntityFrameworkStores<AppDbContext>();
        collection.AddScoped<AuthService>();
        collection.AddScoped<AuthReceiptCleanup>();
        services = collection.BuildServiceProvider();
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.MigrateAsync();
        var user = new ApplicationUser { UserName = "auth.admin", Role = Roles.PlatformAdmin };
        Assert.True((await scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>().CreateAsync(user, "Temporary_2026!")).Succeeded);
        userId = user.Id;
    }
    public async Task DisposeAsync()
    {
        if (services is not null) await services.DisposeAsync();
        NpgsqlConnection.ClearAllPools();
        await using var connection = new NpgsqlConnection(Admin);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand($"DROP DATABASE {database} WITH (FORCE)", connection);
        await command.ExecuteNonQueryAsync();
    }
    private async Task<T> Call<T>(Func<AuthService, Task<T>> action)
    {
        await using var scope = services.CreateAsyncScope();
        return await action(scope.ServiceProvider.GetRequiredService<AuthService>());
    }
    private static Dictionary<string, string> Cookies(HttpContext context) => context.Response.Headers.SetCookie
        .Where(x => x is not null).Select(x => x!.Split(';')[0].Split('=', 2)).ToDictionary(x => x[0], x => x[1]);
    private static DefaultHttpContext Request(Dictionary<string, string>? cookies = null)
    {
        var context = new DefaultHttpContext();
        context.Request.Headers.Origin = "https://localhost:5173";
        if (cookies is not null)
        {
            context.Request.Headers.Cookie = string.Join("; ", cookies.Select(x => $"{x.Key}={x.Value}"));
            context.Request.Headers["X-CSRF-Token"] = cookies[AuthService.CsrfCookie];
        }
        return context;
    }
    private async Task<DefaultHttpContext> Login()
    {
        var context = Request();
        await Call(s => s.LoginAsync(new("auth.admin", "Temporary_2026!"), context, default));
        return context;
    }

    [Fact]
    public async Task LoginClaimsCookiesAndExpiryFollowContract()
    {
        var context = Request();
        var response = await Call(s => s.LoginAsync(new(" AUTH.ADMIN ", "Temporary_2026!"), context, default));
        Assert.True(response.User.MustChangePassword);
        Assert.Equal(clock.GetUtcNow().UtcDateTime.AddMinutes(15), response.ExpiresAtUtc);
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(response.AccessToken);
        Assert.Equal(900, jwt.Payload.Expiration - jwt.Payload.NotBefore);
        Assert.Contains(jwt.Claims, c => c.Type == "role" && c.Value == Roles.PlatformAdmin);
        Assert.Contains(context.Response.Headers.SetCookie, s => s!.StartsWith("feynman_refresh=") && s.Contains("secure") && s.Contains("httponly") && s.Contains("path=/api/v1/auth"));
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var family = await db.RefreshTokenFamilies.SingleAsync();
        var token = await db.RefreshTokens.SingleAsync();
        Assert.Equal(clock.GetUtcNow().UtcDateTime.AddDays(30), family.AbsoluteExpiresAtUtc);
        Assert.Equal(clock.GetUtcNow().UtcDateTime.AddDays(7), token.IdleExpiresAtUtc);
    }
    [Fact]
    public async Task ConcurrentRefreshReturnsSameRotationAndLateReplayRevokesFamily()
    {
        var oldCookies = Cookies(await Login());
        var first = Request(oldCookies);
        var second = Request(oldCookies);
        var responses = await Task.WhenAll(Call(s => s.RefreshAsync(first, default)), Call(s => s.RefreshAsync(second, default)));
        Assert.Equal(responses[0], responses[1]);
        Assert.Equal(Cookies(first), Cookies(second));
        Assert.NotEqual(oldCookies[AuthService.RefreshCookie], Cookies(first)[AuthService.RefreshCookie]);
        clock.Advance(TimeSpan.FromSeconds(11));
        var replay = await Assert.ThrowsAsync<AppException>(() => Call(s => s.RefreshAsync(Request(oldCookies), default)));
        Assert.Equal("refresh_token_invalid", replay.Code);
        await Assert.ThrowsAsync<AppException>(() => Call(s => s.RefreshAsync(Request(Cookies(first)), default)));
    }
    [Fact]
    public async Task ReceiptCleanupDeletesExpiredCiphertextWithoutRefreshTraffic()
    {
        var initial = Cookies(await Login());
        var refreshed = Request(initial);
        await Call(s => s.RefreshAsync(refreshed, default));
        clock.Advance(TimeSpan.FromSeconds(5));
        await Call(s => s.RefreshAsync(Request(Cookies(refreshed)), default));
        clock.Advance(TimeSpan.FromSeconds(5));
        await using var scope = services.CreateAsyncScope();
        Assert.Equal(1, await scope.ServiceProvider.GetRequiredService<AuthReceiptCleanup>().CleanupAsync());
        var remaining = Assert.Single(await scope.ServiceProvider.GetRequiredService<AppDbContext>().RotationReceipts.ToListAsync());
        Assert.True(remaining.ExpiresAtUtc > clock.GetUtcNow().UtcDateTime);
    }
    [Fact]
    public async Task RefreshSlidesIdleWindowButNeverExtendsThirtyDayAbsoluteExpiry()
    {
        var cookies = Cookies(await Login());
        for (var i = 0; i < 4; i++)
        {
            clock.Advance(TimeSpan.FromDays(6));
            var context = Request(cookies);
            await Call(s => s.RefreshAsync(context, default));
            cookies = Cookies(context);
        }
        await using (var scope = services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var family = await db.RefreshTokenFamilies.SingleAsync();
            var current = await db.RefreshTokens.SingleAsync(t => t.ConsumedAtUtc == null);
            Assert.Equal(family.AbsoluteExpiresAtUtc, current.IdleExpiresAtUtc);
        }
        clock.Advance(TimeSpan.FromDays(6));
        await Assert.ThrowsAsync<AppException>(() => Call(s => s.RefreshAsync(Request(cookies), default)));
    }
    [Fact]
    public async Task IdleRefreshExpiresAfterSevenDays()
    {
        var cookies = Cookies(await Login());
        clock.Advance(TimeSpan.FromDays(7));
        await Assert.ThrowsAsync<AppException>(() => Call(s => s.RefreshAsync(Request(cookies), default)));
    }
    [Fact]
    public async Task CsrfOriginAndDisabledAccountAreChecked()
    {
        var cookies = Cookies(await Login());
        var wrongOrigin = Request(cookies); wrongOrigin.Request.Headers.Origin = "https://evil.example";
        Assert.Equal("csrf_invalid", (await Assert.ThrowsAsync<AppException>(() => Call(s => s.RefreshAsync(wrongOrigin, default)))).Code);
        var wrongCsrf = Request(cookies); wrongCsrf.Request.Headers["X-CSRF-Token"] = "bad";
        await Assert.ThrowsAsync<AppException>(() => Call(s => s.RefreshAsync(wrongCsrf, default)));
        await using (var scope = services.CreateAsyncScope())
            await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.Where(u => u.Id == userId).ExecuteUpdateAsync(s => s.SetProperty(u => u.IsActive, false));
        Assert.Equal("account_disabled", (await Assert.ThrowsAsync<AppException>(() => Call(s => s.RefreshAsync(Request(cookies), default)))).Code);
    }
    [Fact]
    public async Task FirstPasswordChangeUsesIdentityRulesRevokesOtherSessionsAndLogoutIsIdempotent()
    {
        var oldCookies = Cookies(await Login());
        var context = Request();
        context.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", userId.ToString())], "test"));
        await Assert.ThrowsAsync<AppException>(() => Call(s => s.ChangePasswordAsync(new("Temporary_2026!", "weak"), context, default)));
        var response = await Call(s => s.ChangePasswordAsync(new("Temporary_2026!", "NewSecure_2026!"), context, default));
        Assert.False(response.User.MustChangePassword);
        await Assert.ThrowsAsync<AppException>(() => Call(s => s.RefreshAsync(Request(oldCookies), default)));
        var current = Cookies(context);
        await Call(async s => { await s.LogoutAsync(Request(current), default); return true; });
        await Call(async s => { await s.LogoutAsync(Request(current), default); return true; });
        await Assert.ThrowsAsync<AppException>(() => Call(s => s.RefreshAsync(Request(current), default)));
    }
    private sealed class TestClock : TimeProvider
    {
        private DateTimeOffset current = new(2026, 10, 24, 0, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => current;
        public void Advance(TimeSpan duration) => current += duration;
    }
}
