# HF Model Downloader

![HF Model Downloader Logo](assets/logo.svg)

HF Model Downloader 是一个面向 Hugging Face 的桌面下载器  
支持仓库清单浏览 文件筛选 推荐方案 历史记录 失败重试和多 Endpoint 下载

## 下载

- Releases 页面：`https://github.com/Yifo98/HF_Model_Downloader/releases`
- macOS：优先下载 `HF Model Downloader-*-mac.zip`
- Windows：优先下载 `HF Model Downloader-*-win.zip`，也可以直接使用便携版 `.exe`

标准分享包目标就是解压即用

## 功能概览

- 输入 `owner/repo` 后直接拉取文件清单
- 支持官方源 HF Mirror 和自定义 Endpoint
- 可按文件名 路径 分类和族群筛选结果
- 提供推荐方案 帮你快速选模型权重或完整推理集
- 支持并发下载 历史记录 打开目录 定位文件和失败重试
- 桌面端运行时会自动管理缓存和应用数据目录

## 使用方式

1. 填写 `owner/repo`
2. 选择下载目录
3. 选择官方源 镜像源 或自定义 Endpoint
4. 加载文件清单
5. 用筛选和推荐方案勾选需要的文件
6. 点击开始下载 并在右侧查看队列和历史

## 发布包说明

### macOS

当前 macOS 分享包为未签名应用

首次在其他 Mac 上运行时：

1. 解压 zip
2. 右键应用并选择 `打开`
3. 如果系统拦截 在系统设置中选择 `仍要打开`

### Windows

当前 Windows 分享包为未签名便携版

首次在其他电脑上运行时 如果 SmartScreen 弹出提示：

1. 点击 `更多信息`
2. 点击 `仍要运行`

## 本地开发

### 安装依赖

```bash
npm install
```

### 启动开发版

```bash
npm run dev
```

### macOS 启动器

仓库根目录保留了一个 macOS 启动器：

- `Launch HF Model Downloader.command`

它会调用 `scripts/launch-mac.sh`  
如果本机还没安装依赖 会先执行一次 `npm install`

### 本地打包

```bash
npm run build
npm run dist:mac
npm run dist:win
```

如果你在 Windows 本机上执行分享打包：

```powershell
npm run dist:share
```

## 依赖说明

如果你使用的是 GitHub Releases 中的标准分享包 一般不需要额外安装 Node.js 或 Python  
只有在你打算直接运行源码时 才需要先安装：

- Node.js 20+
- npm

## 版本规则

- 小改动或修复 bug：升级 `patch`，例如 `2.0.0 -> 2.0.1`
- 功能增强但不改桌面主形态：升级 `minor`，例如 `2.0.0 -> 2.1.0`
- 桌面架构或产品主流程发生明显代际变化：升级 `major`，例如 `2.0.0 -> 3.0.0`

当前版本号唯一来源是 `package.json`。打包文件名、`release/<version>/` 目录和自动生成的发布说明都会跟着同步。

常用命令：

```bash
npm run version:patch
npm run version:minor
npm run version:major
```
