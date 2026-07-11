const { tasks: createTasksApi } = require('@googleapis/tasks');
const { getClient } = require('./auth');

// Wraps the Google Tasks API, handling pagination and normalizing responses.
// All functions return flattened arrays of normalized objects (id, title, and computed fields).

function getTasksApi() {
  return createTasksApi({ version: 'v1', auth: getClient() });
}

function normalizeTask(task) {
  return {
    id: task.id,
    title: task.title ?? '',
    completed: task.status === 'completed',
    notes: task.notes ?? null,
    position: task.position,
  };
}

// showCompleted: false excludes completed tasks server-side, so this counts only
// active (remaining) tasks without fetching full task bodies (fields trims the payload).
async function countActiveTasks(taskListId) {
  const tasksApi = getTasksApi();
  let count = 0;
  let pageToken;

  do {
    const { data } = await tasksApi.tasks.list({
      tasklist: taskListId,
      maxResults: 100,
      showCompleted: false,
      pageToken,
      fields: 'items(id),nextPageToken',
    });
    count += (data.items || []).length;
    pageToken = data.nextPageToken;
  } while (pageToken);

  return count;
}

async function listTaskLists() {
  const tasksApi = getTasksApi();
  const taskLists = [];
  let pageToken;

  // Paginate through all lists (API returns up to 100 per request).
  do {
    const { data } = await tasksApi.tasklists.list({ maxResults: 100, pageToken });
    for (const list of data.items || []) {
      taskLists.push({ id: list.id, title: list.title });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  // Each list's count is fetched independently and a failure falls back to null
  // (rather than rejecting the whole call) so one flaky per-list request can't
  // blank out every list's count in the sidebar—the renderer keeps the last
  // known value displayed until a real count comes back.
  const activeTaskCounts = await Promise.all(
    taskLists.map((list) => countActiveTasks(list.id).catch(() => null))
  );
  taskLists.forEach((list, index) => {
    list.activeTaskCount = activeTaskCounts[index];
  });

  return taskLists;
}

async function insertTaskList(title) {
  const tasksApi = getTasksApi();
  const { data } = await tasksApi.tasklists.insert({ requestBody: { title } });
  return { id: data.id, title: data.title };
}

async function patchTaskList(taskListId, title) {
  const tasksApi = getTasksApi();
  const { data } = await tasksApi.tasklists.patch({
    tasklist: taskListId,
    requestBody: { title },
  });
  return { id: data.id, title: data.title };
}

// Permanent: the Tasks API has no trash/restore for deleted task lists (also
// deletes all tasks within it).
async function deleteTaskList(taskListId) {
  const tasksApi = getTasksApi();
  await tasksApi.tasklists.delete({ tasklist: taskListId });
}

async function listTasks(taskListId) {
  const tasksApi = getTasksApi();
  const tasks = [];
  let pageToken;

  // Paginate through all tasks, including completed ones (showCompleted: true).
  // Completed status is normalized to a boolean for easier UI consumption.
  do {
    const { data } = await tasksApi.tasks.list({
      tasklist: taskListId,
      maxResults: 100,
      showCompleted: true,
      pageToken,
    });
    for (const task of data.items || []) {
      tasks.push(normalizeTask(task));
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  // Sort active tasks by position (fixed-width numeric strings, so plain string
  // compare is correct). Completed tasks keep API order (sorted by completion time;
  // their positions are meaningless). Sorting here keeps the renderer's array order
  // authoritative between fetches.
  const active = tasks.filter((task) => !task.completed);
  const completed = tasks.filter((task) => task.completed);
  active.sort((a, b) => (a.position < b.position ? -1 : 1));
  return [...active, ...completed];
}

// Inserts at the top of the list unless previousTaskId names the sibling to place it after.
async function insertTask(taskListId, title, previousTaskId) {
  const tasksApi = getTasksApi();
  const { data } = await tasksApi.tasks.insert({
    tasklist: taskListId,
    previous: previousTaskId || undefined,
    requestBody: { title },
  });
  return normalizeTask(data);
}

// Accepts { title?, completed?, notes? }. Un-completing must explicitly null the completed
// timestamp—patching status alone does not reliably clear it (API quirk).
async function patchTask(taskListId, taskId, updates) {
  const tasksApi = getTasksApi();
  const requestBody = {};
  if (updates.title !== undefined) {
    requestBody.title = updates.title;
  }
  if (updates.notes !== undefined) {
    requestBody.notes = updates.notes;
  }
  if (updates.completed === true) {
    requestBody.status = 'completed';
  } else if (updates.completed === false) {
    requestBody.status = 'needsAction';
    requestBody.completed = null;
  }
  const { data } = await tasksApi.tasks.patch({
    tasklist: taskListId,
    task: taskId,
    requestBody,
  });
  return normalizeTask(data);
}

// Permanent: the Tasks API has no trash/restore for deleted tasks.
async function deleteTask(taskListId, taskId) {
  const tasksApi = getTasksApi();
  await tasksApi.tasks.delete({ tasklist: taskListId, task: taskId });
}

// Only valid for active tasks; the API rejects moves of completed tasks.
async function moveTask(taskListId, taskId, previousTaskId) {
  const tasksApi = getTasksApi();
  const { data } = await tasksApi.tasks.move({
    tasklist: taskListId,
    task: taskId,
    previous: previousTaskId || undefined,
  });
  return normalizeTask(data);
}

module.exports = { listTaskLists, insertTaskList, patchTaskList, deleteTaskList, listTasks, insertTask, patchTask, deleteTask, moveTask };
