import { formatBytes, formatPercent, formatSpeed } from '../services/format'

type StatusPanelProps = {
  runtime: RuntimeStatus | null
  update: DownloadUpdate
  onRevealFile: (targetPath: string) => void
  onOpenManagedPath: (kind: ManagedPathKind) => void
}

function getManagedPathKind(key: string): ManagedPathKind | null {
  if (key === 'downloads') return 'downloads'
  if (key === 'appdata') return 'appData'
  if (key === 'cache') return 'cache'
  return null
}

export function StatusPanel({ runtime, update, onRevealFile, onOpenManagedPath }: StatusPanelProps) {
  const latestSuccessfulJob = [...update.jobs].reverse().find((job) => job.status === 'success')
  const totalBytes = update.jobs.reduce((sum, job) => sum + (job.totalBytes ?? 0), 0)
  const downloadedBytes = update.jobs.reduce((sum, job) => sum + job.downloadedBytes, 0)
  const overallPercent = totalBytes > 0 ? Math.min(100, (downloadedBytes / totalBytes) * 100) : 0
  const visibleJobs = [...update.jobs]
    .sort((left, right) => {
      const priority: Record<DownloadStatus, number> = {
        running: 0,
        error: 1,
        idle: 2,
        cancelled: 3,
        success: 4,
      }
      return priority[left.status] - priority[right.status]
    })
    .slice(0, 8)

  return (
    <aside id="monitor-section" className="sol-panel monitor-panel workflow-anchor" aria-labelledby="monitor-title">
      <div className="section-heading section-heading--monitor">
        <div className="section-index" aria-hidden="true">04</div>
        <div>
          <p className="section-kicker">MONITOR</p>
          <h2 id="monitor-title">实时监控</h2>
          <p>{update.activeRequest ? update.activeRequest.repoId : '当前没有活动任务'}</p>
        </div>
      </div>

      <div className="queue-overview" aria-live="polite" aria-atomic="true">
        <div className="queue-overview__topline">
          <div>
            <small>总体进度</small>
            <strong>{formatPercent(totalBytes > 0 ? overallPercent : null)}</strong>
          </div>
          <span>{update.queue.completed} / {update.queue.total}</span>
        </div>
        <div
          className="progress-track"
          role="progressbar"
          aria-label="下载总进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(overallPercent)}
        >
          <div className="progress-track__bar" style={{ width: `${overallPercent}%` }} />
        </div>
        <div className="queue-metrics">
          <span><strong>{update.queue.running}</strong> 运行</span>
          <span><strong>{update.queue.pending}</strong> 等待</span>
          <span><strong>{update.queue.failed}</strong> 失败</span>
          <span><strong>{update.queue.concurrency}</strong> 并发</span>
        </div>
        {totalBytes > 0 ? <p>{formatBytes(downloadedBytes)} / {formatBytes(totalBytes)}</p> : null}
      </div>

      <div className="runtime-grid" aria-label="本地运行环境">
        {runtime?.checks.map((item) => {
          const managedPathKind = getManagedPathKind(item.key)
          const content = (
            <>
              <span>{item.label}</span>
              <strong>{item.ok ? '正常' : '注意'}</strong>
              <small title={item.detail}>{item.detail}</small>
              {managedPathKind ? <em>打开目录</em> : null}
            </>
          )
          return managedPathKind ? (
            <button
              type="button"
              key={item.key}
              className={item.ok ? 'runtime-pill runtime-pill--button runtime-pill--ok' : 'runtime-pill runtime-pill--button runtime-pill--warn'}
              onClick={() => onOpenManagedPath(managedPathKind)}
              aria-label={`打开${item.label}：${item.detail}`}
            >
              {content}
            </button>
          ) : (
            <div key={item.key} className={item.ok ? 'runtime-pill runtime-pill--ok' : 'runtime-pill runtime-pill--warn'}>
              {content}
            </div>
          )
        })}
        {!runtime ? <p className="muted-copy">正在检查本地运行环境…</p> : null}
      </div>

        {latestSuccessfulJob ? (
        <div className="latest-complete">
          <span>最近完成</span>
          <div>
            <p>{latestSuccessfulJob.path}</p>
            <button type="button" className="text-button" onClick={() => onRevealFile(latestSuccessfulJob.outputPath)}>在文件夹中显示</button>
          </div>
        </div>
        ) : null}

      <div className="job-list">
        <div className="subsection-heading">
          <h3>活动队列</h3>
          <span>{update.jobs.length} 个任务</span>
        </div>
        {update.jobs.length === 0 ? <p className="monitor-empty">任务启动后，速度和进度会显示在这里。</p> : null}
          {visibleJobs.map((job) => (
          <article key={job.jobId} className={`job-card job-card--${job.status}`}>
            <div className="job-card__topline">
              <strong title={job.path}>{job.path}</strong>
              <span>{formatPercent(job.percent)}</span>
            </div>
            <div className="job-card__meta">
              <span>{job.status}</span>
              <span>{formatSpeed(job.speedBytesPerSecond)}</span>
              <span>{formatBytes(job.downloadedBytes)} / {formatBytes(job.totalBytes)}</span>
            </div>
              {job.status === 'success' ? (
              <button type="button" className="text-button job-card__reveal" onClick={() => onRevealFile(job.outputPath)}>在文件夹中显示</button>
              ) : null}
          </article>
          ))}
      </div>

      <details className="log-disclosure">
        <summary>运行日志 <span>{update.logs.length} 行</span></summary>
        <pre>{update.logs.length ? update.logs.join('\n') : '还没有日志输出。'}</pre>
      </details>
    </aside>
  )
}
