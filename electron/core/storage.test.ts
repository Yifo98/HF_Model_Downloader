import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readJsonFile, writeJsonFile } from './storage.js'

test('JSON storage uses atomic private files', () => {
  const root = mkdtempSync(join(tmpdir(), 'hf-downloader-storage-'))
  const file = join(root, 'state.json')
  try {
    writeJsonFile(file, { ok: true })
    assert.deepEqual(readJsonFile(file, {}), { ok: true })
    assert.equal(readFileSync(file, 'utf8').includes('"ok": true'), true)
    if (process.platform !== 'win32') {
      assert.equal(statSync(file).mode & 0o777, 0o600)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
