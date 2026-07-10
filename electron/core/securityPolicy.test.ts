import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  HUGGING_FACE_MODELS_URL,
  isValidSessionId,
  normalizeAllowedExternalUrl,
  normalizeDownloadRequestInput,
  normalizeRuntimeEndpoint,
  resolveApprovedPath,
  sanitizeHistoryEntries,
  sanitizePreferences,
} from './securityPolicy.js'

test('external navigation is fixed to the official models page', () => {
  assert.equal(normalizeAllowedExternalUrl(HUGGING_FACE_MODELS_URL), HUGGING_FACE_MODELS_URL)
  assert.throws(() => normalizeAllowedExternalUrl('https://huggingface.co.evil.example/models'), /只允许/)
  assert.throws(() => normalizeAllowedExternalUrl('https://huggingface.co/settings/tokens'), /只允许/)
})

test('runtime endpoints allow loopback only in development', () => {
  assert.equal(normalizeRuntimeEndpoint('http://127.0.0.1:8080', true), 'http://127.0.0.1:8080')
  assert.throws(() => normalizeRuntimeEndpoint('http://127.0.0.1:8080', false), /正式版/)
  assert.equal(normalizeRuntimeEndpoint('https://hf-mirror.com', false), 'https://hf-mirror.com')
  assert.throws(() => normalizeRuntimeEndpoint('https://custom.example', false), /自定义 Endpoint/)
})

test('download requests deduplicate paths, cap concurrency, and keep custom endpoints token-free', () => {
  const request = normalizeDownloadRequestInput({
    repoId: 'demo/model',
    endpoint: 'https://huggingface.co',
    outputDir: '/tmp/models',
    token: 'hf_example',
    selectedPaths: ['weights/model.safetensors', 'weights/model.safetensors'],
    concurrency: 99,
    createRepoFolder: true,
  }, false)
  assert.deepEqual(request.selectedPaths, ['weights/model.safetensors'])
  assert.equal(request.concurrency, 8)
  assert.throws(() => normalizeDownloadRequestInput({ ...request, endpoint: 'https://hf-mirror.com' }, false), /Token 只允许/)
})

test('portable path collisions are rejected before download', () => {
  assert.throws(() => normalizeDownloadRequestInput({
    repoId: 'demo/model',
    endpoint: 'https://huggingface.co',
    outputDir: '/tmp/models',
    token: null,
    selectedPaths: ['Model.bin', 'model.bin'],
    concurrency: 2,
    createRepoFolder: true,
  }, false), /大小写不敏感/)
})

test('approved paths resolve symlinks and reject escapes', () => {
  const root = mkdtempSync(join(tmpdir(), 'hf-policy-'))
  const approved = join(root, 'approved')
  const outside = join(root, 'outside')
  mkdirSync(approved)
  mkdirSync(outside)
  try {
    assert.equal(resolveApprovedPath(join(approved, 'new-file'), [approved]), join(realpathSync.native(approved), 'new-file'))
    assert.throws(() => resolveApprovedPath(outside, [approved]), /批准/)
    if (process.platform !== 'win32') {
      const link = join(approved, 'escape')
      symlinkSync(outside, link, 'dir')
      assert.throws(() => resolveApprovedPath(link, [approved]), /批准/)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('preferences never retain renderer token fields', () => {
  const fallback = {
    repoId: '',
    endpoint: 'https://huggingface.co',
    outputDir: '/tmp/models',
    concurrency: 3,
    createRepoFolder: true,
  }
  const preferences = sanitizePreferences({ ...fallback, token: 'hf_secret' }, fallback)
  assert.equal('token' in preferences, false)
})

test('history rejects malformed session identifiers and truncates unsafe rows', () => {
  assert.equal(isValidSessionId('session-1712345678901'), true)
  assert.equal(isValidSessionId('../history.json'), false)
  assert.deepEqual(sanitizeHistoryEntries([{ sessionId: '../history.json' }]), [])
})
