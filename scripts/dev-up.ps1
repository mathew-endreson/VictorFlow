# PowerShell entry point: .\scripts\dev-up.ps1   (same as `pnpm dev:up`)
$ErrorActionPreference = 'Stop'
node (Join-Path $PSScriptRoot 'dev-up.mjs') @args
exit $LASTEXITCODE
