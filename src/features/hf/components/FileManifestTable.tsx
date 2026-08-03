import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'

import { formatBytes } from '../services/format'
import {
  buildManifestTree,
  collectDirectoryPaths,
  type ManifestTreeDirectoryNode,
  type ManifestTreeNode,
} from '../services/manifestTree'

type FileManifestItem = Window['appApi'] extends { listFiles: (...args: never[]) => Promise<(infer T)[]> } ? T : never

type FileManifestTableProps = {
  allItems: FileManifestItem[]
  items: FileManifestItem[]
  selected: string[]
  onToggle: (path: string) => void
  onToggleMany: (paths: string[], checked: boolean) => void
}

type TreeRowStyle = CSSProperties & { '--tree-depth': number }

function DirectoryCheckbox({
  node,
  selected,
  onToggleMany,
}: {
  node: ManifestTreeDirectoryNode<FileManifestItem>
  selected: ReadonlySet<string>
  onToggleMany: FileManifestTableProps['onToggleMany']
}) {
  const selectedCount = node.descendantPaths.filter((path) => selected.has(path)).length
  const checked = selectedCount === node.descendantPaths.length
  const mixed = selectedCount > 0 && !checked

  return (
    <input
      type="checkbox"
      checked={checked}
      ref={(element) => {
        if (element) element.indeterminate = mixed
      }}
      onChange={(event) => onToggleMany(node.descendantPaths, event.target.checked)}
      aria-label={`${checked ? '取消选择' : '选择'}文件夹 ${node.path} 中的全部 ${node.fileCount} 个文件`}
      aria-checked={mixed ? 'mixed' : checked}
    />
  )
}

function TreeRows({
  nodes,
  depth,
  expanded,
  forceExpanded,
  selected,
  onToggleExpanded,
  onToggle,
  onToggleMany,
}: {
  nodes: ManifestTreeNode<FileManifestItem>[]
  depth: number
  expanded: ReadonlySet<string>
  forceExpanded: boolean
  selected: ReadonlySet<string>
  onToggleExpanded: (path: string) => void
  onToggle: FileManifestTableProps['onToggle']
  onToggleMany: FileManifestTableProps['onToggleMany']
}) {
  return nodes.map((node) => {
    const rowStyle = { '--tree-depth': depth } as TreeRowStyle
    if (node.kind === 'file') {
      const checked = selected.has(node.path)
      return (
        <div
          key={node.path}
          className={checked ? 'manifest-tree__row manifest-tree__row--file manifest-tree__row--selected' : 'manifest-tree__row manifest-tree__row--file'}
          style={rowStyle}
          role="treeitem"
          aria-level={depth + 1}
          aria-selected={checked}
        >
          <span className="manifest-tree__check">
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(node.path)}
              aria-label={`选择文件 ${node.path}`}
            />
          </span>
          <button type="button" className="manifest-tree__name manifest-tree__name--file" onClick={() => onToggle(node.path)} title={node.path}>
            <span className="manifest-tree__file-icon" aria-hidden="true" />
            <span>{node.name}</span>
          </button>
          <span><span className="file-tag">{node.item.category}</span></span>
          <span><span className="file-family">{node.item.family}</span></span>
          <span className="manifest-tree__size">{formatBytes(node.item.size)}</span>
        </div>
      )
    }

    const isExpanded = forceExpanded || expanded.has(node.path)
    const selectedCount = node.descendantPaths.filter((path) => selected.has(path)).length
    return (
      <div key={node.path} className="manifest-tree__branch" role="none">
        <div
          className={selectedCount > 0 ? 'manifest-tree__row manifest-tree__row--directory manifest-tree__row--selected' : 'manifest-tree__row manifest-tree__row--directory'}
          style={rowStyle}
          role="treeitem"
          aria-level={depth + 1}
          aria-expanded={isExpanded}
        >
          <span className="manifest-tree__check">
            <DirectoryCheckbox node={node} selected={selected} onToggleMany={onToggleMany} />
          </span>
          <button
            type="button"
            className="manifest-tree__name manifest-tree__name--directory"
            onClick={() => onToggleExpanded(node.path)}
            aria-label={`${isExpanded ? '收起' : '展开'}文件夹 ${node.path}`}
          >
            <span className={isExpanded ? 'manifest-tree__chevron manifest-tree__chevron--open' : 'manifest-tree__chevron'} aria-hidden="true">›</span>
            <span className="manifest-tree__folder-icon" aria-hidden="true" />
            <strong>{node.name}</strong>
            <small>{selectedCount}/{node.fileCount} 已选</small>
          </button>
          <span><span className="file-tag file-tag--folder">文件夹</span></span>
          <span className="manifest-tree__folder-summary">{node.fileCount} 个文件</span>
          <span className="manifest-tree__size">{formatBytes(node.totalSize)}</span>
        </div>
        {isExpanded ? (
          <div role="group">
            <TreeRows
              nodes={node.children}
              depth={depth + 1}
              expanded={expanded}
              forceExpanded={forceExpanded}
              selected={selected}
              onToggleExpanded={onToggleExpanded}
              onToggle={onToggle}
              onToggleMany={onToggleMany}
            />
          </div>
        ) : null}
      </div>
    )
  })
}

export function FileManifestTable({ allItems, items, selected, onToggle, onToggleMany }: FileManifestTableProps) {
  const [expandedPaths, setExpandedPaths] = useState<string[]>([])
  const tree = useMemo(() => buildManifestTree(allItems, items), [allItems, items])
  const directoryPaths = useMemo(() => collectDirectoryPaths(tree), [tree])
  const expanded = useMemo(() => new Set(expandedPaths), [expandedPaths])
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const filtering = items.length !== allItems.length

  function toggleExpanded(path: string) {
    setExpandedPaths((current) => current.includes(path)
      ? current.filter((item) => item !== path)
      : [...current, path])
  }

  return (
    <div className="manifest-frame">
      {items.length === 0 ? (
        <div className="manifest-empty">
          <strong>这里还没有文件</strong>
          <p>先读取仓库清单；如果已经读取过，请调整搜索或族群筛选。</p>
        </div>
      ) : (
        <>
          <div className="manifest-tree__topbar">
            <span>仓库目录</span>
            <div>
              <button type="button" className="text-button" onClick={() => setExpandedPaths(directoryPaths)}>全部展开</button>
              <button type="button" className="text-button" onClick={() => setExpandedPaths([])} disabled={filtering}>全部收起</button>
            </div>
          </div>
          <div className="manifest-scroll">
            <div className="manifest-tree" role="tree" aria-label="Hugging Face 仓库文件目录">
              <div className="manifest-tree__header" aria-hidden="true">
                <span>选择</span>
                <span>名称</span>
                <span>分类</span>
                <span>族群 / 内容</span>
                <span>大小</span>
              </div>
              <TreeRows
                nodes={tree}
                depth={0}
                expanded={expanded}
                forceExpanded={filtering}
                selected={selectedSet}
                onToggleExpanded={toggleExpanded}
                onToggle={onToggle}
                onToggleMany={onToggleMany}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
