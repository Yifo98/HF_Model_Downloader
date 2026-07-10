import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, realpathSync, statSync } from 'node:fs'
import { statfs } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { DownloadRunner } from './core/downloadRunner.js'
import { deleteHistoryEntry, reconcileHistory } from './core/historyManager.js'
import { listModelFiles, normalizeRepoId, testEndpoint } from './core/hfApi.js'
import {
  HUGGING_FACE_MODELS_URL,
  isValidSessionId,
  normalizeAllowedExternalUrl,
  normalizeApprovedRoot,
  normalizeDownloadRequestInput,
  normalizeRuntimeEndpoint,
  normalizeTokenForEndpoint,
  resolveApprovedPath,
  sanitizeHistoryEntries,
  sanitizePreferences,
} from './core/securityPolicy.js'
import { readJsonFile, writeJsonFile } from './core/storage.js'
import type {
  AppInfo,
  AppPaths,
  DownloadUpdate,
  HistoryDeleteMode,
  HistoryEntry,
  ManagedPathKind,
  Preferences,
  RuntimeStatus,
  UpdateCheckResult,
} from './core/types.js'
import { UpdateService } from './core/updateService.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rendererDist = join(__dirname, '..', 'dist')
const rendererEntry = join(rendererDist, 'index.html')
const preloadPath = join(__dirname, '..', 'electron', 'preload.cjs')
const HOME_ROOT = resolveHomeRoot()
const PROGRAM_ROOT = resolve(HOME_ROOT, 'Program')
const PORTABLE_ROOT = resolvePortableRoot()
const IS_WINDOWS_PORTABLE = process.platform === 'win32' && app.isPackaged
const HF_ROOT = IS_WINDOWS_PORTABLE ? join(PORTABLE_ROOT, 'HF_Model_Downloader_Data') : join(PROGRAM_ROOT, 'HuggingFace')
const HF_RUNTIME_ROOT = IS_WINDOWS_PORTABLE ? HF_ROOT : join(HF_ROOT, 'HF_Model_Downloader')
const LEGACY_ELECTRON_USER_DATA_DIR = join(app.getPath('appData'), app.getName())
const TARGET_ELECTRON_USER_DATA_DIR = join(HF_RUNTIME_ROOT, 'electron-user-data')
const TARGET_ELECTRON_SESSION_DIR = join(HF_RUNTIME_ROOT, 'electron-session')
const TARGET_ELECTRON_LOGS_DIR = join(HF_RUNTIME_ROOT, 'logs')
const TARGET_ELECTRON_TEMP_DIR = join(HF_RUNTIME_ROOT, 'temp')
const TARGET_ELECTRON_CRASH_DUMPS_DIR = join(HF_RUNTIME_ROOT, 'crashDumps')
const TARGET_CHROMIUM_CACHE_DIR = join(HF_RUNTIME_ROOT, 'cache', 'chromium')
const DEFAULT_DOWNLOADS_DIR = IS_WINDOWS_PORTABLE ? join(HF_RUNTIME_ROOT, 'Downloads') : join(PROGRAM_ROOT, 'Downloads')
const APPROVED_ROOTS_FILE = join(HF_RUNTIME_ROOT, 'approved-output-roots.json')
const defaultPreferences: Preferences = {
  repoId: '',
  endpoint: 'https://huggingface.co',
  outputDir: DEFAULT_DOWNLOADS_DIR,
  concurrency: 3,
  createRepoFolder: true,
}

let mainWindow: BrowserWindow | null = null
let trustedRendererUrl: string | null = null
let runner: DownloadRunner | null = null
let startPending = false
let approvedOutputRoots: string[] | null = null
let updateService: UpdateService | null = null
let latestUpdate: DownloadUpdate = {
  queue: { total: 0, pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0, concurrency: 1 },
  jobs: [],
  logs: [],
  activeRequest: null,
}

function resolveHomeRoot() {
  const candidates = [process.env.USERPROFILE, process.env.HOME, homedir()]
  for (const candidate of candidates) {
    if (candidate && isAbsolute(candidate)) return candidate
  }
  const electronHome = app.getPath('home')
  return electronHome && isAbsolute(electronHome) ? electronHome : process.cwd()
}

function resolveExistingNonLinkDirectory(candidate: string | undefined) {
  if (!candidate || !isAbsolute(candidate)) return null
  try {
    const absoluteCandidate = resolve(candidate)
    const metadata = lstatSync(absoluteCandidate)
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) return null
    return realpathSync.native(absoluteCandidate)
  } catch {
    return null
  }
}

function hasPortableRootMarker(candidate: string) {
  try {
    const marker = lstatSync(join(candidate, '.hf-model-downloader-portable-root'))
    return marker.isFile() && !marker.isSymbolicLink()
  } catch {
    return false
  }
}

function resolvePortableRoot() {
  const executableDirectory = resolveExistingNonLinkDirectory(dirname(process.execPath))
  if (!executableDirectory) {
    throw new Error('无法解析安全的 Windows 便携项目目录。')
  }

  const configuredRoot = resolveExistingNonLinkDirectory(process.env.HF_MODEL_DOWNLOADER_PORTABLE_ROOT)
  if (
    configuredRoot
    && hasPortableRootMarker(configuredRoot)
    && isInsideDirectory(configuredRoot, executableDirectory)
  ) {
    return configuredRoot
  }

  // A directly opened executable lives one level below the extracted ZIP root.
  // The package marker lets that path keep the same project-contained data layout
  // as the launcher without trusting an arbitrary parent directory.
  const parentDirectory = resolveExistingNonLinkDirectory(dirname(executableDirectory))
  if (parentDirectory && hasPortableRootMarker(parentDirectory)) return parentDirectory
  return executableDirectory
}

function isInsideDirectory(root: string, candidate: string) {
  const offset = relative(root, candidate)
  return offset === '' || (offset !== '..' && !offset.startsWith(`..${sep}`) && !isAbsolute(offset))
}

function ensureRuntimeDirectory(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (!IS_WINDOWS_PORTABLE) return

  const metadata = lstatSync(directory)
  const realDirectory = realpathSync.native(directory)
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || !isInsideDirectory(PORTABLE_ROOT, realDirectory)) {
    throw new Error(`Windows 便携运行目录不安全：${directory}`)
  }
}

function configureProcessPaths() {
  const runtimeDirectories = [
    HF_ROOT,
    TARGET_ELECTRON_USER_DATA_DIR,
    TARGET_ELECTRON_SESSION_DIR,
    TARGET_ELECTRON_LOGS_DIR,
  ]
  if (IS_WINDOWS_PORTABLE) {
    runtimeDirectories.push(TARGET_ELECTRON_TEMP_DIR, TARGET_ELECTRON_CRASH_DUMPS_DIR, TARGET_CHROMIUM_CACHE_DIR)
  }
  for (const directory of runtimeDirectories) ensureRuntimeDirectory(directory)

  if (IS_WINDOWS_PORTABLE) {
    app.setPath('appData', HF_RUNTIME_ROOT)
    app.setPath('temp', TARGET_ELECTRON_TEMP_DIR)
    app.setPath('crashDumps', TARGET_ELECTRON_CRASH_DUMPS_DIR)
    app.commandLine.appendSwitch('disk-cache-dir', TARGET_CHROMIUM_CACHE_DIR)
    process.env.TEMP = TARGET_ELECTRON_TEMP_DIR
    process.env.TMP = TARGET_ELECTRON_TEMP_DIR
  }
  app.setPath('userData', TARGET_ELECTRON_USER_DATA_DIR)
  app.setPath('sessionData', TARGET_ELECTRON_SESSION_DIR)
  app.setPath('logs', TARGET_ELECTRON_LOGS_DIR)
}

configureProcessPaths()
const ownsSingleInstanceLock = app.requestSingleInstanceLock()

function getAppPaths(): AppPaths {
  const appDataDir = HF_RUNTIME_ROOT
  const cacheDir = join(appDataDir, 'cache')
  const historyFile = join(appDataDir, 'history.json')
  const preferencesFile = join(appDataDir, 'preferences.json')
  const downloadsDir = DEFAULT_DOWNLOADS_DIR
  const legacyAppDataDir = join(LEGACY_ELECTRON_USER_DATA_DIR, 'hf-desktop')
  ensureRuntimeDirectory(downloadsDir)
  ensureRuntimeDirectory(cacheDir)
  if (!IS_WINDOWS_PORTABLE) migrateLegacyData(legacyAppDataDir, { historyFile, preferencesFile })
  return { downloadsDir, appDataDir, historyFile, preferencesFile, cacheDir }
}

function migrateLegacyData(sourceDir: string, target: Pick<AppPaths, 'historyFile' | 'preferencesFile'>) {
  if (!existsSync(sourceDir) || sourceDir === HF_RUNTIME_ROOT) return
  const sourcePreferences = join(sourceDir, 'preferences.json')
  if (existsSync(sourcePreferences)) {
    const safePreferences = sanitizePreferences(readJsonFile<unknown>(sourcePreferences, {}), defaultPreferences)
    if (!existsSync(target.preferencesFile)) writeJsonFile(target.preferencesFile, safePreferences)
    // Rewrite the old file too so a legacy plaintext token is not left behind.
    writeJsonFile(sourcePreferences, safePreferences)
  }

  const sourceHistory = join(sourceDir, 'history.json')
  if (existsSync(sourceHistory) && !existsSync(target.historyFile)) {
    writeJsonFile(target.historyFile, sanitizeHistoryEntries(readJsonFile<unknown>(sourceHistory, [])))
  }
}

function collectLegacyApprovedRoots(paths: AppPaths) {
  const candidates: unknown[] = []
  const preferences = readJsonFile<unknown>(paths.preferencesFile, {})
  if (typeof preferences === 'object' && preferences !== null && 'outputDir' in preferences) {
    candidates.push((preferences as { outputDir?: unknown }).outputDir)
  }
  const history = readJsonFile<unknown>(paths.historyFile, [])
  if (Array.isArray(history)) {
    for (const entry of history) {
      if (typeof entry === 'object' && entry !== null && 'outputDir' in entry) {
        candidates.push((entry as { outputDir?: unknown }).outputDir)
      }
    }
  }
  return candidates
}

function loadApprovedOutputRoots() {
  if (approvedOutputRoots) return approvedOutputRoots
  const paths = getAppPaths()
  const stored = readJsonFile<unknown>(APPROVED_ROOTS_FILE, [])
  const candidates: unknown[] = [paths.downloadsDir]
  if (Array.isArray(stored)) candidates.push(...stored)
  if (!existsSync(APPROVED_ROOTS_FILE)) candidates.push(...collectLegacyApprovedRoots(paths))

  approvedOutputRoots = [...new Set(candidates.flatMap((candidate) => {
    try {
      return [normalizeApprovedRoot(candidate)]
    } catch {
      return []
    }
  }))]
  writeJsonFile(APPROVED_ROOTS_FILE, approvedOutputRoots)
  return approvedOutputRoots
}

function approveOutputRoot(value: unknown) {
  const root = normalizeApprovedRoot(value)
  const roots = loadApprovedOutputRoots()
  if (!roots.includes(root)) {
    roots.push(root)
    writeJsonFile(APPROVED_ROOTS_FILE, roots)
  }
  return root
}

function loadPreferences() {
  const paths = getAppPaths()
  const sanitized = sanitizePreferences(readJsonFile<unknown>(paths.preferencesFile, defaultPreferences), defaultPreferences)
  try {
    sanitized.endpoint = normalizeRuntimeEndpoint(sanitized.endpoint, !app.isPackaged)
  } catch {
    sanitized.endpoint = defaultPreferences.endpoint
  }
  try {
    sanitized.outputDir = resolveApprovedPath(sanitized.outputDir, loadApprovedOutputRoots())
  } catch {
    sanitized.outputDir = normalizeApprovedRoot(DEFAULT_DOWNLOADS_DIR)
  }
  return sanitized
}

function savePreferences(value: unknown) {
  const paths = getAppPaths()
  const current = loadPreferences()
  const sanitized = sanitizePreferences(value, current)
  try {
    sanitized.endpoint = normalizeRuntimeEndpoint(sanitized.endpoint, !app.isPackaged)
  } catch {
    sanitized.endpoint = current.endpoint
  }
  try {
    sanitized.outputDir = resolveApprovedPath(sanitized.outputDir, loadApprovedOutputRoots())
  } catch {
    sanitized.outputDir = current.outputDir
  }
  writeJsonFile(paths.preferencesFile, sanitized)
}

function loadHistory() {
  const paths = getAppPaths()
  const roots = loadApprovedOutputRoots()
  return sanitizeHistoryEntries(readJsonFile<unknown>(paths.historyFile, [])).filter((entry) => {
    try {
      resolveApprovedPath(entry.outputDir, roots)
      return true
    } catch {
      return false
    }
  })
}

function saveHistory(value: unknown) {
  const paths = getAppPaths()
  const roots = loadApprovedOutputRoots()
  const safeEntries = sanitizeHistoryEntries(value).filter((entry) => {
    try {
      resolveApprovedPath(entry.outputDir, roots)
      return true
    } catch {
      return false
    }
  })
  writeJsonFile(paths.historyFile, safeEntries)
}

function refreshHistory() {
  const result = reconcileHistory(loadHistory(), loadApprovedOutputRoots())
  saveHistory(result.entries)
  sendHistory(result.entries)
  return result
}

function sendUpdate(payload: DownloadUpdate) {
  latestUpdate = payload
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('hf:update', payload)
}

function sendHistory(entries: HistoryEntry[]) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('hf:history', entries)
}

function getRuntimeStatus(): RuntimeStatus {
  const paths = getAppPaths()
  return {
    platform: process.platform,
    checks: [
      { key: 'downloads', label: '默认下载目录', ok: existsSync(paths.downloadsDir), detail: paths.downloadsDir },
      { key: 'appdata', label: '应用数据目录', ok: existsSync(paths.appDataDir) || existsSync(paths.cacheDir), detail: paths.appDataDir },
      { key: 'network', label: '网络运行时', ok: typeof fetch === 'function', detail: 'HTTPS、重定向与私网地址防护已启用' },
      { key: 'cache', label: '缓存目录', ok: existsSync(paths.cacheDir) && statSync(paths.cacheDir).isDirectory(), detail: paths.cacheDir },
    ],
  }
}

function getAppInfo(): AppInfo {
  return { name: app.getName(), version: app.getVersion(), platform: process.platform, packaged: app.isPackaged }
}

function getUpdateService() {
  if (!updateService) {
    const updatesDir = join(getAppPaths().appDataDir, 'updates')
    ensureRuntimeDirectory(updatesDir)
    updateService = new UpdateService({
      currentVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      updatesDir,
    })
  }
  return updateService
}

function updateErrorResult(error: unknown): UpdateCheckResult {
  const message = error instanceof Error ? error.message : '检查更新失败。'
  return {
    currentVersion: app.getVersion(),
    latestVersion: app.getVersion(),
    updateAvailable: false,
    releaseName: '',
    releaseNotes: '',
    publishedAt: '',
    packageSize: 0,
    platform: process.platform,
    arch: process.arch,
    downloadUrl: '',
    sha256: '',
    error: message,
  }
}

function formatDiskBytes(value: bigint) {
  const gibibyte = 1024n * 1024n * 1024n
  const mebibyte = 1024n * 1024n
  if (value >= gibibyte) return `${(Number(value * 10n / gibibyte) / 10).toFixed(1)} GiB`
  return `${(Number(value * 10n / mebibyte) / 10).toFixed(1)} MiB`
}

async function assertSufficientDiskSpace(outputDir: string, selected: readonly { size: number | null }[]) {
  const unknownSizeCount = selected.filter((item) => item.size === null).length
  if (unknownSizeCount > 0) {
    throw new Error(`有 ${unknownSizeCount} 个文件缺少大小信息，无法安全检查磁盘空间；请刷新清单或切换 Endpoint。`)
  }

  const totalBytes = selected.reduce((sum, item) => sum + (item.size ?? 0), 0)
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 0) throw new Error('下载规模超出安全计算范围。')

  const total = BigInt(totalBytes)
  const fixedReserve = 512n * 1024n * 1024n
  const required = total + total / 10n + fixedReserve
  const filesystem = await statfs(outputDir, { bigint: true })
  const available = filesystem.bavail * filesystem.bsize
  if (available < required) {
    throw new Error(`磁盘空间不足：至少需要 ${formatDiskBytes(required)}（含 10% 与 512 MiB 安全余量），当前可用 ${formatDiskBytes(available)}。`)
  }
}

function normalizeDevServerUrl(value: string | undefined) {
  if (!value || app.isPackaged) return null
  try {
    const parsed = new URL(value)
    const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]'
    if (!loopback || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) return null
    return parsed.toString()
  } catch {
    return null
  }
}

function isTrustedRendererLocation(value: string) {
  if (!trustedRendererUrl) return false
  try {
    const actual = new URL(value)
    const trusted = new URL(trustedRendererUrl)
    if (trusted.protocol === 'file:') return actual.protocol === 'file:' && actual.pathname === trusted.pathname
    return actual.origin === trusted.origin
  } catch {
    return false
  }
}

function configureWindowSecurity(window: BrowserWindow, isDevelopment: boolean) {
  const session = window.webContents.session
  session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)

  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame && isTrustedRendererLocation(event.url)) return
    event.preventDefault()
    try {
      void shell.openExternal(normalizeAllowedExternalUrl(event.url))
    } catch {
      // All non-allowlisted navigation remains blocked.
    }
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      void shell.openExternal(normalizeAllowedExternalUrl(url))
    } catch {
      // All non-allowlisted popups remain blocked.
    }
    return { action: 'deny' }
  })

  if (!isDevelopment) {
    session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [[
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: file:",
            "font-src 'self' data:",
            "connect-src 'none'",
            "frame-src 'none'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'none'",
            "frame-ancestors 'none'",
          ].join('; ')],
        },
      })
    })
  }
}

async function createMainWindow() {
  const devServerUrl = normalizeDevServerUrl(process.env.VITE_DEV_SERVER_URL)
  trustedRendererUrl = devServerUrl ?? pathToFileURL(rendererEntry).toString()
  const logoPath = resolveLogoPath()
  if (process.platform === 'darwin' && logoPath && app.dock) {
    const dockIcon = nativeImage.createFromPath(logoPath)
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon)
  }
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1220,
    minHeight: 800,
    title: 'HF Model Downloader',
    backgroundColor: '#f5f7f5',
    ...(logoPath ? { icon: logoPath } : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })
  configureWindowSecurity(mainWindow, Boolean(devServerUrl))
  mainWindow.on('closed', () => {
    mainWindow = null
    trustedRendererUrl = null
  })
  if (devServerUrl) await mainWindow.loadURL(devServerUrl)
  else await mainWindow.loadFile(rendererEntry)
}

function resolveLogoPath() {
  const candidates = [
    join(app.getAppPath(), 'assets', 'logo-sol.png'),
    join(__dirname, '..', 'assets', 'logo-sol.png'),
    join(process.resourcesPath, 'assets', 'logo-sol.png'),
    join(process.resourcesPath, 'app.asar', 'assets', 'logo-sol.png'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function assertTrustedIpcSender(event: IpcMainInvokeEvent) {
  const window = mainWindow
  if (!window || window.isDestroyed() || event.sender !== window.webContents) throw new Error('拒绝来自未知页面的请求。')
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) throw new Error('只允许主页面调用桌面能力。')
  if (!isTrustedRendererLocation(event.senderFrame.url)) throw new Error('调用页面地址不可信。')
}

function secureHandle(channel: string, handler: (args: readonly unknown[]) => unknown) {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcSender(event)
    return handler(args)
  })
}

function registerIpc() {
  secureHandle('app:get-info', () => getAppInfo())
  secureHandle('paths:get', () => getAppPaths())
  secureHandle('runtime:get', () => getRuntimeStatus())
  secureHandle('preferences:get', () => loadPreferences())
  secureHandle('preferences:save', ([value]) => savePreferences(value))
  secureHandle('history:get', () => refreshHistory().entries)
  secureHandle('history:refresh', () => refreshHistory())
  secureHandle('history:delete', ([sessionId, modeValue]) => {
    if (!isValidSessionId(sessionId)) throw new Error('历史会话 ID 不合法。')
    const mode: HistoryDeleteMode = modeValue === undefined || modeValue === 'record-and-files'
      ? 'record-and-files'
      : modeValue === 'record-only'
        ? 'record-only'
        : (() => { throw new Error('历史删除模式不合法。') })()
    const result = deleteHistoryEntry(loadHistory(), sessionId, mode, loadApprovedOutputRoots())
    const synced = reconcileHistory(result.entries, loadApprovedOutputRoots())
    saveHistory(synced.entries)
    sendHistory(synced.entries)
    return { ...result, entries: synced.entries }
  })
  secureHandle('managed-path:open', async ([kindValue]) => {
    const kind: ManagedPathKind = kindValue === 'downloads' || kindValue === 'appData' || kindValue === 'cache'
      ? kindValue
      : (() => { throw new Error('管理目录类型不合法。') })()
    const paths = getAppPaths()
    const target = kind === 'downloads' ? paths.downloadsDir : kind === 'appData' ? paths.appDataDir : paths.cacheDir
    if (!existsSync(target) || !statSync(target).isDirectory()) throw new Error('管理目录不存在。')
    const error = await shell.openPath(target)
    if (error) throw new Error(error)
  })
  secureHandle('updates:check', async () => {
    try {
      return await getUpdateService().checkForUpdates()
    } catch (error) {
      return updateErrorResult(error)
    }
  })
  secureHandle('updates:prepare', async () => {
    try {
      return await getUpdateService().prepareUpdate()
    } catch (error) {
      return { ready: false, verified: false, message: error instanceof Error ? error.message : '更新包准备失败。' }
    }
  })
  secureHandle('updates:apply', async () => {
    try {
      const result = await getUpdateService().applyPreparedUpdate()
      if (!result.packagePath) return result
      shell.showItemInFolder(result.packagePath)
      return result
    } catch (error) {
      return {
        started: false,
        requiredManual: true,
        message: error instanceof Error ? error.message : '应用更新失败。',
      }
    }
  })
  secureHandle('dialog:pickDirectory', async ([currentPath]) => {
    let defaultPath = DEFAULT_DOWNLOADS_DIR
    try {
      if (currentPath !== undefined) defaultPath = resolveApprovedPath(currentPath, loadApprovedOutputRoots())
    } catch {
      // An arbitrary renderer path must not steer the privileged dialog.
    }
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('主窗口不可用。')
    const result = await dialog.showOpenDialog(mainWindow, {
      defaultPath,
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled || !result.filePaths[0] ? null : approveOutputRoot(result.filePaths[0])
  })
  secureHandle('output:open', async ([targetPath]) => {
    const safePath = resolveApprovedPath(targetPath, loadApprovedOutputRoots())
    if (!existsSync(safePath) || !statSync(safePath).isDirectory()) throw new Error('下载目录不存在。')
    const error = await shell.openPath(safePath)
    if (error) throw new Error(error)
  })
  secureHandle('output:reveal', ([targetPath]) => {
    const safePath = resolveApprovedPath(targetPath, loadApprovedOutputRoots())
    if (!existsSync(safePath) || !statSync(safePath).isFile()) throw new Error('下载文件不存在。')
    shell.showItemInFolder(safePath)
  })
  secureHandle('external:open-hf-models', async () => {
    await shell.openExternal(HUGGING_FACE_MODELS_URL)
  })
  secureHandle('hf:test-endpoint', async ([endpointValue, tokenValue]) => {
    const endpoint = normalizeRuntimeEndpoint(endpointValue, !app.isPackaged)
    const token = normalizeTokenForEndpoint(endpoint, tokenValue)
    return testEndpoint(endpoint, token)
  })
  secureHandle('hf:list-files', async ([value]) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('清单请求不合法。')
    const payload = value as Record<string, unknown>
    const endpoint = normalizeRuntimeEndpoint(payload.endpoint, !app.isPackaged)
    const repoId = normalizeRepoId(typeof payload.repoId === 'string' ? payload.repoId : '')
    const token = normalizeTokenForEndpoint(endpoint, payload.token)
    return listModelFiles(endpoint, repoId, token)
  })
  secureHandle('hf:get-update', () => latestUpdate)
  secureHandle('hf:cancel-download', () => runner?.cancel())
  secureHandle('hf:start-download', async ([value]) => {
    if (runner || startPending) throw new Error('当前已有下载任务正在准备或运行。')
    startPending = true
    try {
      const normalizedRequest = normalizeDownloadRequestInput(value, !app.isPackaged)
      normalizedRequest.outputDir = resolveApprovedPath(normalizedRequest.outputDir, loadApprovedOutputRoots())
      if (!existsSync(normalizedRequest.outputDir) || !statSync(normalizedRequest.outputDir).isDirectory()) {
        throw new Error('下载目录不存在，请重新选择。')
      }

      const manifest = await listModelFiles(normalizedRequest.endpoint, normalizedRequest.repoId, normalizedRequest.token)
      const selectedPaths = new Set(normalizedRequest.selectedPaths)
      const selected = manifest.filter((item) => selectedPaths.has(item.path))
      if (selected.length !== selectedPaths.size) throw new Error('所选文件与最新仓库清单不一致，请重新加载清单。')
      await assertSufficientDiskSpace(normalizedRequest.outputDir, selected)

      const sessionId = `session-${randomUUID()}`
      const totalBytes = selected.reduce((sum, item) => sum + (item.size ?? 0), 0)
      let finalized = false
      const finalize = (status: 'success' | 'error' | 'cancelled', downloadedBytes: number, errorMessage: string | null) => {
        if (finalized) return
        finalized = true
        const nextHistory = loadHistory().map((item) => item.sessionId === sessionId ? {
          ...item,
          finishedAt: new Date().toISOString(),
          status,
          downloadedBytes,
          errorMessage,
        } : item)
        saveHistory(nextHistory)
        sendHistory(nextHistory)
        sendUpdate({ ...latestUpdate, activeRequest: null })
        if (runner === nextRunner) runner = null
      }
      const nextRunner = new DownloadRunner(normalizedRequest, selected, {
        onUpdate: sendUpdate,
        onDone: finalize,
      })

      const history: HistoryEntry[] = [{
        sessionId,
        repoId: normalizedRequest.repoId,
        endpoint: normalizedRequest.endpoint,
        outputDir: normalizedRequest.outputDir,
        selectedPaths: normalizedRequest.selectedPaths,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        status: 'running',
        downloadedBytes: 0,
        totalBytes,
        errorMessage: null,
        createRepoFolder: normalizedRequest.createRepoFolder,
        presentCount: 0,
        missingCount: 0,
        syncStatus: 'unchecked',
      }, ...loadHistory()]
      saveHistory(history)
      sendHistory(loadHistory())
      runner = nextRunner
      void nextRunner.start().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '下载任务异常退出。'
        finalize('error', 0, message)
      })
      return sessionId
    } finally {
      startPending = false
    }
  })
}

if (!ownsSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  void app.whenReady().then(async () => {
    loadApprovedOutputRoots()
    savePreferences(loadPreferences())
    refreshHistory()
    registerIpc()
    await createMainWindow()
    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) await createMainWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
