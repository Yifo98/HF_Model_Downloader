#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RELEASE_DIR="$PROJECT_ROOT/release"
APP_VERSION="$(node -p "require('$PROJECT_ROOT/package.json').version")"
VERSION_DIR="$RELEASE_DIR/$APP_VERSION"
RELEASE_ARCH="x64"
BUILD_ROOT="$RELEASE_DIR/.build/$APP_VERSION/windows-$RELEASE_ARCH"
STAGE_ROOT="$RELEASE_DIR/.stage/$APP_VERSION/windows-$RELEASE_ARCH"
ZIP_NAME="HF-Model-Downloader-$APP_VERSION-windows-$RELEASE_ARCH-portable.zip"
ZIP_PATH="$VERSION_DIR/$ZIP_NAME"
APP_FOLDER_NAME="HF Model Downloader"
APP_EXE_NAME="HF Model Downloader.exe"
LAUNCHER_NAME="Start HF Model Downloader.cmd"
PORTABLE_MARKER=".hf-model-downloader-portable-root"
FORBIDDEN_ARCHIVE_PATH='(^|/)(\.env|\.DS_Store|__MACOSX|cookies?(\.json)?|history(\.json)?|preferences\.json|electron-(session|user-data)|HF_Model_Downloader_Data|logs?|cache|downloads?|token)(/|$)'

cleanup() {
  rm -rf "$BUILD_ROOT" "$STAGE_ROOT"
}
trap cleanup EXIT

fail() {
  echo "$1"
  exit 1
}

cd "$PROJECT_ROOT"

if [[ ! -d "$PROJECT_ROOT/node_modules" ]]; then
  echo "Installing locked development dependencies with npm ci..."
  npm ci
fi

mkdir -p "$VERSION_DIR"
rm -rf "$BUILD_ROOT" "$STAGE_ROOT"
rm -f "$ZIP_PATH"
find "$VERSION_DIR" -maxdepth 1 -type f -name "HF-Model-Downloader-$APP_VERSION-windows-*-portable.exe" -delete
mkdir -p "$BUILD_ROOT" "$STAGE_ROOT"

if [[ "$(uname -s)" == "Darwin" ]]; then
  scripts/generate-platform-icons.sh
fi

npm run build

CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder \
  --win dir \
  --x64 \
  --config.directories.output="$BUILD_ROOT"

BUILT_APP_DIR="$(find "$BUILD_ROOT" -maxdepth 3 -type d -name 'win-unpacked' -print -quit)"
[[ -n "$BUILT_APP_DIR" ]] || fail "Windows unpacked application directory was not created as expected."

APP_DIR="$STAGE_ROOT/$APP_FOLDER_NAME"
/usr/bin/ditto "$BUILT_APP_DIR" "$APP_DIR"
cp "$PROJECT_ROOT/docs/releases/README-Windows.txt" "$STAGE_ROOT/README-Windows.txt"

printf '%s\r\n' \
  '@echo off' \
  'setlocal' \
  'set "HF_MODEL_DOWNLOADER_PORTABLE_ROOT=%~dp0"' \
  'set "HF_MODEL_DOWNLOADER_DATA=%~dp0HF_Model_Downloader_Data"' \
  'set "HF_MODEL_DOWNLOADER_EXE=%~dp0HF Model Downloader\HF Model Downloader.exe"' \
  'if not exist "%HF_MODEL_DOWNLOADER_PORTABLE_ROOT%.hf-model-downloader-portable-root" (' \
  '  echo HF Model Downloader portable marker is missing.' \
  '  echo Please extract the complete ZIP before launching.' \
  '  pause' \
  '  exit /b 1' \
  ')' \
  'if not exist "%HF_MODEL_DOWNLOADER_EXE%" (' \
  '  echo HF Model Downloader runtime is incomplete.' \
  '  echo Please extract the complete ZIP before launching.' \
  '  pause' \
  '  exit /b 1' \
  ')' \
  'for %%D in ("%HF_MODEL_DOWNLOADER_DATA%" "%HF_MODEL_DOWNLOADER_DATA%\appdata" "%HF_MODEL_DOWNLOADER_DATA%\localappdata" "%HF_MODEL_DOWNLOADER_DATA%\temp" "%HF_MODEL_DOWNLOADER_DATA%\electron-user-data" "%HF_MODEL_DOWNLOADER_DATA%\cache\chromium") do (' \
  '  if not exist "%%~D" mkdir "%%~D" >nul 2>&1' \
  '  if not exist "%%~D" (' \
  '    echo Cannot create portable data directory: %%~D' \
  '    echo Move the extracted folder to a writable location and try again.' \
  '    pause' \
  '    exit /b 1' \
  '  )' \
  ')' \
  'set "APPDATA=%HF_MODEL_DOWNLOADER_DATA%\appdata"' \
  'set "LOCALAPPDATA=%HF_MODEL_DOWNLOADER_DATA%\localappdata"' \
  'set "TEMP=%HF_MODEL_DOWNLOADER_DATA%\temp"' \
  'set "TMP=%HF_MODEL_DOWNLOADER_DATA%\temp"' \
  'start "" "%HF_MODEL_DOWNLOADER_EXE%" "--user-data-dir=%HF_MODEL_DOWNLOADER_DATA%\electron-user-data" "--disk-cache-dir=%HF_MODEL_DOWNLOADER_DATA%\cache\chromium"' \
  'endlocal' > "$STAGE_ROOT/$LAUNCHER_NAME"
printf 'HF Model Downloader portable root v1\r\n' > "$STAGE_ROOT/$PORTABLE_MARKER"

APP_EXE="$APP_DIR/$APP_EXE_NAME"
APP_ASAR="$APP_DIR/resources/app.asar"
REQUIRED_RUNTIME_FILES=(
  "$APP_EXE"
  "$APP_ASAR"
  "$APP_DIR/resources.pak"
  "$APP_DIR/icudtl.dat"
  "$APP_DIR/v8_context_snapshot.bin"
  "$APP_DIR/chrome_100_percent.pak"
  "$APP_DIR/chrome_200_percent.pak"
  "$APP_DIR/libEGL.dll"
  "$APP_DIR/libGLESv2.dll"
)
for required_file in "${REQUIRED_RUNTIME_FILES[@]}"; do
  [[ -f "$required_file" ]] || fail "Packaged Windows runtime is incomplete: ${required_file#$STAGE_ROOT/}"
done
[[ -d "$APP_DIR/locales" ]] || fail "Packaged Windows runtime is missing its locales directory."

node scripts/release-tool.mjs verify-stage "$STAGE_ROOT"

if node_modules/.bin/asar list "$APP_ASAR" | grep -Eiq "$FORBIDDEN_ARCHIVE_PATH"; then
  fail "User data or a sensitive runtime path was detected inside app.asar."
fi

(
  cd "$STAGE_ROOT"
  /usr/bin/zip -qry "$ZIP_PATH" . -x '*.DS_Store' '__MACOSX/*'
)

ARCHIVE_LISTING="$(unzip -Z1 "$ZIP_PATH")"
print -r -- "$ARCHIVE_LISTING" | grep -Fxq "$LAUNCHER_NAME" \
  || fail "Windows archive is missing its root launcher."
print -r -- "$ARCHIVE_LISTING" | grep -Fxq "$PORTABLE_MARKER" \
  || fail "Windows archive is missing its portable-root marker."
print -r -- "$ARCHIVE_LISTING" | grep -Fxq "$APP_FOLDER_NAME/$APP_EXE_NAME" \
  || fail "Windows archive is missing the internal application executable."
print -r -- "$ARCHIVE_LISTING" | grep -Fxq "$APP_FOLDER_NAME/resources/app.asar" \
  || fail "Windows archive is missing packaged application resources."

if print -r -- "$ARCHIVE_LISTING" | grep -Eiq "$FORBIDDEN_ARCHIVE_PATH"; then
  fail "User data or a sensitive runtime path was detected inside the Windows archive."
fi

UNEXPECTED_ROOTS="$(print -r -- "$ARCHIVE_LISTING" | awk -F/ 'NF { print $1 }' | sort -u | grep -Fvx -e "$LAUNCHER_NAME" -e "$PORTABLE_MARKER" -e "$APP_FOLDER_NAME" -e 'README-Windows.txt' || true)"
[[ -z "$UNEXPECTED_ROOTS" ]] || fail "Windows archive contains unexpected root entries:\n$UNEXPECTED_ROOTS"

if find "$VERSION_DIR" -maxdepth 1 -type f -name "HF-Model-Downloader-$APP_VERSION-windows-*.exe" | grep -q .; then
  fail "A top-level Windows executable was produced; only the portable ZIP may be published."
fi

node scripts/release-tool.mjs finalize "$VERSION_DIR"
node scripts/release-tool.mjs verify-checksums "$VERSION_DIR"

echo ""
echo "Windows directory-style portable archive:"
echo "$ZIP_PATH"
echo ""
echo "Archive root:"
echo "  $LAUNCHER_NAME"
echo "  $APP_FOLDER_NAME/"
echo "  README-Windows.txt"
echo ""
echo "Release metadata:"
echo "$VERSION_DIR/RELEASE-NOTES.md"
echo "$VERSION_DIR/SHA256SUMS.txt"
