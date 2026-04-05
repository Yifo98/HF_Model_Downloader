#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RELEASE_DIR="$PROJECT_ROOT/release"
APP_VERSION="$(node -p "require('$PROJECT_ROOT/package.json').version")"
VERSION_DIR="$RELEASE_DIR/$APP_VERSION"
ZIP_PRIVACY_PATTERN='cookie|history|config\.json|user[- ]data|electron-session|electron-user-data|token|api[_-]?key'

prepare_release_dir() {
  mkdir -p "$RELEASE_DIR" "$VERSION_DIR"
  rm -rf "$RELEASE_DIR"/win-unpacked
  rm -f "$RELEASE_DIR"/.DS_Store(N) "$VERSION_DIR"/.DS_Store(N)
  rm -f "$RELEASE_DIR"/*win*.zip(N) "$RELEASE_DIR"/*.exe(N) "$RELEASE_DIR"/*win*.zip.blockmap(N) "$RELEASE_DIR"/builder-debug.yml(N)
  rm -f "$VERSION_DIR"/*win*.zip(N) "$VERSION_DIR"/*.exe(N)
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
npx electron-builder --win portable zip --x64

WIN_ZIP="$(find "$RELEASE_DIR" -maxdepth 1 -type f -name '*win*.zip' | head -n 1)"
WIN_PORTABLE_EXE="$(find "$RELEASE_DIR" -maxdepth 1 -type f -name '*.exe' | head -n 1)"

if [[ -z "$WIN_ZIP" || -z "$WIN_PORTABLE_EXE" ]]; then
  echo "Windows build artifacts were not created as expected."
  exit 1
fi

if unzip -l "$WIN_ZIP" | grep -Eiq "$ZIP_PRIVACY_PATTERN"; then
  echo "Sensitive files were detected inside the Windows zip artifact."
  exit 1
fi

cp "$WIN_ZIP" "$VERSION_DIR/"
cp "$WIN_PORTABLE_EXE" "$VERSION_DIR/"
rm -rf "$RELEASE_DIR"/win-unpacked
rm -f "$RELEASE_DIR"/builder-debug.yml(N)
write_release_notes

echo "Windows portable artifact:"
echo "$WIN_PORTABLE_EXE"
echo
echo "Windows zip artifact:"
echo "$WIN_ZIP"
