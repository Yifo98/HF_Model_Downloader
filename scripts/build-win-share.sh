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
EXE_NAME="HF-Model-Downloader-$APP_VERSION-windows-$RELEASE_ARCH-portable.exe"
ZIP_NAME="HF-Model-Downloader-$APP_VERSION-windows-$RELEASE_ARCH-portable.zip"
EXE_PATH="$VERSION_DIR/$EXE_NAME"
ZIP_PATH="$VERSION_DIR/$ZIP_NAME"
FORBIDDEN_ARCHIVE_PATH='(^|/)(\.env|\.DS_Store|__MACOSX|cookies?(\.json)?|history(\.json)?|preferences\.json|electron-(session|user-data)|HF_Model_Downloader_Data|logs?|cache|downloads?|token)(/|$)'

cleanup() {
  rm -rf "$BUILD_ROOT" "$STAGE_ROOT"
}
trap cleanup EXIT

cd "$PROJECT_ROOT"

if [[ ! -d "$PROJECT_ROOT/node_modules" ]]; then
  echo "Installing locked development dependencies with npm ci..."
  npm ci
fi

mkdir -p "$VERSION_DIR"
rm -rf "$BUILD_ROOT" "$STAGE_ROOT"
rm -f "$EXE_PATH" "$ZIP_PATH"
mkdir -p "$BUILD_ROOT" "$STAGE_ROOT"

if [[ "$(uname -s)" == "Darwin" ]]; then
  scripts/generate-platform-icons.sh
fi

npm run build

CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder \
  --win portable \
  --x64 \
  --config.directories.output="$BUILD_ROOT"

BUILT_EXE="$(find "$BUILD_ROOT" -maxdepth 2 -type f -name '*.exe' -size +20M -print -quit)"
if [[ -z "$BUILT_EXE" ]]; then
  echo "Windows portable executable was not created as expected."
  exit 1
fi

cp "$BUILT_EXE" "$EXE_PATH"
cp "$EXE_PATH" "$STAGE_ROOT/$EXE_NAME"
cp "$PROJECT_ROOT/docs/releases/README-Windows.txt" "$STAGE_ROOT/README-Windows.txt"

node scripts/release-tool.mjs verify-stage "$STAGE_ROOT"

(
  cd "$STAGE_ROOT"
  /usr/bin/zip -qry "$ZIP_PATH" . -x '*.DS_Store' '__MACOSX/*'
)

if unzip -Z1 "$ZIP_PATH" | grep -Eiq "$FORBIDDEN_ARCHIVE_PATH"; then
  echo "User data or a sensitive runtime path was detected inside the Windows archive."
  exit 1
fi

node scripts/release-tool.mjs finalize "$VERSION_DIR"
node scripts/release-tool.mjs verify-checksums "$VERSION_DIR"

echo ""
echo "Windows portable executable:"
echo "$EXE_PATH"
echo ""
echo "Windows portable archive:"
echo "$ZIP_PATH"
echo ""
echo "Release metadata:"
echo "$VERSION_DIR/RELEASE-NOTES.md"
echo "$VERSION_DIR/SHA256SUMS.txt"
