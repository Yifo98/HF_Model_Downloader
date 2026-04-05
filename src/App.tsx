import { useEffect, useMemo, useState } from 'react'
import './App.css'
import logoUrl from '../assets/logo.svg'
import { FileManifestTable } from './features/hf/components/FileManifestTable'
import { HistoryPanel } from './features/hf/components/HistoryPanel'
import { StatusPanel } from './features/hf/components/StatusPanel'
import { formatBytes } from './features/hf/services/format'

const MIRRORS: MirrorProfile[] = [
  { id: 'official', label: '官方源', baseUrl: 'https://huggingface.co', source: 'official' },
  { id: 'mirror', label: 'HF Mirror', baseUrl: 'https://hf-mirror.com', source: 'mirror' },
]

const EMPTY_UPDATE: DownloadUpdate = {
  queue: { total: 0, pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0, concurrency: 1 },
  jobs: [],
  logs: [],
  activeRequest: null,
}

function dedupe(items: string[]) {
  return [...new Set(items)]
}

type QuickSelectionMode = 'weights' | 'runtime' | 'docs' | 'all'
type ThemeMode = 'midnight' | 'ember' | 'aurora'
const THEME_STORAGE_KEY = 'hf-model-downloader.theme'

export default function App() {
  const [paths, setPaths] = useState<AppPaths | null>(null)
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [manifest, setManifest] = useState<FileManifestItem[]>([])
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [repoId, setRepoId] = useState('')
  const [endpoint, setEndpoint] = useState(MIRRORS[0].baseUrl)
  const [customEndpoint, setCustomEndpoint] = useState('')
  const [useCustomEndpoint, setUseCustomEndpoint] = useState(false)
  const [token, setToken] = useState('')
  const [outputDir, setOutputDir] = useState('')
  const [concurrency, setConcurrency] = useState(3)
  const [createRepoFolder, setCreateRepoFolder] = useState(true)
  const [search, setSearch] = useState('')
  const [familyFilter, setFamilyFilter] = useState('all')
  const [endpointStatus, setEndpointStatus] = useState<EndpointTestResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadingManifest, setLoadingManifest] = useState(false)
  const [message, setMessage] = useState('先填一个仓库，再让师姐替你把文件清单拽下来。')
  const [update, setUpdate] = useState<DownloadUpdate>(EMPTY_UPDATE)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyStatusFilter, setHistoryStatusFilter] = useState<'all' | DownloadStatus>('all')
  const [historyRepoFilter, setHistoryRepoFilter] = useState('')
  const [activeQuickSelection, setActiveQuickSelection] = useState<QuickSelectionMode | null>(null)
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return stored === 'ember' || stored === 'aurora' ? stored : 'midnight'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  useEffect(() => {
    let mounted = true
    void Promise.all([
      window.appApi.getPaths(),
      window.appApi.getRuntimeStatus(),
      window.appApi.getPreferences(),
      window.appApi.getHistory(),
      window.appApi.getLatestUpdate(),
    ]).then(([nextPaths, nextRuntime, prefs, nextHistory, latestUpdate]) => {
      if (!mounted) return
      setPaths(nextPaths)
      setRuntime(nextRuntime)
      setRepoId(prefs.repoId)
      setEndpoint(prefs.endpoint)
      setToken(prefs.token)
      setOutputDir(prefs.outputDir || nextPaths.downloadsDir)
      setConcurrency(prefs.concurrency)
      setCreateRepoFolder(prefs.createRepoFolder)
      setHistory(nextHistory)
      setUpdate(latestUpdate)
    })

    const unsubscribe = window.appApi.onJobUpdate((payload) => {
      setUpdate(payload)
    })
    const unsubscribeHistory = window.appApi.onHistoryUpdate((entries) => {
      setHistory(entries)
    })

    return () => {
      mounted = false
      unsubscribe()
      unsubscribeHistory()
    }
  }, [])

  useEffect(() => {
    if (!paths) return
    void window.appApi.savePreferences({
      repoId,
      endpoint: useCustomEndpoint ? customEndpoint : endpoint,
      token,
      outputDir,
      concurrency,
      createRepoFolder,
    })
  }, [repoId, endpoint, customEndpoint, useCustomEndpoint, token, outputDir, concurrency, createRepoFolder, paths])

  const activeEndpoint = useMemo(() => (useCustomEndpoint ? customEndpoint : endpoint).trim(), [customEndpoint, endpoint, useCustomEndpoint])
  const hasManifest = manifest.length > 0
  const repoLooksValid = useMemo(() => repoId.trim().split('/').filter(Boolean).length === 2, [repoId])
  const needsTokenHint = useMemo(() => !token.trim(), [token])

  const visibleManifest = useMemo(() => {
    return manifest.filter((item) => {
      const keyword = search.trim().toLowerCase()
      const matchesSearch =
        !keyword
        || item.path.toLowerCase().includes(keyword)
        || item.category.toLowerCase().includes(keyword)
        || item.family.toLowerCase().includes(keyword)
      const matchesFamily = familyFilter === 'all' || item.family === familyFilter
      return matchesSearch && matchesFamily
    })
  }, [familyFilter, manifest, search])

  const families = useMemo(() => ['all', ...new Set(manifest.map((item) => item.family))], [manifest])
  const totalSelectedBytes = useMemo(() => manifest.filter((item) => selectedPaths.includes(item.path)).reduce((sum, item) => sum + (item.size ?? 0), 0), [manifest, selectedPaths])
  const selectedVisibleCount = useMemo(() => visibleManifest.filter((item) => selectedPaths.includes(item.path)).length, [selectedPaths, visibleManifest])
  const historySummary = useMemo(() => ({
    total: history.length,
    success: history.filter((item) => item.status === 'success').length,
    running: history.filter((item) => item.status === 'running').length,
    failed: history.filter((item) => item.status === 'error').length,
  }), [history])
  const historyRepoOptions = useMemo(() => [...new Set(history.map((item) => item.repoId))].sort((left, right) => left.localeCompare(right)), [history])
  const visibleHistory = useMemo(() => {
    return history.filter((entry) => {
      const matchesStatus = historyStatusFilter === 'all' || entry.status === historyStatusFilter
      const matchesRepo = !historyRepoFilter || entry.repoId === historyRepoFilter
      return matchesStatus && matchesRepo
    })
  }, [history, historyRepoFilter, historyStatusFilter])
  const preflightItems = useMemo(() => ([
    {
      label: '仓库格式',
      ok: repoLooksValid,
      detail: repoLooksValid ? '格式正确' : '请写成 owner/repo',
    },
    {
      label: 'Token',
      ok: !needsTokenHint,
      detail: needsTokenHint ? '公开仓库可留空，私有仓库记得补' : '已填写，可访问受限仓库',
    },
    {
      label: '输出目录',
      ok: Boolean(outputDir.trim()),
      detail: outputDir.trim() || '还没选目录',
    },
    {
      label: '文件清单',
      ok: hasManifest,
      detail: hasManifest ? `已读取 ${manifest.length} 项` : '还没加载',
    },
  ]), [repoLooksValid, needsTokenHint, outputDir, hasManifest, manifest.length])
  const quickSelectionOptions = useMemo(() => {
    const buildSelection = (mode: QuickSelectionMode) => {
      const matchedItems = mode === 'all'
        ? visibleManifest
        : visibleManifest.filter((item) => {
            if (mode === 'weights') return item.family === 'weights'
            if (mode === 'runtime') return ['weights', 'config', 'tokenizer'].includes(item.family)
            if (mode === 'docs') return ['docs', 'media'].includes(item.family)
            return true
          })

      const matchedPaths = matchedItems.map((item) => item.path)
      const selectedCount = matchedPaths.filter((path) => selectedPaths.includes(path)).length
      const totalBytes = matchedItems.reduce((sum, item) => sum + (item.size ?? 0), 0)
      return { matchedItems, matchedPaths, selectedCount, totalBytes }
    }

    return [
      {
        mode: 'weights' as const,
        title: '模型权重',
        description: '只拿主要权重文件 适合已经熟悉仓库结构 想自己补配置的人',
        note: '范围最小 只保留核心模型文件 通常不含配置和 tokenizer',
        ...buildSelection('weights'),
      },
      {
        mode: 'runtime' as const,
        title: '推荐下载',
        description: '把权重 配置 tokenizer 一起带走 更适合直接推理或部署',
        note: '这是包含模型权重的完整默认方案 一般优先用它',
        ...buildSelection('runtime'),
      },
      {
        mode: 'docs' as const,
        title: '文档示例',
        description: '只看 README 示例图和说明文件 适合先摸清仓库内容',
        note: '不会下载大权重 更适合快速浏览',
        ...buildSelection('docs'),
      },
      {
        mode: 'all' as const,
        title: '当前结果全选',
        description: '把当前搜索和筛选结果全部勾上 适合已经缩小范围后一次带走',
        note: '只作用于当前可见结果 不会动到已被过滤的条目',
        ...buildSelection('all'),
      },
    ]
  }, [selectedPaths, visibleManifest])

  async function handlePickDirectory() {
    const picked = await window.appApi.pickDirectory(outputDir || paths?.downloadsDir)
    if (picked) setOutputDir(picked)
  }

  function openDownloadFolder(targetPath: string) {
    if (!targetPath) return
    void window.appApi.openPath(targetPath)
  }

  function revealDownloadedFile(targetPath: string) {
    if (!targetPath) return
    void window.appApi.showItemInFolder(targetPath)
  }

  async function handleTestEndpoint() {
    setBusy(true)
    setEndpointStatus(null)
    const result = await window.appApi.testEndpoint(activeEndpoint, token || null)
    setEndpointStatus(result)
    setBusy(false)
  }

  function applyHistoryEntry(entry: HistoryEntry) {
    setRepoId(entry.repoId)
    setOutputDir(entry.outputDir)
    setConcurrency((current) => current || 3)
    setManifest([])
    setSelectedPaths([])
    setActiveQuickSelection(null)
    setSearch('')
    setFamilyFilter('all')
    const matchedMirror = MIRRORS.find((item) => item.baseUrl === entry.endpoint)
    if (matchedMirror) {
      setUseCustomEndpoint(false)
      setEndpoint(matchedMirror.baseUrl)
      setCustomEndpoint('')
    } else {
      setUseCustomEndpoint(true)
      setCustomEndpoint(entry.endpoint)
    }
  }

  async function loadManifestWithSelection(nextRepoId: string, nextEndpoint: string, preferredPaths?: string[]) {
    if (!nextRepoId.trim()) {
      setMessage('仓库名不能为空。像 `black-forest-labs/FLUX.1-dev` 这样填。')
      return null
    }
    if (!nextEndpoint) {
      setMessage('先给 endpoint 一个合法地址。')
      return null
    }

    setLoadingManifest(true)
    setMessage('正在向 Hugging Face 拉文件清单...')
    try {
      const nextManifest = await window.appApi.listFiles({
        endpoint: nextEndpoint,
        repoId: nextRepoId.trim(),
        token: token.trim() || null,
      })
      setManifest(nextManifest)
      const nextSelectedPaths = preferredPaths?.length
        ? nextManifest.filter((item) => preferredPaths.includes(item.path)).map((item) => item.path)
        : nextManifest.map((item) => item.path)
      setSelectedPaths(nextSelectedPaths)
      setActiveQuickSelection(null)
      setMessage(
        nextManifest.length > 0
          ? `文件清单已加载，共 ${nextManifest.length} 项。${preferredPaths?.length ? ` 已按历史回填 ${nextSelectedPaths.length} 项。` : ''}`
          : '清单接口通了，但这个仓库现在没返回可下载文件。试试官方源、检查权限，或者换个公开仓库先验证。',
      )
      return { manifest: nextManifest, selectedPaths: nextSelectedPaths }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载文件清单失败。')
      return null
    } finally {
      setLoadingManifest(false)
    }
  }

  async function handleLoadManifest() {
    await loadManifestWithSelection(repoId, activeEndpoint)
  }

  async function handleStartDownload() {
    if (!selectedPaths.length) {
      setMessage('至少勾一个文件，不然下载器也不知道你想搬什么。')
      return
    }
    setBusy(true)
    try {
      await window.appApi.startDownload({
        repoId: repoId.trim(),
        outputDir,
        endpoint: activeEndpoint,
        token: token.trim() || null,
        selectedPaths,
        concurrency,
        createRepoFolder,
      })
      setMessage('下载任务已经发给主进程，右侧可以盯实时遥测。')
      setHistory(await window.appApi.getHistory())
      setHistoryOpen(true)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '启动下载失败。')
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteHistory(sessionId: string) {
    const nextHistory = await window.appApi.deleteHistory(sessionId)
    setHistory(nextHistory)
  }

  async function handleRestoreHistory(entry: HistoryEntry) {
    applyHistoryEntry(entry)
    await loadManifestWithSelection(entry.repoId, entry.endpoint, entry.selectedPaths)
    setHistoryOpen(false)
  }

  async function handleRetryHistory(entry: HistoryEntry) {
    applyHistoryEntry(entry)
    const restored = await loadManifestWithSelection(entry.repoId, entry.endpoint, entry.selectedPaths)
    if (!restored || restored.selectedPaths.length === 0) {
      setHistoryOpen(true)
      return
    }

    setBusy(true)
    try {
      await window.appApi.startDownload({
        repoId: entry.repoId.trim(),
        outputDir: entry.outputDir,
        endpoint: entry.endpoint,
        token: token.trim() || null,
        selectedPaths: restored.selectedPaths,
        concurrency,
        createRepoFolder,
      })
      setMessage(`已按历史会话重新发起下载：${entry.repoId}`)
      setHistory(await window.appApi.getHistory())
      setHistoryOpen(true)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '重试下载失败。')
      setHistoryOpen(true)
    } finally {
      setBusy(false)
    }
  }

  function applyQuickSelection(mode: QuickSelectionMode) {
    const selectedByMode = quickSelectionOptions.find((item) => item.mode === mode)?.matchedPaths ?? []

    setSelectedPaths((current) => dedupe([
      ...current.filter((item) => !visibleManifest.some((row) => row.path === item)),
      ...selectedByMode,
    ]))
    setActiveQuickSelection(mode)
  }

  function togglePath(path: string) {
    setActiveQuickSelection(null)
    setSelectedPaths((current) => current.includes(path) ? current.filter((item) => item !== path) : [...current, path])
  }

  function selectAllVisible() {
    setActiveQuickSelection(null)
    setSelectedPaths((current) => dedupe([...current, ...visibleManifest.map((item) => item.path)]))
  }

  function clearAllVisible() {
    const visible = new Set(visibleManifest.map((item) => item.path))
    setActiveQuickSelection(null)
    setSelectedPaths((current) => current.filter((item) => !visible.has(item)))
  }

  return (
    <div className="app-shell">
      <main className="app-main">
        <section className="hero panel">
          <div className="hero__copy">
            <img src={logoUrl} alt="HF Model Downloader" className="hero__logo" />
            <div>
              <p className="eyebrow">HF MODEL DOWNLOADER</p>
              <h1>更顺手地管理 Hugging Face 模型下载</h1>
              <p>读取仓库清单 筛选需要的文件 批量下载并保留历史记录与失败上下文</p>
            </div>
          </div>
          <div className="hero__meta">
            <div className="theme-switcher">
              <span>主题</span>
              <div className="segmented">
                <button type="button" className={theme === 'midnight' ? 'segmented__item active' : 'segmented__item'} onClick={() => setTheme('midnight')}>深夜</button>
                <button type="button" className={theme === 'ember' ? 'segmented__item active' : 'segmented__item'} onClick={() => setTheme('ember')}>余烬</button>
                <button type="button" className={theme === 'aurora' ? 'segmented__item active' : 'segmented__item'} onClick={() => setTheme('aurora')}>极光</button>
              </div>
            </div>
            <button type="button" className="ghost-button" onClick={() => void window.appApi.openExternal('https://huggingface.co/models')}>打开 HF Models</button>
            <button type="button" className={historyOpen ? 'history-toggle history-toggle--active' : 'history-toggle'} onClick={() => setHistoryOpen((current) => !current)}>
              <span>{historyOpen ? '收起历史' : '查看历史'}</span>
              <strong>{historySummary.total}</strong>
            </button>
          </div>
        </section>

        {historyOpen ? (
          <HistoryPanel
            entries={visibleHistory}
            summary={historySummary}
            statusFilter={historyStatusFilter}
            repoFilter={historyRepoFilter}
            repoOptions={historyRepoOptions}
            onStatusFilterChange={setHistoryStatusFilter}
            onRepoFilterChange={setHistoryRepoFilter}
            onDelete={handleDeleteHistory}
            onRestore={handleRestoreHistory}
            onRetry={handleRetryHistory}
            onOpenFolder={openDownloadFolder}
          />
        ) : null}

        <section className="panel form-panel">
          <div className="panel__header">
            <div>
              <h3>仓库配置</h3>
              <p>把配置填完后直接拉清单，下面就能继续筛选和确认，不用再手动切页。</p>
            </div>
          </div>
          <div className="form-grid">
            <label>
              仓库名
              <input value={repoId} onChange={(event) => setRepoId(event.target.value)} placeholder="例如：black-forest-labs/FLUX.1-dev" />
            </label>
            <label>
              下载目录
              <div className="input-with-button">
                <input value={outputDir} onChange={(event) => setOutputDir(event.target.value)} placeholder={paths?.downloadsDir ?? '选择下载目录'} />
                <button type="button" className="ghost-button" onClick={handlePickDirectory}>浏览</button>
              </div>
            </label>
            <label>
              Endpoint 预设
              <select value={useCustomEndpoint ? 'custom' : endpoint} onChange={(event) => {
                if (event.target.value === 'custom') {
                  setUseCustomEndpoint(true)
                  setCustomEndpoint(endpoint)
                } else {
                  setUseCustomEndpoint(false)
                  setEndpoint(event.target.value)
                }
              }}>
                {MIRRORS.map((mirror) => <option key={mirror.id} value={mirror.baseUrl}>{mirror.label}</option>)}
                <option value="custom">自定义</option>
              </select>
            </label>
            {useCustomEndpoint ? (
              <label>
                自定义 Endpoint
                <input value={customEndpoint} onChange={(event) => setCustomEndpoint(event.target.value)} placeholder="https://hf-mirror.example.com" />
              </label>
            ) : null}
            <label>
              Token
              <input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder="可选，私有仓库或限流场景再填" />
            </label>
            <label>
              并发数
              <input type="number" min={1} max={8} value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value) || 1)} />
            </label>
          </div>
          <label className="checkbox-row">
            <input type="checkbox" checked={createRepoFolder} onChange={(event) => setCreateRepoFolder(event.target.checked)} />
            <span>自动创建仓库名子目录，避免不同模型下载到同一层互相污染。</span>
          </label>
          <div className="panel__actions">
            <button type="button" className="ghost-button" onClick={handleTestEndpoint} disabled={busy}>{busy ? '检测中...' : '测试连接'}</button>
            <button type="button" className="primary-button" onClick={handleLoadManifest} disabled={loadingManifest}>{loadingManifest ? '读取清单中...' : hasManifest ? '重新加载文件清单' : '加载文件清单'}</button>
          </div>
          <p className={endpointStatus?.ok ? 'status-line status-line--ok' : 'status-line'}>
            {endpointStatus ? `${endpointStatus.ok ? '成功' : '失败'} · ${endpointStatus.message}${endpointStatus.latencyMs ? ` · ${endpointStatus.latencyMs}ms` : ''}` : message}
          </p>
          {paths ? (
            <div className="storage-note">
              <strong>本地 Hugging Face 数据目录</strong>
              <span>{paths.appDataDir}</span>
              <span>缓存：{paths.cacheDir}</span>
            </div>
          ) : null}
          <div className="preflight-grid">
            {preflightItems.map((item) => (
              <article key={item.label} className={item.ok ? 'preflight-card preflight-card--ok' : 'preflight-card preflight-card--warn'}>
                <strong>{item.label}</strong>
                <span>{item.detail}</span>
              </article>
            ))}
          </div>
        </section>

        <div className="workspace-layout">
          <div className="workspace-main">
            <section className="panel toolbar-panel">
              <div className="toolbar-panel__controls">
                <label>
                  文件筛选
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="按文件名 路径 后缀 分类筛选都行" disabled={!hasManifest} />
                </label>
                <label>
                  族群筛选
                  <select value={familyFilter} onChange={(event) => setFamilyFilter(event.target.value)} disabled={!hasManifest}>
                    {families.map((family) => <option key={family} value={family}>{family === 'all' ? '全部' : family}</option>)}
                  </select>
                </label>
              </div>
              <div className="toolbar-panel__summary">
                {hasManifest ? `当前可见 ${visibleManifest.length} 项 · 已选 ${selectedVisibleCount}/${visibleManifest.length}` : '先加载清单再筛选'}
              </div>
            </section>

            <section className="panel quick-actions-panel">
              <div>
                <h3>推荐方案</h3>
                <p>模型权重是精简版 推荐下载会把权重加上配置与 tokenizer 一起带走 更适合直接使用</p>
              </div>
              <div className="quick-actions">
                {quickSelectionOptions.map((option) => {
                  const exactVisibleMatch =
                    option.matchedPaths.length === selectedVisibleCount
                    && option.selectedCount === option.matchedPaths.length
                  const active = activeQuickSelection === option.mode && exactVisibleMatch
                  return (
                    <button
                      key={option.mode}
                      type="button"
                      className={active ? 'quick-option quick-option--active' : 'quick-option'}
                      onClick={() => applyQuickSelection(option.mode)}
                      disabled={!hasManifest}
                    >
                      <div className="quick-option__header">
                        <strong>{option.title}</strong>
                        <span>{option.selectedCount}/{option.matchedItems.length}</span>
                      </div>
                      <p>{option.description}</p>
                      <small>{option.note}</small>
                      <div className="quick-option__meta">
                        <span>{option.matchedItems.length} 项</span>
                        <span>{formatBytes(option.totalBytes)}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>

            <FileManifestTable items={visibleManifest} selected={selectedPaths} onToggle={togglePath} onSelectAll={selectAllVisible} onClearAll={clearAllVisible} />
          </div>

          <aside className="action-rail panel">
            <div className="panel__header">
              <div>
                <h3>下载操作台</h3>
                <p>把关键摘要和动作收成一块，操作会顺得多。</p>
              </div>
            </div>
            <div className="action-rail__stats">
              <div className="action-stat">
                <strong>仓库</strong>
                <span>{repoId || '还没填'}</span>
              </div>
              <div className="action-stat">
                <strong>已选文件</strong>
                <span>{selectedPaths.length} 项</span>
              </div>
              <div className="action-stat">
                <strong>预计大小</strong>
                <span>{formatBytes(totalSelectedBytes)}</span>
              </div>
              <div className="action-stat">
                <strong>输出目录</strong>
                <span>{outputDir || '还没选'}</span>
              </div>
            </div>
            <div className="panel__actions">
              <button type="button" className="primary-button" onClick={handleStartDownload} disabled={busy || update.queue.running > 0 || !hasManifest}>{update.queue.running > 0 ? '任务运行中' : '开始下载'}</button>
              <button type="button" className="ghost-button" onClick={() => void window.appApi.cancelDownload()} disabled={update.queue.running === 0}>取消任务</button>
              <button type="button" className="ghost-button" onClick={() => openDownloadFolder(outputDir)} disabled={!outputDir}>打开下载目录</button>
            </div>
            <p className="status-line">{message}</p>
          </aside>
        </div>

      </main>

      <StatusPanel runtime={runtime} update={update} currentOutputDir={outputDir} onOpenOutputDir={openDownloadFolder} onRevealFile={revealDownloadedFile} />
    </div>
  )
}
