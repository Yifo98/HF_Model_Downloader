#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RELEASE_DIR="$PROJECT_ROOT/release"
APP_VERSION="$(node -p "require('$PROJECT_ROOT/package.json').version")"
VERSION_DIR="$RELEASE_DIR/$APP_VERSION"
HOST_ARCH="$(uname -m)"

case "$HOST_ARCH" in
  arm64)
    RELEASE_ARCH="arm64"
    BUILDER_ARCH_FLAG="--arm64"
    ;;
  x86_64)
    RELEASE_ARCH="x64"
    BUILDER_ARCH_FLAG="--x64"
    ;;
  *)
    echo "Unsupported macOS architecture: $HOST_ARCH"
    exit 1
    ;;
esac

BUILD_ROOT="$RELEASE_DIR/.build/$APP_VERSION/mac-$RELEASE_ARCH"
STAGE_ROOT="$RELEASE_DIR/.stage/$APP_VERSION/mac-$RELEASE_ARCH"
ARTIFACT_NAME="HF-Model-Downloader-$APP_VERSION-mac-$RELEASE_ARCH-portable.zip"
ARTIFACT_PATH="$VERSION_DIR/$ARTIFACT_NAME"
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
rm -f "$ARTIFACT_PATH"
mkdir -p "$BUILD_ROOT" "$STAGE_ROOT"

scripts/generate-platform-icons.sh
npm run build

CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder \
  --mac dir \
  "$BUILDER_ARCH_FLAG" \
  --config.directories.output="$BUILD_ROOT"

BUILT_APP="$(find "$BUILD_ROOT" -maxdepth 3 -type d -name 'HF Model Downloader.app' -print -quit)"
if [[ -z "$BUILT_APP" ]]; then
  echo "macOS app bundle was not created as expected."
  exit 1
fi

/usr/bin/ditto "$BUILT_APP" "$STAGE_ROOT/HF Model Downloader.app"
cp "$PROJECT_ROOT/docs/releases/README-macOS.txt" "$STAGE_ROOT/README-macOS.txt"

node scripts/release-tool.mjs verify-stage "$STAGE_ROOT"

APP_ASAR="$STAGE_ROOT/HF Model Downloader.app/Contents/Resources/app.asar"
if [[ ! -f "$APP_ASAR" ]]; then
  echo "Packaged Electron application is missing app.asar."
  exit 1
fi

if node_modules/.bin/asar list "$APP_ASAR" | grep -Eiq "$FORBIDDEN_ARCHIVE_PATH"; then
  echo "User data or a sensitive runtime path was detected inside app.asar."
  exit 1
fi

(
  cd "$STAGE_ROOT"
  /usr/bin/zip -qry "$ARTIFACT_PATH" . -x '*.DS_Store' '__MACOSX/*'
)

if unzip -Z1 "$ARTIFACT_PATH" | grep -Eiq "$FORBIDDEN_ARCHIVE_PATH"; then
  echo "User data or a sensitive runtime path was detected inside the macOS archive."
  exit 1
fi

node scripts/release-tool.mjs finalize "$VERSION_DIR"
node scripts/release-tool.mjs verify-checksums "$VERSION_DIR"

echo ""
echo "macOS portable archive:"
echo "$ARTIFACT_PATH"
echo ""
echo "Release metadata:"
echo "$VERSION_DIR/RELEASE-NOTES.md"
echo "$VERSION_DIR/SHA256SUMS.txt"
