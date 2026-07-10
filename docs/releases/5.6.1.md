# HF Model Downloader 5.6.1 · Sol

5.6.1 是 Sol 5.6 系列的可用性与发行收尾版本：应用图标、页面导航、下载历史、目录管理与更新入口现在使用同一套桌面运行边界，并提供 macOS / Windows 自包含便携包。

## 中文 Release Notes

### 界面与导航

- 将 Sol Logo 同步到应用窗口、macOS `.app` 与 Windows 便携版图标。
- 把容易误解为分页器的 `01–04` 顶部导航改为真实工作流状态；点击仍可定位到对应区域，滚动时不再伪装成固定的当前页。
- 精简重复的“定位文件 / 打开目录”操作：文件使用“在文件夹中显示”，下载根目录使用“打开目录”。
- 运行环境目录卡片展示完整路径，并可直接打开默认下载、应用数据和缓存目录。

### 下载历史与本地文件

- 刷新历史时会核对本地文件；所有文件都已不存在的记录会从历史中清理，部分缺失则明确标记。
- 删除历史提供两种清晰选择：只删记录，或在确认后同时删除该记录对应的本地文件。
- 文件删除受下载根目录、真实路径和共享引用保护，不会越界删除或误删仍被其他历史记录引用的文件。

### 检查更新

- 新增 GitHub Release 更新检查，可显示版本号、更新日志、平台资产大小与校验状态。
- 便携更新包下载后必须通过 `SHA256SUMS.txt` 的 SHA-256 校验；校验失败不会继续。
- 当前为未签名便携发行，应用会准备并定位已验证的新包，不会静默替换正在运行的程序。

### 便携包与安全

- macOS：`HF-Model-Downloader-5.6.1-mac-<arch>-portable.zip`，解压后直接打开 `.app`。
- Windows：`HF-Model-Downloader-5.6.1-windows-x64-portable.exe`，或下载同名 `.zip` 后解压运行。
- Electron、应用代码和运行依赖均已包含在便携包中；普通用户无需安装 Node.js、npm 或 Python。
- 构建使用严格文件白名单，并在压缩前检查历史、Token、会话、缓存、日志、下载内容和其他用户数据。
- 每个发布资产都记录在 `SHA256SUMS.txt` 中。

## 首次运行提示

这些包目前没有 Apple Developer ID / Windows Authenticode 签名：

- macOS 可能显示 Gatekeeper 提示。请优先右键应用并选择“打开”，或在“系统设置 → 隐私与安全性”中确认本次打开。
- Windows SmartScreen 可能显示“未知发布者”。确认文件来自本仓库且 SHA-256 一致后，可选择“更多信息 → 仍要运行”。

签名与公证缺失意味着系统无法验证发布者身份；SHA-256 只能验证下载资产与本次 GitHub Release 一致，不能替代代码签名。

---

## English Release Notes

### Interface and navigation

- Applied the Sol raster logo consistently to the app window, macOS bundle, and Windows portable executable.
- Replaced the misleading `01–04` page-style navigation with an honest live workflow indicator while keeping click-to-scroll shortcuts.
- Removed duplicate file actions: individual files use “Show in folder”, while download roots use “Open folder”.
- Runtime directory cards now expose the full path and open downloads, app data, or cache directly.

### Download history and local files

- History refresh now reconciles records with local files: fully missing records are removed and partially missing records are identified.
- Deletion offers an explicit choice between removing only the record and, after confirmation, removing the corresponding local files too.
- Real-path, download-root, and shared-reference checks prevent deletion outside the managed output or deletion of files still referenced elsewhere.

### Update checks

- Added GitHub Release update checks with version, release notes, platform asset size, and verification state.
- Downloaded portable updates must match the SHA-256 value in `SHA256SUMS.txt`.
- Because this is an unsigned portable release, the app prepares and reveals a verified package instead of silently replacing the running app.

### Portable packaging and security

- macOS: extract `HF-Model-Downloader-5.6.1-mac-<arch>-portable.zip`, then open the `.app`.
- Windows: run `HF-Model-Downloader-5.6.1-windows-x64-portable.exe` directly, or extract the matching `.zip` first.
- Electron and all runtime dependencies are bundled. End users do not need Node.js, npm, or Python.
- Release builds use a strict file allowlist and reject user history, tokens, sessions, caches, logs, or downloaded content before compression.
- Verify every published asset with `SHA256SUMS.txt`.

The current artifacts are not signed with Apple Developer ID or Windows Authenticode. Gatekeeper or SmartScreen may therefore show a first-run warning. A checksum proves asset integrity against this Release, but it does not replace publisher signing.
