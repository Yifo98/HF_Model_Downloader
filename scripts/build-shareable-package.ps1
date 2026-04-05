param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Push-Location $ProjectRoot
try {
    if (-not (Test-Path (Join-Path $ProjectRoot "node_modules"))) {
        npm install | Out-Host
    }

    npm run build | Out-Host
    npx electron-builder --win portable zip --x64 | Out-Host
}
finally {
    Pop-Location
}

$releaseDir = Join-Path $ProjectRoot "release"
$portableExe = Get-ChildItem -LiteralPath $releaseDir -Filter *.exe | Select-Object -First 1
$zipArtifact = Get-ChildItem -LiteralPath $releaseDir -Filter *win*.zip | Select-Object -First 1

if (-not $portableExe -or -not $zipArtifact) {
    throw "Windows build artifacts were not created as expected."
}

$privacyPattern = 'cookie|history|config\.json|user[- ]data|electron-session|electron-user-data|token|api[_-]?key'
$tempInspectDir = Join-Path $releaseDir "_inspect"

if (Test-Path $tempInspectDir) {
    Remove-Item -LiteralPath $tempInspectDir -Recurse -Force
}

Expand-Archive -LiteralPath $zipArtifact.FullName -DestinationPath $tempInspectDir -Force

try {
    $sensitive = Get-ChildItem -LiteralPath $tempInspectDir -Recurse -File | Where-Object {
        $_.FullName -match $privacyPattern
    }

    if ($sensitive) {
        throw "Sensitive files were detected inside the Windows zip artifact."
    }
}
finally {
    if (Test-Path $tempInspectDir) {
        Remove-Item -LiteralPath $tempInspectDir -Recurse -Force
    }
}

Write-Host ""
Write-Host "Windows portable artifact:"
Write-Host $portableExe.FullName
Write-Host ""
Write-Host "Windows zip artifact:"
Write-Host $zipArtifact.FullName
