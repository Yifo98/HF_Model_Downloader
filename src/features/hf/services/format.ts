export function formatBytes(numBytes: number | null) {
  if (numBytes === null || Number.isNaN(numBytes)) return '未知'
  let value = numBytes
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

export function formatPercent(value: number | null) {
  if (value === null) return '—'
  return `${value.toFixed(1)}%`
}

export function formatSpeed(value: number) {
  if (!value) return '—'
  return `${formatBytes(value)}/s`
}

export function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}
