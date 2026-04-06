import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDownloadUrl, getEndpointProbePlan, normalizeEndpoint } from './hfApi.js'

test('normalizeEndpoint trims slash and falls back to official', () => {
  assert.equal(normalizeEndpoint('https://hf-mirror.com///'), 'https://hf-mirror.com')
  assert.equal(normalizeEndpoint('   '), 'https://huggingface.co')
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
