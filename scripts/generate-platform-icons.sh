#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_ICON="$PROJECT_ROOT/assets/logo-sol.png"
OUTPUT_DIR="$PROJECT_ROOT/assets/platform"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hf-model-downloader-icons.XXXXXX")"
ICONSET_DIR="$WORK_DIR/HFModelDownloader.iconset"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Platform icon generation currently requires macOS sips and iconutil."
  exit 1
fi

if [[ ! -f "$SOURCE_ICON" ]]; then
  echo "Missing source logo: $SOURCE_ICON"
  exit 1
fi

if [[ "$(sips -g hasAlpha "$SOURCE_ICON" | awk '/hasAlpha:/ { print $2 }')" != "yes" ]]; then
  echo "Source logo must contain a real alpha channel; opaque matte backgrounds are not allowed."
  exit 1
fi

mkdir -p "$OUTPUT_DIR" "$ICONSET_DIR"

create_png() {
  local size="$1"
  local output="$2"
  sips -z "$size" "$size" "$SOURCE_ICON" --out "$output" >/dev/null
}

create_png 16 "$ICONSET_DIR/icon_16x16.png"
create_png 32 "$ICONSET_DIR/icon_16x16@2x.png"
create_png 32 "$ICONSET_DIR/icon_32x32.png"
create_png 64 "$ICONSET_DIR/icon_32x32@2x.png"
create_png 128 "$ICONSET_DIR/icon_128x128.png"
create_png 256 "$ICONSET_DIR/icon_128x128@2x.png"
create_png 256 "$ICONSET_DIR/icon_256x256.png"
create_png 512 "$ICONSET_DIR/icon_256x256@2x.png"
create_png 512 "$ICONSET_DIR/icon_512x512.png"
create_png 1024 "$ICONSET_DIR/icon_512x512@2x.png"

iconutil -c icns "$ICONSET_DIR" -o "$OUTPUT_DIR/icon.icns"

create_png 256 "$WORK_DIR/icon-256.png"
sips -s format ico "$WORK_DIR/icon-256.png" --out "$OUTPUT_DIR/icon.ico" >/dev/null
create_png 1024 "$OUTPUT_DIR/icon-1024.png"

echo "Generated platform icons from assets/logo-sol.png:"
echo "- assets/platform/icon.icns"
echo "- assets/platform/icon.ico"
echo "- assets/platform/icon-1024.png"
