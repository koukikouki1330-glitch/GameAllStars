$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$env:GAMEALLSTARS_BIND_URL = if ($env:GAMEALLSTARS_BIND_URL) { $env:GAMEALLSTARS_BIND_URL } else { "http://localhost:5180" }
Write-Host "Game All-stars Store Server"
Write-Host "URL: $env:GAMEALLSTARS_BIND_URL"
Write-Host "Press Ctrl+C to stop."

$exe = Join-Path $PSScriptRoot "bin\Debug\net8.0\GameAllStarsStoreServer.exe"
if (Test-Path $exe) {
    & $exe
    exit $LASTEXITCODE
}

dotnet run --project (Join-Path $PSScriptRoot "GameAllStarsStoreServer.csproj")
