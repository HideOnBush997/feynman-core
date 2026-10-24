using Feynman.Api.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;

namespace Feynman.Persistence.Tests;

public sealed class DatabaseTests : IAsyncLifetime
{
    private readonly string databaseName = "feynman_test_" + Guid.NewGuid().ToString("N");
    private string Connection => new NpgsqlConnectionStringBuilder(AdminConnection) { Database = databaseName }.ToString();
    private static string AdminConnection => DatabaseConnection.TestAdmin();
    private AppDbContext Open() => new(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(Connection).Options);

    public async Task InitializeAsync()
    {
        await using var connection = new NpgsqlConnection(AdminConnection);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand($"CREATE DATABASE {databaseName}", connection);
        await command.ExecuteNonQueryAsync();
        await using var db = Open();
        await db.Database.MigrateAsync();
    }

    public async Task DisposeAsync()
    {
        NpgsqlConnection.ClearAllPools();
        await using var connection = new NpgsqlConnection(AdminConnection);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand($"DROP DATABASE {databaseName} WITH (FORCE)", connection);
        await command.ExecuteNonQueryAsync();
    }

    [Fact]
    public async Task InitialMigrationAppliesToEmptyPostgreSql18()
    {
        await using var db = Open();
        Assert.Single(await db.Database.GetAppliedMigrationsAsync());
        Assert.Empty(await db.Database.GetPendingMigrationsAsync());
        await db.Database.OpenConnectionAsync();
        Assert.StartsWith("18.", db.Database.GetDbConnection().ServerVersion);
        Assert.Empty(await db.Tenants.ToListAsync());
    }

    [Fact]
    public async Task NormalizedUsernamesAreGloballyUnique()
    {
        await using var db = Open();
        db.Users.Add(new ApplicationUser { UserName = "alice", NormalizedUserName = "ALICE", Role = Roles.PlatformAdmin });
        await db.SaveChangesAsync();
        db.Users.Add(new ApplicationUser { UserName = "Alice", NormalizedUserName = "ALICE", Role = Roles.PlatformAdmin });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task SegmentChecksDuplicatesAndForeignKeysAreEnforced()
    {
        await using var db = Open();
        var task = await AddTaskAsync(db);
        db.Segments.Add(new Segment { TaskId = task.Id, StartMs = 10, EndMs = 20 });
        await db.SaveChangesAsync();
        db.Segments.Add(new Segment { TaskId = task.Id, StartMs = 10, EndMs = 20 });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();
        db.Segments.Add(new Segment { TaskId = task.Id, StartMs = -1, EndMs = 5 });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();
        db.Segments.Add(new Segment { TaskId = Guid.NewGuid(), StartMs = 0, EndMs = 10 });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task HistoricalParentsCannotCascadeDelete()
    {
        await using var db = Open();
        var task = await AddTaskAsync(db);
        db.Segments.Add(new Segment { TaskId = task.Id, StartMs = 0, EndMs = 10 });
        await db.SaveChangesAsync();
        await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM tenants WHERE id = {task.TenantId}"));
        await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM tasks WHERE id = {task.Id}"));
        Assert.Single(await db.Segments.ToListAsync());
    }

    [Fact]
    public async Task SeedIsIdempotentAndPreservesExistingPasswords()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddDbContext<AppDbContext>(x => x.UseNpgsql(Connection));
        services.AddIdentityCore<ApplicationUser>(x => x.User.AllowedUserNameCharacters = "").AddEntityFrameworkStores<AppDbContext>();
        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        await DemoSeed.RunAsync(db, users, new DemoSeedOptions { AdminPassword = "FixtureAdmin_Only123!", AnnotatorPassword = "FixtureAnnotator_Only123!" });
        var originalHash = (await users.FindByNameAsync("demo.admin"))!.PasswordHash;
        await DemoSeed.RunAsync(db, users, new DemoSeedOptions { AdminPassword = "FixtureAdmin_Only123!", AnnotatorPassword = "FixtureAnnotator_Only123!" });
        Assert.Equal(2, await db.Users.CountAsync());
        Assert.Single(await db.Tenants.ToListAsync());
        Assert.Single(await db.Tasks.ToListAsync());
        Assert.Equal(originalHash, (await users.FindByNameAsync("demo.admin"))!.PasswordHash);
        Assert.All(await db.Users.ToListAsync(), x => Assert.True(x.MustChangePassword));
    }

    [Fact]
    public async Task OptimisticVersionConflictDoesNotOverwriteWinner()
    {
        await using var first = Open();
        var task = await AddTaskAsync(first);
        await using var second = Open();
        var stale = await second.Tasks.SingleAsync(x => x.Id == task.Id);
        task.Name = "winner"; task.RowVersion++;
        await first.SaveChangesAsync();
        stale.Name = "loser"; stale.RowVersion++;
        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => second.SaveChangesAsync());
        await using var read = Open();
        Assert.Equal("winner", (await read.Tasks.SingleAsync()).Name);
    }

    [Fact]
    public async Task ConditionalClaimsHaveExactlyOneWinner()
    {
        await using var db = Open();
        var task = await AddTaskAsync(db);
        task.Status = TaskStates.Available;
        var users = new[] { new ApplicationUser { UserName = "a", NormalizedUserName = "A", TenantId = task.TenantId }, new ApplicationUser { UserName = "b", NormalizedUserName = "B", TenantId = task.TenantId } };
        db.Users.AddRange(users); await db.SaveChangesAsync();
        async Task<int> Claim(Guid user)
        {
            await using var contender = Open();
            return await contender.Tasks.Where(x => x.Id == task.Id && x.Status == TaskStates.Available && x.RowVersion == 1)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.Status, TaskStates.Claimed).SetProperty(x => x.AssigneeUserId, user).SetProperty(x => x.RowVersion, x => x.RowVersion + 1));
        }
        var results = await Task.WhenAll(users.Select(x => Claim(x.Id)));
        Assert.Equal(1, results.Sum());
        await using var read = Open();
        Assert.Equal(2, (await read.Tasks.SingleAsync()).RowVersion);
    }

    [Fact]
    public async Task FailedAggregateTransactionRollsBackSegmentsAndVersion()
    {
        await using var db = Open();
        var task = await AddTaskAsync(db);
        await using (var transaction = await db.Database.BeginTransactionAsync())
        {
            task.RowVersion++; await db.SaveChangesAsync();
            db.Segments.Add(new Segment { TaskId = task.Id, StartMs = 0, EndMs = 10 });
            await db.SaveChangesAsync();
            await transaction.RollbackAsync();
        }
        await using var read = Open();
        Assert.Empty(await read.Segments.ToListAsync());
        Assert.Equal(1, (await read.Tasks.SingleAsync()).RowVersion);
    }

    [Fact]
    public async Task RoleTenantBindingAndTokenFingerprintsAreConstrained()
    {
        await using var db = Open();
        db.Users.Add(new ApplicationUser { UserName = "invalid", NormalizedUserName = "INVALID", Role = Roles.Annotator });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();
        var user = new ApplicationUser { UserName = "admin", NormalizedUserName = "ADMIN", Role = Roles.PlatformAdmin };
        var family = new RefreshTokenFamily { User = user, UserId = user.Id, AbsoluteExpiresAtUtc = DateTime.UtcNow.AddDays(30) };
        db.RefreshTokens.Add(new RefreshToken { Family = family, FamilyId = family.Id, TokenHash = new byte[32], IdleExpiresAtUtc = DateTime.UtcNow.AddDays(7) });
        await db.SaveChangesAsync();
        db.RefreshTokens.Add(new RefreshToken { FamilyId = family.Id, TokenHash = new byte[32], IdleExpiresAtUtc = DateTime.UtcNow.AddDays(7) });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();
        await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM application_users WHERE id = {user.Id}"));
        Assert.Single(await db.RefreshTokens.ToListAsync());
    }
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task SubmissionOrSaveRacingCancellationOrRecallCommitsOneAggregate(bool submit)
    {
        await using var db = Open();
        var task = await AddTaskAsync(db);
        var user = new ApplicationUser { UserName = "worker", NormalizedUserName = "WORKER", TenantId = task.TenantId };
        db.Users.Add(user);
        task.Status = TaskStates.Claimed; task.AssigneeUserId = user.Id;
        await db.SaveChangesAsync();
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        async Task<int> Write()
        {
            await using var writer = Open();
            await using var transaction = await writer.Database.BeginTransactionAsync();
            await release.Task;
            var count = await writer.Tasks.Where(x => x.Id == task.Id && x.Status == TaskStates.Claimed && x.RowVersion == 1)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.Status, submit ? TaskStates.Submitted : TaskStates.Claimed)
                    .SetProperty(x => x.RowVersion, x => x.RowVersion + 1));
            if (count == 1)
            {
                writer.Segments.Add(new Segment { TaskId = task.Id, StartMs = 0, EndMs = 10 });
                await writer.SaveChangesAsync();
            }
            await transaction.CommitAsync(); return count;
        }
        async Task<int> TakeAway()
        {
            await using var manager = Open();
            await release.Task;
            return await manager.Tasks.Where(x => x.Id == task.Id && x.Status == TaskStates.Claimed && x.RowVersion == 1)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.Status, submit ? TaskStates.Cancelled : TaskStates.Available)
                    .SetProperty(x => x.AssigneeUserId, (Guid?)null).SetProperty(x => x.RowVersion, x => x.RowVersion + 1));
        }
        var write = Write(); var take = TakeAway(); release.SetResult();
        var results = await Task.WhenAll(write, take);
        Assert.Equal(1, results.Sum());
        await using var read = Open();
        var stored = await read.Tasks.SingleAsync();
        Assert.Equal(2, stored.RowVersion);
        if (results[0] == 1)
        {
            Assert.Single(await read.Segments.ToListAsync());
            Assert.Equal(submit ? TaskStates.Submitted : TaskStates.Claimed, stored.Status);
            Assert.Equal(user.Id, stored.AssigneeUserId);
        }
        else
        {
            Assert.Empty(await read.Segments.ToListAsync());
            Assert.Equal(submit ? TaskStates.Cancelled : TaskStates.Available, stored.Status);
            Assert.Null(stored.AssigneeUserId);
        }
    }
    private static async Task<AnnotationTask> AddTaskAsync(AppDbContext db)
    {
        var tenant = new Tenant { Name = "test" };
        var task = new AnnotationTask { Tenant = tenant, TenantId = tenant.Id, Name = "test", VideoUrl = "https://example.test/video.mp4" };
        db.Tasks.Add(task); await db.SaveChangesAsync(); return task;
    }
}



