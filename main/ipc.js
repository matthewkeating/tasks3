const { ipcMain } = require('electron');
const auth = require('./auth');
const googleTasksClient = require('./googleTasksClient');

// Registers all IPC handlers that the renderer process invokes.
// Handlers are thin wrappers that delegate to business logic in auth.js and googleTasksClient.js.
// This separation keeps IPC wiring independent from implementation, making it easier to
// test business logic and add new endpoints without duplicating logic.

function registerIpcHandlers() {
  ipcMain.handle('auth:getStatus', () => auth.getAuthStatus());
  ipcMain.handle('auth:signIn', () => auth.signIn());
  ipcMain.handle('auth:signOut', () => auth.signOut());

  // Task list endpoints return wrapped responses for consistency and future extensibility.
  // Network errors are caught here to suppress Electron's console logging—the renderer
  // handles errors via try/catch and the poll retries automatically.
  ipcMain.handle('tasks:listTaskLists', async () => {
    try {
      const taskLists = await googleTasksClient.listTaskLists();
      return { taskLists };
    } catch {
      // Network error; return empty. Renderer shows stale data or empty state. Poll retries in 10s.
      return { taskLists: [] };
    }
  });

  ipcMain.handle('tasks:insertTaskList', async (_event, title) => {
    try {
      const taskList = await googleTasksClient.insertTaskList(title);
      return { taskList };
    } catch {
      return { taskList: null };
    }
  });

  ipcMain.handle('tasks:patchTaskList', async (_event, taskListId, title) => {
    try {
      const taskList = await googleTasksClient.patchTaskList(taskListId, title);
      return { taskList };
    } catch {
      return { taskList: null };
    }
  });

  ipcMain.handle('tasks:listTasks', async (_event, taskListId) => {
    try {
      const tasks = await googleTasksClient.listTasks(taskListId);
      return { tasks };
    } catch {
      return { tasks: [] };
    }
  });

  ipcMain.handle('tasks:insertTask', async (_event, taskListId, title, previousTaskId) => {
    try {
      const task = await googleTasksClient.insertTask(taskListId, title, previousTaskId);
      return { task };
    } catch {
      return { task: null };
    }
  });

  ipcMain.handle('tasks:patchTask', async (_event, taskListId, taskId, updates) => {
    try {
      const task = await googleTasksClient.patchTask(taskListId, taskId, updates);
      return { task };
    } catch {
      return { task: null };
    }
  });

  ipcMain.handle('tasks:deleteTask', async (_event, taskListId, taskId) => {
    try {
      await googleTasksClient.deleteTask(taskListId, taskId);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle('tasks:moveTask', async (_event, taskListId, taskId, previousTaskId) => {
    try {
      const task = await googleTasksClient.moveTask(taskListId, taskId, previousTaskId);
      return { task };
    } catch {
      return { task: null };
    }
  });
}

module.exports = { registerIpcHandlers };
