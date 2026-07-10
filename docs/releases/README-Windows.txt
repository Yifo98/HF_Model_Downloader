HF Model Downloader 5.6 Sol for Windows

便携使用 / Portable use
1. 将 ZIP 完整解压到有写入权限的目录或移动硬盘；不要在压缩包预览窗口中直接运行。
2. 双击“Start HF Model Downloader.cmd”。启动器使用 ASCII 文件名以兼容跨平台 ZIP 工具；请保留它和“HF Model Downloader”文件夹的相对位置。
3. ZIP 已包含 Electron、应用代码和全部运行依赖，不需要安装 Node.js、npm 或 Python。
4. “HF Model Downloader/HF Model Downloader.exe”是 Electron 必需的内部运行文件，不是另一个安装包；通常请使用根目录启动器。

数据位置 / Data location
启动器会先验证便携标记与内部 EXE，并在 Electron 启动前把 APPDATA、LOCALAPPDATA、TEMP、TMP、Chromium userData 与缓存切换到项目目录。应用数据、默认下载、缓存、Electron userData/session、日志、崩溃记录和临时文件都会写入：

  HF_Model_Downloader_Data/

因此可以把整个解压目录一起移动或备份，不会主动把这些运行数据写到 Windows 用户目录或其他盘。请不要把程序解压到只读目录；如果项目内数据目录无法创建，启动器会停止运行。

为保持真正的便携边界，本版本不会自动读取或改写 Windows 用户目录里的旧版 Electron 数据。

如果绕过启动器直接双击内部 EXE，应用会通过便携标记识别 ZIP 根目录；若标记被删除，则至少把数据写到内部 EXE 所在目录，而不会回退到 C 盘用户目录。

首次运行 / First launch
当前版本没有 Windows Authenticode 签名。若 SmartScreen 提示未知发布者，请先确认 ZIP 来自 https://github.com/Yifo98/HF_Model_Downloader/releases 且 SHA-256 与同一 Release 的 SHA256SUMS.txt 一致，再选择“更多信息 → 仍要运行”。

发布页只提供 Windows ZIP，不单独发布安装器或顶层 portable EXE。完整更新日志与 SHA-256 校验值见同一 GitHub Release。
