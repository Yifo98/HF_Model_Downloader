import { formatBytes } from '../services/format'

type FileManifestItem = Window['appApi'] extends { listFiles: (...args: never[]) => Promise<(infer T)[]> } ? T : never

type FileManifestTableProps = {
  items: FileManifestItem[]
  selected: string[]
  onToggle: (path: string) => void
  onSelectAll: () => void
  onClearAll: () => void
}

export function FileManifestTable({ items, selected, onToggle, onSelectAll, onClearAll }: FileManifestTableProps) {
  return (
    <section className="panel panel--table">
      <div className="panel__header">
        <div>
          <h3>文件清单</h3>
          <p>{items.length} 个文件，勾选你真正想下载的内容。</p>
        </div>
        <div className="panel__actions">
          <button type="button" className="ghost-button" onClick={onSelectAll}>全选</button>
          <button type="button" className="ghost-button" onClick={onClearAll}>清空</button>
        </div>
      </div>
      <div className="table-wrap">
        {items.length === 0 ? <p className="empty-state empty-state--padded">当前筛选结果为空。先清掉文件筛选或族群筛选，或者回上面重新拉一次清单。</p> : null}
        <table className="manifest-table">
          <thead>
            <tr>
              <th>选择</th>
              <th>路径</th>
              <th>分类</th>
              <th>族群</th>
              <th>大小</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const checked = selected.includes(item.path)
              return (
                <tr key={item.path}>
                  <td>
                    <input type="checkbox" checked={checked} onChange={() => onToggle(item.path)} />
                  </td>
                  <td className="manifest-table__path">{item.path}</td>
                  <td>{item.category}</td>
                  <td>{item.family}</td>
                  <td>{formatBytes(item.size)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
