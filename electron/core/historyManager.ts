import {
  existsSync,
  lstatSync,
  realpathSync,
  unlinkSync,
} from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { getSafeRelativePathSegments, normalizeRepoId } from './hfApi.js'
import { resolveApprovedPath } from './securityPolicy.js'
import type {
  HistoryDeleteMode,
  HistoryDeleteResult,
  HistoryEntry,
  HistorySyncResult,
} from './types.js'

type CandidateState = 'file' | 'missing' | 'unsafe'

type HistoryFileCandidate = {
  path: string
  outputRoot: string
  state: CandidateState
}

function isInside(rootPath: string, targetPath: string) {
  const nested = relative(rootPath, targetPath)
  return nested === '' || (!nested.startsWith('..') && !isAbsolute(nested))
}

function inspectCandidate(outputRoot: string, candidatePath: string): CandidateState {
  if (!isInside(outputRoot, candidatePath) || candidatePath === outputRoot) return 'unsafe'
  const nested = relative(outputRoot, candidatePath)
  let current = outputRoot
  for (const segment of nested.split(sep)) {
    current = resolve(current, segment)
    if (!existsSync(current)) return 'missing'
    let entry
    try {
      entry = lstatSync(current)
    } catch {
      return 'missing'
    }
    if (entry.isSymbolicLink()) return 'unsafe'
    if (current === candidatePath) return entry.isFile() ? 'file' : 'unsafe'
    if (!entry.isDirectory()) return 'unsafe'
  }
  return 'unsafe'
}

function getCandidateLayouts(entry: HistoryEntry) {
  if (entry.createRepoFolder === true) return [true]
  if (entry.createRepoFolder === false) return [false]
  // 5.6 之前的历史没有保存 createRepoFolder，因此只读检查两种旧布局。
  return [true, false]
}

export function resolveHistoryFileCandidates(
  entry: HistoryEntry,
  approvedRoots: readonly string[],
  selectedPath: string,
) {
  const outputRoot = resolveApprovedPath(entry.outputDir, approvedRoots)
  if (!existsSync(outputRoot)) return []
  const rootEntry = lstatSync(outputRoot)
  if (rootEntry.isSymbolicLink() || !rootEntry.isDirectory()) return []
  const canonicalOutputRoot = realpathSync.native(outputRoot)
  const relativeSegments = getSafeRelativePathSegments(selectedPath)
  const repoSegments = normalizeRepoId(entry.repoId).split('/')
  const unique = new Map<string, HistoryFileCandidate>()

  for (const createRepoFolder of getCandidateLayouts(entry)) {
    const candidatePath = resolve(
      canonicalOutputRoot,
      ...(createRepoFolder ? repoSegments : []),
      ...relativeSegments,
    )
    if (!isInside(canonicalOutputRoot, candidatePath)) continue
    unique.set(candidatePath, {
      path: candidatePath,
      outputRoot: canonicalOutputRoot,
      state: inspectCandidate(canonicalOutputRoot, candidatePath),
    })
  }
  return [...unique.values()]
}

function inspectEntry(entry: HistoryEntry, approvedRoots: readonly string[]) {
  let presentCount = 0
  let missingCount = 0
  for (const selectedPath of entry.selectedPaths) {
    let candidates: HistoryFileCandidate[] = []
    try {
      candidates = resolveHistoryFileCandidates(entry, approvedRoots, selectedPath)
    } catch {
      // An unapproved or malformed historical path is never traversed.
    }
    if (candidates.some((candidate) => candidate.state === 'file')) presentCount += 1
    else missingCount += 1
  }
  return { presentCount, missingCount }
}

export function reconcileHistory(entries: readonly HistoryEntry[], approvedRoots: readonly string[]): HistorySyncResult {
  const nextEntries: HistoryEntry[] = []
  let removedRecords = 0

  for (const entry of entries) {
    if (entry.status === 'running' || entry.selectedPaths.length === 0) {
      nextEntries.push({ ...entry, presentCount: 0, missingCount: 0, syncStatus: 'unchecked' })
      continue
    }
    const { presentCount, missingCount } = inspectEntry(entry, approvedRoots)
    // A failed/cancelled task remains useful for retry even when it produced no files.
    if (entry.status === 'success' && presentCount === 0 && missingCount > 0) {
      removedRecords += 1
      continue
    }
    nextEntries.push({
      ...entry,
      presentCount,
      missingCount,
      syncStatus: missingCount > 0 ? 'partial' : 'available',
    })
  }

  return {
    entries: nextEntries,
    removedRecords,
    message: removedRecords > 0
      ? `已同步本地文件，并清理 ${removedRecords} 条已全部移除的下载记录。`
      : '下载历史已与本地文件同步。',
  }
}

function getExistingFileIdentity(candidate: HistoryFileCandidate) {
  if (candidate.state !== 'file') return null
  try {
    const canonical = realpathSync.native(candidate.path)
    if (!isInside(candidate.outputRoot, canonical) || canonical === candidate.outputRoot) return null
    const metadata = lstatSync(canonical, { bigint: true })
    if (metadata.isSymbolicLink() || !metadata.isFile()) return null
    if (metadata.ino !== 0n) return `${metadata.dev}:${metadata.ino}`
    return process.platform === 'win32' || process.platform === 'darwin'
      ? canonical.toLocaleLowerCase('en-US')
      : canonical
  } catch {
    return null
  }
}

function collectReferencedFiles(entries: readonly HistoryEntry[], approvedRoots: readonly string[]) {
  const referenced = new Set<string>()
  for (const entry of entries) {
    for (const selectedPath of entry.selectedPaths) {
      try {
        for (const candidate of resolveHistoryFileCandidates(entry, approvedRoots, selectedPath)) {
          const identity = getExistingFileIdentity(candidate)
          if (identity) referenced.add(identity)
        }
      } catch {
        // Invalid legacy entries cannot authorize filesystem access.
      }
    }
  }
  return referenced
}

export function deleteHistoryEntry(
  entries: readonly HistoryEntry[],
  sessionId: string,
  mode: HistoryDeleteMode,
  approvedRoots: readonly string[],
): HistoryDeleteResult {
  const target = entries.find((entry) => entry.sessionId === sessionId)
  if (!target) {
    return {
      entries: [...entries],
      removedFiles: 0,
      missingFiles: 0,
      failedFiles: 0,
      skippedShared: 0,
      skippedUnsafe: 0,
      recordDeleted: false,
      message: '该下载记录已不存在。',
    }
  }
  if (target.status === 'running') throw new Error('运行中的任务不能删除，请先取消下载。')

  const remaining = entries.filter((entry) => entry.sessionId !== sessionId)
  if (mode === 'record-only') {
    return {
      entries: remaining,
      removedFiles: 0,
      missingFiles: 0,
      failedFiles: 0,
      skippedShared: 0,
      skippedUnsafe: 0,
      recordDeleted: true,
      message: '已仅删除下载记录，本地文件保持不变。',
    }
  }

  const sharedFiles = collectReferencedFiles(remaining, approvedRoots)
  const processedFiles = new Set<string>()
  let removedFiles = 0
  let missingFiles = 0
  let failedFiles = 0
  let skippedShared = 0
  let skippedUnsafe = 0

  for (const selectedPath of target.selectedPaths) {
    let candidates: HistoryFileCandidate[] = []
    try {
      candidates = resolveHistoryFileCandidates(target, approvedRoots, selectedPath)
    } catch {
      skippedUnsafe += 1
      continue
    }
    const existing = candidates.filter((candidate) => candidate.state === 'file')
    if (existing.length === 0) {
      if (candidates.some((candidate) => candidate.state === 'unsafe')) skippedUnsafe += 1
      else missingFiles += 1
      continue
    }

    // Old history rows did not record the chosen layout. If both legacy layouts
    // exist, neither can be proven to belong to this task, so keep both files.
    if (target.createRepoFolder === null && existing.length > 1) {
      skippedUnsafe += existing.length
      continue
    }

    for (const candidate of existing) {
      const identity = getExistingFileIdentity(candidate)
      if (!identity) {
        skippedUnsafe += 1
        continue
      }
      if (processedFiles.has(identity)) continue
      processedFiles.add(identity)
      if (sharedFiles.has(identity)) {
        skippedShared += 1
        continue
      }
      try {
        const entry = lstatSync(candidate.path)
        if (entry.isSymbolicLink() || !entry.isFile()) {
          skippedUnsafe += 1
          continue
        }
        const canonical = realpathSync.native(candidate.path)
        if (!isInside(candidate.outputRoot, canonical)) {
          skippedUnsafe += 1
          continue
        }
        unlinkSync(candidate.path)
        removedFiles += 1
      } catch {
        failedFiles += 1
      }
    }
  }

  const recordDeleted = failedFiles === 0
  const resultingEntries = recordDeleted ? remaining : [...entries]
  return {
    entries: resultingEntries,
    removedFiles,
    missingFiles,
    failedFiles,
    skippedShared,
    skippedUnsafe,
    recordDeleted,
    message: recordDeleted
      ? `已删除记录与 ${removedFiles} 个本地文件${skippedShared > 0 ? `，${skippedShared} 个共享文件已保留` : ''}${skippedUnsafe > 0 ? `，${skippedUnsafe} 个无法唯一确认归属的文件已保留` : ''}。`
      : `有 ${failedFiles} 个文件删除失败，历史记录已保留便于重试。`,
  }
}
