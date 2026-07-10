import type { HfWorkbench } from '../hooks/useHfWorkbench'

type DownloadDockProps = Pick<HfWorkbench,
  | 'repoId'
  | 'outputDir'
  | 'selectedSummary'
  | 'canStartDownload'
  | 'queueActive'
  | 'activeAction'
  | 'message'
  | 'handleStartDownload'
  | 'handleCancelDownload'
  | 'openDownloadFolder'
>

export function DownloadDock(props: DownloadDockProps) {
  return (
    <section id="download-section" className="download-dock workflow-anchor" aria-labelledby="download-dock-title">
      <div className="download-dock__step" aria-hidden="true">03</div>
      <div className="download-dock__summary">
        <p className="section-kicker">COMMIT</p>
        <h2 id="download-dock-title">{props.queueActive ? '下载正在进行' : '准备写入本地'}</h2>
        <p className="download-dock__message" role="status" aria-live="polite" aria-atomic="true">{props.message}</p>
      </div>
      <div className="download-dock__facts">
        <span><small>仓库</small><strong>{props.repoId || '未设置'}</strong></span>
        <span><small>已选</small><strong>{props.selectedSummary}</strong></span>
        <span><small>目标</small><strong title={props.outputDir}>{props.outputDir || '未选择目录'}</strong></span>
      </div>
      <div className="download-dock__actions">
        <button
          type="button"
          className="button button--coral"
          onClick={props.handleStartDownload}
          disabled={!props.canStartDownload || props.activeAction === 'download'}
        >
          {props.activeAction === 'download' ? '正在启动' : props.queueActive ? '任务运行中' : '开始下载'}
        </button>
        <button type="button" className="button button--quiet" onClick={props.handleCancelDownload} disabled={!props.queueActive}>取消任务</button>
        <button type="button" className="button button--quiet" onClick={() => props.openDownloadFolder(props.outputDir)} disabled={!props.outputDir}>打开下载目录</button>
      </div>
    </section>
  )
}
