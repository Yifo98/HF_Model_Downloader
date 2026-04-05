#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RELEASE_DIR="$PROJECT_ROOT/release"
README_PATH="$RELEASE_DIR/README-mac.txt"
APP_VERSION="$(node -p "require('$PROJECT_ROOT/package.json').version")"
VERSION_DIR="$RELEASE_DIR/$APP_VERSION"
ARCH_NAME="$(uname -m)"
ZIP_PRIVACY_PATTERN='cookie|history|config\.json|user[- ]data|electron-session|electron-user-data|token|api[_-]?key'

case "$ARCH_NAME" in
  arm64)
    BUILDER_ARCH_FLAG="--arm64"
    ;;
  x86_64)
    BUILDER_ARCH_FLAG="--x64"
    ;;
  *)
    echo "Unsupported macOS architecture: $ARCH_NAME"
    exit 1
    ;;
esac

prepare_release_dir() {
  mkdir -p "$RELEASE_DIR" "$VERSION_DIR"
  rm -rf "$RELEASE_DIR"/win-unpacked "$RELEASE_DIR"/mac-unpacked
  rm -f "$RELEASE_DIR"/.DS_Store(N) "$VERSION_DIR"/.DS_Store(N)
  rm -f "$RELEASE_DIR"/*mac*.zip(N) "$RELEASE_DIR"/*mac*.zip.blockmap(N) "$RELEASE_DIR"/*.txt(N) "$RELEASE_DIR"/latest-mac.yml(N)
  rm -f "$VERSION_DIR"/*mac*.zip(N) "$VERSION_DIR"/*.txt(N) "$VERSION_DIR"/latest-mac.yml(N)
}

write_release_notes() {
  cat > "$VERSION_DIR/RELEASE-NOTES.md" <<EOF
# HF Model Downloader $APP_VERSION

## Summary

This release moves the project onto the long-term Electron desktop architecture.

## Included artifacts

- \`HF Model Downloader-$APP_VERSION-arm64-mac.zip\`
- \`HF Model Downloader-$APP_VERSION-win.zip\`
- \`HF Model Downloader $APP_VERSION.exe\`
- \`README-mac.txt\`

## Highlights

- Migrated the app to \`Electron + React + TypeScript\`
- Added repository manifest loading with search and family filtering
- Added recommended selection presets for model weights and full runtime downloads
- Added live queue telemetry history restore retry and file reveal actions
- Unified startup and packaging flow around \`package.json\` and \`scripts/\`
- Removed the legacy Tk entrypoint and old root-level bat launch scripts

## Packaging and privacy

- Shared builds are intended to be unpack-and-run
- Packaging scripts verify that release archives do not include cookies history local session files tokens or API keys
- Versioned release notes are refreshed inside the \`release/$APP_VERSION/\` folder on each packaging run
- macOS and Windows builds are currently unsigned so first-run security prompts are expected
EOF
}

cd "$PROJECT_ROOT"

if [[ ! -d "$PROJECT_ROOT/node_modules" ]]; then
  echo "Missing node_modules in $PROJECT_ROOT"
  echo "Installing dependencies first..."
  npm install
fi

prepare_release_dir

npm run build
npx electron-builder --mac zip "$BUILDER_ARCH_FLAG"

MAC_ZIP="$(find "$RELEASE_DIR" -maxdepth 1 -type f -name '*mac.zip' | head -n 1)"
if [[ -z "$MAC_ZIP" ]]; then
  echo "macOS zip artifact was not created as expected."
  exit 1
fi

if unzip -l "$MAC_ZIP" | grep -Eiq "$ZIP_PRIVACY_PATTERN"; then
  echo "Sensitive files were detected inside the macOS zip artifact."
  exit 1
fi

cat > "$README_PATH" <<'EOF'
HF Model Downloader for macOS

This build is an unsigned macOS app bundle packaged as a zip.

Before first use on another Mac:
1. Unzip the archive.
2. Right-click "HF Model Downloader.app" and choose "Open" the first time.

If Gatekeeper warns about the app being unsigned, use "Open Anyway" from
System Settings or right-click the app and choose "Open".
EOF

cp "$MAC_ZIP" "$VERSION_DIR/"
cp "$README_PATH" "$VERSION_DIR/"
rm -f "$RELEASE_DIR"/*mac*.zip.blockmap(N) "$RELEASE_DIR"/latest-mac.yml(N)
write_release_notes

echo "macOS app bundle:"
find "$RELEASE_DIR" -maxdepth 2 -name 'HF Model Downloader.app' -print
echo
echo "macOS zip artifact:"
echo "$MAC_ZIP"
echo
echo "Share notes:"
echo "$README_PATH"
