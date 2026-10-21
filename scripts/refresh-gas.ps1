$ErrorActionPreference = "Continue"
$repo = Split-Path $PSScriptRoot -Parent
$gh = Join-Path $env:LOCALAPPDATA "gh-cli\bin\gh.exe"
$log = Join-Path $env:LOCALAPPDATA "weth-gas-refresh.log"
Set-Location $repo
$env:GH_BIN = $gh
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$tsx = Join-Path $repo "node_modules\.bin\tsx.cmd"
$output = & $tsx scripts/refresh-gas.ts 2>&1
$code = $LASTEXITCODE
Add-Content -Path $log -Value "$stamp $code $($output | Out-String)".Trim()
exit $code
