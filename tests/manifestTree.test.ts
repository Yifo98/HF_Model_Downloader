import assert from 'node:assert/strict'
import test from 'node:test'

import { buildManifestTree, collectDirectoryPaths, updatePathSelection } from '../src/features/hf/services/manifestTree.ts'

type TestItem = {
  path: string
  size: number | null
  category: string
  family: string
}

const items: TestItem[] = [
  { path: 'README.md', size: 20, category: '文档', family: 'docs' },
  { path: 'weights/model-2.safetensors', size: 200, category: '权重', family: 'weights' },
  { path: 'weights/model-10.safetensors', size: 1_000, category: '权重', family: 'weights' },
  { path: 'weights/quantized/model-q4.gguf', size: 400, category: '权重', family: 'weights' },
]

test('manifest tree groups nested paths, sorts folders first, and aggregates complete folders', () => {
  const tree = buildManifestTree(items)
  assert.equal(tree[0]?.kind, 'directory')
  assert.equal(tree[0]?.name, 'weights')
  assert.equal(tree[1]?.kind, 'file')

  const weights = tree[0]
  assert.equal(weights?.kind, 'directory')
  if (weights?.kind !== 'directory') return
  assert.deepEqual(weights.descendantPaths, [
    'weights/model-10.safetensors',
    'weights/model-2.safetensors',
    'weights/quantized/model-q4.gguf',
  ])
  assert.equal(weights.fileCount, 3)
  assert.equal(weights.totalSize, 1_600)
  assert.deepEqual(collectDirectoryPaths(tree), ['weights', 'weights/quantized'])
})

test('filtered tree preserves ancestors while folder selection still covers hidden descendants', () => {
  const tree = buildManifestTree(items, [items[3]!])
  assert.equal(tree.length, 1)
  const weights = tree[0]
  assert.equal(weights?.kind, 'directory')
  if (weights?.kind !== 'directory') return
  assert.deepEqual(weights.descendantPaths, [
    'weights/model-10.safetensors',
    'weights/model-2.safetensors',
    'weights/quantized/model-q4.gguf',
  ])
  assert.equal(weights.children[0]?.kind, 'directory')
})

test('folder selection adds and removes descendants without disturbing unrelated files', () => {
  const selected = updatePathSelection(['README.md'], ['weights/a', 'weights/b'], true)
  assert.deepEqual(selected, ['README.md', 'weights/a', 'weights/b'])
  assert.deepEqual(updatePathSelection(selected, ['weights/a', 'weights/b'], false), ['README.md'])
})
