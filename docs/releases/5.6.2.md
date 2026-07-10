# HF Model Downloader 5.6.2 · Sol Portable

5.6.2 修复了平台图标外圈黑底，并收紧 Windows 便携版的交付和数据边界：发布页只需要一个 ZIP，Electron 运行目录、启动器和项目数据可以随解压目录一起移动，不再生成独立的安装器或 NSIS portable wrapper。

### 图标与 GitHub 展示

- Sol 主图外围改为真正透明像素，重新生成 macOS `.icns`、Windows `.ico` 与应用内图标，去除 Dock、任务栏和界面中的黑色方框。
- README 改用 1600 × 640 的 Sol 品牌卡片，补充四阶段工作流与安全能力信息；源版式保留在仓库，可随版本重复渲染，不使用 SVG。

## 中文 Release Notes

### Windows 目录式便携包

- Windows 发行资产改为唯一的 `HF-Model-Downloader-5.6.2-windows-x64-portable.zip`。
- ZIP 根目录包含 `Start HF Model Downloader.cmd`、`HF Model Downloader/` 自包含运行目录和使用说明；启动器使用 ASCII 文件名，避免跨平台 ZIP 工具破坏中文文件名。
- 内部 `HF Model Downloader.exe` 是 Electron 运行时的必要入口，不是安装包；发布页不再单独提供 `.exe`。
- 打包过程从 electron-builder 的 `win-unpacked` 目录原样收集 Electron、应用代码、DLL、locale 和资源，再进行结构、隐私及 SHA-256 检查。

### 项目自包含数据

- 启动器通过 `HF_MODEL_DOWNLOADER_PORTABLE_ROOT` 把解压项目根传给主进程。
- 主进程只接受绝对、已存在、自身不是符号链接、包含便携标记且确实包含当前 EXE 的便携根目录。
- 启动器在 Electron 原生启动前即把 APPDATA、LOCALAPPDATA、TEMP、TMP、Chromium userData 与缓存指向项目目录；只读目录会安全停止，不会回退到系统盘。
- 应用数据、默认下载、缓存、Electron userData/session、日志、崩溃记录和临时目录统一落在项目根的 `HF_Model_Downloader_Data/` 下。
- Windows 便携版不会自动读取或改写用户配置盘中的旧 Electron 数据，避免首次运行重新触碰 C 盘。
- 直接打开内部 EXE 时，会优先通过便携标记恢复 ZIP 根；标记缺失时也只退回 EXE 所在目录。
- 更新目录同样拒绝符号链接和 junction / reparse point 路径逃逸。

### 兼容与安全

- 检查更新继续寻找同名 `windows-x64-portable.zip`，现有更新接口不变。
- ZIP 根结构和必需运行依赖会在发布前验证；历史、Token、会话、缓存、日志、下载内容和其他用户数据不得进入发布资产。
- 当前 Windows 资产仍未使用 Authenticode 签名；首次运行前请核对 GitHub Release 中的 `SHA256SUMS.txt`。
- 本次 Windows x64 资产在 macOS 上交叉构建并完成静态与归档验证，尚未在 Windows 真机运行，也未用 ProcMon 验证首次启动写入或 SmartScreen 行为。

macOS 的数据位置没有在本次更新中改变，仍使用当前用户目录下的既有 Sol 数据结构。

---

## English Release Notes

### Icon and GitHub presentation

- The Sol source image now uses real transparency around the artwork. The macOS `.icns`, Windows `.ico`, and in-app image were regenerated to remove the black square in the Dock, taskbar, and interface.
- The README now uses a 1600 × 640 Sol brand card with the four-stage workflow and security proof points. Its source layout remains reproducible in the repository and does not use SVG.

### Directory-style Windows portable package

- The only Windows release asset is `HF-Model-Downloader-5.6.2-windows-x64-portable.zip`.
- Its root contains `Start HF Model Downloader.cmd`, a self-contained `HF Model Downloader/` runtime directory, and the portable-use guide. The ASCII launcher name avoids filename corruption in cross-platform ZIP tools.
- The executable inside the runtime directory is required by Electron; it is not an installer and is no longer published as a separate top-level asset.
- Packaging copies electron-builder's complete `win-unpacked` output before validating runtime dependencies, privacy exclusions, archive structure, and SHA-256.

### Project-contained runtime data

- The launcher passes the extracted project root through `HF_MODEL_DOWNLOADER_PORTABLE_ROOT`.
- The main process accepts only an absolute, existing, non-symlink directory with the portable marker that actually contains the running executable.
- Before Electron's native bootstrap, the launcher redirects APPDATA, LOCALAPPDATA, TEMP, TMP, Chromium userData, and disk cache into the project. A read-only project fails closed instead of falling back to a system drive.
- App data, default downloads, caches, Electron userData/session, logs, crash dumps, and temporary files stay under `HF_Model_Downloader_Data/` beside the application runtime.
- The Windows portable build does not automatically read or rewrite legacy Electron data from the user profile drive.
- Directly opening the internal executable uses the package marker to recover the ZIP root and otherwise falls back to the executable directory.
- The updates directory rejects symbolic-link and junction / reparse-point escapes through the same containment check.

### Compatibility and security

- The update checker still selects the versioned `windows-x64-portable.zip`; its public IPC contract is unchanged.
- Release validation rejects incomplete runtimes and user history, tokens, sessions, caches, logs, downloaded files, or other user data.
- The Windows package remains unsigned. Verify it against `SHA256SUMS.txt` from the same GitHub Release before first launch.
- This Windows x64 asset was cross-built on macOS and passed static/archive checks, but it has not yet been launched on a Windows machine or observed with ProcMon, and SmartScreen behavior remains unverified.

The macOS data layout is unchanged and continues to use the existing Sol directories under the current user's home directory.
