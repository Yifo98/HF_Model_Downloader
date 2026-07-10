# HF Model Downloader 5.6.2 Sol · Design QA

## 验收范围

- 透明图标源：`assets/logo-sol.png`，1254 × 1254 RGBA Raster PNG，不使用 SVG。
- GitHub 展示：`assets/github-sol-card.png`，由 `assets/branding/github-sol-card.html` 可重复渲染。
- 平台资源：`assets/platform/icon.icns`、`assets/platform/icon.ico` 与 1024 PNG。
- 实际应用：从 `HF-Model-Downloader-5.6.2-mac-arm64-portable.zip` 解压并启动的 production `app.asar`。
- 重点回归：黑色方框、应用内 Logo、Finder bundle icon、版本同步、真实打包窗口与浅色/深色背景边缘。

## 图标处理边界

5.6.1 的源 PNG 把外圈黑色画布直接烘焙进 RGB 像素，所以 Dock、运行中应用和 README 都会显示黑方框；这不是 macOS 自动加的边框。

5.6.2 使用当前会话的图像生成能力做背景隔离，再只把外圈转换为 Alpha；主体文件夹、薄荷数据流、珊瑚核心和雾紫底座保持原构图。最终源图四角 Alpha 为 0，透明区没有不透明黑像素；同一源图再派生 ICNS、ICO、应用内资源和品牌卡片。

## 证据

- 真实便携包窗口：`outputs/design-qa/5.6.2-packaged-window.jpeg`
- Finder bundle icon：`outputs/design-qa/5.6.2-bundle-icon.jpeg`
- 透明方案浅色/深色对照：`outputs/imagegen/icon-comparison-raster.png`
- GitHub 品牌卡片：`assets/github-sol-card.png`
- 打包内 Logo 与源码 SHA-256 一致：`cdac8eb0aa86326e65487548d0726a64b76d0592d3a1900fb7415da0001c180a`

`outputs/` 是本地验收目录，不提交到 Git；GitHub 上的公开视觉资产是品牌卡片、透明源图与平台图标。

## 结果

### P0 / P1

- 无阻断级视觉问题。
- 真实 5.6.2 `.app` 从 `app.asar/dist/index.html` 启动，窗口标题、菜单栏和界面版本均为 Sol 5.6.2。
- 应用内 Logo 与 Finder bundle icon 均没有 5.6.1 的黑色方框。
- macOS 运行时 `app.dock.setIcon`、窗口图标、React 顶栏和打包内资源共同指向同一透明 PNG；打包内文件哈希与仓库源图一致。
- GitHub README 不再孤立显示单个 Logo，改为完整的 Sol 品牌卡片，补齐连接、策展、下载、监控与校验能力。
- 品牌卡片在 1600 × 640 输出中无裁切、无黑金风格、无 SVG，版本从 `package.json` 注入。

### P2

- macOS / Windows 便携包未使用 Developer ID、Apple 公证或 Authenticode；首次运行可能出现 Gatekeeper / SmartScreen 提示。
- Windows x64 包已在 macOS 上交叉构建并完成结构、隐私、路径与校验和检查，但未在 Windows 真机启动或采集任务栏图标。
- 当前本机验收工具能捕获应用窗口与 Finder bundle icon，不能单独采集 macOS Dock 区域；运行时 Dock 调用已在真实包启动时执行，但仍建议在正式签名构建后补一张系统级 Dock 截图。

## 最小复现

```bash
npm run icons:generate
npm run brand:render
npm test
npm run lint
npm run build
npm run dist:mac
npm run dist:win
```

1. 解压 macOS ZIP，启动 `HF Model Downloader.app`。
2. 确认页面来自 production `app.asar`，版本显示 5.6.2。
3. 在 Finder 预览 `.app`，检查透明边角与小尺寸轮廓。
4. 对比应用顶栏 Logo、Finder 图标和 `assets/logo-sol.png`。
5. 检查 README 品牌卡片在 GitHub 明暗主题中的完整宽度与文字可读性。

## Final result

passed with disclosed Windows and signing limitations
