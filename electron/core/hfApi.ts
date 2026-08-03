import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { EndpointTestResult, FileManifestItem } from './types.js'

const OFFICIAL_ENDPOINT = 'https://huggingface.co'
const REQUEST_TIMEOUT_MS = 8000
const MAX_API_RESPONSE_BYTES = 8 * 1024 * 1024
const MAX_ERROR_DETAIL_CHARS = 2_048
const MAX_MANIFEST_FILES = 10_000
const MAX_TREE_PAGES = 200
const REPO_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/
const COMMIT_REVISION_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i
const SHA256_PATTERN = /^[a-f0-9]{64}$/i
const GIT_OBJECT_ID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i
const LOCAL_HTTP_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const PORTABLE_INVALID_CHARACTERS = '<>:"|?*'
const WINDOWS_RESERVED_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const RESERVED_PARTIALS_DIRECTORY = '.hf-model-downloader-partials'

export type NetworkFetch = (input: string, init?: RequestInit) => Promise<Response>

const defaultNetworkFetch: NetworkFetch = (input, init) => fetch(input, init)

function trimSlash(value: string) {
  return value.trim().replace(/\/+$/, '')
}

export function normalizeEndpoint(value: string) {
  const raw = trimSlash(value) || OFFICIAL_ENDPOINT
  let parsed: URL

  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('Endpoint 必须是有效的 http(s) 地址。')
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Endpoint 只允许使用 http 或 https。')
  }

  if (parsed.username || parsed.password) {
    throw new Error('Endpoint 不能包含用户名或密码。')
  }

  if (parsed.protocol === 'http:' && !LOCAL_HTTP_HOSTS.has(parsed.hostname)) {
    throw new Error('远程 Endpoint 必须使用 https；http 只允许本机开发地址。')
  }

  parsed.hash = ''
  parsed.search = ''
  parsed.pathname = trimSlash(parsed.pathname)
  return parsed.toString().replace(/\/+$/, '')
}

export function normalizeTokenForEndpoint(endpoint: string, token: string | null) {
  const normalizedToken = token?.trim() || null
  if (normalizedToken && normalizeEndpoint(endpoint) !== OFFICIAL_ENDPOINT) {
    throw new Error('为防止凭证泄露，Token 只允许发送到 Hugging Face 官方源。')
  }
  return normalizedToken
}

export function normalizeRepoId(value: string) {
  const parts = value.trim().split('/')
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    throw new Error('仓库名格式不对，应该像 `owner/repo`。')
  }

  for (const part of parts) {
    if (part === '.' || part === '..' || !REPO_SEGMENT_PATTERN.test(part)) {
      throw new Error('仓库名只能包含字母、数字、点、下划线和短横线。')
    }
  }

  return parts.join('/')
}

export function normalizeCommitRevision(value: unknown) {
  if (typeof value !== 'string' || !COMMIT_REVISION_PATTERN.test(value.trim())) {
    throw new Error('仓库元数据未提供可信的 commit SHA，已拒绝使用可变 revision。')
  }
  return value.trim().toLocaleLowerCase('en-US')
}

export function getSafeRelativePathSegments(filePath: string) {
  if (!filePath.trim() || filePath.length > 4_096 || filePath.includes('\0') || filePath.includes('\\')) {
    throw new Error('文件路径不合法。')
  }

  const segments = filePath.split('/')
  if (segments.some((segment) => (
    !segment
    || segment.length > 255
    || segment === '.'
    || segment === '..'
    || segment.endsWith('.')
    || segment.endsWith(' ')
    || [...segment].some((character) => character.charCodeAt(0) <= 31 || PORTABLE_INVALID_CHARACTERS.includes(character))
    || WINDOWS_RESERVED_NAMES.test(segment)
  ))) {
    throw new Error('文件路径不能包含空段或上级目录。')
  }

  if (segments[0]?.toLocaleLowerCase('en-US') === RESERVED_PARTIALS_DIRECTORY) {
    throw new Error('文件路径与下载器的临时目录冲突。')
  }

  return segments
}

function isLoopbackHostname(hostname: string) {
  return LOCAL_HTTP_HOSTS.has(hostname.toLocaleLowerCase('en-US'))
}

function extractMappedIpv4(address: string) {
  const normalized = address.toLocaleLowerCase('en-US')
  if (!normalized.startsWith('::ffff:')) return null
  const suffix = normalized.slice('::ffff:'.length)
  if (isIP(suffix) === 4) return suffix
  const groups = suffix.split(':')
  if (groups.length !== 2 || groups.some((group) => !/^[a-f0-9]{1,4}$/.test(group))) return null
  const high = Number.parseInt(groups[0], 16)
  const low = Number.parseInt(groups[1], 16)
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')
}

export function isPrivateOrLocalAddress(address: string) {
  const mappedIpv4 = extractMappedIpv4(address)
  if (mappedIpv4) return isPrivateOrLocalAddress(mappedIpv4)

  if (isIP(address) === 4) {
    const octets = address.split('.').map(Number)
    const [first = -1, second = -1, third = -1] = octets
    return first === 0
      || first === 10
      || first === 127
      || (first === 100 && second >= 64 && second <= 127)
      || (first === 169 && second === 254)
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 0)
      || (first === 192 && second === 168)
      || (first === 198 && (second === 18 || second === 19))
      || (first === 198 && second === 51 && third === 100)
      || (first === 203 && second === 0 && third === 113)
      || (first >= 224)
  }

  if (isIP(address) === 6) {
    const normalized = address.toLocaleLowerCase('en-US')
    return normalized === '::'
      || normalized === '::1'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || /^fe[89ab]/.test(normalized)
      || normalized.startsWith('ff')
      || normalized.startsWith('2001:db8:')
  }

  return true
}

export function isAllowedResolvedAddress(address: string) {
  if (!isPrivateOrLocalAddress(address)) return true
  if (isIP(address) !== 4) return false
  const [first, second] = address.split('.').map(Number)
  // Clash and similar local proxies use RFC 2544 as synthetic DNS space.
  // Direct literal access remains blocked by assertSafeNetworkUrl above.
  return first === 198 && (second === 18 || second === 19)
}

export async function assertSafeNetworkUrl(value: string | URL, allowLoopback = false) {
  const target = value instanceof URL ? value : new URL(value)
  if (target.username || target.password) throw new Error('网络地址不能包含用户名或密码。')
  if (target.protocol !== 'https:' && !(target.protocol === 'http:' && allowLoopback && isLoopbackHostname(target.hostname))) {
    throw new Error('网络请求必须使用 https。')
  }

  if (isLoopbackHostname(target.hostname)) {
    if (!allowLoopback) throw new Error('网络请求不能访问本机地址。')
    return
  }

  const literalHostname = target.hostname.replace(/^\[|\]$/g, '')
  if (isIP(literalHostname)) {
    if (isPrivateOrLocalAddress(literalHostname)) throw new Error('网络请求不能访问私网或保留地址。')
    return
  }

  const addresses = await lookup(target.hostname, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some(({ address }) => !isAllowedResolvedAddress(address))) {
    throw new Error('Endpoint 解析到了私网或保留地址，已拒绝访问。')
  }
}

function normalizeManifestPath(filePath: string) {
  return getSafeRelativePathSegments(filePath).join('/')
}

type EndpointProbe = {
  url: string
  successMessage: string
  failureMessage?: string
  failClosed?: boolean
}

export function getEndpointProbePlan(endpoint: string, hasToken: boolean) {
  const normalized = normalizeEndpoint(endpoint)
  const probes: EndpointProbe[] = []

  if (normalized === OFFICIAL_ENDPOINT && hasToken) {
    probes.push({
      url: `${normalized}/api/whoami-v2`,
      successMessage: 'Token 有效 官方源可访问',
      failureMessage: 'Token 无效或当前网络无法访问官方鉴权接口',
      failClosed: true,
    })
  }

  probes.push({
    url: normalized === OFFICIAL_ENDPOINT
      ? `${normalized}/api/models/openai-community/gpt2`
      : `${normalized}/api/models?limit=1`,
    successMessage: normalized === OFFICIAL_ENDPOINT ? '官方源可访问' : 'Endpoint 可访问',
  })

  probes.push({
    url: `${normalized}/robots.txt`,
    successMessage: '基础连通性正常',
  })

  return probes
}

function encodeRepoId(repoId: string) {
  return normalizeRepoId(repoId)
    .split('/')
    .map((segment) => encodeURIComponent(segment.trim()))
    .join('/')
}

function buildHeaders(token: string | null) {
  const headers = new Headers()
  headers.set('Accept', 'application/json')
  if (token?.trim()) {
    headers.set('Authorization', `Bearer ${token.trim()}`)
  }
  return headers
}

type ResponseSnapshot = {
  ok: boolean
  status: number
  statusText: string
  body: string
  linkHeader: string | null
}

function truncateErrorDetail(value: string) {
  const normalized = value.trim()
  return normalized.length <= MAX_ERROR_DETAIL_CHARS
    ? normalized
    : `${normalized.slice(0, MAX_ERROR_DETAIL_CHARS)}…`
}

export function readErrorMessage(body: string) {
  if (!body.trim()) return ''
  try {
    const payload = JSON.parse(body) as { error?: string; message?: string }
    return truncateErrorDetail(payload.error || payload.message || body)
  } catch {
    return truncateErrorDetail(body)
  }
}

async function readBoundedResponseBody(response: Response) {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let receivedBytes = 0

  while (true) {
    const result = await reader.read()
    if (result.done) break
    receivedBytes += result.value.byteLength
    if (receivedBytes > MAX_API_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new Error('Endpoint 响应过大，已中止读取。')
    }
    chunks.push(result.value)
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
}

async function requestSnapshot(url: string, headers: Headers, networkFetch: NetworkFetch): Promise<ResponseSnapshot> {
  const target = new URL(url)
  await assertSafeNetworkUrl(target, isLoopbackHostname(target.hostname))
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort(new Error(`网络请求超过 ${REQUEST_TIMEOUT_MS / 1000} 秒，已停止等待。`))
  }, REQUEST_TIMEOUT_MS)

  try {
    const response = await networkFetch(target.toString(), {
      method: 'GET',
      headers,
      signal: controller.signal,
      redirect: 'manual',
    })
    const body = await readBoundedResponseBody(response)
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body,
      linkHeader: response.headers.get('link'),
    }
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason instanceof Error) throw controller.signal.reason
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function classifyFamily(path: string) {
  const lower = path.toLowerCase()
  if (lower.endsWith('.safetensors') || lower.endsWith('.bin') || lower.endsWith('.pt') || lower.endsWith('.pth')) return 'weights'
  if (lower.endsWith('.json') || lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'config'
  if (lower.endsWith('.md') || lower.endsWith('.txt') || lower.endsWith('.rst')) return 'docs'
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp')) return 'media'
  if (lower.includes('tokenizer') || lower.endsWith('.model') || lower.endsWith('.vocab') || lower.endsWith('.merges')) return 'tokenizer'
  return 'other'
}

function classifyCategory(path: string) {
  const lower = path.toLowerCase()
  if (lower.includes('lora')) return 'LoRA'
  if (lower.includes('controlnet')) return 'ControlNet'
  if (lower.includes('vae')) return 'VAE'
  if (lower.includes('tokenizer') || lower.includes('clip')) return '文本编码'
  if (lower.includes('video') || lower.includes('text-to-video') || lower.includes('i2v')) return '文生视频'
  if (lower.includes('image') || lower.includes('diffusion') || lower.includes('unet')) return '文生图'
  return '其他'
}

export function buildDownloadUrl(endpoint: string, repoId: string, revision: string, filePath: string) {
  const normalized = normalizeEndpoint(endpoint)
  const normalizedRevision = normalizeCommitRevision(revision)
  const encodedPath = getSafeRelativePathSegments(filePath).map((segment) => encodeURIComponent(segment)).join('/')
  return `${normalized}/${encodeRepoId(repoId)}/resolve/${encodeURIComponent(normalizedRevision)}/${encodedPath}?download=1`
}

function buildApiErrorMessage(prefix: string, status: number, detail?: string) {
  const suffix = detail ? ` · ${detail}` : ''
  return `${prefix}：HTTP ${status}${suffix}`
}

function normalizeSha256(value: unknown) {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().replace(/^sha256:/i, '').toLocaleLowerCase('en-US')
  return SHA256_PATTERN.test(normalized) ? normalized : undefined
}

function normalizeGitObjectId(value: unknown) {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLocaleLowerCase('en-US')
  return GIT_OBJECT_ID_PATTERN.test(normalized) ? normalized : undefined
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function extractIntegrity(entry: Record<string, unknown>) {
  const lfs = readRecord(entry.lfs)
  const lfsSha256 = normalizeSha256(lfs?.sha256) ?? normalizeSha256(lfs?.oid)
  const gitBlobOid = lfsSha256
    ? undefined
    : normalizeGitObjectId(entry.oid) ?? normalizeGitObjectId(entry.blobId) ?? normalizeGitObjectId(entry.blob_id)

  return { lfsSha256, gitBlobOid }
}

export function toManifestItems(payload: Array<Record<string, unknown>>, revision: string, pathKey = 'path') {
  const normalizedRevision = normalizeCommitRevision(revision)
  return payload
    .flatMap((entry) => {
      const rawPath = typeof entry[pathKey] === 'string' ? entry[pathKey] as string : ''
      let path = ''
      try {
        path = normalizeManifestPath(rawPath)
      } catch {
        return []
      }

      const type = entry.type === 'directory' ? 'directory' : 'file'
      const size = typeof entry.size === 'number' && Number.isSafeInteger(entry.size) && entry.size >= 0 ? entry.size : null
      const { lfsSha256, gitBlobOid } = extractIntegrity(entry)
      return [{
        path,
        size,
        type,
        category: classifyCategory(path),
        family: classifyFamily(path),
        revision: normalizedRevision,
        ...(lfsSha256 ? { lfsSha256 } : {}),
        ...(gitBlobOid ? { gitBlobOid } : {}),
      } satisfies FileManifestItem]
    })
    .filter((entry) => entry.path && entry.type === 'file')
}

export function getNextTreePageUrl(linkHeader: string | null, currentUrl: string) {
  if (!linkHeader) return null
  const nextEntry = linkHeader
    .split(',')
    .map((entry) => entry.trim())
    .find((entry) => /;\s*rel=(?:"next"|next)(?:\s*;|$)/i.test(entry))
  if (!nextEntry) return null
  const match = nextEntry.match(/^<([^>]+)>/)
  if (!match?.[1]) throw new Error('文件清单分页链接格式不正确。')

  const current = new URL(currentUrl)
  const next = new URL(match[1], current)
  if (next.origin !== current.origin || next.username || next.password) {
    throw new Error('文件清单分页链接试图跳转到其他来源。')
  }
  return next.toString()
}

async function listTreeFiles(endpoint: string, repoId: string, revision: string, token: string | null, networkFetch: NetworkFetch) {
  const normalizedRevision = normalizeCommitRevision(revision)
  let nextUrl: string | null = `${normalizeEndpoint(endpoint)}/api/models/${encodeRepoId(repoId)}/tree/${encodeURIComponent(normalizedRevision)}?recursive=1&expand=1`
  const seenUrls = new Set<string>()
  const rows: FileManifestItem[] = []

  for (let page = 0; nextUrl && page < MAX_TREE_PAGES; page += 1) {
    if (seenUrls.has(nextUrl)) throw new Error('文件清单分页链接出现循环。')
    seenUrls.add(nextUrl)
    const response = await requestSnapshot(nextUrl, buildHeaders(token), networkFetch)
    if (!response.ok) {
      const detail = readErrorMessage(response.body)
      throw new Error(buildApiErrorMessage('无法读取文件清单', response.status, detail))
    }

    const payload = JSON.parse(response.body) as unknown
    if (!Array.isArray(payload)) throw new Error('文件清单响应格式不正确。')
    rows.push(...toManifestItems(
      payload.filter((entry): entry is Record<string, unknown> => readRecord(entry) !== null),
      normalizedRevision,
    ))
    if (rows.length > MAX_MANIFEST_FILES) throw new Error(`仓库文件超过 ${MAX_MANIFEST_FILES} 项安全上限。`)
    nextUrl = getNextTreePageUrl(response.linkHeader, nextUrl)
  }

  if (nextUrl) throw new Error('文件清单分页超过安全上限。')
  return rows
}

type ModelMetadata = {
  revision: string
  siblings: Array<Record<string, unknown>>
}

async function getModelMetadata(endpoint: string, repoId: string, token: string | null, networkFetch: NetworkFetch): Promise<ModelMetadata> {
  const metadataUrl = `${normalizeEndpoint(endpoint)}/api/models/${encodeRepoId(repoId)}?blobs=true`
  const response = await requestSnapshot(metadataUrl, buildHeaders(token), networkFetch)
  if (!response.ok) {
    const detail = readErrorMessage(response.body)
    throw new Error(buildApiErrorMessage('无法读取仓库元数据', response.status, detail))
  }

  const payload = readRecord(JSON.parse(response.body))
  if (!payload) throw new Error('仓库元数据响应格式不正确。')
  const revision = normalizeCommitRevision(payload.sha)
  const siblings = Array.isArray(payload.siblings)
    ? payload.siblings.flatMap((entry) => {
      const record = readRecord(entry)
      return record ? [record] : []
    })
    : []
  return { revision, siblings }
}

export async function testEndpoint(
  endpoint: string,
  token: string | null,
  networkFetch: NetworkFetch = defaultNetworkFetch,
): Promise<EndpointTestResult> {
  const start = Date.now()
  let lastFailure = '连接失败'

  try {
    const safeToken = normalizeTokenForEndpoint(endpoint, token)
    for (const probe of getEndpointProbePlan(endpoint, Boolean(safeToken))) {
      try {
        const response = await requestSnapshot(probe.url, buildHeaders(safeToken), networkFetch)

        if (response.ok) {
          return {
            ok: true,
            message: probe.successMessage,
            latencyMs: Date.now() - start,
          }
        }

        lastFailure = probe.failureMessage ?? `HTTP ${response.status}`
        if (response.status !== 401 && response.status !== 403) {
          const detail = readErrorMessage(response.body)
          if (detail) {
            lastFailure = `${lastFailure} · ${detail}`
          }
        } else {
          lastFailure = `${lastFailure} · HTTP ${response.status}`
        }
        if (probe.failClosed) {
          return { ok: false, message: lastFailure, latencyMs: Date.now() - start }
        }
      } catch (error) {
        lastFailure = error instanceof Error ? `网络请求失败 · ${error.message}` : '连接失败'
        return { ok: false, message: lastFailure, latencyMs: Date.now() - start }
      }
    }
  } catch (error) {
    lastFailure = error instanceof Error ? error.message : '连接失败'
  }

  return {
    ok: false,
    message: lastFailure,
    latencyMs: Date.now() - start,
  }
}

export async function listModelFiles(
  endpoint: string,
  repoId: string,
  token: string | null,
  networkFetch: NetworkFetch = defaultNetworkFetch,
): Promise<FileManifestItem[]> {
  const normalizedRepoId = normalizeRepoId(repoId)
  const normalizedEndpoint = normalizeEndpoint(endpoint)
  const safeToken = normalizeTokenForEndpoint(normalizedEndpoint, token)

  const metadata = await getModelMetadata(normalizedEndpoint, normalizedRepoId, safeToken, networkFetch)
  let rows = toManifestItems(metadata.siblings, metadata.revision, 'rfilename')
  if (rows.length === 0) {
    rows = await listTreeFiles(normalizedEndpoint, normalizedRepoId, metadata.revision, safeToken, networkFetch)
  }
  if (rows.length === 0) {
    throw new Error('文件清单为空。这个仓库可能需要登录权限，或者当前 endpoint 不支持列目录。')
  }
  if (rows.length > MAX_MANIFEST_FILES) throw new Error(`仓库文件超过 ${MAX_MANIFEST_FILES} 项安全上限。`)

  rows.sort((left, right) => left.path.localeCompare(right.path))
  return rows
}
