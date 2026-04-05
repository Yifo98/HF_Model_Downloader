/// <reference types="vite/client" />

type MirrorProfile = {
  id: string
  label: string
  baseUrl: string
  source: 'official' | 'mirror' | 'custom'
}

type AppPaths = {
  downloadsDir: string
  appDataDir: string
  historyFile: string
  preferencesFile: string
  cacheDir: string
}

type RuntimeCheck = {
  key: string
  label: string
  ok: boolean
  detail: string
}

type RuntimeStatus = {
  platform: string
  checks: RuntimeCheck[]
}

type FileManifestItem = {
  path: string
  size: number | null
  type: 'file' | 'directory'
  category: string
  family: string
}

type DownloadRequest = {
  repoId: string
  outputDir: string
  endpoint: string
  token: string | null
  selectedPaths: string[]
  concurrency: number
  createRepoFolder: boolean
}

type DownloadStatus = 'idle' | 'running' | 'success' | 'error' | 'cancelled'

type DownloadJobSnapshot = {
  jobId: string
  path: string
  status: DownloadStatus
  downloadedBytes: number
  totalBytes: number | null
  speedBytesPerSecond: number
  percent: number | null
  message: string
  outputPath: string
  commandPreview: string
}

type QueueSnapshot = {
  total: number
  pending: number
  running: number
  completed: number
  failed: number
  cancelled: number
  concurrency: number
}

type DownloadUpdate = {
  queue: QueueSnapshot
  jobs: DownloadJobSnapshot[]
  logs: string[]
  activeRequest: DownloadRequest | null
}

type HistoryEntry = {
  sessionId: string
  repoId: string
  endpoint: string
  outputDir: string
  selectedPaths: string[]
  startedAt: string
  finishedAt: string | null
  status: DownloadStatus
  downloadedBytes: number
  totalBytes: number
  errorMessage: string | null
}

type Preferences = {
  repoId: string
  endpoint: string
  token: string
  outputDir: string
  concurrency: number
  createRepoFolder: boolean
}

type EndpointTestResult = {
  ok: boolean
  message: string
  latencyMs: number | null
}

type Unsubscribe = () => void

interface Window {
  appApi: {
    getPaths: () => Promise<AppPaths>
    getRuntimeStatus: () => Promise<RuntimeStatus>
    getPreferences: () => Promise<Preferences>
    savePreferences: (value: Preferences) => Promise<void>
    getHistory: () => Promise<HistoryEntry[]>
    deleteHistory: (sessionId: string) => Promise<HistoryEntry[]>
    pickDirectory: (currentPath?: string) => Promise<string | null>
    testEndpoint: (endpoint: string, token: string | null) => Promise<EndpointTestResult>
    listFiles: (payload: { endpoint: string; repoId: string; token: string | null }) => Promise<FileManifestItem[]>
    startDownload: (request: DownloadRequest) => Promise<string>
    cancelDownload: () => Promise<void>
    getLatestUpdate: () => Promise<DownloadUpdate>
    openPath: (targetPath: string) => Promise<void>
    showItemInFolder: (targetPath: string) => Promise<void>
    openExternal: (targetUrl: string) => Promise<void>
    onJobUpdate: (listener: (payload: DownloadUpdate) => void) => Unsubscribe
    onHistoryUpdate: (listener: (entries: HistoryEntry[]) => void) => Unsubscribe
  }
}
