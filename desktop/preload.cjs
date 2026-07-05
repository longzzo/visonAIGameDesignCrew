// 설정 화면(settings.html) 전용 브릿지 — 앱 페이지에는 영향 없음
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("veDesktop", {
  getConfig: () => ipcRenderer.invoke("ve:getConfig"),
  test: (url) => ipcRenderer.invoke("ve:test", url),
  save: (url) => ipcRenderer.invoke("ve:save", url),
});
