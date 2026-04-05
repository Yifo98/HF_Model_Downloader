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

export type FileManifestItem = {
  path: string
  size: number | null
  type: 'file' | 'directory'
  category: string
  family: string
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
  activeRequest: DownloadRequest | null
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
}

export type Preferences = {
  repoId: string
  endpoint: string
  token: string
  outputDir: string
  concurrency: number
  createRepoFolder: boolean
}

export type EndpointTestResult = {
  ok: boolean
  message: string
  latencyMs: number | null
}
