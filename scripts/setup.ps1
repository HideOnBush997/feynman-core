$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$taskTools = 'D:\Codex\Work'
New-Item -ItemType Directory -Force "$taskTools\feynman-certs" | Out-Null
$env:DOTNET_CLI_HOME = "$taskTools\dotnet-home"
$env:NUGET_PACKAGES = "$taskTools\nuget"
$env:PLAYWRIGHT_BROWSERS_PATH = "$taskTools\playwright-browsers"
if (Test-Path "$taskTools\dotnet\dotnet.exe") { $env:PATH = "$taskTools\dotnet;$env:PATH" }
$taskExistingConfig = Test-Path 'backend\Feynman.Api\appsettings.Local.json'
if (-not (Test-Path 'backend\Feynman.Api\appsettings.Local.json')) {
    $taskConfig = Get-Content 'backend\Feynman.Api\appsettings.Local.example.json' -Raw | ConvertFrom-Json
    $taskDatabasePassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
    $taskConfig.ConnectionStrings.Database = $taskConfig.ConnectionStrings.Database.Replace('REPLACE_WITH_LOCAL_DATABASE_PASSWORD', $taskDatabasePassword)
    $taskConfig.DemoSeed.AdminPassword = 'A1!' + [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).ToLowerInvariant()
    $taskConfig.DemoSeed.AnnotatorPassword = 'A1!' + [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).ToLowerInvariant()
    $taskConfig.Auth.SigningKey = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
    $taskConfig.Auth.HmacKey = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
    $taskConfig.Auth.ReceiptEncryptionKey = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    $taskConfig | ConvertTo-Json -Depth 8 | Set-Content 'backend\Feynman.Api\appsettings.Local.json' -Encoding utf8
}
if (-not (Test-Path '.env')) {
    if ($taskExistingConfig) { throw 'Existing local configuration detected. Create ignored .env using the existing database credentials; no database credentials were changed.' }
    @("POSTGRES_DB=feynman", "POSTGRES_USER=feynman", "POSTGRES_PASSWORD=$taskDatabasePassword", "POSTGRES_PORT=5432") | Set-Content '.env' -Encoding utf8
}
docker compose up -d --wait
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL startup failed' }
dotnet dev-certs https --trust
dotnet dev-certs https -ep "$taskTools\feynman-certs\localhost.pem" --format PEM --no-password
dotnet tool restore
if ($LASTEXITCODE -ne 0) { throw 'dotnet tool restore failed' }
dotnet ef database update --project backend/Feynman.Api
if ($LASTEXITCODE -ne 0) { throw 'Migration failed' }
dotnet run --project backend/Feynman.Api -- --seed
if ($LASTEXITCODE -ne 0) { throw 'Seed failed' }
Push-Location frontend
npm install --cache "$taskTools\npm-cache"
if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
Pop-Location
Write-Host 'Ready. Run scripts/start-api.ps1 and scripts/start-web.ps1 in separate terminals.'



