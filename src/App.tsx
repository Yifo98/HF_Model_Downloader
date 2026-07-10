import './App.css'

import logoUrl from '../assets/logo-sol.png'
import { DownloadDock } from './features/hf/components/DownloadDock'
import { HistoryPanel } from './features/hf/components/HistoryPanel'
import { SelectionWorkspace } from './features/hf/components/SelectionWorkspace'
import { SourceSetupPanel } from './features/hf/components/SourceSetupPanel'
import { StatusPanel } from './features/hf/components/StatusPanel'
import { UpdatePanel } from './features/hf/components/UpdatePanel'
import { useHfWorkbench } from './features/hf/hooks/useHfWorkbench'

export default function App() {
  const workbench = useHfWorkbench()
  const workflow = [
    {
      id: 'source-section',
      number: '01',
      label: '连接',
      status: workbench.loadingManifest ? '读取中' : workbench.hasManifest ? '清单就绪' : workbench.repoLooksValid ? '待读取' : '待连接',
      tone: workbench.loadingManifest ? 'active' : workbench.hasManifest ? 'ready' : 'waiting',
    },
    {
      id: 'selection-section',
      number: '02',
      label: '策展',
      status: workbench.hasManifest ? `已选 ${workbench.selectedPaths.length} 项` : '等待清单',
      tone: workbench.selectedPaths.length > 0 ? 'ready' : 'waiting',
    },
    {
      id: 'download-section',
      number: '03',
      label: '下载',
      status: workbench.queueActive ? '正在下载' : workbench.canStartDownload ? '可以开始' : '尚未就绪',
      tone: workbench.queueActive ? 'active' : workbench.canStartDownload ? 'ready' : 'waiting',
    },
    {
      id: 'monitor-section',
      number: '04',
      label: '监控',
      status: workbench.update.queue.running > 0
        ? `${workbench.update.queue.running} 项运行`
        : workbench.update.jobs.length > 0 ? `${workbench.update.jobs.length} 项任务` : '当前空闲',
      tone: workbench.update.queue.running > 0 ? 'active' : workbench.update.jobs.length > 0 ? 'ready' : 'waiting',
    },
  ]

  function scrollToSection(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="sol-app">
      <header className="sol-header">
        <div className="brand-lockup">
          <div className="brand-lockup__image">
            <img src={logoUrl} alt="" />
          </div>
          <div>
            <p>HF MODEL DOWNLOADER</p>
            <h1>Sol <span>{workbench.appInfo ? workbench.appInfo.version : '…'}</span></h1>
          </div>
        </div>

        <div className="flow-map" aria-label="实时工作流状态">
          {workflow.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`flow-map__item flow-map__item--${item.tone}`}
              onClick={() => scrollToSection(item.id)}
              aria-label={`${item.number} ${item.label}，${item.status}`}
            >
              <span><strong>{item.number}</strong>{item.label}</span>
              <small>{item.status}</small>
            </button>
          ))}
        </div>

        <nav className="sol-header__actions" aria-label="应用快捷操作">
          <button type="button" className="header-button header-button--browse" onClick={() => void window.appApi.openExternal('https://huggingface.co/models')}>
            浏览模型库
          </button>
          <button
            type="button"
            className={workbench.updateCenterOpen ? 'header-button header-button--active' : 'header-button'}
            onClick={() => {
              if (workbench.updateCenterOpen) {
                workbench.setUpdateCenterOpen(false)
              } else if (workbench.softwareUpdate) {
                workbench.setUpdateCenterOpen(true)
              } else {
                void workbench.handleCheckForUpdates().catch(() => undefined)
              }
            }}
            aria-expanded={workbench.updateCenterOpen}
            aria-controls="update-region"
          >
            检查更新
          </button>
          <button
            type="button"
            className={workbench.historyOpen ? 'history-button history-button--active' : 'history-button'}
            onClick={workbench.handleToggleHistory}
            aria-expanded={workbench.historyOpen}
            aria-controls="history-region"
          >
            <span>{workbench.historyOpen ? '收起历史' : '下载历史'}</span>
            <strong>{workbench.historySummary.total}</strong>
          </button>
        </nav>
      </header>

      <main className="sol-main">
        {workbench.updateCenterOpen ? (
          <div id="update-region">
            <UpdatePanel
              appInfo={workbench.appInfo}
              softwareUpdate={workbench.softwareUpdate}
              preparedUpdate={workbench.preparedUpdate}
              updateApplyResult={workbench.updateApplyResult}
              updateAction={workbench.updateAction}
              updateError={workbench.updateError}
              setUpdateCenterOpen={workbench.setUpdateCenterOpen}
              handleCheckForUpdates={workbench.handleCheckForUpdates}
              handlePrepareUpdate={workbench.handlePrepareUpdate}
              handleApplyPreparedUpdate={workbench.handleApplyPreparedUpdate}
            />
          </div>
        ) : null}

        {workbench.historyOpen ? (
          <div id="history-region">
            <HistoryPanel
              entries={workbench.visibleHistory}
              summary={workbench.historySummary}
              statusFilter={workbench.historyStatusFilter}
              repoFilter={workbench.historyRepoFilter}
              repoOptions={workbench.historyRepoOptions}
              onStatusFilterChange={workbench.setHistoryStatusFilter}
              onRepoFilterChange={workbench.setHistoryRepoFilter}
              onDelete={workbench.handleDeleteHistory}
              onRefresh={workbench.handleRefreshHistory}
              syncing={workbench.historySyncing}
              syncMessage={workbench.historySyncMessage}
              onRestore={workbench.handleRestoreHistory}
              onRetry={workbench.handleRetryHistory}
              onOpenFolder={workbench.openDownloadFolder}
            />
          </div>
        ) : null}

        <SourceSetupPanel
          allowCustomEndpoint={workbench.appInfo?.packaged !== true}
          paths={workbench.paths}
          repoId={workbench.repoId}
          setRepoId={workbench.setRepoId}
          endpoint={workbench.endpoint}
          setEndpoint={workbench.setEndpoint}
          customEndpoint={workbench.customEndpoint}
          setCustomEndpoint={workbench.setCustomEndpoint}
          useCustomEndpoint={workbench.useCustomEndpoint}
          setUseCustomEndpoint={workbench.setUseCustomEndpoint}
          token={workbench.token}
          setToken={workbench.setToken}
          tokenAllowed={workbench.tokenAllowed}
          outputDir={workbench.outputDir}
          concurrency={workbench.concurrency}
          setConcurrency={workbench.setConcurrency}
          createRepoFolder={workbench.createRepoFolder}
          setCreateRepoFolder={workbench.setCreateRepoFolder}
          endpointStatus={workbench.endpointStatus}
          activeAction={workbench.activeAction}
          loadingManifest={workbench.loadingManifest}
          hasManifest={workbench.hasManifest}
          message={workbench.message}
          readiness={workbench.readiness}
          handlePickDirectory={workbench.handlePickDirectory}
          handleTestEndpoint={workbench.handleTestEndpoint}
          handleLoadManifest={workbench.handleLoadManifest}
        />

        <div className="sol-workspace">
          <SelectionWorkspace
            hasManifest={workbench.hasManifest}
            visibleManifest={workbench.visibleManifest}
            selectedPaths={workbench.selectedPaths}
            selectedVisibleCount={workbench.selectedVisibleCount}
            search={workbench.search}
            setSearch={workbench.setSearch}
            familyFilter={workbench.familyFilter}
            setFamilyFilter={workbench.setFamilyFilter}
            families={workbench.families}
            quickSelectionOptions={workbench.quickSelectionOptions}
            activeQuickSelection={workbench.activeQuickSelection}
            applyQuickSelection={workbench.applyQuickSelection}
            togglePath={workbench.togglePath}
            selectAllVisible={workbench.selectAllVisible}
            clearAllVisible={workbench.clearAllVisible}
          />

          <StatusPanel
            runtime={workbench.runtime}
            update={workbench.update}
            onRevealFile={workbench.revealDownloadedFile}
            onOpenManagedPath={workbench.openManagedPath}
          />
        </div>

        <DownloadDock
          repoId={workbench.repoId}
          outputDir={workbench.outputDir}
          selectedSummary={workbench.selectedSummary}
          canStartDownload={workbench.canStartDownload}
          queueActive={workbench.queueActive}
          activeAction={workbench.activeAction}
          message={workbench.message}
          handleStartDownload={workbench.handleStartDownload}
          handleCancelDownload={workbench.handleCancelDownload}
          openDownloadFolder={workbench.openDownloadFolder}
        />
      </main>
    </div>
  )
}
