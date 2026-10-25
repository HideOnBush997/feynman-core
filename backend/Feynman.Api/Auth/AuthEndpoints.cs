using System.Text;
using Feynman.Api.Persistence;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.IdentityModel.Tokens;

namespace Feynman.Api.Auth;

public static class AuthEndpoints
{
    public static IServiceCollection AddFeynmanAuth(this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection("Auth").Get<AuthOptions>() ?? new();
        options.Validate();
        services.AddSingleton(options);
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton<AuthCrypto>();
        services.AddScoped<AuthService>();
        services.AddScoped<AuthReceiptCleanup>();
        services.AddHostedService<AuthReceiptCleanupWorker>();
        services.AddIdentityCore<ApplicationUser>(o =>
        {
            // The product deliberately permits Unicode and punctuation in globally unique usernames.
            o.User.AllowedUserNameCharacters = "";
            o.User.RequireUniqueEmail = false;
            o.Password.RequiredLength = 6;
            o.Password.RequireDigit = false;
            o.Password.RequireLowercase = false;
            o.Password.RequireUppercase = false;
            o.Password.RequireNonAlphanumeric = false;
        }).AddErrorDescriber<SimplePasswordErrors>().AddEntityFrameworkStores<AppDbContext>();
        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o =>
        {
            o.MapInboundClaims = false;
            o.TokenValidationParameters = new()
            {
                ValidateIssuer = true,
                ValidIssuer = options.Issuer,
                ValidateAudience = true,
                ValidAudience = options.Audience,
                ValidateLifetime = true,
                RequireExpirationTime = true,
                ValidateIssuerSigningKey = true,
                RequireSignedTokens = true,
                IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(options.SigningKey)),
                ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
                ClockSkew = TimeSpan.Zero,
                NameClaimType = "sub",
                RoleClaimType = "role"
            };
        });
        services.AddAuthorization(o =>
        {
            o.AddPolicy(Roles.PlatformAdmin, p => p.RequireAuthenticatedUser().RequireRole(Roles.PlatformAdmin));
            o.AddPolicy(Roles.Annotator, p => p.RequireAuthenticatedUser().RequireRole(Roles.Annotator));
        });
        services.AddCors(o => o.AddPolicy("Spa", p => p.WithOrigins(options.AllowedOrigins).AllowCredentials().WithMethods("GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS").WithHeaders("Authorization", "Content-Type", "X-CSRF-Token", "If-Match")));
        return services;
    }

    public static IEndpointRouteBuilder MapFeynmanAuth(this IEndpointRouteBuilder endpoints)
    {
        var auth = endpoints.MapGroup("/api/v1/auth");
        auth.MapPost("/login", (LoginRequest body, AuthService service, HttpContext context, CancellationToken ct) => service.LoginAsync(body, context, ct)).AllowAnonymous();
        auth.MapPost("/refresh", (AuthService service, HttpContext context, CancellationToken ct) => service.RefreshAsync(context, ct)).AllowAnonymous();
        auth.MapPost("/logout", async (AuthService service, HttpContext context, CancellationToken ct) => { await service.LogoutAsync(context, ct); return Results.NoContent(); }).AllowAnonymous();
        auth.MapPost("/change-password", (ChangePasswordRequest body, AuthService service, HttpContext context, CancellationToken ct) => service.ChangePasswordAsync(body, context, ct)).RequireAuthorization();
        auth.MapGet("/me", async (AuthService service, HttpContext context, CancellationToken ct) => AuthService.ToDto(await service.GetActiveUserAsync(context, ct))).RequireAuthorization();
        return endpoints;
    }
}

public sealed class ActiveUserMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, AuthService service)
    {
        if (context.User.Identity?.IsAuthenticated == true && context.GetEndpoint()?.Metadata.GetMetadata<IAllowAnonymous>() is null)
        {
            var user = await service.GetActiveUserAsync(context, context.RequestAborted);
            context.Items[typeof(ApplicationUser)] = user;
        }
        await next(context);
    }
}

public sealed class SimplePasswordErrors : IdentityErrorDescriber
{
    public override IdentityError DuplicateUserName(string userName) => new() { Code = nameof(DuplicateUserName), Description = "用户名已存在，请更换用户名。" };
    public override IdentityError PasswordTooShort(int length) => new() { Code = nameof(PasswordTooShort), Description = $"密码至少需要 {length} 位。" };
    public override IdentityError PasswordMismatch() => new() { Code = nameof(PasswordMismatch), Description = "当前密码错误。" };
}
