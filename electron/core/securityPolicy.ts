import { existsSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { getSafeRelativePathSegments, normalizeEndpoint, normalizeRepoId, normalizeTokenForEndpoint as enforceOfficialTokenEndpoint } from './hfApi.js'
import { sanitizeNetworkConfig } from './networkPolicy.js'
import type { DownloadRequest, HistoryEntry, Preferences } from './types.js'

export const MAX_SELECTED_FILES = 10_000
export const MAX_HISTORY_ENTRIES = 300
export const HUGGING_FACE_MODELS_URL = 'https://huggingface.co/models'
const PACKAGED_ENDPOINTS = new Set(['https://huggingface.co', 'https://hf-mirror.com'])

const MAX_TOKEN_LENGTH = 4_096
const MAX_PATH_LENGTH = 4_096
const MAX_ENDPOINT_LENGTH = 2_048
const SESSION_ID_PATTERN = /^session-(?:\d{10,16}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i
const DOWNLOAD_STATUSES = new Set(['idle', 'running', 'success', 'error', 'cancelled'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readBoundedString(value: unknown, label: string, maxLength: number) {
  if (typeof value !== 'string' || value.length > maxLength || value.includes('\0')) {
    throw new Error(`${label} 不合法。`)
  }
  return value
}

export function normalizeAbsolutePath(value: unknown, label = '路径') {
  const raw = readBoundedString(value, label, MAX_PATH_LENGTH).trim()
  if (!raw || !isAbsolute(raw)) {
    throw new Error(`${label}必须是绝对路径。`)
  }
  return resolve(raw)
}

function canonicalizeExistingAncestor(targetPath: string) {
  const target = resolve(targetPath)
  let ancestor = target
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor)
    if (parent === ancestor) break
    ancestor = parent
  }

  if (!existsSync(ancestor)) return target
  const canonicalAncestor = realpathSync.native(ancestor)
  return resolve(canonicalAncestor, relative(ancestor, target))
}

function pathIsInside(rootPath: string, targetPath: string) {
  const relativePath = relative(rootPath, targetPath)
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

export function normalizeApprovedRoot(value: unknown) {
  const absolutePath = normalizeAbsolutePath(value, '下载目录')
  if (!existsSync(absolutePath) || !statSync(absolutePath).isDirectory()) {
    throw new Error('下载目录不存在或不是文件夹。')
  }
  return realpathSync.native(absolutePath)
}

export function resolveApprovedPath(value: unknown, approvedRoots: readonly string[]) {
  const absolutePath = normalizeAbsolutePath(value)
  const canonicalTarget = canonicalizeExistingAncestor(absolutePath)
  for (const root of approvedRoots) {
    const canonicalRoot = canonicalizeExistingAncestor(normalizeAbsolutePath(root, '批准目录'))
    if (pathIsInside(canonicalRoot, canonicalTarget)) return canonicalTarget
  }
  throw new Error('该路径不在用户批准的下载目录中。')
}

export function normalizeAllowedExternalUrl(value: unknown) {
  const raw = readBoundedString(value, '外部链接', MAX_ENDPOINT_LENGTH)
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('外部链接不合法。')
  }
  if (parsed.username || parsed.password || parsed.toString() !== HUGGING_FACE_MODELS_URL) {
    throw new Error('只允许打开 Hugging Face Models 官方页面。')
  }
  return HUGGING_FACE_MODELS_URL
}

export function normalizeRuntimeEndpoint(value: unknown, allowLocalDevelopment: boolean) {
  const raw = readBoundedString(value, 'Endpoint', MAX_ENDPOINT_LENGTH)
  const normalized = normalizeEndpoint(raw)
  const hostname = new URL(normalized).hostname
  const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  if (isLoopback && !allowLocalDevelopment) {
    throw new Error('正式版不允许访问本机 Endpoint。')
  }
  if (!allowLocalDevelopment && !PACKAGED_ENDPOINTS.has(normalized)) {
    throw new Error('正式版只允许 Hugging Face 官方源和内置 HF Mirror；自定义 Endpoint 仅在开发模式开放。')
  }
  return normalized
}

export function normalizeToken(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const token = readBoundedString(value, 'Token', MAX_TOKEN_LENGTH).trim()
  return token || null
}

export function normalizeTokenForEndpoint(endpoint: string, value: unknown) {
  const token = normalizeToken(value)
  return enforceOfficialTokenEndpoint(endpoint, token)
}

function normalizeSelectedPaths(value: unknown, allowEmpty = false) {
  if (!Array.isArray(value) || value.length > MAX_SELECTED_FILES) {
    throw new Error(`单次最多选择 ${MAX_SELECTED_FILES} 个文件。`)
  }

  const paths: string[] = []
  const exactKeys = new Set<string>()
  const portableKeys = new Set<string>()
  for (const item of value) {
    const path = getSafeRelativePathSegments(readBoundedString(item, '文件路径', MAX_PATH_LENGTH)).join('/')
    if (exactKeys.has(path)) continue
    const portableKey = path.normalize('NFC').toLocaleLowerCase('en-US')
    if (portableKeys.has(portableKey)) {
      throw new Error(`所选文件在大小写不敏感文件系统中会冲突：${path}`)
    }
    exactKeys.add(path)
    portableKeys.add(portableKey)
    paths.push(path)
  }

  if (!allowEmpty && paths.length === 0) throw new Error('至少选择一个文件。')
  return paths
}

export function normalizeDownloadRequestInput(value: unknown, allowLocalDevelopment: boolean): DownloadRequest {
  if (!isRecord(value)) throw new Error('下载请求不合法。')
  const endpoint = normalizeRuntimeEndpoint(value.endpoint, allowLocalDevelopment)
  const concurrency = Number(value.concurrency)
  return {
    repoId: normalizeRepoId(readBoundedString(value.repoId, '仓库名', 256)),
    outputDir: normalizeAbsolutePath(value.outputDir, '下载目录'),
    endpoint,
    token: normalizeTokenForEndpoint(endpoint, value.token),
    selectedPaths: normalizeSelectedPaths(value.selectedPaths),
    concurrency: Number.isFinite(concurrency) ? Math.max(1, Math.min(Math.trunc(concurrency), 8)) : 1,
    createRepoFolder: value.createRepoFolder !== false,
  }
}

export function sanitizePreferences(value: unknown, fallback: Preferences): Preferences {
  if (!isRecord(value)) return fallback

  let endpoint = fallback.endpoint
  try {
    endpoint = normalizeEndpoint(readBoundedString(value.endpoint, 'Endpoint', MAX_ENDPOINT_LENGTH))
  } catch {
    // Preferences are written while the user is typing; keep the last valid endpoint.
  }

  let outputDir = fallback.outputDir
  try {
    outputDir = normalizeAbsolutePath(value.outputDir, '下载目录')
  } catch {
    // Keep the last valid, approved path.
  }

  const concurrency = Number(value.concurrency)
  const repoId = typeof value.repoId === 'string' && value.repoId.length <= 256 && !value.repoId.includes('\0')
    ? value.repoId
    : fallback.repoId
  const networkConfig = sanitizeNetworkConfig({
    mode: value.networkMode,
    proxyUrl: value.proxyUrl,
  }, {
    mode: fallback.networkMode,
    proxyUrl: fallback.proxyUrl,
  })

  return {
    repoId,
    endpoint,
    outputDir,
    concurrency: Number.isFinite(concurrency) ? Math.max(1, Math.min(Math.trunc(concurrency), 8)) : fallback.concurrency,
    createRepoFolder: typeof value.createRepoFolder === 'boolean' ? value.createRepoFolder : fallback.createRepoFolder,
    networkMode: networkConfig.mode,
    proxyUrl: networkConfig.proxyUrl,
  }
}

export function isValidSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value)
}

function normalizeHistoryEntry(value: unknown): HistoryEntry | null {
  if (!isRecord(value) || !isValidSessionId(value.sessionId)) return null
  try {
    const status = typeof value.status === 'string' && DOWNLOAD_STATUSES.has(value.status) ? value.status : null
    const startedAt = readBoundedString(value.startedAt, '开始时间', 64)
    const finishedAt = value.finishedAt === null ? null : readBoundedString(value.finishedAt, '结束时间', 64)
    const downloadedBytes = Number(value.downloadedBytes)
    const totalBytes = Number(value.totalBytes)
    if (!status || !Number.isFinite(Date.parse(startedAt)) || (finishedAt && !Number.isFinite(Date.parse(finishedAt)))) return null
    if (!Number.isFinite(downloadedBytes) || downloadedBytes < 0 || !Number.isFinite(totalBytes) || totalBytes < 0) return null

    return {
      sessionId: value.sessionId,
      repoId: normalizeRepoId(readBoundedString(value.repoId, '仓库名', 256)),
      endpoint: normalizeEndpoint(readBoundedString(value.endpoint, 'Endpoint', MAX_ENDPOINT_LENGTH)),
      outputDir: normalizeAbsolutePath(value.outputDir, '下载目录'),
      selectedPaths: normalizeSelectedPaths(value.selectedPaths, true),
      startedAt,
      finishedAt,
      status: status as HistoryEntry['status'],
      downloadedBytes,
      totalBytes,
      errorMessage: value.errorMessage === null
        ? null
        : readBoundedString(value.errorMessage, '错误信息', 2_000),
      createRepoFolder: typeof value.createRepoFolder === 'boolean' ? value.createRepoFolder : null,
      presentCount: Number.isSafeInteger(Number(value.presentCount)) && Number(value.presentCount) >= 0
        ? Number(value.presentCount)
        : 0,
      missingCount: Number.isSafeInteger(Number(value.missingCount)) && Number(value.missingCount) >= 0
        ? Number(value.missingCount)
        : 0,
      syncStatus: value.syncStatus === 'available' || value.syncStatus === 'partial'
        ? value.syncStatus
        : 'unchecked',
    }
  } catch {
    return null
  }
}

export function sanitizeHistoryEntries(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_HISTORY_ENTRIES).flatMap((entry) => {
    const normalized = normalizeHistoryEntry(entry)
    return normalized ? [normalized] : []
  })
}
