import test from 'node:test'
import assert from 'node:assert/strict'
import {
  chooseRecommendedRoute,
  normalizeNetworkConfig,
  protectRequestHeaders,
  sanitizeNetworkConfig,
  summarizeProxyResolution,
} from './networkPolicy.js'
import type { NetworkRouteProbe } from './types.js'

test('network config accepts explicit safe routes and rejects credential-bearing proxies', () => {
  assert.deepEqual(normalizeNetworkConfig({ mode: 'auto', proxyUrl: '' }), { mode: 'auto', proxyUrl: '' })
  assert.deepEqual(
    normalizeNetworkConfig({ mode: 'custom', proxyUrl: 'socks5://127.0.0.1:7897/' }),
    { mode: 'custom', proxyUrl: 'socks5://127.0.0.1:7897' },
  )
  assert.throws(
    () => normalizeNetworkConfig({ mode: 'custom', proxyUrl: 'http://user:secret@127.0.0.1:7897' }),
    /用户名或密码/,
  )
  assert.throws(
    () => normalizeNetworkConfig({ mode: 'custom', proxyUrl: 'file:///tmp/proxy' }),
    /http、https、socks4 或 socks5/,
  )
  assert.throws(
    () => normalizeNetworkConfig({ mode: 'custom', proxyUrl: 'http://127.0.0.1:7897/proxy.pac' }),
    /路径/,
  )
})

test('preference sanitization keeps the last safe network config', () => {
  const fallback = { mode: 'system' as const, proxyUrl: '' }
  assert.deepEqual(sanitizeNetworkConfig({ mode: 'direct', proxyUrl: '' }, fallback), {
    mode: 'direct',
    proxyUrl: '',
  })
  assert.deepEqual(sanitizeNetworkConfig({ mode: 'custom', proxyUrl: 'http://user:secret@example.com' }, fallback), fallback)
})

test('proxy resolution summaries detect direct and redact credentials', () => {
  assert.deepEqual(summarizeProxyResolution('DIRECT'), { detected: false, summary: '未检测到系统代理' })
  assert.deepEqual(summarizeProxyResolution('PROXY user:secret@127.0.0.1:7897; DIRECT'), {
    detected: true,
    summary: 'PROXY 127.0.0.1:7897; DIRECT',
  })
})

test('automatic routing recommends the fastest available route', () => {
  const probes: NetworkRouteProbe[] = [
    { mode: 'system', available: true, latencyMs: 420, detail: '系统代理可用' },
    { mode: 'direct', available: false, latencyMs: null, detail: '直连超时' },
    { mode: 'custom', available: true, latencyMs: 180, detail: '自定义代理可用' },
  ]
  assert.equal(chooseRecommendedRoute(probes), 'custom')
  assert.equal(chooseRecommendedRoute(probes.filter((probe) => probe.mode !== 'custom')), 'system')
  assert.equal(chooseRecommendedRoute(probes.map((probe) => ({ ...probe, available: false, latencyMs: null }))), null)
})

test('automatic routing can exclude a system route that only aliases direct access', () => {
  const probes: NetworkRouteProbe[] = [
    { mode: 'system', available: true, latencyMs: 200, detail: '系统未配置代理，当前等同直连' },
    { mode: 'direct', available: true, latencyMs: 200, detail: 'HTTP 200' },
  ]
  assert.equal(chooseRecommendedRoute(probes.filter((probe) => probe.mode !== 'system')), 'direct')
})

test('authorization survives only on the official Hugging Face origin', () => {
  const headers = { Authorization: 'Bearer hf_secret', Accept: 'application/json' }
  assert.equal(protectRequestHeaders('https://huggingface.co/api/whoami-v2', headers).Authorization, 'Bearer hf_secret')
  assert.equal('Authorization' in protectRequestHeaders('https://cdn.example/model.bin', headers), false)
  assert.equal(headers.Authorization, 'Bearer hf_secret', 'the caller-owned headers must not be mutated')
})
