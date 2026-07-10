import { formatBytes } from '../services/format'
import type { HfWorkbench } from '../hooks/useHfWorkbench'
import { FileManifestTable } from './FileManifestTable'

type SelectionWorkspaceProps = Pick<HfWorkbench,
  | 'hasManifest'
  | 'visibleManifest'
  | 'selectedPaths'
  | 'selectedVisibleCount'
  | 'search'
  | 'setSearch'
  | 'familyFilter'
  | 'setFamilyFilter'
  | 'families'
  | 'quickSelectionOptions'
  | 'activeQuickSelection'
  | 'applyQuickSelection'
  | 'togglePath'
  | 'selectAllVisible'
  | 'clearAllVisible'
>

export function SelectionWorkspace(props: SelectionWorkspaceProps) {
  return (
    <section id="selection-section" className="sol-panel selection-panel workflow-anchor" aria-labelledby="selection-title">
      <div className="section-heading section-heading--compact">
        <div className="section-index" aria-hidden="true">02</div>
        <div>
          <p className="section-kicker">CURATE</p>
          <h2 id="selection-title">策展下载内容</h2>
          <p>{props.hasManifest ? `当前视图 ${props.visibleManifest.length} 项，已选 ${props.selectedVisibleCount} 项` : '读取清单后，可按用途快速组合下载方案。'}</p>
        </div>
      </div>

      <div className="selection-presets" aria-label="推荐下载方案">
        {props.quickSelectionOptions.map((option) => {
          const exactVisibleMatch = option.matchedPaths.length === props.selectedVisibleCount
            && option.selectedCount === option.matchedPaths.length
          const active = props.activeQuickSelection === option.mode && exactVisibleMatch
          return (
            <button
              key={option.mode}
              type="button"
              className={active ? 'preset-button preset-button--active' : 'preset-button'}
              onClick={() => props.applyQuickSelection(option.mode)}
              disabled={!props.hasManifest}
              aria-pressed={active}
            >
              <span className="preset-button__topline">
                <strong>{option.title}</strong>
                <em>{option.note}</em>
              </span>
              <span>{option.description}</span>
              <small>{option.matchedItems.length} 项 · {formatBytes(option.totalBytes)}</small>
            </button>
          )
        })}
      </div>

      <p className="trust-note" role="note">
        优先选择 <strong>safetensors</strong> 权重；文件下载成功只代表传输完成，不代表模型代码天然可信。
      </p>

      <div className="manifest-toolbar">
        <label className="field field--search" htmlFor="manifest-search">
          <span className="field__label">搜索文件</span>
          <input
            id="manifest-search"
            value={props.search}
            onChange={(event) => props.setSearch(event.target.value)}
            placeholder="文件名、路径、后缀或分类"
            disabled={!props.hasManifest}
          />
        </label>
        <label className="field field--family" htmlFor="family-filter">
          <span className="field__label">文件族群</span>
          <select
            id="family-filter"
            value={props.familyFilter}
            onChange={(event) => props.setFamilyFilter(event.target.value)}
            disabled={!props.hasManifest}
          >
            {props.families.map((family) => <option key={family} value={family}>{family === 'all' ? '全部族群' : family}</option>)}
          </select>
        </label>
        <div className="manifest-toolbar__actions">
          <span>{props.selectedVisibleCount} / {props.visibleManifest.length}</span>
          <button type="button" className="text-button" onClick={props.selectAllVisible} disabled={!props.hasManifest}>选择全部</button>
          <button type="button" className="text-button" onClick={props.clearAllVisible} disabled={!props.hasManifest}>清空当前</button>
        </div>
      </div>

      <FileManifestTable
        items={props.visibleManifest}
        selected={props.selectedPaths}
        onToggle={props.togglePath}
      />
    </section>
  )
}
