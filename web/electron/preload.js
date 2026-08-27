const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  testDatabase: (config) => ipcRenderer.invoke('config:test-database', config),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  finishSetup: () => ipcRenderer.invoke('setup:complete'),
  restartServer: () => ipcRenderer.invoke('server:restart'),
  getSystemInfo: () => ipcRenderer.invoke('system:get-info'),
  setLoginItem: (enabled) => ipcRenderer.invoke('application:set-login-item', enabled),
  startMysqlService: () => ipcRenderer.invoke('mysql:start-service'),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
  dashboardReady: () => ipcRenderer.send('dashboard:ready'),
  reportRealtime: (data) => ipcRenderer.send('renderer:realtime', data),
  onSplashStatus: (callback) => ipcRenderer.on('splash:status', (_event, status) => callback(status))
});
