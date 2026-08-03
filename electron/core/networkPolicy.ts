import type { NetworkConfig, NetworkMode, NetworkRouteMode, NetworkRouteProbe } from './types.js'

const NETWORK_MODES = new Set<NetworkMode>(['auto', 'system', 'direct', 'custom'])
const PROXY_PROTOCOLS = new Set(['http:', 'https:', 'socks4:', 'socks5:'])
const MAX_PROXY_URL_LENGTH = 2_048
const OFFICIAL_ENDPOINT_ORIGIN = 'https://huggingface.co'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeProxyUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > MAX_PROXY_URL_LENGTH || value.includes('\0')) {
    throw new Error('自定义代理地址不合法。')
  }
  const raw = value.trim()
  if (!raw) return ''

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('自定义代理必须是有效地址。')
  }
  if (!PROXY_PROTOCOLS.has(parsed.protocol)) {
    throw new Error('自定义代理只支持 http、https、socks4 或 socks5。')
  }
  if (!parsed.hostname) throw new Error('自定义代理缺少主机名。')
  if (parsed.username || parsed.password) throw new Error('自定义代理不能包含用户名或密码。')
  if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
    throw new Error('自定义代理不能包含路径、查询参数或片段。')
  }

  parsed.pathname = ''
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString().replace(/\/$/, '')
}

export function normalizeNetworkConfig(value: unknown): NetworkConfig {
  if (!isRecord(value) || typeof value.mode !== 'string' || !NETWORK_MODES.has(value.mode as NetworkMode)) {
    throw new Error('网络模式不合法。')
  }
  const mode = value.mode as NetworkMode
  const proxyUrl = normalizeProxyUrl(value.proxyUrl ?? '')
  if (mode === 'custom' && !proxyUrl) throw new Error('自定义代理模式需要填写代理地址。')
  return { mode, proxyUrl }
}

export function sanitizeNetworkConfig(value: unknown, fallback: NetworkConfig): NetworkConfig {
  try {
    return normalizeNetworkConfig(value)
  } catch {
    return { ...fallback }
  }
}

export function summarizeProxyResolution(value: string) {
  const directives = value
    .replace(/[\r\n]/g, ' ')
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((entry) => {
      const match = entry.match(/^([A-Za-z0-9_-]+)(?:\s+([^\s]+))?$/)
      if (!match) return '未知代理规则'
      const kind = match[1]?.toUpperCase() ?? 'PROXY'
      const target = match[2]?.replace(/^.*@/, '')
      return target ? `${kind} ${target}` : kind
    })
  const normalized = directives.length > 0 ? directives : ['DIRECT']
  const detected = normalized.some((entry) => entry !== 'DIRECT')
  return {
    detected,
    summary: detected ? normalized.join('; ') : '未检测到系统代理',
  }
}

export function chooseRecommendedRoute(probes: readonly NetworkRouteProbe[]): NetworkRouteMode | null {
  const available = probes
    .filter((probe) => probe.available)
    .sort((left, right) => (left.latencyMs ?? Number.POSITIVE_INFINITY) - (right.latencyMs ?? Number.POSITIVE_INFINITY))
  return available[0]?.mode ?? null
}

export function protectRequestHeaders(targetUrl: string, headers: Record<string, string>) {
  const protectedHeaders = { ...headers }
  if (new URL(targetUrl).origin !== OFFICIAL_ENDPOINT_ORIGIN) {
    for (const key of Object.keys(protectedHeaders)) {
      if (key.toLocaleLowerCase('en-US') === 'authorization') delete protectedHeaders[key]
    }
  }
  return protectedHeaders
}

export function networkModeLabel(mode: NetworkMode | NetworkRouteMode) {
  if (mode === 'auto') return '自动推荐'
  if (mode === 'system') return '系统代理'
  if (mode === 'direct') return '直连'
  return '自定义代理'
}
