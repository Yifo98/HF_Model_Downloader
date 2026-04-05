import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDownloadUrl, normalizeEndpoint } from './hfApi.js'

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
