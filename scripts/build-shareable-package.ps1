param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Package = Get-Content -LiteralPath (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json
$Version = $Package.version
$ReleaseRoot = Join-Path $ProjectRoot "release"
$VersionDirectory = Join-Path $ReleaseRoot $Version
$BuildRoot = Join-Path $ReleaseRoot ".build\$Version\windows-x64"
$StageRoot = Join-Path $ReleaseRoot ".stage\$Version\windows-x64"
$ExeName = "HF-Model-Downloader-$Version-windows-x64-portable.exe"
$ZipName = "HF-Model-Downloader-$Version-windows-x64-portable.zip"
$ExePath = Join-Path $VersionDirectory $ExeName
$ZipPath = Join-Path $VersionDirectory $ZipName

Push-Location $ProjectRoot
try {
    if (-not (Test-Path (Join-Path $ProjectRoot "node_modules"))) {
        Write-Host "Installing locked development dependencies with npm ci..."
        npm ci | Out-Host
    }

    New-Item -ItemType Directory -Path $VersionDirectory -Force | Out-Null
    Remove-Item -LiteralPath $BuildRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $StageRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $ExePath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $ZipPath -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $BuildRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $StageRoot -Force | Out-Null

    npm run build | Out-Host
    $env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
    npx electron-builder --win portable --x64 "--config.directories.output=$BuildRoot" | Out-Host

    $BuiltExe = Get-ChildItem -LiteralPath $BuildRoot -Filter *.exe -File |
        Where-Object { $_.Length -gt 20MB } |
        Select-Object -First 1
    if (-not $BuiltExe) {
        throw "Windows portable executable was not created as expected."
    }

    Copy-Item -LiteralPath $BuiltExe.FullName -Destination $ExePath
    Copy-Item -LiteralPath $ExePath -Destination (Join-Path $StageRoot $ExeName)
    Copy-Item -LiteralPath (Join-Path $ProjectRoot "docs\releases\README-Windows.txt") -Destination (Join-Path $StageRoot "README-Windows.txt")

    node scripts/release-tool.mjs verify-stage $StageRoot | Out-Host
    Compress-Archive -Path (Join-Path $StageRoot "*") -DestinationPath $ZipPath -CompressionLevel Optimal

    node scripts/release-tool.mjs finalize $VersionDirectory | Out-Host
    node scripts/release-tool.mjs verify-checksums $VersionDirectory | Out-Host
}
finally {
    Pop-Location
    Remove-Item -LiteralPath $BuildRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $StageRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Windows portable executable:"
Write-Host $ExePath
Write-Host ""
Write-Host "Windows portable archive:"
Write-Host $ZipPath
Write-Host ""
Write-Host "Release metadata:"
Write-Host (Join-Path $VersionDirectory "RELEASE-NOTES.md")
Write-Host (Join-Path $VersionDirectory "SHA256SUMS.txt")
