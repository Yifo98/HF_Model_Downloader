import { once } from 'node:events'
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { buildDownloadUrl, getSafeRelativePathSegments, normalizeEndpoint, normalizeRepoId } from './hfApi.js'
import type { DownloadJobSnapshot, DownloadRequest, DownloadUpdate, FileManifestItem, QueueSnapshot } from './types.js'

export type DownloadRunnerCallbacks = {
  onUpdate: (payload: DownloadUpdate) => void
  onDone: (status: 'success' | 'error' | 'cancelled', totalBytes: number, errorMessage: string | null) => void
}

function buildQueueSnapshot(jobs: DownloadJobSnapshot[], concurrency: number): QueueSnapshot {
  return {
    total: jobs.length,
    pending: jobs.filter((job) => job.status === 'idle').length,
    running: jobs.filter((job) => job.status === 'running').length,
    completed: jobs.filter((job) => job.status === 'success').length,
    failed: jobs.filter((job) => job.status === 'error').length,
    cancelled: jobs.filter((job) => job.status === 'cancelled').length,
    concurrency,
  }
}

function createJobSnapshots(request: DownloadRequest, manifest: FileManifestItem[]) {
  const outputRoot = resolveOutputRoot(request)

  return manifest.map((item, index) => {
    const outputPath = resolve(outputRoot, ...getSafeRelativePathSegments(item.path))
    assertInsideDirectory(outputRoot, outputPath)

    return {
      jobId: 'job-' + String(index + 1),
      path: item.path,
      status: 'idle',
      downloadedBytes: 0,
      totalBytes: item.size,
      speedBytesPerSecond: 0,
      percent: 0,
      message: '等待中',
      outputPath,
      commandPreview: 'GET ' + buildDownloadUrl(request.endpoint, request.repoId, item.path),
    } satisfies DownloadJobSnapshot
  })
}

function resolveOutputRoot(request: DownloadRequest) {
  const outputDir = request.outputDir.trim()
  if (!outputDir || !isAbsolute(outputDir)) {
    throw new Error('下载目录必须是绝对路径。')
  }

  const normalizedRepoId = normalizeRepoId(request.repoId)
  const repoFolder = request.createRepoFolder ? normalizedRepoId.split('/').at(-1) ?? '' : ''
  const root = repoFolder ? resolve(outputDir, repoFolder) : resolve(outputDir)
  assertInsideDirectory(resolve(outputDir), root)
  return root
}

function assertInsideDirectory(rootDir: string, targetPath: string) {
  const relativePath = relative(rootDir, targetPath)
  if (relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))) return
  throw new Error('拒绝写入下载目录之外的路径。')
}

function normalizeDownloadRequest(request: DownloadRequest): DownloadRequest {
  const outputDir = request.outputDir.trim()
  const concurrency = Number.isFinite(request.concurrency) ? Math.trunc(request.concurrency) : 1

  return {
    ...request,
    repoId: normalizeRepoId(request.repoId),
    endpoint: normalizeEndpoint(request.endpoint),
    outputDir,
    concurrency: Math.max(1, Math.min(concurrency, 8)),
    selectedPaths: request.selectedPaths.map((path) => getSafeRelativePathSegments(path).join('/')),
  }
}

export class DownloadRunner {
  private readonly controller = new AbortController()
  private cancelled = false
  private readonly jobs: DownloadJobSnapshot[]
  private readonly logs: string[] = []
  private readonly request: DownloadRequest

  constructor(
    request: DownloadRequest,
    manifest: FileManifestItem[],
    private readonly callbacks: DownloadRunnerCallbacks,
  ) {
    this.request = normalizeDownloadRequest(request)
    this.jobs = createJobSnapshots(this.request, manifest)
  }

  cancel() {
    this.cancelled = true
    this.controller.abort()
    for (const job of this.jobs) {
      if (job.status === 'idle' || job.status === 'running') {
        job.status = 'cancelled'
        job.message = '已取消'
      }
    }
    this.emitUpdate()
  }

  async start() {
    try {
      const queue = [...this.jobs]
      const workerCount = Math.max(1, Math.min(this.request.concurrency, queue.length || 1))
      const workers = Array.from({ length: workerCount }, async () => {
        while (queue.length > 0 && !this.cancelled) {
          const job = queue.shift()
          if (!job) break
          await this.downloadJob(job)
        }
      })

      await Promise.all(workers)

      const totalBytes = this.jobs.reduce((sum, job) => sum + job.downloadedBytes, 0)
      const hasError = this.jobs.some((job) => job.status === 'error')
      const status = this.cancelled ? 'cancelled' : hasError ? 'error' : 'success'
      this.callbacks.onDone(
        status,
        totalBytes,
        hasError ? this.jobs.find((job) => job.status === 'error')?.message ?? null : null,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : '下载失败'
      this.logs.push(message)
      this.callbacks.onDone(this.cancelled ? 'cancelled' : 'error', this.jobs.reduce((sum, job) => sum + job.downloadedBytes, 0), message)
    }
  }

  private emitUpdate() {
    this.callbacks.onUpdate({
      queue: buildQueueSnapshot(this.jobs, this.request.concurrency),
      jobs: [...this.jobs],
      logs: [...this.logs.slice(-200)],
      activeRequest: this.request,
    })
  }

  private async downloadJob(job: DownloadJobSnapshot) {
    if (this.cancelled) return

    job.status = 'running'
    job.message = '准备下载'
    this.logs.push('开始下载 ' + job.path)
    this.emitUpdate()

    const tempPath = job.outputPath + '.part'
    mkdirSync(dirname(job.outputPath), { recursive: true })

    const existingSize = existsSync(tempPath) ? statSync(tempPath).size : 0
    const url = buildDownloadUrl(this.request.endpoint, this.request.repoId, job.path)
    const headers = new Headers()
    if (this.request.token?.trim()) {
      headers.set('Authorization', 'Bearer ' + this.request.token.trim())
    }
    if (existingSize > 0) {
      headers.set('Range', 'bytes=' + String(existingSize) + '-')
    }

    const startedAt = Date.now()
    const response = await fetch(url, {
      headers,
      signal: this.controller.signal,
    })

    if (!response.ok && response.status !== 206) {
      job.status = 'error'
      job.message = 'HTTP ' + String(response.status)
      this.logs.push('下载失败 ' + job.path + ': HTTP ' + String(response.status))
      this.emitUpdate()
      return
    }

    const contentLengthHeader = response.headers.get('content-length')
    const appendMode = existingSize > 0 && response.status === 206
    const baseDownloaded = appendMode ? existingSize : 0
    const resolvedTotal = contentLengthHeader
      ? Number.parseInt(contentLengthHeader, 10) + baseDownloaded
      : job.totalBytes
    job.totalBytes = Number.isFinite(resolvedTotal) ? resolvedTotal : job.totalBytes
    job.downloadedBytes = baseDownloaded

    const stream = createWriteStream(tempPath, { flags: appendMode ? 'a' : 'w' })
    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('响应体为空: ' + job.path)
    }

    while (!this.cancelled) {
      const { value, done } = await reader.read()
      if (done) break
      if (!value) continue
      if (!stream.write(Buffer.from(value))) {
        await once(stream, 'drain')
      }
      job.downloadedBytes += value.length
      const elapsedSeconds = Math.max(1, (Date.now() - startedAt) / 1000)
      job.speedBytesPerSecond = Math.round((job.downloadedBytes - baseDownloaded) / elapsedSeconds)
      job.percent = job.totalBytes ? Number(((job.downloadedBytes / job.totalBytes) * 100).toFixed(1)) : null
      job.message = '下载中'
      this.emitUpdate()
    }

    stream.end()
    await once(stream, 'finish')

    if (this.cancelled) {
      job.status = 'cancelled'
      job.message = '已取消'
      this.emitUpdate()
      return
    }

    await rename(tempPath, job.outputPath)
    job.status = 'success'
    job.percent = 100
    job.message = '下载完成'
    this.logs.push('完成 ' + job.path)
    this.emitUpdate()
  }
}
