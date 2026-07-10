import { formatBytes } from '../services/format'

type FileManifestItem = Window['appApi'] extends { listFiles: (...args: never[]) => Promise<(infer T)[]> } ? T : never

type FileManifestTableProps = {
  items: FileManifestItem[]
  selected: string[]
  onToggle: (path: string) => void
}

export function FileManifestTable({ items, selected, onToggle }: FileManifestTableProps) {
  return (
    <div className="manifest-frame">
      {items.length === 0 ? (
        <div className="manifest-empty">
          <strong>这里还没有文件</strong>
          <p>先读取仓库清单；如果已经读取过，请调整搜索或族群筛选。</p>
        </div>
      ) : (
        <div className="manifest-scroll">
          <table className="manifest-table">
            <caption className="sr-only">Hugging Face 仓库文件清单</caption>
          <thead>
            <tr>
                <th className="manifest-table__check">选择</th>
                <th>文件路径</th>
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
                    <td className="manifest-table__check">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggle(item.path)}
                        aria-label={`选择 ${item.path}`}
                      />
                  </td>
                  <td className="manifest-table__path">{item.path}</td>
                    <td><span className="file-tag">{item.category}</span></td>
                    <td><span className="file-family">{item.family}</span></td>
                    <td className="manifest-table__size">{formatBytes(item.size)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      )}
    </div>
  )
}
