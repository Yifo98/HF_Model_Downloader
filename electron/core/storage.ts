import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

function ensureParent(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true })
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!existsSync(filePath)) return fallback
    const raw = readFileSync(filePath, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeJsonFile(filePath: string, value: unknown) {
  ensureParent(filePath)
  writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8')
}
