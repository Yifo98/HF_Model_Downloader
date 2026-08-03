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

type NetworkMode = 'auto' | 'system' | 'direct' | 'custom'

type NetworkRouteMode = Exclude<NetworkMode, 'auto'>

type NetworkConfig = {
  mode: NetworkMode
  proxyUrl: string
}

type NetworkRouteProbe = {
  mode: NetworkRouteMode
  available: boolean
  latencyMs: number | null
  detail: string
}

type NetworkDetectionResult = {
  selectedMode: NetworkMode
  effectiveMode: NetworkRouteMode | null
  recommendedMode: NetworkRouteMode | null
  systemProxyDetected: boolean
  systemProxySummary: string
  routes: NetworkRouteProbe[]
  message: string
}

type FileManifestItem = {
  path: string
  size: number | null
  type: 'file' | 'directory'
  category: string
  family: string
  revision: string
  lfsSha256?: string
  gitBlobOid?: string
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

type DownloadRequestSummary = Omit<DownloadRequest, 'token'> & {
  authenticated: boolean
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
  activeRequest: DownloadRequestSummary | null
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
  createRepoFolder: boolean | null
  presentCount: number
  missingCount: number
  syncStatus: 'unchecked' | 'available' | 'partial'
}

type HistoryDeleteMode = 'record-only' | 'record-and-files'

type HistoryDeleteResult = {
  entries: HistoryEntry[]
  removedFiles: number
  missingFiles: number
  failedFiles: number
  skippedShared: number
  skippedUnsafe: number
  recordDeleted: boolean
  message: string
}

type HistorySyncResult = {
  entries: HistoryEntry[]
  removedRecords: number
  message: string
}

type ManagedPathKind = 'downloads' | 'appData' | 'cache'

type UpdateCheckResult = {
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  releaseName: string
  releaseNotes: string
  publishedAt: string
  packageSize: number
  platform: string
  arch: string
  downloadUrl: string
  sha256: string
  error?: string
}

type UpdatePrepareResult = {
  ready: boolean
  verified: boolean
  packagePath?: string
  message: string
}

type UpdateApplyResult = {
  started: boolean
  requiredManual: boolean
  packagePath?: string
  message: string
}

type Preferences = {
  repoId: string
  endpoint: string
  outputDir: string
  concurrency: number
  createRepoFolder: boolean
  networkMode: NetworkMode
  proxyUrl: string
}

type AppInfo = {
  name: string
  version: string
  platform: string
  packaged: boolean
}

type EndpointTestResult = {
  ok: boolean
  message: string
  latencyMs: number | null
}

type Unsubscribe = () => void

interface Window {
  appApi: {
    getAppInfo: () => Promise<AppInfo>
    getPaths: () => Promise<AppPaths>
    getRuntimeStatus: () => Promise<RuntimeStatus>
    getPreferences: () => Promise<Preferences>
    savePreferences: (value: Preferences) => Promise<void>
    getHistory: () => Promise<HistoryEntry[]>
    deleteHistory: (sessionId: string, mode: HistoryDeleteMode) => Promise<HistoryDeleteResult>
    refreshHistory: () => Promise<HistorySyncResult>
    pickDirectory: (currentPath?: string) => Promise<string | null>
    detectNetwork: (endpoint: string, networkConfig: NetworkConfig) => Promise<NetworkDetectionResult>
    testEndpoint: (endpoint: string, token: string | null, networkConfig: NetworkConfig) => Promise<EndpointTestResult>
    listFiles: (payload: { endpoint: string; repoId: string; token: string | null; network: NetworkConfig }) => Promise<FileManifestItem[]>
    startDownload: (request: DownloadRequest, networkConfig: NetworkConfig) => Promise<string>
    cancelDownload: () => Promise<void>
    getLatestUpdate: () => Promise<DownloadUpdate>
    openPath: (targetPath: string) => Promise<void>
    showItemInFolder: (targetPath: string) => Promise<void>
    openManagedPath: (kind: ManagedPathKind) => Promise<void>
    checkForUpdates: () => Promise<UpdateCheckResult>
    prepareUpdate: () => Promise<UpdatePrepareResult>
    applyPreparedUpdate: () => Promise<UpdateApplyResult>
    openExternal: (targetUrl: string) => Promise<void>
    onJobUpdate: (listener: (payload: DownloadUpdate) => void) => Unsubscribe
    onHistoryUpdate: (listener: (entries: HistoryEntry[]) => void) => Unsubscribe
  }
}
