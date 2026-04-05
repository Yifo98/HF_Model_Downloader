import { formatBytes, formatPercent, formatSpeed } from '../services/format'

type StatusPanelProps = {
  runtime: RuntimeStatus | null
  update: DownloadUpdate
  currentOutputDir: string
  onOpenOutputDir: (targetPath: string) => void
  onRevealFile: (targetPath: string) => void
}

export function StatusPanel({ runtime, update, currentOutputDir, onOpenOutputDir, onRevealFile }: StatusPanelProps) {
  const latestSuccessfulJob = [...update.jobs].reverse().find((job) => job.status === 'success')

  return (
    <aside className="status-column">
      <section className="panel panel--sticky">
        <div className="panel__header">
          <div>
            <h3>运行态</h3>
            <p>这里集中看连接状态 目录信息 队列快照和最近任务 不用来回翻页面</p>
          </div>
        </div>
        <div className="runtime-grid">
          {runtime?.checks.map((item) => (
            <div key={item.key} className={item.ok ? 'runtime-pill runtime-pill--ok' : 'runtime-pill runtime-pill--warn'}>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </div>
          ))}
        </div>
        {latestSuccessfulJob ? (
          <div className="queue-card queue-card--success">
            <h4>最近完成</h4>
            <p>{latestSuccessfulJob.path}</p>
            <div className="panel__actions panel__actions--compact">
              <button type="button" className="ghost-button" onClick={() => onRevealFile(latestSuccessfulJob.outputPath)}>定位文件</button>
              <button type="button" className="ghost-button" onClick={() => onOpenOutputDir(currentOutputDir)}>打开目录</button>
            </div>
          </div>
        ) : null}
        <div className="queue-card">
          <h4>队列快照</h4>
          <p>总数 {update.queue.total} · 运行中 {update.queue.running} · 完成 {update.queue.completed}</p>
          <p>失败 {update.queue.failed} · 已取消 {update.queue.cancelled} · 并发 {update.queue.concurrency}</p>
          {update.activeRequest ? <p className="queue-card__hint">当前仓库：{update.activeRequest.repoId}</p> : <p className="queue-card__hint">还没有活跃任务。</p>}
        </div>
        <div className="job-list">
          <h4>任务遥测</h4>
          {update.jobs.length === 0 ? <p className="empty-state">等待任务启动。</p> : null}
          {update.jobs.slice(0, 6).map((job) => (
            <div key={job.jobId} className="job-card">
              <strong>{job.path}</strong>
              <span>{job.status} · {formatPercent(job.percent)}</span>
              <span>{formatBytes(job.downloadedBytes)} / {formatBytes(job.totalBytes)}</span>
              <span>{formatSpeed(job.speedBytesPerSecond)}</span>
              {job.status === 'success' ? (
                <div className="job-card__actions">
                  <button type="button" className="ghost-button" onClick={() => onRevealFile(job.outputPath)}>定位文件</button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div className="log-box">
          <h4>原始日志</h4>
          <pre>{update.logs.length ? update.logs.join('\n') : '还没有日志输出。'}</pre>
        </div>
      </section>
    </aside>
  )
}
