const { contextBridge, ipcRenderer } = require('electron');

// Preload script: securely exposes IPC APIs to the renderer process via contextBridge.
// This isolates the renderer from Node.js while allowing controlled main↔renderer communication.

// Window control APIs use send (fire-and-forget) since no response is needed.
contextBridge.exposeInMainWorld('windowControls', {
  close: () => ipcRenderer.send('window-control', 'close'),
  minimize: () => ipcRenderer.send('window-control', 'minimize'),
  maximize: () => ipcRenderer.send('window-control', 'maximize'),
});

// Google Tasks APIs use invoke (request-response) to return data to the renderer.
contextBridge.exposeInMainWorld('googleTasks', {
  getAuthStatus: () => ipcRenderer.invoke('auth:getStatus'),
  signIn: () => ipcRenderer.invoke('auth:signIn'),
  signOut: () => ipcRenderer.invoke('auth:signOut'),
  listTaskLists: () => ipcRenderer.invoke('tasks:listTaskLists'),
  insertTaskList: (title) => ipcRenderer.invoke('tasks:insertTaskList', title),
  patchTaskList: (taskListId, title) => ipcRenderer.invoke('tasks:patchTaskList', taskListId, title),
  deleteTaskList: (taskListId) => ipcRenderer.invoke('tasks:deleteTaskList', taskListId),
  listTasks: (taskListId) => ipcRenderer.invoke('tasks:listTasks', taskListId),
  insertTask: (taskListId, title, previousTaskId) => ipcRenderer.invoke('tasks:insertTask', taskListId, title, previousTaskId),
  patchTask: (taskListId, taskId, updates) => ipcRenderer.invoke('tasks:patchTask', taskListId, taskId, updates),
  deleteTask: (taskListId, taskId) => ipcRenderer.invoke('tasks:deleteTask', taskListId, taskId),
  moveTask: (taskListId, taskId, previousTaskId) => ipcRenderer.invoke('tasks:moveTask', taskListId, taskId, previousTaskId),
});

// Menu-triggered commands push from main to renderer, since accelerators are owned
// by the native Menu (main/menu.js) rather than the renderer's keydown listener.
contextBridge.exposeInMainWorld('appMenu', {
  onNewTask: (callback) => ipcRenderer.on('menu:new-task', callback),
  onNewList: (callback) => ipcRenderer.on('menu:new-list', callback),
  onToggleLeftSidebar: (callback) => ipcRenderer.on('menu:toggle-left-sidebar', callback),
  onToggleRightSidebar: (callback) => ipcRenderer.on('menu:toggle-right-sidebar', callback),
  onToggleCompletedSection: (callback) => ipcRenderer.on('menu:toggle-completed-section', callback),
  onToggleWordWrap: (callback) => ipcRenderer.on('menu:toggle-word-wrap', callback),
  onToggleCompleted: (callback) => ipcRenderer.on('menu:toggle-completed', callback),
  onDeleteTask: (callback) => ipcRenderer.on('menu:delete-task', callback),
  onSelectNext: (callback) => ipcRenderer.on('menu:select-next', callback),
  onSelectPrevious: (callback) => ipcRenderer.on('menu:select-previous', callback),
});

// The global show/hide shortcut (Cmd+Shift+') lives in main.js, outside the
// Menu—same main-to-renderer push mechanism as appMenu, separate namespace
// since it isn't a menu accelerator.
contextBridge.exposeInMainWorld('appVisibility', {
  onShown: (callback) => ipcRenderer.on('app:shown', callback),
});
