import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { EndpointTestResult, FileManifestItem } from './types.js'

const OFFICIAL_ENDPOINT = 'https://huggingface.co'
const REQUEST_TIMEOUT_MS = 12000

function trimSlash(value: string) {
  return value.trim().replace(/\/+$/, '')
}

export function normalizeEndpoint(value: string) {
  return trimSlash(value) || OFFICIAL_ENDPOINT
}

type EndpointProbe = {
  url: string
  successMessage: string
  failureMessage?: string
}

export function getEndpointProbePlan(endpoint: string, hasToken: boolean) {
  const normalized = normalizeEndpoint(endpoint)
  const probes: EndpointProbe[] = []

  if (normalized === OFFICIAL_ENDPOINT && hasToken) {
    probes.push({
      url: `${normalized}/api/whoami-v2`,
      successMessage: 'Token 有效 官方源可访问',
      failureMessage: 'Token 无效或当前网络无法访问官方鉴权接口',
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
  return repoId
    .split('/')
    .map((segment) => encodeURIComponent(segment.trim()))
    .filter(Boolean)
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
}

function readErrorMessage(body: string) {
  if (!body.trim()) return ''
  try {
    const payload = JSON.parse(body) as { error?: string; message?: string }
    return payload.error || payload.message || body.trim()
  } catch {
    return body.trim()
  }
}

async function requestSnapshot(url: string, headers: Headers, family?: 4): Promise<ResponseSnapshot> {
  const target = new URL(url)
  const requestImpl = target.protocol === 'http:' ? httpRequest : httpsRequest

  return await new Promise<ResponseSnapshot>((resolve, reject) => {
    const req = requestImpl(target, {
      method: 'GET',
      headers: Object.fromEntries(headers.entries()),
      timeout: REQUEST_TIMEOUT_MS,
      family,
    }, (res) => {
      const chunks: Buffer[] = []

      res.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })

      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        resolve({
          ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
          status: res.statusCode ?? 0,
          statusText: res.statusMessage ?? '',
          body,
        })
      })
    })

    req.on('timeout', () => {
      req.destroy(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`))
    })

    req.on('error', (error) => {
      reject(error)
    })

    req.end()
  })
}

async function requestSnapshotWithFallback(url: string, headers: Headers) {
  let lastError: Error | null = null

  for (const family of [4, undefined] as const) {
    try {
      return await requestSnapshot(url, headers, family)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown request error')
    }
  }

  throw lastError ?? new Error('Unknown request error')
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

export function buildDownloadUrl(endpoint: string, repoId: string, filePath: string) {
  const normalized = normalizeEndpoint(endpoint)
  const encodedSegments = filePath.split('/').map((segment) => encodeURIComponent(segment)).join('/')
  return `${normalized}/${repoId}/resolve/main/${encodedSegments}?download=1`
}

function buildApiErrorMessage(prefix: string, status: number, detail?: string) {
  const suffix = detail ? ` · ${detail}` : ''
  return `${prefix}：HTTP ${status}${suffix}`
}

function toManifestItems(payload: Array<Record<string, unknown>>) {
  return payload
    .map((entry) => {
      const path = typeof entry.path === 'string' ? entry.path : ''
      const type = entry.type === 'directory' ? 'directory' : 'file'
      const size = typeof entry.size === 'number' ? entry.size : null
      return {
        path,
        size,
        type,
        category: classifyCategory(path),
        family: classifyFamily(path),
      } satisfies FileManifestItem
    })
    .filter((entry) => entry.path && entry.type === 'file')
}

async function listTreeFiles(endpoint: string, repoId: string, token: string | null) {
  const treeUrl = `${normalizeEndpoint(endpoint)}/api/models/${encodeRepoId(repoId)}/tree/main?recursive=1&expand=1`
  const response = await requestSnapshotWithFallback(treeUrl, buildHeaders(token))
  if (!response.ok) {
    const detail = readErrorMessage(response.body)
    throw new Error(buildApiErrorMessage('无法读取文件清单', response.status, detail))
  }

  const payload = JSON.parse(response.body) as Array<Record<string, unknown>>
  return toManifestItems(payload)
}

async function listSiblingFiles(endpoint: string, repoId: string, token: string | null) {
  const metadataUrl = `${normalizeEndpoint(endpoint)}/api/models/${encodeRepoId(repoId)}`
  const response = await requestSnapshotWithFallback(metadataUrl, buildHeaders(token))
  if (!response.ok) {
    const detail = readErrorMessage(response.body)
    throw new Error(buildApiErrorMessage('无法读取仓库元数据', response.status, detail))
  }

  const payload = JSON.parse(response.body) as { siblings?: Array<{ rfilename?: string; size?: number }> }
  const rows = (payload.siblings ?? [])
    .map((item) => {
      const path = typeof item.rfilename === 'string' ? item.rfilename : ''
      return {
        path,
        size: typeof item.size === 'number' ? item.size : null,
        type: 'file',
        category: classifyCategory(path),
        family: classifyFamily(path),
      } satisfies FileManifestItem
    })
    .filter((entry) => entry.path)

  return rows
}

export async function testEndpoint(endpoint: string, token: string | null): Promise<EndpointTestResult> {
  const start = Date.now()
  let lastFailure = '连接失败'

  try {
    for (const probe of getEndpointProbePlan(endpoint, Boolean(token?.trim()))) {
      try {
        const response = await requestSnapshotWithFallback(probe.url, buildHeaders(token))

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
      } catch (error) {
        lastFailure = error instanceof Error ? `网络请求失败 · ${error.message}` : '连接失败'
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

export async function listModelFiles(endpoint: string, repoId: string, token: string | null): Promise<FileManifestItem[]> {
  const normalizedRepoId = repoId.trim()
  if (!normalizedRepoId.includes('/')) {
    throw new Error('仓库名格式不对，应该像 `owner/repo`。')
  }

  let rows = await listTreeFiles(endpoint, normalizedRepoId, token)
  if (rows.length === 0) {
    rows = await listSiblingFiles(endpoint, normalizedRepoId, token)
  }
  if (rows.length === 0) {
    throw new Error('文件清单为空。这个仓库可能需要登录权限，或者当前 endpoint 不支持列目录。')
  }

  rows.sort((left, right) => left.path.localeCompare(right.path))
  return rows
}
