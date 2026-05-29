import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDownloadUrl, getEndpointProbePlan, getSafeRelativePathSegments, normalizeEndpoint, normalizeRepoId } from './hfApi.js'

test('normalizeEndpoint trims slash and falls back to official', () => {
  assert.equal(normalizeEndpoint('https://hf-mirror.com///'), 'https://hf-mirror.com')
  assert.equal(normalizeEndpoint('   '), 'https://huggingface.co')
})

test('normalizeEndpoint rejects non-http protocols', () => {
  assert.throws(() => normalizeEndpoint('file:///tmp/model'), /http/)
  assert.throws(() => normalizeEndpoint('javascript:alert(1)'), /http/)
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
})

test('buildDownloadUrl encodes nested file names', () => {
  assert.equal(
    buildDownloadUrl('https://huggingface.co/', 'demo/repo', 'folder/model file.safetensors'),
    'https://huggingface.co/demo/repo/resolve/main/folder/model%20file.safetensors?download=1',
  )
})

test('buildDownloadUrl keeps repo owner and name as path segments', () => {
  assert.equal(
    buildDownloadUrl('https://hf-mirror.com', 'black-forest-labs/FLUX.1-dev', 'weights/model.safetensors'),
    'https://hf-mirror.com/black-forest-labs/FLUX.1-dev/resolve/main/weights/model.safetensors?download=1',
  )
})

test('official endpoint probe plan prioritizes token verification when token exists', () => {
  const probes = getEndpointProbePlan('https://huggingface.co/', true)
  assert.equal(probes[0]?.url, 'https://huggingface.co/api/whoami-v2')
  assert.equal(probes[1]?.url, 'https://huggingface.co/api/models/openai-community/gpt2')
})

test('mirror endpoint probe plan avoids whoami and checks models list first', () => {
  const probes = getEndpointProbePlan('https://hf-mirror.com', false)
  assert.equal(probes[0]?.url, 'https://hf-mirror.com/api/models?limit=1')
  assert.equal(probes[1]?.url, 'https://hf-mirror.com/robots.txt')
})
