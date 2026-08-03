import { createHash } from 'node:crypto'
import { session, type Session } from 'electron'
import { assertSafeNetworkUrl, getEndpointProbePlan, normalizeEndpoint, type NetworkFetch } from './hfApi.js'
import {
  chooseRecommendedRoute,
  networkModeLabel,
  normalizeNetworkConfig,
  protectRequestHeaders,
  summarizeProxyResolution,
} from './networkPolicy.js'
import type {
  NetworkConfig,
  NetworkDetectionResult,
  NetworkRouteMode,
  NetworkRouteProbe,
} from './types.js'

const PROBE_TIMEOUT_MS = 4_000
const DETECTION_CACHE_MS = 30_000
const MAX_NETWORK_ERROR_LENGTH = 240

type CachedDetection = {
  expiresAt: number
  value: NetworkDetectionResult
}

function routeKey(mode: NetworkRouteMode, proxyUrl = '') {
  if (mode !== 'custom') return mode
  return `custom-${createHash('sha256').update(proxyUrl).digest('hex').slice(0, 16)}`
}

function proxyConfigFor(mode: NetworkRouteMode, proxyUrl: string): Electron.ProxyConfig {
  if (mode === 'system') return { mode: 'system' }
  if (mode === 'direct') return { mode: 'direct' }
  return { mode: 'fixed_servers', proxyRules: proxyUrl }
}

function boundedError(error: unknown) {
  const message = error instanceof Error ? error.message : '连接失败'
  const normalized = message.replace(/[\r\n]+/g, ' ').trim()
  return normalized.length <= MAX_NETWORK_ERROR_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_NETWORK_ERROR_LENGTH)}…`
}

export class NetworkTransport {
  private readonly sessions = new Map<string, Promise<Session>>()
  private readonly detectionCache = new Map<string, CachedDetection>()

  private configureSessionSecurity(networkSession: Session) {
    const filter = { urls: ['http://*/*', 'https://*/*'] }
    const allowLoopbackByRequest = new Map<number, boolean>()
    networkSession.webRequest.onBeforeRequest(filter, (details, callback) => {
      let target: URL
      try {
        target = new URL(details.url)
      } catch {
        callback({ cancel: true })
        return
      }
      const firstRequestInChain = !allowLoopbackByRequest.has(details.id)
      const allowLoopback = firstRequestInChain
        ? target.hostname === 'localhost' || target.hostname === '127.0.0.1' || target.hostname === '[::1]'
        : allowLoopbackByRequest.get(details.id) === true
      if (firstRequestInChain) allowLoopbackByRequest.set(details.id, allowLoopback)
      void assertSafeNetworkUrl(target, allowLoopback)
        .then(() => callback({}))
        .catch(() => callback({ cancel: true }))
    })
    networkSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
      callback({ requestHeaders: protectRequestHeaders(details.url, details.requestHeaders) })
    })
    networkSession.webRequest.onCompleted(filter, (details) => allowLoopbackByRequest.delete(details.id))
    networkSession.webRequest.onErrorOccurred(filter, (details) => allowLoopbackByRequest.delete(details.id))
  }

  private getSession(mode: NetworkRouteMode, proxyUrl = '') {
    const key = routeKey(mode, proxyUrl)
    const current = this.sessions.get(key)
    if (current) return current

    const next = (async () => {
      const networkSession = session.fromPartition(`hf-network-${key}`, { cache: false })
      this.configureSessionSecurity(networkSession)
      await networkSession.setProxy(proxyConfigFor(mode, proxyUrl))
      return networkSession
    })()
    this.sessions.set(key, next)
    return next
  }

  private async fetcherFor(mode: NetworkRouteMode, proxyUrl = ''): Promise<NetworkFetch> {
    const networkSession = await this.getSession(mode, proxyUrl)
    return (input, init) => networkSession.fetch(input, {
      ...init,
      redirect: 'follow',
      bypassCustomProtocolHandlers: true,
    }) as Promise<Response>
  }

  private async probe(mode: NetworkRouteMode, endpoint: string, proxyUrl = ''): Promise<NetworkRouteProbe> {
    const probeUrl = getEndpointProbePlan(endpoint, false)[0]?.url ?? normalizeEndpoint(endpoint)
    const startedAt = Date.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort(new Error(`连接超过 ${PROBE_TIMEOUT_MS / 1000} 秒`))
    }, PROBE_TIMEOUT_MS)

    try {
      await assertSafeNetworkUrl(probeUrl)
      const networkFetch = await this.fetcherFor(mode, proxyUrl)
      const response = await networkFetch(probeUrl, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'manual',
      })
      await response.body?.cancel().catch(() => undefined)
      const reachable = response.status >= 200 && response.status < 500
      return {
        mode,
        available: reachable,
        latencyMs: Date.now() - startedAt,
        detail: reachable ? `HTTP ${response.status}` : `HTTP ${response.status}，服务暂不可用`,
      }
    } catch (error) {
      const reason = controller.signal.aborted && controller.signal.reason instanceof Error
        ? controller.signal.reason
        : error
      return {
        mode,
        available: false,
        latencyMs: null,
        detail: boundedError(reason),
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  async detect(endpointValue: string, configValue: NetworkConfig, force = false): Promise<NetworkDetectionResult> {
    const endpoint = normalizeEndpoint(endpointValue)
    const config = normalizeNetworkConfig(configValue)
    const cacheKey = JSON.stringify([endpoint, config.mode, config.proxyUrl])
    const cached = this.detectionCache.get(cacheKey)
    if (!force && cached && cached.expiresAt > Date.now()) {
      return { ...cached.value, selectedMode: config.mode }
    }

    const systemSession = await this.getSession('system')
    let proxyResolution = 'DIRECT'
    try {
      proxyResolution = await systemSession.resolveProxy(endpoint)
    } catch {
      proxyResolution = 'DIRECT'
    }
    const systemProxy = summarizeProxyResolution(proxyResolution)

    const directProbePromise = this.probe('direct', endpoint)
    const systemProbePromise = systemProxy.detected ? this.probe('system', endpoint) : null
    const customProbePromise = config.proxyUrl ? this.probe('custom', endpoint, config.proxyUrl) : null
    const [directProbe, systemProbe, customProbe] = await Promise.all([
      directProbePromise,
      systemProbePromise,
      customProbePromise,
    ])
    const routes: NetworkRouteProbe[] = [
      ...(systemProbe ? [systemProbe] : [{
        mode: 'system' as const,
        available: directProbe.available,
        latencyMs: directProbe.latencyMs,
        detail: directProbe.available ? '系统未配置代理，当前等同直连' : directProbe.detail,
      }]),
      directProbe,
      ...(customProbe ? [customProbe] : []),
    ]
    const recommendationCandidates = systemProxy.detected
      ? routes
      : routes.filter((route) => route.mode !== 'system')
    const recommendedMode = chooseRecommendedRoute(recommendationCandidates)
    const effectiveMode = config.mode === 'auto' ? recommendedMode : config.mode
    const selectedProbe = effectiveMode ? routes.find((route) => route.mode === effectiveMode) : null
    let message = '未找到可用网络通道。请检查代理设置或网络连接。'
    if (recommendedMode && config.mode === 'auto') {
      message = `自动推荐使用${networkModeLabel(recommendedMode)}。`
    } else if (recommendedMode && selectedProbe?.available && effectiveMode === recommendedMode) {
      message = `当前${networkModeLabel(effectiveMode)}可用，也是推荐通道。`
    } else if (recommendedMode && effectiveMode) {
      message = `当前选择${networkModeLabel(effectiveMode)}；检测建议使用${networkModeLabel(recommendedMode)}。`
    }

    const result: NetworkDetectionResult = {
      selectedMode: config.mode,
      effectiveMode,
      recommendedMode,
      systemProxyDetected: systemProxy.detected,
      systemProxySummary: systemProxy.summary,
      routes,
      message,
    }
    this.detectionCache.set(cacheKey, {
      expiresAt: Date.now() + DETECTION_CACHE_MS,
      value: result,
    })
    return result
  }

  async resolve(endpoint: string, configValue: NetworkConfig) {
    const config = normalizeNetworkConfig(configValue)
    let mode: NetworkRouteMode
    if (config.mode === 'auto') {
      const detection = await this.detect(endpoint, config)
      if (!detection.recommendedMode) throw new Error(detection.message)
      mode = detection.recommendedMode
    } else {
      mode = config.mode
    }
    return {
      mode,
      fetch: await this.fetcherFor(mode, mode === 'custom' ? config.proxyUrl : ''),
    }
  }
}
