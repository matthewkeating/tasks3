const { ipcMain } = require('electron');
const auth = require('./auth');
const googleTasksClient = require('./googleTasksClient');

// Registers all IPC handlers that the renderer process invokes.
// Handlers are thin wrappers that delegate to business logic in auth.js and googleTasksClient.js.
// This separation keeps IPC wiring independent from implementation, making it easier to
// test business logic and add new endpoints without duplicating logic.

// Wraps a task endpoint: delegate to the client, and on any error (typically a
// network failure) return `fallback` instead of throwing. Swallowing here keeps
// Electron from console-logging the rejection; the renderer handles the fallback
// shape via try/catch and the poll retries automatically in 10s.
function handleTaskCall(channel, fn, fallback) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await fn(...args);
    } catch {
      return fallback;
    }
  });
}

function registerIpcHandlers() {
  // Auth handlers surface their own errors to the renderer, so they aren't wrapped.
  ipcMain.handle('auth:getStatus', () => auth.getAuthStatus());
  ipcMain.handle('auth:signIn', () => auth.signIn());
  ipcMain.handle('auth:signOut', () => auth.signOut());

  // Task endpoints return wrapped responses for consistency and future extensibility.
  const client = googleTasksClient;
  handleTaskCall('tasks:listTaskLists', async () => ({ taskLists: await client.listTaskLists() }), { taskLists: [] });
  handleTaskCall('tasks:insertTaskList', async (title) => ({ taskList: await client.insertTaskList(title) }), { taskList: null });
  handleTaskCall('tasks:patchTaskList', async (id, title) => ({ taskList: await client.patchTaskList(id, title) }), { taskList: null });
  handleTaskCall('tasks:deleteTaskList', async (id) => { await client.deleteTaskList(id); return { ok: true }; }, { ok: false });
  handleTaskCall('tasks:listTasks', async (id) => ({ tasks: await client.listTasks(id) }), { tasks: [] });
  handleTaskCall('tasks:insertTask', async (id, title, prev) => ({ task: await client.insertTask(id, title, prev) }), { task: null });
  handleTaskCall('tasks:patchTask', async (id, taskId, updates) => ({ task: await client.patchTask(id, taskId, updates) }), { task: null });
  handleTaskCall('tasks:deleteTask', async (id, taskId) => { await client.deleteTask(id, taskId); return { ok: true }; }, { ok: false });
  handleTaskCall('tasks:moveTask', async (id, taskId, prev) => ({ task: await client.moveTask(id, taskId, prev) }), { task: null });
}

module.exports = { registerIpcHandlers };
