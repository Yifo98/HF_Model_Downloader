const { contextBridge, ipcRenderer } = require('electron')

const appApi = {
  getPaths: () => ipcRenderer.invoke('paths:get'),
  getRuntimeStatus: () => ipcRenderer.invoke('runtime:get'),
  getPreferences: () => ipcRenderer.invoke('preferences:get'),
  savePreferences: (value) => ipcRenderer.invoke('preferences:save', value),
  getHistory: () => ipcRenderer.invoke('history:get'),
  deleteHistory: (sessionId) => ipcRenderer.invoke('history:delete', sessionId),
  pickDirectory: (currentPath) => ipcRenderer.invoke('dialog:pickDirectory', currentPath),
  testEndpoint: (endpoint, token) => ipcRenderer.invoke('hf:test-endpoint', endpoint, token),
  listFiles: (payload) => ipcRenderer.invoke('hf:list-files', payload),
  startDownload: (request) => ipcRenderer.invoke('hf:start-download', request),
  cancelDownload: () => ipcRenderer.invoke('hf:cancel-download'),
  getLatestUpdate: () => ipcRenderer.invoke('hf:get-update'),
  openPath: (targetPath) => ipcRenderer.invoke('shell:openPath', targetPath),
  showItemInFolder: (targetPath) => ipcRenderer.invoke('shell:showItemInFolder', targetPath),
  openExternal: (targetUrl) => ipcRenderer.invoke('shell:openExternal', targetUrl),
  onJobUpdate: (listener) => {
    const wrapped = (_event, payload) => listener(payload)
    ipcRenderer.on('hf:update', wrapped)
    return () => ipcRenderer.removeListener('hf:update', wrapped)
  },
  onHistoryUpdate: (listener) => {
    const wrapped = (_event, payload) => listener(payload)
    ipcRenderer.on('hf:history', wrapped)
    return () => ipcRenderer.removeListener('hf:history', wrapped)
  },
}

contextBridge.exposeInMainWorld('appApi', appApi)
