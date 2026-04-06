# HF Model Downloader 2.0.1

## 中文说明

本次发布主要补强了 Windows 分享包的启动稳定性，并继续保持桌面下载流程的一致体验。

## 包含内容

- `HF Model Downloader-2.0.1-arm64-mac.zip`
- `HF Model Downloader-2.0.1-win.zip`
- `HF Model Downloader 2.0.1.exe`
- `README-mac.txt`

## 主要更新

- 修复 Windows 便携版启动时的绝对路径初始化问题
- 保持仓库文件清单加载 搜索 分类与族群筛选能力
- 保持推荐方案 历史恢复 失败重试和定位文件动作
- 启动与打包流程继续统一到 `package.json` 和 `scripts/`

## 打包与隐私

- 分享包目标仍然是解压即用
- 打包脚本会校验压缩包中不包含 cookies 历史记录 本地会话 token 或 API Key
- 每次重新打包时，`release/2.0.1/` 下的版本发布说明会自动刷新
- 目前 macOS 与 Windows 版本都还是未签名状态，首次运行可能会看到系统安全提示

## English

## Summary

This release primarily hardens the Windows portable package and keeps the desktop download flow consistent.

## Included artifacts

- `HF Model Downloader-2.0.1-arm64-mac.zip`
- `HF Model Downloader-2.0.1-win.zip`
- `HF Model Downloader 2.0.1.exe`
- `README-mac.txt`

## Highlights

- Fixed the Windows portable startup failure caused by non-absolute runtime path initialization
- Kept repository manifest loading, search, category filtering, and family filtering
- Kept recommended presets, history restore, retry, and reveal-in-folder actions
- Continued to unify startup and packaging around `package.json` and `scripts/`

## Packaging and privacy

- Shared builds are intended to be unpack-and-run
- Packaging scripts verify that release archives do not include cookies, history, local session files, tokens, or API keys
- Versioned release notes inside `release/2.0.1/` are refreshed on each packaging run
- macOS and Windows builds are currently unsigned, so first-run security prompts are expected
