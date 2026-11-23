const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pulseAPI', {
  getInitialState: () => ipcRenderer.invoke('get-initial-state'),
  queryPrompt: (promptText) => ipcRenderer.invoke('query-prompt', promptText),
  queryAI: (promptText, conversationHistory = []) =>
    ipcRenderer.invoke('query-ai', { promptText, conversationHistory }),
  getAgyModels: () => ipcRenderer.invoke('get-agy-models'),
  setAgyModel: (modelId) => ipcRenderer.invoke('set-agy-model', modelId),
  resetConversation: () => ipcRenderer.invoke('reset-conversation'),
  getTasks: () => ipcRenderer.invoke('get-tasks'),
  rerunTask: (id) => ipcRenderer.invoke('rerun-task', id),
  stopTask: (id) => ipcRenderer.invoke('stop-task', id),
  removeTask: (id) => ipcRenderer.invoke('remove-task', id),
  executeAction: (payload) => ipcRenderer.invoke('execute-action', payload),
  saveRoutine: (payload) => ipcRenderer.invoke('save-routine', payload),
  deleteRoutine: (id) => ipcRenderer.invoke('delete-routine', id),
  rescanProjects: () => ipcRenderer.invoke('rescan-projects'),
  updateConfig: (partial) => ipcRenderer.invoke('update-config', partial),
  toggleStartup: (enable) => ipcRenderer.invoke('toggle-startup', enable),
  setWindowHeight: (height) => ipcRenderer.send('set-window-height', height),
  setSettingsOpen: (open) => ipcRenderer.send('set-settings-open', open),
  userInteracted: () => ipcRenderer.send('user-interacted'),
  hideWindow: () => ipcRenderer.send('hide-window'),
  onSpotlightFocused: (callback) =>
    ipcRenderer.on('spotlight-focused', (_event, data) => callback(data)),
  onProjectsUpdated: (callback) =>
    ipcRenderer.on('projects-updated', (_event, data) => callback(data)),
  onStartupUpdated: (callback) =>
    ipcRenderer.on('startup-updated', (_event, data) => callback(data)),
  onTasksUpdated: (callback) =>
    ipcRenderer.on('tasks-updated', (_event, data) => callback(data)),
});
