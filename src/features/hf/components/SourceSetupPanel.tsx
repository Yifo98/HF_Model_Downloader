import { useState } from 'react'

import { MIRRORS, type HfWorkbench } from '../hooks/useHfWorkbench'

type SourceSetupPanelProps = Pick<HfWorkbench,
  | 'paths'
  | 'repoId'
  | 'setRepoId'
  | 'endpoint'
  | 'customEndpoint'
  | 'useCustomEndpoint'
  | 'handleEndpointProfileChange'
  | 'handleCustomEndpointChange'
  | 'token'
  | 'setToken'
  | 'tokenAllowed'
  | 'outputDir'
  | 'concurrency'
  | 'setConcurrency'
  | 'createRepoFolder'
  | 'setCreateRepoFolder'
  | 'networkMode'
  | 'setNetworkMode'
  | 'proxyUrl'
  | 'setProxyUrl'
  | 'networkStatus'
  | 'networkError'
  | 'detectingNetwork'
  | 'queueActive'
  | 'endpointStatus'
  | 'activeAction'
  | 'loadingManifest'
  | 'hasManifest'
  | 'message'
  | 'readiness'
  | 'handlePickDirectory'
  | 'handleDetectNetwork'
  | 'handleTestEndpoint'
  | 'handleLoadManifest'
> & {
  allowCustomEndpoint: boolean
}

const NETWORK_MODE_OPTIONS: Array<{ value: NetworkMode; label: string }> = [
  { value: 'auto', label: '自动推荐' },
  { value: 'system', label: '跟随系统代理' },
  { value: 'direct', label: '直连' },
  { value: 'custom', label: '自定义代理' },
]

function networkRouteLabel(mode: NetworkRouteMode) {
  if (mode === 'system') return '系统代理'
  if (mode === 'direct') return '直连'
  return '自定义代理'
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

      <div className="network-routing" aria-labelledby="network-routing-title">
        <div className="network-routing__heading">
          <div>
            <span id="network-routing-title">连接策略</span>
            <small>模型源决定访问站点，网络通道决定如何连接；切换模型源后会自动重新检测。</small>
          </div>
          <p className={props.networkError ? 'network-routing__message network-routing__message--error' : 'network-routing__message'}>
            {props.detectingNetwork
              ? '正在检测可用通道…'
              : props.networkError ?? props.networkStatus?.message ?? '应用启动后会自动检测并给出推荐。'}
          </p>
        </div>

        <div className="network-routing__controls">
          <label className="network-routing__source" htmlFor="endpoint-profile">
            <span>模型源</span>
            <select
              id="endpoint-profile"
              value={props.useCustomEndpoint ? 'custom' : props.endpoint}
              onChange={(event) => props.handleEndpointProfileChange(event.target.value)}
              disabled={props.queueActive || props.activeAction !== null || props.loadingManifest}
            >
              {MIRRORS.map((mirror) => <option key={mirror.id} value={mirror.baseUrl}>{mirror.label}</option>)}
              {props.allowCustomEndpoint ? <option value="custom">自定义 Endpoint（开发模式）</option> : null}
            </select>
            {props.useCustomEndpoint ? (
              <input
                className="field__subinput"
                aria-label="自定义 Endpoint 地址"
                value={props.customEndpoint}
                onChange={(event) => props.handleCustomEndpointChange(event.target.value)}
                placeholder="https://example.com"
                autoCapitalize="none"
                spellCheck={false}
                disabled={props.queueActive || props.activeAction !== null || props.loadingManifest}
              />
            ) : null}
          </label>
          <label className="network-routing__select" htmlFor="network-mode">
            <span>使用方式</span>
            <select
              id="network-mode"
              value={props.networkMode}
              onChange={(event) => props.setNetworkMode(event.target.value as NetworkMode)}
              disabled={props.queueActive || props.activeAction !== null || props.loadingManifest}
            >
              {NETWORK_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="network-routing__proxy" htmlFor="custom-proxy-url">
            <span>自定义代理地址</span>
            <input
              id="custom-proxy-url"
              value={props.proxyUrl}
              onChange={(event) => props.setProxyUrl(event.target.value)}
              placeholder="例如 http://127.0.0.1:7897"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={props.queueActive || props.activeAction !== null || props.loadingManifest}
            />
          </label>
          <button
            type="button"
            className="text-button network-routing__detect"
            onClick={props.handleDetectNetwork}
            disabled={props.detectingNetwork || props.queueActive || props.activeAction !== null || props.loadingManifest}
          >
            {props.detectingNetwork ? '检测中' : '重新检测'}
          </button>
        </div>

        {props.networkStatus ? (
          <div className="network-routing__results" aria-label="网络通道检测结果">
            <span className="network-routing__system" title={props.networkStatus.systemProxySummary}>
              系统：{props.networkStatus.systemProxySummary}
            </span>
            {props.networkStatus.routes.map((route) => (
              <span
                key={route.mode}
                className={route.available ? 'network-route network-route--available' : 'network-route network-route--unavailable'}
                title={route.detail}
              >
                <strong>{networkRouteLabel(route.mode)}</strong>
                <small>{route.available ? `${route.latencyMs ?? 0} ms` : '不可用'}</small>
                {props.networkStatus?.recommendedMode === route.mode ? <em>推荐</em> : null}
              </span>
            ))}
          </div>
        ) : null}
        <small className="network-routing__privacy">代理地址会保存在本机偏好中，因此不允许填写账号或密码。</small>
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
            disabled={props.activeAction === 'endpoint' || props.loadingManifest || props.detectingNetwork}
          >
            {props.activeAction === 'endpoint' ? '正在测试' : '测试连接'}
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={props.handleLoadManifest}
            disabled={props.loadingManifest || props.activeAction === 'endpoint' || props.detectingNetwork}
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
