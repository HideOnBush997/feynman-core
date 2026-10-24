using Feynman.Api.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Feynman.Api.Auth;

public sealed class AuthReceiptCleanup(AppDbContext db, TimeProvider clock)
{
    public Task<int> CleanupAsync(CancellationToken cancellationToken = default) =>
        db.RotationReceipts.Where(r => r.ExpiresAtUtc <= clock.GetUtcNow().UtcDateTime)
            .ExecuteDeleteAsync(cancellationToken);
}

public sealed class AuthReceiptCleanupWorker(IServiceScopeFactory scopes, ILogger<AuthReceiptCleanupWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            // Local migration commands can construct the host before the schema is installed.
            await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
            using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
            do
            {
                try
                {
                    await using var scope = scopes.CreateAsyncScope();
                    await scope.ServiceProvider.GetRequiredService<AuthReceiptCleanup>().CleanupAsync(stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
                catch (Exception ex) { logger.LogWarning(ex, "Expired authentication receipt cleanup failed; retrying in 30 seconds."); }
            } while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }
}
