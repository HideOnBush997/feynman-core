using System.Text.Json;
using Npgsql;

namespace Feynman.Api.Persistence;

public static class DatabaseConnection
{
    public static string Resolve()
    {
        var injected = Environment.GetEnvironmentVariable("ConnectionStrings__Database");
        if (!string.IsNullOrWhiteSpace(injected)) return injected;
        foreach (var start in new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
        {
            for (var directory = new DirectoryInfo(start); directory is not null; directory = directory.Parent)
            {
                foreach (var relative in new[] { "appsettings.Local.json", "backend/Feynman.Api/appsettings.Local.json" })
                {
                    var path = Path.Combine(directory.FullName, relative);
                    if (!File.Exists(path)) continue;
                    using var document = JsonDocument.Parse(File.ReadAllText(path));
                    if (document.RootElement.TryGetProperty("ConnectionStrings", out var section) &&
                        section.TryGetProperty("Database", out var value) && value.GetString() is { Length: > 0 } connection)
                        return connection;
                }
            }
        }
        throw new InvalidOperationException("Set ConnectionStrings__Database or run scripts/setup.ps1 to create local configuration.");
    }

    public static string TestAdmin()
    {
        var injected = Environment.GetEnvironmentVariable("FEYNMAN_TEST_DATABASE");
        return !string.IsNullOrWhiteSpace(injected) ? injected : new NpgsqlConnectionStringBuilder(Resolve()) { Database = "postgres" }.ToString();
    }
}
