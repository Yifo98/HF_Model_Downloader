# Changelog

本项目使用 `package.json` 作为版本号唯一来源。完整发行说明、首次运行限制和资产名称见 `docs/releases/`。

## 5.6.2 · 2026-07-10

### Changed

- Sol 源图外圈改为真实透明像素，并重新生成 macOS、Windows 与应用内平台图标。
- GitHub README 从孤立图标改为可重复渲染的 1600 × 640 品牌卡片。
- Windows 交付改为单一目录式便携 ZIP；不再生成或发布安装器、NSIS portable wrapper 或顶层 EXE。
- Windows ZIP 使用根目录启动器加载完整的 `win-unpacked` Electron 运行目录。
- macOS 数据落点保持现状；Windows 应用数据、下载、缓存、session、日志、崩溃记录与临时目录统一收进解压项目根。
- Windows 目录式便携版不再自动读取或改写用户配置盘上的旧 Electron 数据。

### Security

- `HF_MODEL_DOWNLOADER_PORTABLE_ROOT` 只接受绝对、已存在、自身非符号链接、含便携标记且包含当前 EXE 的目录。
- 启动器在 Electron 原生启动前把 APPDATA、LOCALAPPDATA、TEMP、TMP、Chromium userData 与缓存切换到项目目录。
- 更新目录复用真实路径包含性检查，拒绝 junction / reparse point 把更新包写到项目外。
- 打包脚本校验 ZIP 根结构、内部 Electron 依赖、隐私排除项和 SHA-256，并拒绝单独的 Windows 发布 EXE。

## 5.6.1 · 2026-07-10

### Added

- 下载历史与本地文件的受控同步，以及“只删记录 / 同时删除文件”的显式选择。
- 默认下载、应用数据与缓存目录的完整路径展示和打开动作。
- 固定 GitHub 仓库、平台资产与 SHA-256 校验的检查更新工作流。
- macOS `.icns`、Windows `.ico` 与统一的 Sol 应用图标。
- 自包含 macOS / Windows 便携包、双语说明、Release Notes 和 `SHA256SUMS.txt`。

### Changed

- 顶部 `01–04` 从固定页签改为真实工作流状态与区域定位。
- 合并重复的文件定位操作，区分单文件“在文件夹中显示”和根目录“打开目录”。
- 发布构建改用严格的文件白名单和版本化输出目录。

### Security

- 本地文件删除必须由用户明确确认，并受下载根目录、真实路径和共享引用保护。
- 更新只接受 `Yifo98/HF_Model_Downloader` 的 HTTPS Release 资产，并要求 `SHA256SUMS.txt` 校验通过。
- 未签名版本只准备和揭示已验证的更新包，不静默替换当前应用。

## 5.6.0 · 2026-07-10

- 完成 Sol 界面、固定 commit 下载身份、Token / Endpoint / 路径白名单、Electron IPC 收窄与下载校验架构的基础重构。
