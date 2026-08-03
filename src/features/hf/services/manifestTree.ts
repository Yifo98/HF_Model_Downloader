export type ManifestTreeSourceItem = {
  path: string
  size: number | null
  category: string
  family: string
}

export type ManifestTreeFileNode<T extends ManifestTreeSourceItem = ManifestTreeSourceItem> = {
  kind: 'file'
  path: string
  name: string
  item: T
}

export type ManifestTreeDirectoryNode<T extends ManifestTreeSourceItem = ManifestTreeSourceItem> = {
  kind: 'directory'
  path: string
  name: string
  children: ManifestTreeNode<T>[]
  descendantPaths: string[]
  fileCount: number
  totalSize: number | null
}

export type ManifestTreeNode<T extends ManifestTreeSourceItem = ManifestTreeSourceItem> =
  | ManifestTreeFileNode<T>
  | ManifestTreeDirectoryNode<T>

type MutableDirectory<T extends ManifestTreeSourceItem> = {
  path: string
  name: string
  directories: Map<string, MutableDirectory<T>>
  files: T[]
}

function createDirectory<T extends ManifestTreeSourceItem>(path: string, name: string): MutableDirectory<T> {
  return { path, name, directories: new Map(), files: [] }
}

function compareNodes<T extends ManifestTreeSourceItem>(left: ManifestTreeNode<T>, right: ManifestTreeNode<T>) {
  if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
  return left.name.localeCompare(right.name, 'en', { numeric: true, sensitivity: 'base' })
}

function allDescendantFiles<T extends ManifestTreeSourceItem>(directory: MutableDirectory<T>): T[] {
  return [
    ...directory.files,
    ...[...directory.directories.values()].flatMap((child) => allDescendantFiles(child)),
  ]
}

function finalizeDirectory<T extends ManifestTreeSourceItem>(
  directory: MutableDirectory<T>,
  visiblePaths: ReadonlySet<string>,
): ManifestTreeDirectoryNode<T> | null {
  const children: ManifestTreeNode<T>[] = [
    ...[...directory.directories.values()]
      .map((child) => finalizeDirectory(child, visiblePaths))
      .filter((child): child is ManifestTreeDirectoryNode<T> => child !== null),
    ...directory.files
      .filter((item) => visiblePaths.has(item.path))
      .map((item) => ({
        kind: 'file' as const,
        path: item.path,
        name: item.path.split('/').at(-1) ?? item.path,
        item,
      })),
  ].sort(compareNodes)

  if (children.length === 0) return null
  const descendants = allDescendantFiles(directory).sort((left, right) => left.path.localeCompare(right.path, 'en'))
  const knownSizes = descendants.filter((item) => item.size !== null)
  return {
    kind: 'directory',
    path: directory.path,
    name: directory.name,
    children,
    descendantPaths: descendants.map((item) => item.path),
    fileCount: descendants.length,
    totalSize: knownSizes.length === descendants.length
      ? knownSizes.reduce((sum, item) => sum + (item.size ?? 0), 0)
      : null,
  }
}

export function buildManifestTree<T extends ManifestTreeSourceItem>(
  allItems: readonly T[],
  visibleItems: readonly T[] = allItems,
): ManifestTreeNode<T>[] {
  const root = createDirectory<T>('', '')

  for (const item of allItems) {
    const segments = item.path.split('/')
    let current = root
    for (const segment of segments.slice(0, -1)) {
      const path = current.path ? `${current.path}/${segment}` : segment
      let child = current.directories.get(segment)
      if (!child) {
        child = createDirectory<T>(path, segment)
        current.directories.set(segment, child)
      }
      current = child
    }
    current.files.push(item)
  }

  const visiblePaths = new Set(visibleItems.map((item) => item.path))
  const rootNode = finalizeDirectory(root, visiblePaths)
  return rootNode?.children ?? []
}

export function collectDirectoryPaths<T extends ManifestTreeSourceItem>(nodes: readonly ManifestTreeNode<T>[]) {
  const paths: string[] = []
  for (const node of nodes) {
    if (node.kind !== 'directory') continue
    paths.push(node.path, ...collectDirectoryPaths(node.children))
  }
  return paths
}

export function updatePathSelection(current: readonly string[], paths: readonly string[], checked: boolean) {
  const selected = new Set(current)
  for (const path of paths) {
    if (checked) selected.add(path)
    else selected.delete(path)
  }
  return [...selected]
}
