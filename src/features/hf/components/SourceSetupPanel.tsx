import { useState } from 'react'

import { MIRRORS, type HfWorkbench } from '../hooks/useHfWorkbench'

type SourceSetupPanelProps = Pick<HfWorkbench,
  | 'paths'
  | 'repoId'
  | 'setRepoId'
  | 'endpoint'
  | 'setEndpoint'
  | 'customEndpoint'
  | 'setCustomEndpoint'
  | 'useCustomEndpoint'
  | 'setUseCustomEndpoint'
  | 'token'
  | 'setToken'
  | 'tokenAllowed'
  | 'outputDir'
  | 'concurrency'
  | 'setConcurrency'
  | 'createRepoFolder'
  | 'setCreateRepoFolder'
  | 'endpointStatus'
  | 'activeAction'
  | 'loadingManifest'
  | 'hasManifest'
  | 'message'
  | 'readiness'
  | 'handlePickDirectory'
  | 'handleTestEndpoint'
  | 'handleLoadManifest'
> & {
  allowCustomEndpoint: boolean
}

export function SourceSetupPanel(props: SourceSetupPanelProps) {
  const [showToken, setShowToken] = useState(false)

  return (
    <section id="source-section" className="sol-panel source-panel workflow-anchor" aria-labelledby="source-title">
      <div className="section-heading">
        <div className="section-index" aria-hidden="true">01</div>
        <div>
          <p className="section-kicker">SOURCE</p>
          <h2 id="source-title">连接模型仓库</h2>
          <p>确定来源、访问凭证和本地落点。Token 只保留在当前应用会话中。</p>
        </div>
        <div className="readiness-row" aria-label="下载准备状态">
          {props.readiness.map((item) => (
            <span key={item.label} className={item.ok ? 'readiness-chip readiness-chip--ready' : 'readiness-chip'} title={item.detail}>
              <span>{item.label}</span>
              <strong>{item.detail}</strong>
            </span>
          ))}
        </div>
      </div>

      <div className="source-grid">
        <label className="field field--repo" htmlFor="repo-id">
          <span className="field__label">仓库 ID</span>
          <input
            id="repo-id"
            value={props.repoId}
            onChange={(event) => props.setRepoId(event.target.value)}
            placeholder="owner/repository"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <small>例如：black-forest-labs/FLUX.1-dev</small>
        </label>

        <label className="field" htmlFor="endpoint-profile">
          <span className="field__label">Endpoint</span>
          <select
            id="endpoint-profile"
            value={props.useCustomEndpoint ? 'custom' : props.endpoint}
            onChange={(event) => {
              if (event.target.value === 'custom') {
                props.setToken('')
                props.setUseCustomEndpoint(true)
                props.setCustomEndpoint(props.endpoint)
              } else {
                if (event.target.value !== MIRRORS[0].baseUrl) props.setToken('')
                props.setUseCustomEndpoint(false)
                props.setEndpoint(event.target.value)
              }
            }}
          >
            {MIRRORS.map((mirror) => <option key={mirror.id} value={mirror.baseUrl}>{mirror.label}</option>)}
            {props.allowCustomEndpoint ? <option value="custom">自定义 Endpoint（开发模式）</option> : null}
          </select>
          {props.useCustomEndpoint ? (
            <input
              className="field__subinput"
              aria-label="自定义 Endpoint 地址"
              value={props.customEndpoint}
              onChange={(event) => props.setCustomEndpoint(event.target.value)}
              placeholder="https://example.com"
              autoCapitalize="none"
              spellCheck={false}
            />
          ) : <small>可随时测试当前节点连通性</small>}
        </label>

        <label className="field field--token" htmlFor="access-token">
          <span className="field__label">访问 Token <em>可选</em></span>
          <div className="input-action">
            <input
              id="access-token"
              type={showToken ? 'text' : 'password'}
              value={props.token}
              onChange={(event) => props.setToken(event.target.value)}
              placeholder="私有或受限仓库需要"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={!props.tokenAllowed}
            />
            <button type="button" className="text-button" onClick={() => setShowToken((current) => !current)} disabled={!props.tokenAllowed}>
              {showToken ? '隐藏' : '显示'}
            </button>
          </div>
          <small>{props.tokenAllowed ? '仅官方源可用；建议使用 fine-grained read Token，不写入偏好、历史或日志' : '非官方 Endpoint 禁止接收 Token，切换后会自动清除当前值'}</small>
        </label>

        <label className="field field--directory" htmlFor="output-directory">
          <span className="field__label">下载目录</span>
          <div className="input-action">
            <input
              id="output-directory"
              value={props.outputDir}
              placeholder={props.paths?.downloadsDir ?? '选择本地目录'}
              readOnly
              spellCheck={false}
            />
            <button type="button" className="text-button" onClick={props.handlePickDirectory}>选择</button>
          </div>
          <small>{props.paths ? `应用数据与缓存独立存放在 ${props.paths.appDataDir}` : '正在读取本地运行目录'}</small>
        </label>
      </div>

      <div className="source-footer">
        <div className="source-options">
          <label className="compact-field" htmlFor="concurrency">
            <span>并发</span>
            <input
              id="concurrency"
              type="number"
              min={1}
              max={8}
              value={props.concurrency}
              onChange={(event) => props.setConcurrency(Math.min(8, Math.max(1, Number(event.target.value) || 1)))}
            />
          </label>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={props.createRepoFolder}
              onChange={(event) => props.setCreateRepoFolder(event.target.checked)}
            />
            <span>为仓库创建独立子目录</span>
          </label>
        </div>
        <div className="source-actions">
          <button
            type="button"
            className="button button--quiet"
            onClick={props.handleTestEndpoint}
            disabled={props.activeAction === 'endpoint'}
          >
            {props.activeAction === 'endpoint' ? '正在测试' : '测试连接'}
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={props.handleLoadManifest}
            disabled={props.loadingManifest}
          >
            {props.loadingManifest ? '正在读取清单' : props.hasManifest ? '重新读取清单' : '读取文件清单'}
          </button>
        </div>
      </div>

      <div
        className={props.endpointStatus?.ok ? 'message-strip message-strip--success' : 'message-strip'}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span>{props.endpointStatus ? (props.endpointStatus.ok ? '连接正常' : '连接失败') : '工作台状态'}</span>
        <p>
          {props.endpointStatus
            ? `${props.endpointStatus.message}${props.endpointStatus.latencyMs !== null ? ` · ${props.endpointStatus.latencyMs} ms` : ''}`
            : props.message}
        </p>
      </div>
    </section>
  )
}
