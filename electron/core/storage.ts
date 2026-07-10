import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const MAX_JSON_BYTES = 8 * 1024 * 1024

function ensureParent(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 })
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!existsSync(filePath)) return fallback
    if (statSync(filePath).size > MAX_JSON_BYTES) return fallback
    const raw = readFileSync(filePath, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeJsonFile(filePath: string, value: unknown) {
  ensureParent(filePath)
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(tempPath, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    renameSync(tempPath, filePath)
    if (process.platform !== 'win32') chmodSync(filePath, 0o600)
  } finally {
    if (existsSync(tempPath)) rmSync(tempPath, { force: true })
  }
}
