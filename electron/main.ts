import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { cpSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DownloadRunner } from './core/downloadRunner.js'
import { listModelFiles, testEndpoint } from './core/hfApi.js'
import { readJsonFile, writeJsonFile } from './core/storage.js'
import type { AppPaths, DownloadRequest, DownloadUpdate, HistoryEntry, Preferences, RuntimeStatus } from './core/types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rendererDist = join(__dirname, '..', 'dist')
const preloadPath = join(__dirname, '..', 'electron', 'preload.cjs')
const HOME_ROOT = resolveHomeRoot()
const PROGRAM_ROOT = resolve(HOME_ROOT, 'Program')
const PORTABLE_ROOT = dirname(process.execPath)
const IS_WINDOWS_PORTABLE = process.platform === 'win32' && app.isPackaged
const HF_ROOT = IS_WINDOWS_PORTABLE ? join(PORTABLE_ROOT, 'HF_Model_Downloader_Data') : join(PROGRAM_ROOT, 'HuggingFace')
const HF_RUNTIME_ROOT = IS_WINDOWS_PORTABLE ? HF_ROOT : join(HF_ROOT, 'HF_Model_Downloader')
const LEGACY_ELECTRON_USER_DATA_DIR = join(app.getPath('appData'), app.getName())
const TARGET_ELECTRON_USER_DATA_DIR = join(HF_RUNTIME_ROOT, 'electron-user-data')
const TARGET_ELECTRON_SESSION_DIR = join(HF_RUNTIME_ROOT, 'electron-session')
const TARGET_ELECTRON_LOGS_DIR = join(HF_RUNTIME_ROOT, 'logs')
const DEFAULT_DOWNLOADS_DIR = IS_WINDOWS_PORTABLE ? join(HF_RUNTIME_ROOT, 'Downloads') : join(PROGRAM_ROOT, 'Downloads')
const defaultPreferences: Preferences = {
  repoId: '',
  endpoint: 'https://huggingface.co',
  token: '',
  outputDir: DEFAULT_DOWNLOADS_DIR,
  concurrency: 3,
  createRepoFolder: true,
}

let mainWindow: BrowserWindow | null = null
let runner: DownloadRunner | null = null
let latestUpdate: DownloadUpdate = {
  queue: { total: 0, pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0, concurrency: 1 },
  jobs: [],
  logs: [],
  activeRequest: null,
}

function resolveHomeRoot() {
  const candidates = [
    process.env.USERPROFILE,
    process.env.HOME,
    homedir(),
  ]

  for (const candidate of candidates) {
    if (candidate && isAbsolute(candidate)) {
      return candidate
    }
  }

  const electronHome = app.getPath('home')
  if (electronHome && isAbsolute(electronHome)) {
    return electronHome
  }

  return process.cwd()
}

function migrateDirectoryIfNeeded(sourceDir: string, targetDir: string) {
  if (!existsSync(sourceDir) || sourceDir === targetDir || existsSync(targetDir)) return
  mkdirSync(dirname(targetDir), { recursive: true })
  cpSync(sourceDir, targetDir, { recursive: true })
}

function configureProcessPaths() {
  mkdirSync(HF_ROOT, { recursive: true })
  migrateDirectoryIfNeeded(LEGACY_ELECTRON_USER_DATA_DIR, TARGET_ELECTRON_USER_DATA_DIR)
  mkdirSync(TARGET_ELECTRON_USER_DATA_DIR, { recursive: true })
  mkdirSync(TARGET_ELECTRON_SESSION_DIR, { recursive: true })
  mkdirSync(TARGET_ELECTRON_LOGS_DIR, { recursive: true })
  app.setPath('userData', TARGET_ELECTRON_USER_DATA_DIR)
  app.setPath('sessionData', TARGET_ELECTRON_SESSION_DIR)
  app.setPath('logs', TARGET_ELECTRON_LOGS_DIR)
}

configureProcessPaths()

function getAppPaths(): AppPaths {
  const appDataDir = HF_RUNTIME_ROOT
  const cacheDir = join(appDataDir, 'cache')
  const historyFile = join(appDataDir, 'history.json')
  const preferencesFile = join(appDataDir, 'preferences.json')
  const downloadsDir = DEFAULT_DOWNLOADS_DIR
  const legacyAppDataDir = join(LEGACY_ELECTRON_USER_DATA_DIR, 'hf-desktop')
  migrateLegacyData(legacyAppDataDir, appDataDir)
  mkdirSync(downloadsDir, { recursive: true })
  mkdirSync(cacheDir, { recursive: true })
  return {
    downloadsDir,
    appDataDir,
    historyFile,
    preferencesFile,
    cacheDir,
  }
}

function migrateLegacyData(sourceDir: string, targetDir: string) {
  if (!existsSync(sourceDir) || sourceDir === targetDir) return
  mkdirSync(targetDir, { recursive: true })
  for (const name of ['history.json', 'preferences.json', 'cache']) {
    const sourcePath = join(sourceDir, name)
    const targetPath = join(targetDir, name)
    if (!existsSync(sourcePath) || existsSync(targetPath)) continue
    cpSync(sourcePath, targetPath, { recursive: true })
  }
}

function loadPreferences() {
  const paths = getAppPaths()
  return readJsonFile(paths.preferencesFile, defaultPreferences)
}

function savePreferences(value: Preferences) {
  const paths = getAppPaths()
  writeJsonFile(paths.preferencesFile, value)
}

function loadHistory() {
  const paths = getAppPaths()
  return readJsonFile<HistoryEntry[]>(paths.historyFile, [])
}

function saveHistory(value: HistoryEntry[]) {
  const paths = getAppPaths()
  writeJsonFile(paths.historyFile, value)
}

function sendUpdate(payload: DownloadUpdate) {
  latestUpdate = payload
  mainWindow?.webContents.send('hf:update', payload)
}

function sendHistory(entries: HistoryEntry[]) {
  mainWindow?.webContents.send('hf:history', entries)
}

function getRuntimeStatus(): RuntimeStatus {
  const paths = getAppPaths()
  const checks = [
    {
      key: 'downloads',
      label: '默认下载目录',
      ok: existsSync(paths.downloadsDir),
      detail: paths.downloadsDir,
    },
    {
      key: 'appdata',
      label: '应用数据目录',
      ok: existsSync(paths.appDataDir) || existsSync(paths.cacheDir),
      detail: paths.appDataDir,
    },
    {
      key: 'network',
      label: '网络运行时',
      ok: typeof fetch === 'function',
      detail: '使用 Node.js fetch 访问 Hugging Face Hub',
    },
    {
      key: 'cache',
      label: '缓存目录',
      ok: existsSync(paths.cacheDir) && statSync(paths.cacheDir).isDirectory(),
      detail: paths.cacheDir,
    },
  ]

  return {
    platform: process.platform,
    checks,
  }
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1220,
    minHeight: 800,
    title: 'HF Model Downloader',
    backgroundColor: '#f4efe4',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl)
  } else {
    await mainWindow.loadFile(join(rendererDist, 'index.html'))
  }
}

function registerIpc() {
  ipcMain.handle('paths:get', () => getAppPaths())
  ipcMain.handle('runtime:get', () => getRuntimeStatus())
  ipcMain.handle('preferences:get', () => loadPreferences())
  ipcMain.handle('preferences:save', (_event, value: Preferences) => {
    savePreferences(value)
  })
  ipcMain.handle('history:get', () => loadHistory())
  ipcMain.handle('history:delete', (_event, sessionId: string) => {
    const remaining = loadHistory().filter((entry) => entry.sessionId !== sessionId)
    saveHistory(remaining)
    sendHistory(remaining)
    return remaining
  })
  ipcMain.handle('dialog:pickDirectory', async (_event, currentPath?: string) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      defaultPath: currentPath || app.getPath('downloads'),
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('shell:openPath', async (_event, targetPath: string) => {
    if (!targetPath) return
    await shell.openPath(targetPath)
  })
  ipcMain.handle('shell:showItemInFolder', async (_event, targetPath: string) => {
    if (!targetPath) return
    shell.showItemInFolder(targetPath)
  })
  ipcMain.handle('shell:openExternal', async (_event, targetUrl: string) => {
    if (!targetUrl) return
    await shell.openExternal(targetUrl)
  })
  ipcMain.handle('hf:test-endpoint', async (_event, endpoint: string, token: string | null) => testEndpoint(endpoint, token))
  ipcMain.handle('hf:list-files', async (_event, payload: { endpoint: string; repoId: string; token: string | null }) => {
    return listModelFiles(payload.endpoint, payload.repoId, payload.token)
  })
  ipcMain.handle('hf:get-update', () => latestUpdate)
  ipcMain.handle('hf:cancel-download', () => {
    runner?.cancel()
  })
  ipcMain.handle('hf:start-download', async (_event, request: DownloadRequest) => {
    if (runner) {
      throw new Error('当前已有下载任务在运行。')
    }

    const manifest = await listModelFiles(request.endpoint, request.repoId, request.token)
    const selected = manifest.filter((item) => request.selectedPaths.includes(item.path))
    if (selected.length === 0) {
      throw new Error('没有可下载的文件。')
    }

    const sessionId = `session-${Date.now()}`
    const totalBytes = selected.reduce((sum, item) => sum + (item.size ?? 0), 0)
    const history = loadHistory()
    const entry: HistoryEntry = {
      sessionId,
      repoId: request.repoId,
      endpoint: request.endpoint,
      outputDir: request.outputDir,
      selectedPaths: request.selectedPaths,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      status: 'running',
      downloadedBytes: 0,
      totalBytes,
      errorMessage: null,
    }
    history.unshift(entry)
    saveHistory(history)
    sendHistory(history)

    runner = new DownloadRunner(request, selected, {
      onUpdate: (payload) => {
        sendUpdate(payload)
      },
      onDone: (status, downloadedBytes, errorMessage) => {
        const nextHistory = loadHistory().map((item) => {
          if (item.sessionId !== sessionId) return item
          return {
            ...item,
            finishedAt: new Date().toISOString(),
            status,
            downloadedBytes,
            errorMessage,
          }
        })
        saveHistory(nextHistory)
        sendHistory(nextHistory)
        sendUpdate({
          ...latestUpdate,
          activeRequest: null,
        })
        runner = null
      },
    })

    void runner.start()
    return sessionId
  })
}

app.whenReady().then(async () => {
  registerIpc()
  await createMainWindow()
  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
