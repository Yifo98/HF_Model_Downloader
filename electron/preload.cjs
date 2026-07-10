const { contextBridge, ipcRenderer } = require('electron')

const HF_MODELS_URL = 'https://huggingface.co/models'

function requireString(value, label) {
  if (typeof value !== 'string') throw new TypeError(`${label} 必须是字符串。`)
  return value
}

function requireListener(listener) {
  if (typeof listener !== 'function') throw new TypeError('事件监听器必须是函数。')
  return listener
}

function requireHistoryDeleteMode(value) {
  if (value === undefined || value === 'record-and-files') return 'record-and-files'
  if (value === 'record-only') return value
  throw new TypeError('历史删除模式不合法。')
}

function requireManagedPathKind(value) {
  if (value === 'downloads' || value === 'appData' || value === 'cache') return value
  throw new TypeError('管理目录类型不合法。')
}

const appApi = Object.freeze({
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  getPaths: () => ipcRenderer.invoke('paths:get'),
  getRuntimeStatus: () => ipcRenderer.invoke('runtime:get'),
  getPreferences: () => ipcRenderer.invoke('preferences:get'),
  savePreferences: (value) => ipcRenderer.invoke('preferences:save', value),
  getHistory: () => ipcRenderer.invoke('history:get'),
  refreshHistory: () => ipcRenderer.invoke('history:refresh'),
  deleteHistory: (sessionId, mode) => ipcRenderer.invoke(
    'history:delete',
    requireString(sessionId, '会话 ID'),
    requireHistoryDeleteMode(mode),
  ),
  openManagedPath: (kind) => ipcRenderer.invoke('managed-path:open', requireManagedPathKind(kind)),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  prepareUpdate: () => ipcRenderer.invoke('updates:prepare'),
  applyPreparedUpdate: () => ipcRenderer.invoke('updates:apply'),
  pickDirectory: (currentPath) => ipcRenderer.invoke('dialog:pickDirectory', currentPath),
  testEndpoint: (endpoint, token) => ipcRenderer.invoke('hf:test-endpoint', requireString(endpoint, 'Endpoint'), token),
  listFiles: (payload) => ipcRenderer.invoke('hf:list-files', payload),
  startDownload: (request) => ipcRenderer.invoke('hf:start-download', request),
  cancelDownload: () => ipcRenderer.invoke('hf:cancel-download'),
  getLatestUpdate: () => ipcRenderer.invoke('hf:get-update'),
  openPath: (targetPath) => ipcRenderer.invoke('output:open', requireString(targetPath, '下载目录')),
  showItemInFolder: (targetPath) => ipcRenderer.invoke('output:reveal', requireString(targetPath, '下载文件')),
  openExternal: (targetUrl) => {
    if (targetUrl !== HF_MODELS_URL) return Promise.reject(new Error('只允许打开 Hugging Face Models 官方页面。'))
    return ipcRenderer.invoke('external:open-hf-models')
  },
  onJobUpdate: (listener) => {
    requireListener(listener)
    const wrapped = (_event, payload) => listener(payload)
    ipcRenderer.on('hf:update', wrapped)
    return () => ipcRenderer.removeListener('hf:update', wrapped)
  },
  onHistoryUpdate: (listener) => {
    requireListener(listener)
    const wrapped = (_event, payload) => listener(payload)
    ipcRenderer.on('hf:history', wrapped)
    return () => ipcRenderer.removeListener('hf:history', wrapped)
  },
})

contextBridge.exposeInMainWorld('appApi', appApi)
