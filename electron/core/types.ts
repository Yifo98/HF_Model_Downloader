export type MirrorProfile = {
  id: string
  label: string
  baseUrl: string
  source: 'official' | 'mirror' | 'custom'
}

export type AppPaths = {
  downloadsDir: string
  appDataDir: string
  historyFile: string
  preferencesFile: string
  cacheDir: string
}

export type RuntimeCheck = {
  key: string
  label: string
  ok: boolean
  detail: string
}

export type RuntimeStatus = {
  platform: NodeJS.Platform
  checks: RuntimeCheck[]
}

export type NetworkMode = 'auto' | 'system' | 'direct' | 'custom'

export type NetworkRouteMode = Exclude<NetworkMode, 'auto'>

export type NetworkConfig = {
  mode: NetworkMode
  proxyUrl: string
}

export type NetworkRouteProbe = {
  mode: NetworkRouteMode
  available: boolean
  latencyMs: number | null
  detail: string
}

export type NetworkDetectionResult = {
  selectedMode: NetworkMode
  effectiveMode: NetworkRouteMode | null
  recommendedMode: NetworkRouteMode | null
  systemProxyDetected: boolean
  systemProxySummary: string
  routes: NetworkRouteProbe[]
  message: string
}

export type FileManifestItem = {
  path: string
  size: number | null
  type: 'file' | 'directory'
  category: string
  family: string
  revision: string
  lfsSha256?: string
  gitBlobOid?: string
}

export type DownloadRequest = {
  repoId: string
  outputDir: string
  endpoint: string
  token: string | null
  selectedPaths: string[]
  concurrency: number
  createRepoFolder: boolean
}

export type DownloadRequestSummary = Omit<DownloadRequest, 'token'> & {
  authenticated: boolean
}

export type DownloadStatus = 'idle' | 'running' | 'success' | 'error' | 'cancelled'

export type DownloadJobSnapshot = {
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

export type QueueSnapshot = {
  total: number
  pending: number
  running: number
  completed: number
  failed: number
  cancelled: number
  concurrency: number
}

export type DownloadUpdate = {
  queue: QueueSnapshot
  jobs: DownloadJobSnapshot[]
  logs: string[]
  activeRequest: DownloadRequestSummary | null
}

export type HistoryEntry = {
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

export type HistoryDeleteMode = 'record-only' | 'record-and-files'

export type HistoryDeleteResult = {
  entries: HistoryEntry[]
  removedFiles: number
  missingFiles: number
  failedFiles: number
  skippedShared: number
  skippedUnsafe: number
  recordDeleted: boolean
  message: string
}

export type HistorySyncResult = {
  entries: HistoryEntry[]
  removedRecords: number
  message: string
}

export type ManagedPathKind = 'downloads' | 'appData' | 'cache'

export type UpdateCheckResult = {
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  releaseName: string
  releaseNotes: string
  publishedAt: string
  packageSize: number
  platform: NodeJS.Platform
  arch: string
  downloadUrl: string
  sha256: string
  error?: string
}

export type UpdatePrepareResult = {
  ready: boolean
  verified: boolean
  packagePath?: string
  message: string
}

export type UpdateApplyResult = {
  started: boolean
  requiredManual: boolean
  packagePath?: string
  message: string
}

export type Preferences = {
  repoId: string
  endpoint: string
  outputDir: string
  concurrency: number
  createRepoFolder: boolean
  networkMode: NetworkMode
  proxyUrl: string
}

export type AppInfo = {
  name: string
  version: string
  platform: NodeJS.Platform
  packaged: boolean
}

export type EndpointTestResult = {
  ok: boolean
  message: string
  latencyMs: number | null
}
