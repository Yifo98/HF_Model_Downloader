# HF Model Downloader 5.6.1 Sol · Design QA

## 验收范围

- 视觉来源：用户选定的 `assets/logo-sol.png` Raster Logo。
- 实际实现：从 `HF-Model-Downloader-5.6.1-mac-arm64-portable.zip` 解压并启动的 production `app.asar`。
- 核心状态：`Comfy-Org/frame_interpolation` 固定 commit 清单，8 个文件，默认“运行所需”选择 6 项。
- 重点回归：平台图标、顶部工作流、历史同步与删除确认、完整路径与目录打开、更新中心、便携包界面。

## 证据

- macOS 便携包真实启动：`outputs/design-qa/5.6.1-sol-packaged-initial.jpeg`
- Logo 与真实实现同屏：`outputs/design-qa/5.6.1-source-implementation-comparison.png`
- 对照页：`outputs/design-qa/compare-5.6.1.html`
- 平台图标：`assets/platform/icon.icns`、`assets/platform/icon.ico`

## 对照方法

Logo 是视觉母板，不是界面线框，因此不做布局逐像素复制。来源与实现被放入同一张 1600 px 对照图，检查四个可见映射：

1. 雾紫玻璃质感用于顶栏、面板边界、步骤标记与下载坞。
2. 薄荷数据流用于准备状态、目录状态、进度与已选统计。
3. 珊瑚核心用于步骤 03 和主要下载操作。
4. 柔白体积感用于工作台层级、圆角、阴影与留白。

## 结果

### P0 / P1

- 无阻断级视觉或交互问题。
- Sol Logo 已出现在界面、窗口资源、macOS ICNS 与 Windows ICO，不再使用 Electron 默认图标。
- 顶部 01–04 由清单、选择与下载队列实时驱动；可点击定位区域，不再把滚动位置伪装成分页状态。
- 历史打开时会同步本地文件；删除弹层提供“记录与文件”“仅记录”“取消”，默认键盘焦点在“取消”。
- 目录卡片在界面内换行显示完整路径，并在真实 Electron 中准确打开默认下载目录。
- 更新中心展示当前/最新版本、Release Notes、平台包、大小与 SHA-256 状态，文案没有伪称静默安装。
- 1480 × 940 主窗口与 1220 × 800 最小窗口均保留主流程；窄窗下工作流条会收敛，核心按钮仍可达。

### P2

- macOS / Windows 便携包未使用 Developer ID、Apple 公证或 Authenticode；首次运行可能出现 Gatekeeper / SmartScreen 提示。
- Windows x64 包已在 macOS 上交叉构建并完成结构、隐私与校验和检查，但未在 Windows 真机启动。

### P3

- Release Notes 以安全纯文本呈现 GitHub Markdown，保留原文标记；不影响阅读与操作。
- 用户选定源图为 RGB、无 Alpha，系统图标保留同一视觉内容；macOS/Windows 会按各自蒙版呈现边角。

## 交互与运行验证

1. 启动 production `.app`，确认 `file://.../app.asar/dist/index.html`、Sol 5.6.1 与新 Logo。
2. 点击顶部“04 监控”，页面准确滚动到监控区；状态仍表达真实流程而非滚动高亮。
3. 打开下载历史，确认 1 条完成记录同步为 6 项本地文件可用。
4. 打开删除确认，确认默认焦点为“取消”；未删除用户真实文件。
5. 点击默认下载目录卡片，Finder 准确打开 `/Users/yifo/Program/Downloads`。
6. 在便携包中读取公开仓库清单，确认 8 项与默认选择 6 项。
7. 检查更新中心可读取 GitHub Release；便携包下载与应用分支由自动化测试覆盖。

## Final result

passed
