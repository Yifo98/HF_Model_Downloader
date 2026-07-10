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
$ZipName = "HF-Model-Downloader-$Version-windows-x64-portable.zip"
$ZipPath = Join-Path $VersionDirectory $ZipName
$AppFolderName = "HF Model Downloader"
$AppExeName = "HF Model Downloader.exe"
$LauncherName = "Start HF Model Downloader.cmd"
$PortableMarker = ".hf-model-downloader-portable-root"
$ForbiddenPathPattern = '(^|/)(\.env|\.ds_store|__macosx|cookies?(\.json)?|history(\.json)?|preferences\.json|electron-(session|user-data)|hf_model_downloader_data|logs?|cache|downloads?|token)(/|$)'

function Assert-NativeSuccess([string]$Step) {
    if ($LASTEXITCODE -ne 0) {
        throw "$Step failed with exit code $LASTEXITCODE."
    }
}

function Test-ContainsForbiddenPath([string[]]$Entries) {
    foreach ($Entry in $Entries) {
        if ([string]::IsNullOrWhiteSpace($Entry)) {
            continue
        }
        $NormalizedEntry = $Entry.Replace('\', '/')
        if ($NormalizedEntry -match $ForbiddenPathPattern) {
            return $true
        }
    }
    return $false
}

Push-Location $ProjectRoot
try {
    if (-not (Test-Path (Join-Path $ProjectRoot "node_modules"))) {
        Write-Host "Installing locked development dependencies with npm ci..."
        npm ci | Out-Host
        Assert-NativeSuccess "npm ci"
    }

    New-Item -ItemType Directory -Path $VersionDirectory -Force | Out-Null
    Remove-Item -LiteralPath $BuildRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $StageRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $ZipPath -Force -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $VersionDirectory -Filter "HF-Model-Downloader-$Version-windows-*-portable.exe" -File -ErrorAction SilentlyContinue |
        Remove-Item -Force
    New-Item -ItemType Directory -Path $BuildRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $StageRoot -Force | Out-Null

    npm run build | Out-Host
    Assert-NativeSuccess "npm run build"
    $env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
    npx electron-builder --win dir --x64 "--config.directories.output=$BuildRoot" | Out-Host
    Assert-NativeSuccess "electron-builder Windows directory build"

    $BuiltAppDirectory = Get-ChildItem -LiteralPath $BuildRoot -Directory -Filter "win-unpacked" -Recurse |
        Select-Object -First 1
    if (-not $BuiltAppDirectory) {
        throw "Windows unpacked application directory was not created as expected."
    }

    $AppDirectory = Join-Path $StageRoot $AppFolderName
    Copy-Item -LiteralPath $BuiltAppDirectory.FullName -Destination $AppDirectory -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $ProjectRoot "docs\releases\README-Windows.txt") -Destination (Join-Path $StageRoot "README-Windows.txt")

    $LauncherLines = @(
        '@echo off',
        'setlocal',
        'set "HF_MODEL_DOWNLOADER_PORTABLE_ROOT=%~dp0"',
        'set "HF_MODEL_DOWNLOADER_DATA=%~dp0HF_Model_Downloader_Data"',
        'set "HF_MODEL_DOWNLOADER_EXE=%~dp0HF Model Downloader\HF Model Downloader.exe"',
        'if not exist "%HF_MODEL_DOWNLOADER_PORTABLE_ROOT%.hf-model-downloader-portable-root" (',
        '  echo HF Model Downloader portable marker is missing.',
        '  echo Please extract the complete ZIP before launching.',
        '  pause',
        '  exit /b 1',
        ')',
        'if not exist "%HF_MODEL_DOWNLOADER_EXE%" (',
        '  echo HF Model Downloader runtime is incomplete.',
        '  echo Please extract the complete ZIP before launching.',
        '  pause',
        '  exit /b 1',
        ')',
        'for %%D in ("%HF_MODEL_DOWNLOADER_DATA%" "%HF_MODEL_DOWNLOADER_DATA%\appdata" "%HF_MODEL_DOWNLOADER_DATA%\localappdata" "%HF_MODEL_DOWNLOADER_DATA%\temp" "%HF_MODEL_DOWNLOADER_DATA%\electron-user-data" "%HF_MODEL_DOWNLOADER_DATA%\cache\chromium") do (',
        '  if not exist "%%~D" mkdir "%%~D" >nul 2>&1',
        '  if not exist "%%~D" (',
        '    echo Cannot create portable data directory: %%~D',
        '    echo Move the extracted folder to a writable location and try again.',
        '    pause',
        '    exit /b 1',
        '  )',
        ')',
        'set "APPDATA=%HF_MODEL_DOWNLOADER_DATA%\appdata"',
        'set "LOCALAPPDATA=%HF_MODEL_DOWNLOADER_DATA%\localappdata"',
        'set "TEMP=%HF_MODEL_DOWNLOADER_DATA%\temp"',
        'set "TMP=%HF_MODEL_DOWNLOADER_DATA%\temp"',
        'start "" "%HF_MODEL_DOWNLOADER_EXE%" "--user-data-dir=%HF_MODEL_DOWNLOADER_DATA%\electron-user-data" "--disk-cache-dir=%HF_MODEL_DOWNLOADER_DATA%\cache\chromium"',
        'endlocal'
    )
    $Utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText((Join-Path $StageRoot $LauncherName), ($LauncherLines -join "`r`n") + "`r`n", $Utf8WithoutBom)
    [System.IO.File]::WriteAllText((Join-Path $StageRoot $PortableMarker), "HF Model Downloader portable root v1`r`n", $Utf8WithoutBom)

    $RequiredRuntimePaths = @(
        (Join-Path $AppDirectory $AppExeName),
        (Join-Path $AppDirectory "resources\app.asar"),
        (Join-Path $AppDirectory "resources.pak"),
        (Join-Path $AppDirectory "icudtl.dat"),
        (Join-Path $AppDirectory "v8_context_snapshot.bin"),
        (Join-Path $AppDirectory "chrome_100_percent.pak"),
        (Join-Path $AppDirectory "chrome_200_percent.pak"),
        (Join-Path $AppDirectory "libEGL.dll"),
        (Join-Path $AppDirectory "libGLESv2.dll"),
        (Join-Path $AppDirectory "locales")
    )
    foreach ($RequiredPath in $RequiredRuntimePaths) {
        if (-not (Test-Path -LiteralPath $RequiredPath)) {
            throw "Packaged Windows runtime is incomplete: $RequiredPath"
        }
    }

    node scripts/release-tool.mjs verify-stage $StageRoot | Out-Host
    Assert-NativeSuccess "release stage verification"

    $AsarCommand = Join-Path $ProjectRoot "node_modules\.bin\asar.cmd"
    $AsarListing = & $AsarCommand list (Join-Path $AppDirectory "resources\app.asar")
    Assert-NativeSuccess "app.asar inspection"
    if (Test-ContainsForbiddenPath -Entries @($AsarListing)) {
        throw "User data or a sensitive runtime path was detected inside app.asar."
    }

    Compress-Archive -Path (Join-Path $StageRoot "*") -DestinationPath $ZipPath -CompressionLevel Optimal

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $Archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        $ArchiveEntries = @($Archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
    }
    finally {
        $Archive.Dispose()
    }

    foreach ($ExpectedEntry in @(
        $LauncherName,
        $PortableMarker,
        "$AppFolderName/$AppExeName",
        "$AppFolderName/resources/app.asar"
    )) {
        if ($ArchiveEntries -notcontains $ExpectedEntry) {
            throw "Windows archive is missing an expected entry: $ExpectedEntry"
        }
    }
    if (Test-ContainsForbiddenPath -Entries $ArchiveEntries) {
        throw "User data or a sensitive runtime path was detected inside the Windows archive."
    }

    $AllowedRoots = @($LauncherName, $PortableMarker, $AppFolderName, "README-Windows.txt")
    $UnexpectedRoots = $ArchiveEntries |
        Where-Object { $_ } |
        ForEach-Object { ($_ -split '/', 2)[0] } |
        Sort-Object -Unique |
        Where-Object { $_ -notin $AllowedRoots }
    if ($UnexpectedRoots) {
        throw "Windows archive contains unexpected root entries: $($UnexpectedRoots -join ', ')"
    }

    $UnexpectedExecutables = Get-ChildItem -LiteralPath $VersionDirectory -Filter "HF-Model-Downloader-$Version-windows-*.exe" -File -ErrorAction SilentlyContinue
    if ($UnexpectedExecutables) {
        throw "A top-level Windows executable was produced; only the portable ZIP may be published."
    }

    node scripts/release-tool.mjs finalize $VersionDirectory | Out-Host
    Assert-NativeSuccess "release metadata generation"
    node scripts/release-tool.mjs verify-checksums $VersionDirectory | Out-Host
    Assert-NativeSuccess "release checksum verification"
}
finally {
    Pop-Location
    Remove-Item -LiteralPath $BuildRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $StageRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Windows directory-style portable archive:"
Write-Host $ZipPath
Write-Host ""
Write-Host "Archive root:"
Write-Host "  $LauncherName"
Write-Host "  $AppFolderName\"
Write-Host "  README-Windows.txt"
Write-Host ""
Write-Host "Release metadata:"
Write-Host (Join-Path $VersionDirectory "RELEASE-NOTES.md")
Write-Host (Join-Path $VersionDirectory "SHA256SUMS.txt")
