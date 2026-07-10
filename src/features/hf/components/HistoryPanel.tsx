import { useState } from 'react'

import { formatBytes, formatDate } from '../services/format'

type HistoryPanelProps = {
  entries: HistoryEntry[]
  summary: {
    total: number
    success: number
    running: number
    failed: number
  }
  statusFilter: 'all' | DownloadStatus
  repoFilter: string
  repoOptions: string[]
  onStatusFilterChange: (value: 'all' | DownloadStatus) => void
  onRepoFilterChange: (value: string) => void
  onDelete: (sessionId: string, mode: HistoryDeleteMode) => Promise<HistoryDeleteResult>
  onRefresh: () => Promise<HistorySyncResult>
  syncing: boolean
  syncMessage: string
  onRestore: (entry: HistoryEntry) => void
  onRetry: (entry: HistoryEntry) => void
  onOpenFolder: (targetPath: string) => void
}

function getStatusLabel(status: HistoryEntry['status']) {
  switch (status) {
    case 'success':
      return '已完成'
    case 'error':
      return '失败'
    case 'cancelled':
      return '已取消'
    case 'running':
      return '进行中'
    default:
      return status
  }
}

export function HistoryPanel({
  entries,
  summary,
  statusFilter,
  repoFilter,
  repoOptions,
  onStatusFilterChange,
  onRepoFilterChange,
  onDelete,
  onRefresh,
  syncing,
  syncMessage,
  onRestore,
  onRetry,
  onOpenFolder,
}: HistoryPanelProps) {
  const [pendingDelete, setPendingDelete] = useState<HistoryEntry | null>(null)
  const [deleteMode, setDeleteMode] = useState<HistoryDeleteMode | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function confirmDelete(mode: HistoryDeleteMode) {
    if (!pendingDelete) return
    setDeleteMode(mode)
    setDeleteError(null)
    try {
      await onDelete(pendingDelete.sessionId, mode)
      setPendingDelete(null)
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : '删除失败，请重试。')
    } finally {
      setDeleteMode(null)
    }
  }

  return (
    <section className="sol-panel history-panel" aria-labelledby="history-title">
      <div className="history-panel__header">
        <div>
          <p className="section-kicker">HISTORY</p>
          <h2 id="history-title">下载历史</h2>
          <p>恢复模型选择、重试失败任务，或直接打开曾经的下载目录。</p>
        </div>
        <div className="history-panel__tools">
          <div className="history-summary" aria-label="历史概览">
            <span><strong>{summary.total}</strong> 全部</span>
            <span><strong>{summary.success}</strong> 完成</span>
            <span><strong>{summary.running}</strong> 进行中</span>
            <span><strong>{summary.failed}</strong> 失败</span>
          </div>
          <button type="button" className="button button--quiet history-refresh" onClick={() => void onRefresh()} disabled={syncing}>
            {syncing ? '正在核对本地文件' : '同步本地状态'}
          </button>
        </div>
      </div>
      <p className="history-sync-message" role="status" aria-live="polite">{syncMessage}</p>
      <div className="history-filters">
        <label htmlFor="history-status">
          <span>任务状态</span>
          <select id="history-status" value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value as 'all' | DownloadStatus)}>
            <option value="all">全部</option>
            <option value="running">进行中</option>
            <option value="success">已完成</option>
            <option value="error">失败</option>
            <option value="cancelled">已取消</option>
          </select>
        </label>
        <label htmlFor="history-repo">
          <span>模型仓库</span>
          <select id="history-repo" value={repoFilter} onChange={(event) => onRepoFilterChange(event.target.value)}>
            <option value="">全部仓库</option>
            {repoOptions.map((repoId) => <option key={repoId} value={repoId}>{repoId}</option>)}
          </select>
        </label>
      </div>
      <div className="history-list">
        {entries.length === 0 ? <p className="history-empty">当前筛选下没有历史记录。</p> : null}
        {entries.map((entry) => (
          <article key={entry.sessionId} className={`history-card history-card--${entry.status}`}>
            <div className="history-card__meta">
              <div className="history-card__title-row">
                <h4>{entry.repoId}</h4>
                <span className={`history-badge history-badge--${entry.status}`}>{getStatusLabel(entry.status)}</span>
              </div>
              <p className="history-card__endpoint">{entry.endpoint}</p>
              <div className="history-card__facts">
                <span><small>开始</small>{formatDate(entry.startedAt)}</span>
                <span><small>结束</small>{formatDate(entry.finishedAt)}</span>
                <span><small>数据量</small>{formatBytes(entry.downloadedBytes)} / {formatBytes(entry.totalBytes)}</span>
                {entry.syncStatus !== 'unchecked' ? (
                  <span><small>本地状态</small>{entry.missingCount > 0 ? `${entry.presentCount} 项存在，${entry.missingCount} 项缺失` : `${entry.presentCount} 项可用`}</span>
                ) : null}
              </div>
              {entry.errorMessage ? <p className="history-card__error">{entry.errorMessage}</p> : null}
            </div>
            <div className="history-card__actions">
              <button type="button" className="text-button" onClick={() => onRestore(entry)}>恢复选择</button>
              {entry.status !== 'success' ? <button type="button" className="text-button" onClick={() => onRetry(entry)}>重试</button> : null}
              <button type="button" className="text-button" onClick={() => onOpenFolder(entry.outputDir)}>打开目录</button>
              <button
                type="button"
                className="text-button text-button--danger"
                onClick={() => {
                  setDeleteError(null)
                  setPendingDelete(entry)
                }}
              >
                删除
              </button>
            </div>
          </article>
        ))}
      </div>

      {pendingDelete ? (
        <div className="modal-scrim" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !deleteMode) setPendingDelete(null)
        }}>
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-history-title"
            aria-describedby="delete-history-description"
          >
            <p className="section-kicker">DELETE DOWNLOAD</p>
            <h3 id="delete-history-title">同时删除记录和本地文件？</h3>
            <p id="delete-history-description">
              默认会删除 <strong>{pendingDelete.repoId}</strong> 这次任务写入的文件，并移除下载记录。目录中不属于本任务的其他文件不会受到影响。
            </p>
            <div className="confirm-dialog__path" title={pendingDelete.outputDir}>
              <span>下载位置</span>
              <strong>{pendingDelete.outputDir}</strong>
            </div>
            {deleteError ? <p className="confirm-dialog__error" role="alert">{deleteError}</p> : null}
            <div className="confirm-dialog__actions">
              <button
                type="button"
                className="button button--danger"
                onClick={() => void confirmDelete('record-and-files')}
                disabled={deleteMode !== null}
              >
                {deleteMode === 'record-and-files' ? '正在删除' : '删除记录和本地文件'}
              </button>
              <button
                type="button"
                className="button button--quiet"
                onClick={() => void confirmDelete('record-only')}
                disabled={deleteMode !== null}
              >
                {deleteMode === 'record-only' ? '正在删除记录' : '仅删除记录'}
              </button>
              <button type="button" className="text-button" autoFocus onClick={() => setPendingDelete(null)} disabled={deleteMode !== null}>取消</button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  )
}
