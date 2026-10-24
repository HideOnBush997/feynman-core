$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$env:DOTNET_CLI_HOME = 'D:\Codex\Work\dotnet-home'
$env:NUGET_PACKAGES = 'D:\Codex\Work\nuget'
if (Test-Path 'D:\Codex\Work\dotnet\dotnet.exe') { $env:PATH = "D:\Codex\Work\dotnet;$env:PATH" }
$env:ASPNETCORE_URLS = 'https://localhost:7043'
$env:ASPNETCORE_ENVIRONMENT = 'Development'
dotnet run --project backend/Feynman.Api --no-launch-profile



