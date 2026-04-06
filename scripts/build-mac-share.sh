#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RELEASE_DIR="$PROJECT_ROOT/release"
APP_VERSION="$(node -p "require('$PROJECT_ROOT/package.json').version")"
VERSION_DIR="$RELEASE_DIR/$APP_VERSION"
README_PATH="$VERSION_DIR/README-mac.txt"
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
  rm -rf "$RELEASE_DIR"/win-unpacked "$RELEASE_DIR"/mac-unpacked "$RELEASE_DIR"/mac-arm64
  rm -f "$RELEASE_DIR"/.DS_Store(N) "$VERSION_DIR"/.DS_Store(N)
  rm -f "$RELEASE_DIR"/*mac*.zip(N) "$RELEASE_DIR"/*mac*.zip.blockmap(N) "$RELEASE_DIR"/*.txt(N) "$RELEASE_DIR"/latest-mac.yml(N) "$RELEASE_DIR"/builder-debug.yml(N)
  rm -f "$VERSION_DIR"/*mac*.zip(N) "$VERSION_DIR"/*.txt(N) "$VERSION_DIR"/latest-mac.yml(N)
}

write_release_notes() {
  cat > "$VERSION_DIR/RELEASE-NOTES.md" <<EOF
# HF Model Downloader $APP_VERSION

## 中文说明

本次发布主要补强了 Windows 分享包的启动稳定性，并继续保持桌面下载流程的一致体验。

## 包含内容

- \`HF Model Downloader-$APP_VERSION-arm64-mac.zip\`
- \`HF Model Downloader-$APP_VERSION-win.zip\`
- \`HF Model Downloader $APP_VERSION.exe\`
- \`README-mac.txt\`

## 主要更新

- 修复 Windows 便携版启动时的绝对路径初始化问题
- 保持仓库文件清单加载 搜索 分类与族群筛选能力
- 保持推荐方案 历史恢复 失败重试和定位文件动作
- 启动与打包流程继续统一到 \`package.json\` 和 \`scripts/\`

## 打包与隐私

- 分享包目标仍然是解压即用
- 打包脚本会校验压缩包中不包含 cookies 历史记录 本地会话 token 或 API Key
- 每次重新打包时，\`release/$APP_VERSION/\` 下的版本发布说明会自动刷新
- 目前 macOS 与 Windows 版本都还是未签名状态，首次运行可能会看到系统安全提示

## English

## Summary

This release primarily hardens the Windows portable package and keeps the desktop download flow consistent.

## Included artifacts

- \`HF Model Downloader-$APP_VERSION-arm64-mac.zip\`
- \`HF Model Downloader-$APP_VERSION-win.zip\`
- \`HF Model Downloader $APP_VERSION.exe\`
- \`README-mac.txt\`

## Highlights

- Fixed the Windows portable startup failure caused by non-absolute runtime path initialization
- Kept repository manifest loading, search, category filtering, and family filtering
- Kept recommended presets, history restore, retry, and reveal-in-folder actions
- Continued to unify startup and packaging around \`package.json\` and \`scripts/\`

## Packaging and privacy

- Shared builds are intended to be unpack-and-run
- Packaging scripts verify that release archives do not include cookies, history, local session files, tokens, or API keys
- Versioned release notes inside \`release/$APP_VERSION/\` are refreshed on each packaging run
- macOS and Windows builds are currently unsigned, so first-run security prompts are expected
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
The current 2.0.1 build also includes the latest layout adjustments, so the default window should adapt more cleanly on smaller screens.

Before first use on another Mac:
1. Unzip the archive.
2. Right-click "HF Model Downloader.app" and choose "Open" the first time.

If Gatekeeper warns about the app being unsigned, use "Open Anyway" from
System Settings or right-click the app and choose "Open".
EOF

mv "$MAC_ZIP" "$VERSION_DIR/"
rm -f "$RELEASE_DIR"/*mac*.zip.blockmap(N) "$RELEASE_DIR"/latest-mac.yml(N) "$RELEASE_DIR"/builder-debug.yml(N)
rm -rf "$RELEASE_DIR"/mac-arm64
write_release_notes

echo "macOS app bundle:"
find "$RELEASE_DIR" -maxdepth 2 -name 'HF Model Downloader.app' -print
echo
echo "macOS zip artifact:"
echo "$VERSION_DIR/$(basename "$MAC_ZIP")"
echo
echo "Share notes:"
echo "$README_PATH"
