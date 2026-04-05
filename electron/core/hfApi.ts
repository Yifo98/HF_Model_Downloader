import type { EndpointTestResult, FileManifestItem } from './types.js'

const OFFICIAL_ENDPOINT = 'https://huggingface.co'

function trimSlash(value: string) {
  return value.trim().replace(/\/+$/, '')
}

export function normalizeEndpoint(value: string) {
  return trimSlash(value) || OFFICIAL_ENDPOINT
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

function buildApiErrorMessage(prefix: string, response: Response, detail?: string) {
  const suffix = detail ? ` · ${detail}` : ''
  return `${prefix}：HTTP ${response.status}${suffix}`
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

async function readErrorDetail(response: Response) {
  try {
    const payload = await response.json() as { error?: string; message?: string }
    return payload.error || payload.message || ''
  } catch {
    return ''
  }
}

async function listTreeFiles(endpoint: string, repoId: string, token: string | null) {
  const treeUrl = `${normalizeEndpoint(endpoint)}/api/models/${encodeRepoId(repoId)}/tree/main?recursive=1&expand=1`
  const response = await fetch(treeUrl, { headers: buildHeaders(token) })
  if (!response.ok) {
    const detail = await readErrorDetail(response)
    throw new Error(buildApiErrorMessage('无法读取文件清单', response, detail))
  }

  const payload = await response.json() as Array<Record<string, unknown>>
  return toManifestItems(payload)
}

async function listSiblingFiles(endpoint: string, repoId: string, token: string | null) {
  const metadataUrl = `${normalizeEndpoint(endpoint)}/api/models/${encodeRepoId(repoId)}`
  const response = await fetch(metadataUrl, { headers: buildHeaders(token) })
  if (!response.ok) {
    const detail = await readErrorDetail(response)
    throw new Error(buildApiErrorMessage('无法读取仓库元数据', response, detail))
  }

  const payload = await response.json() as { siblings?: Array<{ rfilename?: string; size?: number }> }
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
  try {
    const response = await fetch(`${normalizeEndpoint(endpoint)}/api/models?limit=1`, {
      headers: buildHeaders(token),
    })

    if (!response.ok) {
      return {
        ok: false,
        message: `HTTP ${response.status}`,
        latencyMs: Date.now() - start,
      }
    }

    return {
      ok: true,
      message: '连接成功',
      latencyMs: Date.now() - start,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '连接失败',
      latencyMs: Date.now() - start,
    }
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
