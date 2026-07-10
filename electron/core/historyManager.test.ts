import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deleteHistoryEntry, reconcileHistory } from './historyManager.js'
import type { HistoryEntry } from './types.js'

function makeEntry(outputDir: string, overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    sessionId: 'session-11111111-1111-4111-8111-111111111111',
    repoId: 'demo/model',
    endpoint: 'https://huggingface.co',
    outputDir,
    selectedPaths: ['weights/model.bin', 'config.json'],
    startedAt: '2026-07-10T00:00:00.000Z',
    finishedAt: '2026-07-10T00:01:00.000Z',
    status: 'success',
    downloadedBytes: 12,
    totalBytes: 12,
    errorMessage: null,
    createRepoFolder: true,
    presentCount: 0,
    missingCount: 0,
    syncStatus: 'unchecked',
    ...overrides,
  }
}

test('history reconciliation reports partial files and drops completed records when all files disappear', () => {
  const root = mkdtempSync(join(tmpdir(), 'hf-history-sync-'))
  try {
    const repoRoot = join(root, 'demo', 'model')
    mkdirSync(join(repoRoot, 'weights'), { recursive: true })
    writeFileSync(join(repoRoot, 'weights', 'model.bin'), 'model')
    const entry = makeEntry(root)

    const partial = reconcileHistory([entry], [root])
    assert.equal(partial.removedRecords, 0)
    assert.equal(partial.entries[0].presentCount, 1)
    assert.equal(partial.entries[0].missingCount, 1)
    assert.equal(partial.entries[0].syncStatus, 'partial')

    rmSync(join(repoRoot, 'weights', 'model.bin'))
    const absent = reconcileHistory([entry], [root])
    assert.equal(absent.removedRecords, 1)
    assert.deepEqual(absent.entries, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('legacy history probes repo-folder and flat layouts without following symbolic links', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'hf-history-legacy-'))
  const outside = mkdtempSync(join(tmpdir(), 'hf-history-outside-'))
  try {
    writeFileSync(join(root, 'config.json'), 'flat legacy file')
    mkdirSync(join(root, 'demo', 'model'), { recursive: true })
    symlinkSync(outside, join(root, 'demo', 'model', 'weights'))
    writeFileSync(join(outside, 'model.bin'), 'must not be followed')
    const result = reconcileHistory([makeEntry(root, { createRepoFolder: null })], [root])
    assert.equal(result.entries[0].presentCount, 1)
    assert.equal(result.entries[0].missingCount, 1)
    assert.equal(existsSync(join(outside, 'model.bin')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('record-and-files deletion keeps files referenced by another history entry', () => {
  const root = mkdtempSync(join(tmpdir(), 'hf-history-delete-'))
  try {
    const repoRoot = join(root, 'demo', 'model')
    mkdirSync(join(repoRoot, 'weights'), { recursive: true })
    writeFileSync(join(repoRoot, 'weights', 'model.bin'), 'shared')
    writeFileSync(join(repoRoot, 'config.json'), 'exclusive')
    const target = makeEntry(root)
    const other = makeEntry(root, {
      sessionId: 'session-22222222-2222-4222-8222-222222222222',
      selectedPaths: ['weights/model.bin'],
    })

    const result = deleteHistoryEntry([target, other], target.sessionId, 'record-and-files', [root])
    assert.equal(result.recordDeleted, true)
    assert.equal(result.removedFiles, 1)
    assert.equal(result.skippedShared, 1)
    assert.equal(existsSync(join(repoRoot, 'config.json')), false)
    assert.equal(existsSync(join(repoRoot, 'weights', 'model.bin')), true)
    assert.deepEqual(result.entries.map((entry) => entry.sessionId), [other.sessionId])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('record-only deletion never touches downloaded files', () => {
  const root = mkdtempSync(join(tmpdir(), 'hf-history-record-only-'))
  try {
    const repoRoot = join(root, 'demo', 'model')
    mkdirSync(join(repoRoot, 'weights'), { recursive: true })
    writeFileSync(join(repoRoot, 'weights', 'model.bin'), 'keep')
    const entry = makeEntry(root, { selectedPaths: ['weights/model.bin'] })
    const result = deleteHistoryEntry([entry], entry.sessionId, 'record-only', [root])
    assert.equal(result.recordDeleted, true)
    assert.equal(result.removedFiles, 0)
    assert.equal(existsSync(join(repoRoot, 'weights', 'model.bin')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('record-and-files deletion preserves parent directories it did not create', () => {
  const root = mkdtempSync(join(tmpdir(), 'hf-history-parent-dirs-'))
  try {
    const parent = join(root, 'user-created', 'placeholder')
    mkdirSync(parent, { recursive: true })
    writeFileSync(join(parent, 'model.bin'), 'remove only this file')
    const entry = makeEntry(root, {
      createRepoFolder: false,
      selectedPaths: ['user-created/placeholder/model.bin'],
    })

    const result = deleteHistoryEntry([entry], entry.sessionId, 'record-and-files', [root])
    assert.equal(result.removedFiles, 1)
    assert.equal(existsSync(join(parent, 'model.bin')), false)
    assert.equal(existsSync(parent), true)
    assert.equal(existsSync(join(root, 'user-created')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('legacy deletion keeps both files when the old layout is ambiguous', () => {
  const root = mkdtempSync(join(tmpdir(), 'hf-history-ambiguous-'))
  try {
    const repoRoot = join(root, 'demo', 'model')
    mkdirSync(repoRoot, { recursive: true })
    writeFileSync(join(root, 'config.json'), 'flat')
    writeFileSync(join(repoRoot, 'config.json'), 'nested')
    const entry = makeEntry(root, { createRepoFolder: null, selectedPaths: ['config.json'] })

    const result = deleteHistoryEntry([entry], entry.sessionId, 'record-and-files', [root])
    assert.equal(result.recordDeleted, true)
    assert.equal(result.removedFiles, 0)
    assert.equal(result.skippedUnsafe, 2)
    assert.equal(existsSync(join(root, 'config.json')), true)
    assert.equal(existsSync(join(repoRoot, 'config.json')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('shared references use file identity on case-insensitive volumes', {
  skip: process.platform !== 'darwin' && process.platform !== 'win32',
}, (context) => {
  const root = mkdtempSync(join(tmpdir(), 'hf-history-casefold-'))
  try {
    const repoRoot = join(root, 'demo', 'model')
    mkdirSync(repoRoot, { recursive: true })
    writeFileSync(join(repoRoot, 'Config.json'), 'shared')
    if (!existsSync(join(repoRoot, 'config.json'))) {
      context.skip('The temporary volume is case-sensitive.')
      return
    }
    const target = makeEntry(root, { selectedPaths: ['Config.json'] })
    const other = makeEntry(root, {
      sessionId: 'session-33333333-3333-4333-8333-333333333333',
      selectedPaths: ['config.json'],
    })

    const result = deleteHistoryEntry([target, other], target.sessionId, 'record-and-files', [root])
    assert.equal(result.removedFiles, 0)
    assert.equal(result.skippedShared, 1)
    assert.equal(existsSync(join(repoRoot, 'Config.json')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
