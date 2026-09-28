// 설정 화면(settings.html) 전용 브릿지 — 앱 페이지에는 영향 없음
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("veDesktop", {
  getConfig: () => ipcRenderer.invoke("ve:getConfig"),
  test: (url) => ipcRenderer.invoke("ve:test", url),
  save: (url) => ipcRenderer.invoke("ve:save", url),
  chooseDirectory: (title) => ipcRenderer.invoke("ve:chooseDirectory", title),
  codexLogin: () => ipcRenderer.invoke("ve:codexLogin"),
  claudeLogin: () => ipcRenderer.invoke("ve:claudeLogin"),
  startOpenClaw: () => ipcRenderer.invoke("ve:startOpenClaw"),
  openclawOnboard: () => ipcRenderer.invoke("ve:openclawOnboard"),
  openclawSecrets: () => ipcRenderer.invoke("ve:openclawSecrets"),
  protectOpenClawSecrets: () => ipcRenderer.invoke("ve:protectOpenClawSecrets"),
  auditOpenClawSecrets: () => ipcRenderer.invoke("ve:auditOpenClawSecrets"),
  ollamaPull: (model) => ipcRenderer.invoke("ve:ollamaPull", model),
  exportSupportReport: () => ipcRenderer.invoke("ve:exportSupportReport"),
  getUpdateState: () => ipcRenderer.invoke("ve:getUpdateState"),
  checkForUpdates: () => ipcRenderer.invoke("ve:checkForUpdates"),
});
