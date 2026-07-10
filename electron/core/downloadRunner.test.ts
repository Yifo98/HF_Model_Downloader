import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildDownloadIdentity,
  buildPartialFileName,
  DownloadRunner,
  normalizeStrongEtag,
  resolveOutputRoot,
  toDownloadRequestSummary,
  verifyFileIntegrity,
} from './downloadRunner.js'
import type { DownloadRequest, FileManifestItem } from './types.js'

const REVISION = '0123456789abcdef0123456789abcdef01234567'

function makeRequest(outputDir: string): DownloadRequest {
  return {
    repoId: 'demo/model',
    endpoint: 'https://huggingface.co',
    outputDir,
    token: null,
    selectedPaths: ['model.bin'],
    concurrency: 2,
    createRepoFolder: true,
  }
}

test('renderer download summaries never expose credentials', () => {
  const summary = toDownloadRequestSummary({
    repoId: 'demo/model',
    endpoint: 'https://huggingface.co',
    outputDir: '/tmp/models',
    token: 'hf_secret',
    selectedPaths: ['model.safetensors'],
    concurrency: 2,
    createRepoFolder: true,
  })

  assert.equal(summary.authenticated, true)
  assert.equal('token' in summary, false)
})

test('repo folders retain both owner and repo to avoid same-name collisions', () => {
  const root = resolveOutputRoot(makeRequest('/tmp/models'))
  assert.equal(root, '/tmp/models/demo/model')
})

test('partial identity binds endpoint, repo, revision, and path', () => {
  const original = buildPartialFileName('https://huggingface.co', 'demo/model', REVISION, 'model.bin')
  assert.notEqual(original, buildPartialFileName('https://hf-mirror.com', 'demo/model', REVISION, 'model.bin'))
  assert.notEqual(original, buildPartialFileName('https://huggingface.co', 'other/model', REVISION, 'model.bin'))
  assert.notEqual(original, buildPartialFileName('https://huggingface.co', 'demo/model', 'f'.repeat(40), 'model.bin'))
  assert.notEqual(original, buildPartialFileName('https://huggingface.co', 'demo/model', REVISION, 'nested/model.bin'))
  assert.equal(
    buildDownloadIdentity('https://huggingface.co/', 'demo/model', REVISION, 'model.bin'),
    `https://huggingface.co\ndemo/model\n${REVISION}\nmodel.bin`,
  )
})

test('only strong ETags are accepted for partial resume identity', () => {
  assert.equal(normalizeStrongEtag('"abc123"'), '"abc123"')
  assert.equal(normalizeStrongEtag('W/"abc123"'), null)
  assert.equal(normalizeStrongEtag('abc123'), null)
  assert.equal(normalizeStrongEtag(null), null)
})

test('temporary files verify LFS SHA-256 and ordinary Git blob OIDs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hf-integrity-'))
  try {
    const filePath = join(root, 'payload.bin')
    const content = Buffer.from('immutable model payload')
    writeFileSync(filePath, content)
    const lfsSha256 = createHash('sha256').update(content).digest('hex')
    const gitBlobOid = createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex')
    const base: FileManifestItem = {
      path: 'payload.bin',
      size: content.length,
      type: 'file',
      category: '其他',
      family: 'other',
      revision: REVISION,
    }

    assert.deepEqual(await verifyFileIntegrity(filePath, { ...base, lfsSha256 }), {
      trusted: true,
      matches: true,
      algorithm: 'sha256',
      expected: lfsSha256,
      actual: lfsSha256,
    })
    assert.equal((await verifyFileIntegrity(filePath, { ...base, gitBlobOid })).matches, true)
    assert.equal((await verifyFileIntegrity(filePath, { ...base, lfsSha256: '0'.repeat(64) })).matches, false)
    assert.equal((await verifyFileIntegrity(filePath, base)).trusted, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('existing files are skipped only after trusted hash verification', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hf-existing-'))
  try {
    const outputDir = join(root, 'downloads')
    const repoDir = join(outputDir, 'demo', 'model')
    mkdirSync(repoDir, { recursive: true })
    const content = Buffer.from('already downloaded')
    writeFileSync(join(repoDir, 'model.bin'), content)
    const manifest: FileManifestItem[] = [{
      path: 'model.bin',
      size: content.length,
      type: 'file',
      category: '其他',
      family: 'other',
      revision: REVISION,
      lfsSha256: createHash('sha256').update(content).digest('hex'),
    }]

    let doneStatus = ''
    const runner = new DownloadRunner(makeRequest(outputDir), manifest, {
      onUpdate: () => undefined,
      onDone: (status) => { doneStatus = status },
    })
    await runner.start()
    assert.equal(doneStatus, 'success')

    let unsafeStatus = ''
    const unsafeRunner = new DownloadRunner(makeRequest(outputDir), [{ ...manifest[0], lfsSha256: undefined }], {
      onUpdate: () => undefined,
      onDone: (status) => { unsafeStatus = status },
    })
    await unsafeRunner.start()
    assert.equal(unsafeStatus, 'error')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('chunked responses cannot write beyond the fixed manifest size', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hf-bounded-stream-'))
  const originalFetch = globalThis.fetch
  try {
    const outputDir = join(root, 'downloads')
    mkdirSync(outputDir)
    globalThis.fetch = async () => new Response(Buffer.from('payload-too-large'), { status: 200 })
    const manifest: FileManifestItem[] = [{
      path: 'model.bin',
      size: 4,
      type: 'file',
      category: '其他',
      family: 'other',
      revision: REVISION,
    }]
    let doneStatus = ''
    const runner = new DownloadRunner({
      ...makeRequest(outputDir),
      endpoint: 'http://127.0.0.1:8080',
    }, manifest, {
      onUpdate: () => undefined,
      onDone: (status) => { doneStatus = status },
    })

    await runner.start()
    assert.equal(doneStatus, 'error')
  } finally {
    globalThis.fetch = originalFetch
    rmSync(root, { recursive: true, force: true })
  }
})

test('write stream failures become job errors instead of process errors', { skip: process.platform === 'win32' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'hf-stream-error-'))
  const originalFetch = globalThis.fetch
  const outputDir = join(root, 'downloads')
  const partialsDir = join(outputDir, 'demo', 'model', '.hf-model-downloader-partials')
  try {
    mkdirSync(outputDir)
    const content = Buffer.from('bounded payload')
    globalThis.fetch = async () => new Response(content, {
      status: 200,
      headers: { 'content-length': String(content.length) },
    })
    const manifest: FileManifestItem[] = [{
      path: 'model.bin',
      size: content.length,
      type: 'file',
      category: '其他',
      family: 'other',
      revision: REVISION,
    }]
    let doneStatus = ''
    const runner = new DownloadRunner({
      ...makeRequest(outputDir),
      endpoint: 'http://127.0.0.1:8080',
    }, manifest, {
      onUpdate: () => undefined,
      onDone: (status) => { doneStatus = status },
    })
    chmodSync(partialsDir, 0o500)

    await runner.start()
    assert.equal(doneStatus, 'error')
  } finally {
    globalThis.fetch = originalFetch
    try { chmodSync(partialsDir, 0o700) } catch { /* Directory may not exist after an early failure. */ }
    rmSync(root, { recursive: true, force: true })
  }
})
