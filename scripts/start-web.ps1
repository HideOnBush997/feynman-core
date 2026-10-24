$ErrorActionPreference = 'Stop'
Set-Location (Join-Path (Split-Path $PSScriptRoot -Parent) 'frontend')
$env:HTTPS_CERT_FILE = 'D:\Codex\Work\feynman-certs\localhost.pem'
$env:HTTPS_KEY_FILE = 'D:\Codex\Work\feynman-certs\localhost.key'
$env:PLAYWRIGHT_BROWSERS_PATH = 'D:\Codex\Work\playwright-browsers'
npm run dev



