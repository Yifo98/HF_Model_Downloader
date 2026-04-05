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
  onDelete: (sessionId: string) => void
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
  onRestore,
  onRetry,
  onOpenFolder,
}: HistoryPanelProps) {
  return (
    <section className="panel history-panel">
      <div className="panel__header">
        <div>
          <h3>历史记录</h3>
          <p>点开就该在眼前。这里直接看最近会话、筛失败项、回填重试。</p>
        </div>
      </div>
      <div className="history-summary">
        <div className="history-summary__item">
          <strong>{summary.total}</strong>
          <span>总会话</span>
        </div>
        <div className="history-summary__item">
          <strong>{summary.success}</strong>
          <span>已完成</span>
        </div>
        <div className="history-summary__item">
          <strong>{summary.running}</strong>
          <span>进行中</span>
        </div>
        <div className="history-summary__item">
          <strong>{summary.failed}</strong>
          <span>失败</span>
        </div>
      </div>
      <div className="history-filters">
        <label>
          状态
          <select value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value as 'all' | DownloadStatus)}>
            <option value="all">全部</option>
            <option value="running">进行中</option>
            <option value="success">已完成</option>
            <option value="error">失败</option>
            <option value="cancelled">已取消</option>
          </select>
        </label>
        <label>
          仓库
          <select value={repoFilter} onChange={(event) => onRepoFilterChange(event.target.value)}>
            <option value="">全部仓库</option>
            {repoOptions.map((repoId) => <option key={repoId} value={repoId}>{repoId}</option>)}
          </select>
        </label>
      </div>
      <div className="history-list">
        {entries.length === 0 ? <p className="empty-state">当前筛选下没有历史记录。</p> : null}
        {entries.map((entry) => (
          <article key={entry.sessionId} className={`history-card history-card--${entry.status}`}>
            <div className="history-card__meta">
              <div className="history-card__title-row">
                <h4>{entry.repoId}</h4>
                <span className={`history-badge history-badge--${entry.status}`}>{getStatusLabel(entry.status)}</span>
              </div>
              <p>{entry.endpoint}</p>
              <div className="history-card__facts">
                <span>开始：{formatDate(entry.startedAt)}</span>
                <span>结束：{formatDate(entry.finishedAt)}</span>
                <span>已下载：{formatBytes(entry.downloadedBytes)} / {formatBytes(entry.totalBytes)}</span>
              </div>
              {entry.errorMessage ? <p className="history-card__error">{entry.errorMessage}</p> : null}
            </div>
            <div className="history-card__actions">
              <button type="button" className="ghost-button" onClick={() => onRestore(entry)}>回填</button>
              {entry.status !== 'success' ? <button type="button" className="ghost-button" onClick={() => onRetry(entry)}>重试</button> : null}
              <button type="button" className="ghost-button" onClick={() => onOpenFolder(entry.outputDir)}>打开目录</button>
              <button type="button" className="ghost-button" onClick={() => onDelete(entry.sessionId)}>删除</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
