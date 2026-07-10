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
  ipcMain.handle('tasks:listTaskLists', async () => {
    const taskLists = await googleTasksClient.listTaskLists();
    return { taskLists };
  });

  ipcMain.handle('tasks:insertTaskList', async (_event, title) => {
    const taskList = await googleTasksClient.insertTaskList(title);
    return { taskList };
  });

  ipcMain.handle('tasks:listTasks', async (_event, taskListId) => {
    const tasks = await googleTasksClient.listTasks(taskListId);
    return { tasks };
  });

  ipcMain.handle('tasks:insertTask', async (_event, taskListId, title, previousTaskId) => {
    const task = await googleTasksClient.insertTask(taskListId, title, previousTaskId);
    return { task };
  });

  ipcMain.handle('tasks:patchTask', async (_event, taskListId, taskId, updates) => {
    const task = await googleTasksClient.patchTask(taskListId, taskId, updates);
    return { task };
  });

  ipcMain.handle('tasks:deleteTask', async (_event, taskListId, taskId) => {
    await googleTasksClient.deleteTask(taskListId, taskId);
    return { ok: true };
  });

  ipcMain.handle('tasks:moveTask', async (_event, taskListId, taskId, previousTaskId) => {
    const task = await googleTasksClient.moveTask(taskListId, taskId, previousTaskId);
    return { task };
  });
}

module.exports = { registerIpcHandlers };
