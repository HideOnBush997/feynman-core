using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Feynman.Api.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace Feynman.Api.Auth;

public sealed record LoginRequest(string Username, string Password);
public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);
public sealed record UserDto(Guid Id, string Username, string Role, Guid? TenantId, bool MustChangePassword);
public sealed record SessionResponse(string AccessToken, DateTime ExpiresAtUtc, UserDto User);
public sealed record SessionMaterial(SessionResponse Response, string RefreshToken, string CsrfToken, DateTime RefreshExpiresAtUtc);

public sealed class AuthService(AppDbContext db, UserManager<ApplicationUser> users, AuthOptions options, AuthCrypto crypto, TimeProvider clock)
{
    public const string RefreshCookie = "feynman_refresh";
    public const string CsrfCookie = "feynman_csrf";
    private DateTime Now => clock.GetUtcNow().UtcDateTime;
    public static UserDto ToDto(ApplicationUser user) => new(user.Id, user.UserName!, user.Role, user.TenantId, user.MustChangePassword);

    public async Task<ApplicationUser> GetActiveUserAsync(HttpContext context, CancellationToken ct = default)
    {
        var subject = context.User.FindFirstValue("sub") ?? context.User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(subject, out var id)) throw new AppException(401, "invalid_credentials", "请先登录。");
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct)
            ?? throw new AppException(401, "invalid_credentials", "会话无效。");
        await CheckActiveAsync(user, ct);
        return user;
    }

    private async Task CheckActiveAsync(ApplicationUser user, CancellationToken ct)
    {
        if (!user.IsActive) throw new AppException(403, "account_disabled", "账户已停用。");
        if (user.Role == Roles.Annotator && (user.TenantId is null || !await db.Tenants.AnyAsync(t => t.Id == user.TenantId && t.IsActive, ct)))
            throw new AppException(403, "tenant_disabled", "租户已停用。");
    }

    public async Task<SessionResponse> LoginAsync(LoginRequest request, HttpContext context, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Username) || request.Username.Trim().Length > 50 || string.IsNullOrEmpty(request.Password))
            throw new AppException(401, "invalid_credentials", "用户名或密码错误。");
        var user = await users.FindByNameAsync(request.Username.Trim().Normalize(NormalizationForm.FormKC));
        if (user is null || !await users.CheckPasswordAsync(user, request.Password))
            throw new AppException(401, "invalid_credentials", "用户名或密码错误。");
        await CheckActiveAsync(user, ct);
        var material = await CreateSessionAsync(user, ct);
        WriteCookies(context, material);
        return material.Response;
    }

    private SessionResponse Access(ApplicationUser user)
    {
        var now = Now;
        var expiry = now.AddMinutes(15);
        var claims = new[] { new Claim("sub", user.Id.ToString()), new Claim("jti", Guid.NewGuid().ToString()), new Claim("role", user.Role), new Claim("iat", new DateTimeOffset(now).ToUnixTimeSeconds().ToString(), ClaimValueTypes.Integer64) };
        var token = new JwtSecurityToken(options.Issuer, options.Audience, claims, now, expiry,
            new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(options.SigningKey)), SecurityAlgorithms.HmacSha256));
        return new(new JwtSecurityTokenHandler().WriteToken(token), expiry, ToDto(user));
    }

    private async Task<SessionMaterial> CreateSessionAsync(ApplicationUser user, CancellationToken ct)
    {
        var now = Now;
        var family = new RefreshTokenFamily { UserId = user.Id, CreatedAtUtc = now, AbsoluteExpiresAtUtc = now.AddDays(30) };
        var raw = AuthCrypto.RandomToken();
        var token = new RefreshToken { FamilyId = family.Id, TokenHash = crypto.Fingerprint(raw), CreatedAtUtc = now, IdleExpiresAtUtc = now.AddDays(7) };
        db.RefreshTokenFamilies.Add(family);
        db.RefreshTokens.Add(token);
        await db.SaveChangesAsync(ct);
        return new(Access(user), raw, crypto.Csrf(family.Id), token.IdleExpiresAtUtc);
    }

    private void VerifyOrigin(HttpContext context)
    {
        string? origin = context.Request.Headers.Origin.FirstOrDefault();
        if (string.IsNullOrEmpty(origin) && Uri.TryCreate(context.Request.Headers.Referer.FirstOrDefault(), UriKind.Absolute, out var referer))
            origin = referer.GetLeftPart(UriPartial.Authority);
        if (origin is null || !options.AllowedOrigins.Contains(origin, StringComparer.Ordinal))
            throw new AppException(403, "csrf_invalid", "请求源站无效。");
    }
    private void VerifyCsrf(HttpContext context, Guid familyId)
    {
        var cookie = context.Request.Cookies[CsrfCookie];
        var header = context.Request.Headers["X-CSRF-Token"].FirstOrDefault();
        if (cookie is null || header != cookie || !crypto.ValidCsrf(cookie, familyId))
            throw new AppException(403, "csrf_invalid", "CSRF 校验失败。");
    }

    public async Task<SessionResponse> RefreshAsync(HttpContext context, CancellationToken ct)
    {
        VerifyOrigin(context);
        var raw = context.Request.Cookies[RefreshCookie];
        if (string.IsNullOrEmpty(raw) || raw.Length > 256) throw InvalidRefresh();
        var hash = crypto.Fingerprint(raw);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var token = await db.RefreshTokens.FromSqlInterpolated($"SELECT * FROM refresh_tokens WHERE token_hash = {hash} FOR UPDATE").SingleOrDefaultAsync(ct)
            ?? throw InvalidRefresh();
        var family = await db.RefreshTokenFamilies.FromSqlInterpolated($"SELECT * FROM refresh_token_families WHERE id = {token.FamilyId} FOR UPDATE").SingleAsync(ct);
        VerifyCsrf(context, family.Id);
        var now = Now;
        if (family.RevokedAtUtc is not null || family.AbsoluteExpiresAtUtc <= now || token.RevokedAtUtc is not null) throw InvalidRefresh();
        var user = await db.Users.SingleAsync(u => u.Id == family.UserId, ct);
        await CheckActiveAsync(user, ct);
        SessionMaterial material;
        if (token.ConsumedAtUtc is not null)
        {
            var receipt = await db.RotationReceipts.SingleOrDefaultAsync(r => r.TokenId == token.Id && r.ExpiresAtUtc > now, ct);
            if (receipt is null)
            {
                family.RevokedAtUtc = now;
                await db.SaveChangesAsync(ct);
                await tx.CommitAsync(ct);
                DeleteCookies(context);
                throw InvalidRefresh();
            }
            material = JsonSerializer.Deserialize<SessionMaterial>(crypto.Decrypt(receipt.EncryptedResponse))!;
        }
        else
        {
            if (token.IdleExpiresAtUtc <= now) throw InvalidRefresh();
            var nextRaw = AuthCrypto.RandomToken();
            var next = new RefreshToken { FamilyId = family.Id, TokenHash = crypto.Fingerprint(nextRaw), CreatedAtUtc = now, IdleExpiresAtUtc = new[] { now.AddDays(7), family.AbsoluteExpiresAtUtc }.Min() };
            token.ConsumedAtUtc = now;
            token.ReplacedById = next.Id;
            db.RefreshTokens.Add(next);
            material = new(Access(user), nextRaw, crypto.Csrf(family.Id), next.IdleExpiresAtUtc);
            db.RotationReceipts.Add(new RotationReceipt { TokenId = token.Id, EncryptedResponse = crypto.Encrypt(JsonSerializer.SerializeToUtf8Bytes(material)), ExpiresAtUtc = now.AddSeconds(options.IdempotencySeconds) });
            await db.RotationReceipts.Where(r => r.ExpiresAtUtc <= now).ExecuteDeleteAsync(ct);
            await db.SaveChangesAsync(ct);
        }
        await tx.CommitAsync(ct);
        WriteCookies(context, material);
        return material.Response;
    }

    public async Task LogoutAsync(HttpContext context, CancellationToken ct)
    {
        VerifyOrigin(context);
        var raw = context.Request.Cookies[RefreshCookie];
        if (!string.IsNullOrEmpty(raw) && raw.Length <= 256)
        {
            var hash = crypto.Fingerprint(raw);
            var token = await db.RefreshTokens.AsNoTracking().SingleOrDefaultAsync(t => t.TokenHash == hash, ct);
            if (token is not null)
            {
                VerifyCsrf(context, token.FamilyId);
                await db.RefreshTokenFamilies.Where(f => f.Id == token.FamilyId && f.RevokedAtUtc == null).ExecuteUpdateAsync(s => s.SetProperty(f => f.RevokedAtUtc, Now), ct);
            }
        }
        DeleteCookies(context);
    }

    public async Task<SessionResponse> ChangePasswordAsync(ChangePasswordRequest request, HttpContext context, CancellationToken ct)
    {
        var active = await GetActiveUserAsync(context, ct);
        if (string.IsNullOrEmpty(request.CurrentPassword) || string.IsNullOrEmpty(request.NewPassword))
            throw new AppException(400, "validation_failed", "请输入当前密码与新密码。");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var user = await db.Users.SingleAsync(u => u.Id == active.Id, ct);
        var result = await users.ChangePasswordAsync(user, request.CurrentPassword, request.NewPassword);
        if (!result.Succeeded) throw new AppException(400, "validation_failed", "密码修改失败。", new Dictionary<string, string[]> { ["newPassword"] = result.Errors.Select(e => e.Description).ToArray() });
        user.MustChangePassword = false;
        await db.RefreshTokenFamilies.Where(f => f.UserId == user.Id && f.RevokedAtUtc == null).ExecuteUpdateAsync(s => s.SetProperty(f => f.RevokedAtUtc, Now), ct);
        var material = await CreateSessionAsync(user, ct);
        await tx.CommitAsync(ct);
        WriteCookies(context, material);
        return material.Response;
    }

    private static AppException InvalidRefresh() => new(401, "refresh_token_invalid", "刷新会话无效，请重新登录。");
    private CookieOptions Cookie(bool httpOnly, string path, DateTime? expires = null) => new() { HttpOnly = httpOnly, Secure = true, SameSite = options.CookieSameSite == "None" ? SameSiteMode.None : SameSiteMode.Lax, Path = path, Expires = expires is null ? null : new DateTimeOffset(expires.Value) };
    private void WriteCookies(HttpContext context, SessionMaterial material)
    {
        context.Response.Cookies.Append(RefreshCookie, material.RefreshToken, Cookie(true, "/api/v1/auth", material.RefreshExpiresAtUtc));
        context.Response.Cookies.Append(CsrfCookie, material.CsrfToken, Cookie(false, "/", material.RefreshExpiresAtUtc));
        context.Response.Headers.CacheControl = "no-store";
    }
    private void DeleteCookies(HttpContext context)
    {
        context.Response.Cookies.Delete(RefreshCookie, Cookie(true, "/api/v1/auth"));
        context.Response.Cookies.Delete(CsrfCookie, Cookie(false, "/"));
        context.Response.Headers.CacheControl = "no-store";
    }
}
