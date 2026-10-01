const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("teleprompter", {
  showPresenter: () => ipcRenderer.invoke("window:show-presenter"),
  hidePresenter: () => ipcRenderer.invoke("window:hide-presenter"),
  togglePresenter: () => ipcRenderer.invoke("window:toggle-presenter"),
  getDisplayInfo: () => ipcRenderer.invoke("window:presenter-display-info"),
  openScript: () => ipcRenderer.invoke("script:open"),
  startBackend: () => ipcRenderer.invoke("start-backend"),
  stopBackend: () => ipcRenderer.invoke("stop-backend"),
  startParakeet: (options) => ipcRenderer.invoke("parakeet:start", options),
  stopParakeet: () => ipcRenderer.invoke("parakeet:stop"),
  startRecognition: (options) => ipcRenderer.invoke("recognition:start", options),
  stopRecognition: () => ipcRenderer.invoke("recognition:stop"),
  getBackendStatus: () => ipcRenderer.invoke("backend:status"),
  getAudioDevices: () => ipcRenderer.invoke("audio:devices"),
  selectAudioDevice: (device) => ipcRenderer.invoke("audio:select", device)
});
