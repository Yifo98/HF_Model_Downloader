import { once } from 'node:events'
import { createHash } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { rename } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  assertSafeNetworkUrl,
  buildDownloadUrl,
  getSafeRelativePathSegments,
  normalizeCommitRevision,
  normalizeEndpoint,
  normalizeRepoId,
  normalizeTokenForEndpoint,
  type NetworkFetch,
} from './hfApi.js'
import { MAX_SELECTED_FILES } from './securityPolicy.js'
import type { DownloadJobSnapshot, DownloadRequest, DownloadRequestSummary, DownloadUpdate, FileManifestItem, QueueSnapshot } from './types.js'

const PARTIALS_DIRECTORY = '.hf-model-downloader-partials'
const MAX_REDIRECTS = 5
const RESPONSE_HEADER_TIMEOUT_MS = 30_000
const STREAM_STALL_TIMEOUT_MS = 45_000
const MAX_PARTIAL_METADATA_BYTES = 16 * 1024
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const SHA256_PATTERN = /^[a-f0-9]{64}$/i
const GIT_OBJECT_ID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i

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

function createJobSnapshots(request: DownloadRequest, manifest: FileManifestItem[], outputRoot: string) {
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
      commandPreview: 'GET ' + buildDownloadUrl(request.endpoint, request.repoId, item.revision, item.path),
    } satisfies DownloadJobSnapshot
  })
}

export function resolveOutputRoot(request: DownloadRequest) {
  const outputDir = request.outputDir.trim()
  if (!outputDir || !isAbsolute(outputDir)) {
    throw new Error('下载目录必须是绝对路径。')
  }

  const normalizedRepoId = normalizeRepoId(request.repoId)
  const repoSegments = request.createRepoFolder ? normalizedRepoId.split('/') : []
  const root = repoSegments.length > 0 ? resolve(outputDir, ...repoSegments) : resolve(outputDir)
  assertInsideDirectory(resolve(outputDir), root)
  return root
}

export function buildDownloadIdentity(endpoint: string, repoId: string, revision: string, filePath: string) {
  return [
    normalizeEndpoint(endpoint),
    normalizeRepoId(repoId),
    normalizeCommitRevision(revision),
    getSafeRelativePathSegments(filePath).join('/'),
  ].join('\n')
}

export function buildPartialFileName(endpoint: string, repoId: string, revision: string, filePath: string) {
  const identity = buildDownloadIdentity(endpoint, repoId, revision, filePath)
  return createHash('sha256').update(identity).digest('hex') + '.part'
}

export function normalizeStrongEtag(value: string | null) {
  const normalized = value?.trim() ?? ''
  if (!normalized || /^W\//i.test(normalized) || !/^"[^"\r\n]+"$/.test(normalized)) return null
  return normalized
}

type TrustedIntegrity = {
  algorithm: 'sha256' | 'git-sha1' | 'git-sha256'
  expected: string
}

export type FileIntegrityResult = {
  trusted: boolean
  matches: boolean
  algorithm: TrustedIntegrity['algorithm'] | null
  expected: string | null
  actual: string | null
}

function getTrustedIntegrity(item: FileManifestItem): TrustedIntegrity | null {
  const lfsSha256 = item.lfsSha256?.trim().toLocaleLowerCase('en-US')
  if (lfsSha256 && SHA256_PATTERN.test(lfsSha256)) {
    return { algorithm: 'sha256', expected: lfsSha256 }
  }

  const gitBlobOid = item.gitBlobOid?.trim().toLocaleLowerCase('en-US')
  if (!gitBlobOid || !GIT_OBJECT_ID_PATTERN.test(gitBlobOid)) return null
  return {
    algorithm: gitBlobOid.length === 40 ? 'git-sha1' : 'git-sha256',
    expected: gitBlobOid,
  }
}

export async function verifyFileIntegrity(filePath: string, item: FileManifestItem): Promise<FileIntegrityResult> {
  const integrity = getTrustedIntegrity(item)
  if (!integrity) {
    return { trusted: false, matches: false, algorithm: null, expected: null, actual: null }
  }

  const fileSize = statSync(filePath).size
  const hashAlgorithm = integrity.algorithm === 'git-sha1'
    ? 'sha1'
    : 'sha256'
  const hash = createHash(hashAlgorithm)
  if (integrity.algorithm.startsWith('git-')) {
    hash.update(`blob ${fileSize}\0`)
  }
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk)
  }
  const actual = hash.digest('hex')
  return {
    trusted: true,
    matches: actual === integrity.expected,
    algorithm: integrity.algorithm,
    expected: integrity.expected,
    actual,
  }
}

function removeIfExists(filePath: string) {
  if (existsSync(filePath)) unlinkSync(filePath)
}

type PartialMetadata = {
  identity: string
  etag: string
}

function readPartialMetadata(filePath: string): PartialMetadata | null {
  try {
    if (statSync(filePath).size > MAX_PARTIAL_METADATA_BYTES) return null
    const value = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    const etag = typeof record.etag === 'string' ? normalizeStrongEtag(record.etag) : null
    return typeof record.identity === 'string' && etag ? { identity: record.identity, etag } : null
  } catch {
    return null
  }
}

function writePartialMetadata(filePath: string, metadata: PartialMetadata) {
  writeFileSync(filePath, JSON.stringify(metadata), { encoding: 'utf8', mode: 0o600 })
}

function assertInsideDirectory(rootDir: string, targetPath: string) {
  const relativePath = relative(rootDir, targetPath)
  if (relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))) return
  throw new Error('拒绝写入下载目录之外的路径。')
}

function ensureSafeDirectoryTree(baseDir: string, targetDir: string) {
  const base = realpathSync.native(baseDir)
  if (!statSync(base).isDirectory()) throw new Error('批准的下载根不是文件夹。')
  const target = resolve(targetDir)
  assertInsideDirectory(resolve(baseDir), target)

  let current = base
  const nested = relative(resolve(baseDir), target)
  for (const segment of nested ? nested.split(sep) : []) {
    current = join(current, segment)
    if (existsSync(current)) {
      const entry = lstatSync(current)
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error('下载路径包含符号链接、重解析点或非目录节点。')
      }
    } else {
      mkdirSync(current, { mode: 0o700 })
    }
    assertInsideDirectory(base, realpathSync.native(current))
  }
  return realpathSync.native(current)
}

function assertSafeFileTarget(outputRoot: string, targetPath: string) {
  const safeParent = ensureSafeDirectoryTree(outputRoot, dirname(targetPath))
  assertInsideDirectory(outputRoot, safeParent)
  if (!existsSync(targetPath)) return
  const entry = lstatSync(targetPath)
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new Error('目标路径不是普通文件，已拒绝写入。')
  }
  assertInsideDirectory(outputRoot, realpathSync.native(targetPath))
}

function normalizeDownloadRequest(request: DownloadRequest): DownloadRequest {
  const outputDir = request.outputDir.trim()
  const concurrency = Number.isFinite(request.concurrency) ? Math.trunc(request.concurrency) : 1
  if (request.selectedPaths.length > MAX_SELECTED_FILES) {
    throw new Error(`单次最多选择 ${MAX_SELECTED_FILES} 个文件。`)
  }
  const selectedPaths = [...new Set(request.selectedPaths.map((path) => getSafeRelativePathSegments(path).join('/')))]
  const portablePaths = new Set<string>()
  for (const path of selectedPaths) {
    const key = path.normalize('NFC').toLocaleLowerCase('en-US')
    if (portablePaths.has(key)) throw new Error(`所选文件在大小写不敏感文件系统中会冲突：${path}`)
    portablePaths.add(key)
  }

  return {
    ...request,
    repoId: normalizeRepoId(request.repoId),
    endpoint: normalizeEndpoint(request.endpoint),
    token: normalizeTokenForEndpoint(request.endpoint, request.token),
    outputDir,
    concurrency: Math.max(1, Math.min(concurrency, 8)),
    selectedPaths,
  }
}

export function toDownloadRequestSummary(request: DownloadRequest): DownloadRequestSummary {
  const { token, ...safeRequest } = request
  return {
    ...safeRequest,
    selectedPaths: [...safeRequest.selectedPaths],
    authenticated: Boolean(token?.trim()),
  }
}

export class DownloadRunner {
  private readonly controller = new AbortController()
  private cancelled = false
  private readonly jobs: DownloadJobSnapshot[]
  private readonly logs: string[] = []
  private readonly request: DownloadRequest
  private readonly manifestByPath: Map<string, FileManifestItem>
  private readonly outputRoot: string
  private readonly partialsRoot: string
  private updateTimer: NodeJS.Timeout | null = null
  private lastUpdateAt = 0

  constructor(
    request: DownloadRequest,
    manifest: FileManifestItem[],
    private readonly callbacks: DownloadRunnerCallbacks,
    private readonly networkFetch: NetworkFetch = (input, init) => fetch(input, init),
  ) {
    this.request = normalizeDownloadRequest(request)
    this.manifestByPath = new Map()
    const requestedPaths = new Set(this.request.selectedPaths)
    for (const item of manifest) {
      const path = getSafeRelativePathSegments(item.path).join('/')
      if (!requestedPaths.has(path)) throw new Error(`下载清单包含未选择的文件：${path}`)
      if (this.manifestByPath.has(path)) throw new Error(`下载清单包含重复文件：${path}`)
      this.manifestByPath.set(path, {
        ...item,
        path,
        revision: normalizeCommitRevision(item.revision),
      })
    }
    if (this.manifestByPath.size !== requestedPaths.size) {
      throw new Error('下载清单与所选文件不一致，请重新加载清单。')
    }
    const requestedOutputRoot = resolveOutputRoot(this.request)
    this.outputRoot = ensureSafeDirectoryTree(resolve(this.request.outputDir), requestedOutputRoot)
    this.partialsRoot = ensureSafeDirectoryTree(this.outputRoot, join(this.outputRoot, PARTIALS_DIRECTORY))
    this.jobs = createJobSnapshots(this.request, [...this.manifestByPath.values()], this.outputRoot)
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
    this.emitUpdate(true)
  }

  async start() {
    const queue = [...this.jobs]
    const workerCount = Math.max(1, Math.min(this.request.concurrency, queue.length || 1))
    const workers = Array.from({ length: workerCount }, async () => {
      while (queue.length > 0 && !this.cancelled) {
        const job = queue.shift()
        if (!job) break
        await this.runJob(job)
      }
    })

    await Promise.all(workers)
    if (this.cancelled) {
      for (const job of this.jobs) {
        if (job.status === 'idle' || job.status === 'running') {
          job.status = 'cancelled'
          job.message = '已取消'
        }
      }
    }
    this.emitUpdate(true)

    const totalBytes = this.jobs.reduce((sum, job) => sum + job.downloadedBytes, 0)
    const hasError = this.jobs.some((job) => job.status === 'error')
    const status = this.cancelled ? 'cancelled' : hasError ? 'error' : 'success'
    this.callbacks.onDone(
      status,
      totalBytes,
      hasError ? this.jobs.find((job) => job.status === 'error')?.message ?? null : null,
    )
  }

  private async runJob(job: DownloadJobSnapshot) {
    try {
      await this.downloadJob(job)
    } catch (error) {
      if (this.cancelled) {
        job.status = 'cancelled'
        job.message = '已取消'
      } else {
        const message = error instanceof Error ? error.message : '下载失败'
        job.status = 'error'
        job.message = message
        this.logs.push(`下载失败 ${job.path}: ${message}`)
      }
      this.emitUpdate(true)
    }
  }

  private emitUpdate(force = false) {
    const elapsed = Date.now() - this.lastUpdateAt
    if (!force && elapsed < 120) {
      if (!this.updateTimer) {
        this.updateTimer = setTimeout(() => {
          this.updateTimer = null
          this.flushUpdate()
        }, 120 - elapsed)
      }
      return
    }

    if (this.updateTimer) {
      clearTimeout(this.updateTimer)
      this.updateTimer = null
    }
    this.flushUpdate()
  }

  private flushUpdate() {
    this.lastUpdateAt = Date.now()
    this.callbacks.onUpdate({
      queue: buildQueueSnapshot(this.jobs, this.request.concurrency),
      jobs: this.jobs.map((job) => ({ ...job })),
      logs: [...this.logs.slice(-200)],
      activeRequest: toDownloadRequestSummary(this.request),
    })
  }

  private async fetchWithRedirects(initialUrl: string, headers: Headers, controller: AbortController) {
    let currentUrl = new URL(initialUrl)
    const initialOrigin = currentUrl.origin
    const requestHeaders = new Headers(headers)
    const allowLoopback = currentUrl.hostname === 'localhost' || currentUrl.hostname === '127.0.0.1' || currentUrl.hostname === '[::1]'

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      await assertSafeNetworkUrl(currentUrl, allowLoopback)
      const timeout = setTimeout(() => controller.abort(new Error('连接响应超时。')), RESPONSE_HEADER_TIMEOUT_MS)
      let response: Response
      try {
        response = await this.networkFetch(currentUrl.toString(), {
          headers: requestHeaders,
          signal: controller.signal,
          redirect: 'manual',
        })
      } finally {
        clearTimeout(timeout)
      }

      if (!REDIRECT_STATUSES.has(response.status)) return response
      if (redirectCount === MAX_REDIRECTS) throw new Error('下载重定向次数过多。')
      const location = response.headers.get('location')
      if (!location) throw new Error('下载重定向缺少目标地址。')
      const nextUrl = new URL(location, currentUrl)
      await assertSafeNetworkUrl(nextUrl, allowLoopback)
      if (nextUrl.origin !== initialOrigin) requestHeaders.delete('Authorization')
      await response.body?.cancel()
      currentUrl = nextUrl
    }

    throw new Error('下载重定向失败。')
  }

  private async downloadJob(job: DownloadJobSnapshot) {
    if (this.cancelled) return

    job.status = 'running'
    job.message = '准备下载'
    this.logs.push('开始下载 ' + job.path)
    this.emitUpdate(true)

    const manifestItem = this.manifestByPath.get(job.path)
    if (!manifestItem) throw new Error('下载文件缺少固定 revision 清单。')

    assertSafeFileTarget(this.outputRoot, job.outputPath)
    if (existsSync(job.outputPath)) {
      const integrity = await verifyFileIntegrity(job.outputPath, manifestItem)
      if (integrity.trusted && integrity.matches) {
        const existingOutputSize = statSync(job.outputPath).size
        job.status = 'success'
        job.downloadedBytes = existingOutputSize
        job.percent = 100
        job.message = '文件已存在，可信哈希校验通过'
        this.logs.push('可信哈希校验通过，跳过已完成文件 ' + job.path)
        this.emitUpdate(true)
        return
      }
      if (!integrity.trusted) {
        throw new Error('目标文件已存在，但清单没有可信内容哈希，已拒绝跳过或覆盖。')
      }
      throw new Error('目标文件已存在，但可信内容哈希不匹配，已拒绝覆盖。')
    }

    const identity = buildDownloadIdentity(this.request.endpoint, this.request.repoId, manifestItem.revision, job.path)
    const partialName = buildPartialFileName(this.request.endpoint, this.request.repoId, manifestItem.revision, job.path)
    const tempPath = join(this.partialsRoot, partialName)
    const partialMetadataPath = tempPath + '.json'
    assertSafeFileTarget(this.partialsRoot, tempPath)
    assertSafeFileTarget(this.partialsRoot, partialMetadataPath)

    let existingSize = existsSync(tempPath) ? statSync(tempPath).size : 0
    const partialMetadata = existsSync(partialMetadataPath) ? readPartialMetadata(partialMetadataPath) : null
    if (existingSize > 0 && (!partialMetadata || partialMetadata.identity !== identity)) {
      removeIfExists(tempPath)
      removeIfExists(partialMetadataPath)
      existingSize = 0
      this.logs.push('旧分片缺少匹配的强 ETag 身份，已从头下载 ' + job.path)
    } else if (existingSize === 0) {
      removeIfExists(partialMetadataPath)
    }

    const url = buildDownloadUrl(this.request.endpoint, this.request.repoId, manifestItem.revision, job.path)
    const headers = new Headers()
    headers.set('Accept-Encoding', 'identity')
    if (this.request.token?.trim()) {
      headers.set('Authorization', 'Bearer ' + this.request.token.trim())
    }
    if (existingSize > 0) {
      headers.set('Range', 'bytes=' + String(existingSize) + '-')
      headers.set('If-Range', partialMetadata!.etag)
    }

    const startedAt = Date.now()
    const jobController = new AbortController()
    const abortJob = () => jobController.abort(this.controller.signal.reason)
    this.controller.signal.addEventListener('abort', abortJob, { once: true })
    if (this.controller.signal.aborted) abortJob()
    let stream: ReturnType<typeof createWriteStream> | null = null
    let streamFailure: Promise<never> | null = null

    try {
      const response = await this.fetchWithRedirects(url, headers, jobController)

      if (!response.ok && response.status !== 206) {
        throw new Error('HTTP ' + String(response.status))
      }

      if (response.status === 206 && existingSize === 0) {
        throw new Error('服务器在未请求续传时返回了分段响应。')
      }

      const contentLengthHeader = response.headers.get('content-length')
      const contentLength = contentLengthHeader === null ? null : Number.parseInt(contentLengthHeader, 10)
      if (contentLength !== null && (!Number.isSafeInteger(contentLength) || contentLength < 0)) {
        throw new Error('下载响应的 Content-Length 不合法。')
      }
      const appendMode = existingSize > 0 && response.status === 206
      if (appendMode) {
        const contentRange = response.headers.get('content-range')
        const match = contentRange?.match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/i)
        if (!match || Number(match[1]) !== existingSize) {
          throw new Error('续传响应的 Content-Range 与本地分片不一致。')
        }
        const rangeEnd = Number(match[2])
        const rangeTotal = match[3] === '*' ? null : Number(match[3])
        if (!Number.isSafeInteger(rangeEnd) || rangeEnd < existingSize || rangeTotal === null || !Number.isSafeInteger(rangeTotal)) {
          throw new Error('续传响应缺少可信的完整文件范围。')
        }
        if (contentLength !== null && contentLength !== rangeEnd - existingSize + 1) {
          throw new Error('续传响应的 Content-Length 与 Content-Range 不一致。')
        }
        if (manifestItem.size !== null && rangeTotal !== manifestItem.size) {
          throw new Error('续传响应的文件总大小与固定清单不一致。')
        }
        const responseEtag = normalizeStrongEtag(response.headers.get('etag'))
        if (!responseEtag || responseEtag !== partialMetadata?.etag) {
          throw new Error('续传响应的强 ETag 与本地分片身份不一致。')
        }
      }
      const responseEtag = normalizeStrongEtag(response.headers.get('etag'))
      if (responseEtag) {
        writePartialMetadata(partialMetadataPath, { identity, etag: responseEtag })
      } else {
        removeIfExists(partialMetadataPath)
      }
      const baseDownloaded = appendMode ? existingSize : 0
      const resolvedTotal = contentLength !== null
        ? contentLength + baseDownloaded
        : job.totalBytes
      if (manifestItem.size !== null && resolvedTotal !== null && resolvedTotal !== manifestItem.size) {
        throw new Error('下载响应大小与固定清单不一致。')
      }
      job.totalBytes = manifestItem.size ?? resolvedTotal
      job.downloadedBytes = baseDownloaded

      const reader = response.body?.getReader()
      if (!reader) throw new Error('响应体为空: ' + job.path)
      stream = createWriteStream(tempPath, { flags: appendMode ? 'a' : 'w', mode: 0o600 })
      const activeStream = stream
      streamFailure = new Promise<never>((_resolve, reject) => {
        activeStream.once('error', (error) => {
          jobController.abort(error)
          reject(error)
        })
      })

      while (!this.cancelled) {
        let stallTimer: NodeJS.Timeout | null = null
        const stalled = new Promise<never>((_resolve, reject) => {
          stallTimer = setTimeout(() => {
            const error = new Error('下载数据等待超时。')
            jobController.abort(error)
            reject(error)
          }, STREAM_STALL_TIMEOUT_MS)
        })
        let result: Awaited<ReturnType<typeof reader.read>>
        try {
          result = await Promise.race([reader.read(), stalled, streamFailure])
        } finally {
          if (stallTimer) clearTimeout(stallTimer)
        }
        const { value, done } = result
        if (done) break
        if (!value) continue
        if (manifestItem.size !== null && job.downloadedBytes + value.length > manifestItem.size) {
          const error = new Error('下载数据超过固定清单大小，已中止写入。')
          jobController.abort(error)
          throw error
        }
        if (!activeStream.write(Buffer.from(value))) {
          await Promise.race([once(activeStream, 'drain'), streamFailure])
        }
        job.downloadedBytes += value.length
        const elapsedSeconds = Math.max(1, (Date.now() - startedAt) / 1000)
        job.speedBytesPerSecond = Math.round((job.downloadedBytes - baseDownloaded) / elapsedSeconds)
        job.percent = job.totalBytes ? Number(((job.downloadedBytes / job.totalBytes) * 100).toFixed(1)) : null
        job.message = '下载中'
        this.emitUpdate()
      }

      activeStream.end()
      await Promise.race([once(activeStream, 'finish'), streamFailure])
      stream = null

      if (this.cancelled) {
        job.status = 'cancelled'
        job.message = '已取消'
        this.emitUpdate(true)
        return
      }

      const finalSize = statSync(tempPath).size
      if (job.totalBytes !== null && finalSize !== job.totalBytes) {
        throw new Error(`下载长度校验失败：预期 ${job.totalBytes}，实际 ${finalSize}。`)
      }
      const integrity = await verifyFileIntegrity(tempPath, manifestItem)
      if (integrity.trusted && !integrity.matches) {
        removeIfExists(tempPath)
        removeIfExists(partialMetadataPath)
        throw new Error(`下载内容哈希校验失败（${integrity.algorithm ?? 'unknown'}），已删除不可信分片。`)
      }
      assertSafeFileTarget(this.outputRoot, job.outputPath)
      if (existsSync(job.outputPath)) throw new Error('目标文件在下载期间被创建，已拒绝覆盖。')
      await rename(tempPath, job.outputPath)
      removeIfExists(partialMetadataPath)
      job.status = 'success'
      job.percent = 100
      job.message = integrity.trusted ? '下载完成，内容哈希校验通过' : '下载完成，revision 已固定'
      this.logs.push((integrity.trusted ? '哈希校验通过，完成 ' : '固定 revision 下载完成 ') + job.path)
      this.emitUpdate(true)
    } finally {
      this.controller.signal.removeEventListener('abort', abortJob)
      stream?.destroy()
    }
  }
}
