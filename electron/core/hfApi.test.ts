import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDownloadUrl,
  getNextTreePageUrl,
  getEndpointProbePlan,
  getSafeRelativePathSegments,
  isAllowedResolvedAddress,
  isPrivateOrLocalAddress,
  normalizeCommitRevision,
  normalizeEndpoint,
  normalizeRepoId,
  normalizeTokenForEndpoint,
  readErrorMessage,
  testEndpoint,
  toManifestItems,
} from './hfApi.js'

test('normalizeEndpoint trims slash and falls back to official', () => {
  assert.equal(normalizeEndpoint('https://hf-mirror.com///'), 'https://hf-mirror.com')
  assert.equal(normalizeEndpoint('   '), 'https://huggingface.co')
})

test('normalizeEndpoint rejects non-http protocols', () => {
  assert.throws(() => normalizeEndpoint('file:///tmp/model'), /http/)
  assert.throws(() => normalizeEndpoint('javascript:alert(1)'), /http/)
})

test('normalizeEndpoint requires https for remote endpoints', () => {
  assert.throws(() => normalizeEndpoint('http://example.com'), /https/)
  assert.equal(normalizeEndpoint('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080')
  assert.throws(() => normalizeEndpoint('https://user:pass@example.com'), /用户名或密码/)
})

test('normalizeRepoId accepts owner and repo path only', () => {
  assert.equal(normalizeRepoId(' black-forest-labs/FLUX.1-dev '), 'black-forest-labs/FLUX.1-dev')
  assert.throws(() => normalizeRepoId('owner/repo/extra'), /owner\/repo/)
  assert.throws(() => normalizeRepoId('../repo'), /仓库名/)
})

test('safe relative file paths reject traversal and backslashes', () => {
  assert.deepEqual(getSafeRelativePathSegments('folder/model.safetensors'), ['folder', 'model.safetensors'])
  assert.throws(() => getSafeRelativePathSegments('../secret'), /上级目录/)
  assert.throws(() => getSafeRelativePathSegments('folder\\secret'), /不合法/)
  assert.throws(() => getSafeRelativePathSegments('weights/model.bin:secret'), /上级目录/)
  assert.throws(() => getSafeRelativePathSegments('weights/CON.txt'), /上级目录/)
  assert.throws(() => getSafeRelativePathSegments('weights/model.bin.'), /上级目录/)
  assert.throws(() => getSafeRelativePathSegments('.hf-model-downloader-partials/state'), /临时目录/)
})

test('credentials are sent only to the official Hugging Face endpoint', () => {
  assert.equal(normalizeTokenForEndpoint('https://huggingface.co', ' hf_example '), 'hf_example')
  assert.throws(() => normalizeTokenForEndpoint('https://hf-mirror.com', 'hf_example'), /Token 只允许/)
})

test('private and local IP ranges are recognized for SSRF protection', () => {
  assert.equal(isPrivateOrLocalAddress('127.0.0.1'), true)
  assert.equal(isPrivateOrLocalAddress('169.254.169.254'), true)
  assert.equal(isPrivateOrLocalAddress('192.168.1.8'), true)
  assert.equal(isPrivateOrLocalAddress('100.64.0.1'), true)
  assert.equal(isPrivateOrLocalAddress('198.51.100.8'), true)
  assert.equal(isPrivateOrLocalAddress('198.18.0.25'), true)
  assert.equal(isPrivateOrLocalAddress('203.0.113.4'), true)
  assert.equal(isPrivateOrLocalAddress('8.8.8.8'), false)
  assert.equal(isPrivateOrLocalAddress('::1'), true)
  assert.equal(isPrivateOrLocalAddress('::ffff:ac10:0001'), true)
  assert.equal(isPrivateOrLocalAddress('::ffff:c0a8:0101'), true)
  assert.equal(isPrivateOrLocalAddress('2001:db8::1'), true)
  assert.equal(isAllowedResolvedAddress('198.18.0.25'), true)
  assert.equal(isAllowedResolvedAddress('192.168.1.8'), false)
})

test('remote error details are bounded before reaching the renderer', () => {
  const detail = readErrorMessage(JSON.stringify({ error: 'x'.repeat(5_000) }))
  assert.equal(detail.length, 2_049)
  assert.equal(detail.endsWith('…'), true)
})

test('buildDownloadUrl encodes nested file names', () => {
  const revision = '0123456789abcdef0123456789abcdef01234567'
  assert.equal(
    buildDownloadUrl('https://huggingface.co/', 'demo/repo', revision, 'folder/model file.safetensors'),
    `https://huggingface.co/demo/repo/resolve/${revision}/folder/model%20file.safetensors?download=1`,
  )
})

test('buildDownloadUrl keeps repo owner and name as path segments', () => {
  const revision = 'fedcba9876543210fedcba9876543210fedcba98'
  assert.equal(
    buildDownloadUrl('https://hf-mirror.com', 'black-forest-labs/FLUX.1-dev', revision, 'weights/model.safetensors'),
    `https://hf-mirror.com/black-forest-labs/FLUX.1-dev/resolve/${revision}/weights/model.safetensors?download=1`,
  )
})

test('commit revision must be an immutable Git object id', () => {
  assert.equal(
    normalizeCommitRevision('ABCDEF0123456789ABCDEF0123456789ABCDEF01'),
    'abcdef0123456789abcdef0123456789abcdef01',
  )
  assert.throws(() => normalizeCommitRevision('main'), /commit SHA/)
  assert.throws(() => normalizeCommitRevision('01234567'), /commit SHA/)
})

test('tree entries preserve revision and trustworthy LFS or Git identities', () => {
  const revision = '0123456789abcdef0123456789abcdef01234567'
  const lfsSha256 = 'ab'.repeat(32)
  const gitBlobOid = 'cd'.repeat(20)
  const rows = toManifestItems([
    {
      path: 'weights/model.safetensors',
      type: 'file',
      size: 42,
      oid: 'ef'.repeat(20),
      lfs: { oid: `sha256:${lfsSha256}` },
    },
    {
      path: 'config.json',
      type: 'file',
      size: 12,
      oid: gitBlobOid,
    },
    {
      path: 'mirror-without-hashes.txt',
      type: 'file',
      size: 3,
    },
  ], revision)

  assert.equal(rows[0]?.revision, revision)
  assert.equal(rows[0]?.lfsSha256, lfsSha256)
  assert.equal(rows[0]?.gitBlobOid, undefined, 'LFS content hash must take precedence over pointer blob oid')
  assert.equal(rows[1]?.gitBlobOid, gitBlobOid)
  assert.equal(rows[2]?.lfsSha256, undefined)
  assert.equal(rows[2]?.gitBlobOid, undefined)
})

test('tree pagination accepts same-origin next links and rejects cross-origin links', () => {
  const current = 'https://huggingface.co/api/models/demo/repo/tree/abc?recursive=1&expand=1'
  assert.equal(
    getNextTreePageUrl('<https://huggingface.co/api/models/demo/repo/tree/abc?cursor=next>; rel="next"', current),
    'https://huggingface.co/api/models/demo/repo/tree/abc?cursor=next',
  )
  assert.equal(getNextTreePageUrl('<https://huggingface.co/previous>; rel="prev"', current), null)
  assert.throws(
    () => getNextTreePageUrl('<https://evil.example/steal>; rel="next"', current),
    /其他来源/,
  )
})

test('official endpoint probe plan prioritizes token verification when token exists', () => {
  const probes = getEndpointProbePlan('https://huggingface.co/', true)
  assert.equal(probes[0]?.url, 'https://huggingface.co/api/whoami-v2')
  assert.equal(probes[0]?.failClosed, true)
  assert.equal(probes[1]?.url, 'https://huggingface.co/api/models/openai-community/gpt2')
})

test('mirror endpoint probe plan avoids whoami and checks models list first', () => {
  const probes = getEndpointProbePlan('https://hf-mirror.com', false)
  assert.equal(probes[0]?.url, 'https://hf-mirror.com/api/models?limit=1')
  assert.equal(probes[1]?.url, 'https://hf-mirror.com/robots.txt')
})

test('endpoint connectivity stops after the first transport failure', async () => {
  let calls = 0
  const result = await testEndpoint('https://huggingface.co', null, async () => {
    calls += 1
    throw new Error('offline')
  })

  assert.equal(calls, 1)
  assert.equal(result.ok, false)
  assert.match(result.message, /offline/)
})
