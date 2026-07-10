import type { HfWorkbench } from '../hooks/useHfWorkbench'
import { formatBytes, formatDate } from '../services/format'

type UpdatePanelProps = Pick<HfWorkbench,
  | 'appInfo'
  | 'softwareUpdate'
  | 'preparedUpdate'
  | 'updateApplyResult'
  | 'updateAction'
  | 'updateError'
  | 'setUpdateCenterOpen'
  | 'handleCheckForUpdates'
  | 'handlePrepareUpdate'
  | 'handleApplyPreparedUpdate'
>

function getPlatformLabel(platform: string) {
  if (platform === 'darwin') return 'macOS'
  if (platform === 'win32') return 'Windows'
  if (platform === 'linux') return 'Linux'
  return platform
}

function getVerificationLabel(result: UpdateCheckResult, prepared: UpdatePrepareResult | null) {
  if (prepared?.verified) return 'SHA-256 校验通过'
  if (prepared && !prepared.verified) return '校验未通过'
  return result.sha256 ? '下载后校验' : '当前无需下载'
}

export function UpdatePanel(props: UpdatePanelProps) {
  const result = props.softwareUpdate
  const packageAvailable = Boolean(result?.downloadUrl && result.packageSize > 0 && result.sha256)
  const portableName = result
    ? `HF-Model-Downloader-${result.latestVersion}-${result.platform === 'darwin' ? 'mac' : result.platform === 'win32' ? 'windows' : result.platform}-${result.arch}-portable.zip`
    : null

  return (
    <section className="sol-panel update-panel" aria-labelledby="update-title">
      <div className="update-panel__header">
        <div>
          <p className="section-kicker">SOL UPDATE</p>
          <h2 id="update-title">软件与便携运行包</h2>
          <p>从项目的官方 GitHub Release 检查新版本，只下载与当前平台匹配的便携包，并在使用前核对 SHA-256。</p>
        </div>
        <button type="button" className="text-button" onClick={() => props.setUpdateCenterOpen(false)}>收起</button>
      </div>

      <div className="update-panel__status" aria-live="polite" aria-atomic="true">
        <span>
          <small>当前版本</small>
          <strong>{result?.currentVersion ?? props.appInfo?.version ?? '读取中'}</strong>
        </span>
        <span>
          <small>最新版本</small>
          <strong>{result?.latestVersion ?? '尚未检查'}</strong>
        </span>
        <span>
          <small>当前平台</small>
          <strong>{result ? `${getPlatformLabel(result.platform)} ${result.arch}` : getPlatformLabel(props.appInfo?.platform ?? '未知')}</strong>
        </span>
        <span>
          <small>发布包</small>
          <strong title={portableName ?? undefined}>{portableName ?? '检查后显示'}</strong>
        </span>
      </div>

      {result ? (
        <div className="update-release">
          <div className="update-release__heading">
            <div>
              <span className={result.updateAvailable ? 'update-badge update-badge--available' : 'update-badge'}>
                {result.updateAvailable ? '发现新版本' : '当前已是最新版本'}
              </span>
              <h3>{result.releaseName || `Sol ${result.latestVersion}`}</h3>
              <p>{result.publishedAt ? `发布于 ${formatDate(result.publishedAt)}` : 'Release 未提供发布时间'}</p>
            </div>
            <dl className="update-release__facts">
              <div><dt>包大小</dt><dd>{result.packageSize > 0 ? formatBytes(result.packageSize) : '当前无需下载'}</dd></div>
              <div><dt>校验状态</dt><dd>{getVerificationLabel(result, props.preparedUpdate)}</dd></div>
              <div><dt>平台适配</dt><dd>{packageAvailable ? '已提供当前平台包' : result.updateAvailable ? '暂无当前平台包' : '无需更新'}</dd></div>
            </dl>
          </div>
          <div className="release-notes" aria-label="更新日志">
            <h4>更新日志</h4>
            <p>{result.releaseNotes || '此版本没有提供更新说明。'}</p>
          </div>
          {result.sha256 ? <p className="checksum-line" title={result.sha256}><span>SHA-256</span><code>{result.sha256}</code></p> : null}
        </div>
      ) : (
        <p className="update-panel__empty">点击“检查更新”后，会显示版本、更新日志、便携包大小与校验状态。</p>
      )}

      {props.preparedUpdate ? (
        <p className={props.preparedUpdate.verified ? 'update-result update-result--success' : 'update-result'}>
          {props.preparedUpdate.message}
        </p>
      ) : null}
      {props.updateApplyResult ? (
        <p className="update-result update-result--success">
          {props.updateApplyResult.message}
          {props.updateApplyResult.requiredManual ? ' 便携包不会静默覆盖当前应用，请关闭当前版本后手动解压并启动新版本。' : ''}
        </p>
      ) : null}
      {props.updateError ? <p className="update-result update-result--error" role="alert">{props.updateError}</p> : null}

      <div className="update-panel__actions">
        <button
          type="button"
          className="button button--quiet"
          onClick={() => void props.handleCheckForUpdates().catch(() => undefined)}
          disabled={props.updateAction !== null}
        >
          {props.updateAction === 'check' ? '正在检查' : '重新检查'}
        </button>
        <button
          type="button"
          className="button button--primary"
          onClick={() => void props.handlePrepareUpdate().catch(() => undefined)}
          disabled={!result?.updateAvailable || !packageAvailable || props.updateAction !== null || props.preparedUpdate?.verified === true}
        >
          {props.updateAction === 'prepare' ? '正在下载并校验' : props.preparedUpdate?.verified ? '便携更新包已就绪' : '下载并校验便携更新包'}
        </button>
        <button
          type="button"
          className="button button--quiet"
          onClick={() => void props.handleApplyPreparedUpdate().catch(() => undefined)}
          disabled={!props.preparedUpdate?.verified || props.updateAction !== null}
        >
          {props.updateAction === 'apply' ? '正在定位' : '在文件夹中显示更新包'}
        </button>
      </div>
      <p className="update-panel__note">更新只接受固定命名的 HF-Model-Downloader-&lt;version&gt;-mac-&lt;arch&gt;-portable.zip 或 Windows 对应便携包；不会运行 Release 中的任意脚本或未知附件。</p>
    </section>
  )
}
