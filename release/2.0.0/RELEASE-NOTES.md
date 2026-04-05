# HF Model Downloader 2.0.0

## 中文说明

本次发布把项目正式迁移到长期维护的 Electron 桌面架构，并整理了下载流程与发布方式。

## 包含内容

- `HF Model Downloader-2.0.0-arm64-mac.zip`
- `HF Model Downloader-2.0.0-win.zip`
- `HF Model Downloader 2.0.0.exe`
- `README-mac.txt`

## 主要更新

- 将应用迁移到 `Electron + React + TypeScript`
- 新增仓库文件清单加载、搜索、分类与族群筛选
- 新增推荐方案，方便快速选择模型权重或完整推理下载集
- 新增实时队列遥测、历史恢复、失败重试和定位文件动作
- 启动与打包流程统一到 `package.json` 和 `scripts/`
- 移除旧 Tk 入口与根目录旧版 bat 脚本

## 打包与隐私

- 分享包目标仍然是解压即用
- 打包脚本会校验压缩包中不包含 cookies 历史记录 本地会话 token 或 API Key
- 每次重新打包时，`release/2.0.0/` 下的版本发布说明会自动刷新
- 目前 macOS 与 Windows 版本都还是未签名状态，首次运行可能会看到系统安全提示

## English

## Summary

This release officially moves the project onto a long-term Electron desktop architecture and streamlines the download and packaging flow.

## Included artifacts

- `HF Model Downloader-2.0.0-arm64-mac.zip`
- `HF Model Downloader-2.0.0-win.zip`
- `HF Model Downloader 2.0.0.exe`
- `README-mac.txt`

## Highlights

- Migrated the app to `Electron + React + TypeScript`
- Added repository manifest loading, search, category filtering, and family filtering
- Added recommended presets for model weights and full runtime download sets
- Added live queue telemetry, history restore, retry, and reveal-in-folder actions
- Unified startup and packaging around `package.json` and `scripts/`
- Removed the legacy Tk entrypoint and old root-level bat launch scripts

## Packaging and privacy

- Shared builds are intended to be unpack-and-run
- Packaging scripts verify that release archives do not include cookies, history, local session files, tokens, or API keys
- Versioned release notes inside `release/2.0.0/` are refreshed on each packaging run
- macOS and Windows builds are currently unsigned, so first-run security prompts are expected
