// Tasks (main list + right-hand detail pane): state and rendering for the
// selected list's tasks, selection, mutation, and inline editing.
let tasks = [];
let selectedTaskId = null;
let draggedTaskId = null;
// Task pending confirmation in the delete modal; null when the modal is closed.
let pendingDeleteTask = null;

const taskList = document.getElementById('taskList');
const activeContainer = document.getElementById('activeContainer');
const completedContainer = document.getElementById('completedContainer');
const completedSection = document.getElementById('completedSection');
const addTaskInput = document.getElementById('addTaskInput');
const emptyState = document.querySelector('.empty-state');
const sidebarRight = document.getElementById('sidebarRight');
const toggleSidebarRightButton = document.getElementById('toggleSidebarRightBtn');
const taskDetailEmpty = document.getElementById('taskDetailEmpty');
const taskDetail = document.getElementById('taskDetail');
const taskDetailTitleInput = document.getElementById('taskDetailTitle');
const taskDetailNotesInput = document.getElementById('taskDetailNotes');
const deleteConfirmModalOverlay = document.getElementById('deleteConfirmModalOverlay');
const deleteConfirmModalMessage = document.getElementById('deleteConfirmModalMessage');
const deleteConfirmCancelBtn = document.getElementById('deleteConfirmCancelBtn');
const deleteConfirmDeleteBtn = document.getElementById('deleteConfirmDeleteBtn');

async function loadTasksForSelectedList() {
  const listId = selectedListId;
  try {
    const { tasks: fetchedTasks } = await window.googleTasks.listTasks(listId);
    // Discard the response if the user switched lists while the request was in flight.
    if (selectedListId !== listId) return;
    tasks = fetchedTasks;
  } catch {
    // Network or API error; leave previously-rendered tasks in place.
    return;
  }
  updateUI();
}

function toggleSidebarRight() {
  const isHidden = sidebarRight.classList.toggle('is-hidden');
  localStorage.setItem('sidebarRightHidden', isHidden);
}

function toggleCompletedSection() {
  const isHidden = completedSection.classList.toggle('is-hidden');
  localStorage.setItem('completedSectionHidden', isHidden);
}

// See restoreSidebarLeftState in taskLists.js for why these run pre-paint from init().
function restoreSidebarRightState() {
  const stored = localStorage.getItem('sidebarRightHidden');
  if (stored !== null) {
    sidebarRight.classList.toggle('is-hidden', stored === 'true');
  }
}

function restoreCompletedSectionState() {
  const stored = localStorage.getItem('completedSectionHidden');
  if (stored !== null) {
    completedSection.classList.toggle('is-hidden', stored === 'true');
  }
}

// ---------------------------------------------------------------------------
// Task mutations
//
// Patch/delete/move are optimistic: mutate local state, re-render, then fire
// the IPC call; on failure, re-fetch to resync with the server. Insert is
// pessimistic because the server assigns the task's id and position.
// ---------------------------------------------------------------------------

// Resync only if the user hasn't switched lists while the mutation was in flight;
// otherwise the re-fetch would clobber the newly selected list's tasks.
async function resyncAfterError(listId) {
  if (selectedListId === listId) {
    await loadTasksForSelectedList();
  }
}

// Visual order: active tasks first, then completed—mirrors how renderTasks partitions.
function getOrderedTasks() {
  return [...tasks.filter((t) => !t.completed), ...tasks.filter((t) => t.completed)];
}

async function handleToggleCompleted(task) {
  const listId = selectedListId;
  task.completed = !task.completed;
  updateUI();
  try {
    await window.googleTasks.patchTask(listId, task.id, { completed: task.completed });
  } catch {
    await resyncAfterError(listId);
  }
}

// Deletion is destructive and irreversible via the UI, so it's gated behind a
// confirmation modal rather than firing immediately from the trash icon or shortcut.
function showDeleteConfirmModal(task) {
  pendingDeleteTask = task;
  if (deleteConfirmModalMessage) {
    deleteConfirmModalMessage.textContent = `Delete "${task.title || 'Untitled task'}"? This can't be undone.`;
  }
  if (deleteConfirmModalOverlay) {
    deleteConfirmModalOverlay.classList.remove('is-hidden');
  }
}

function hideDeleteConfirmModal() {
  pendingDeleteTask = null;
  if (deleteConfirmModalOverlay) {
    deleteConfirmModalOverlay.classList.add('is-hidden');
  }
}

function confirmPendingDelete() {
  const task = pendingDeleteTask;
  hideDeleteConfirmModal();
  if (task) handleDeleteTask(task);
}

async function handleDeleteTask(task) {
  const listId = selectedListId;
  // Keep a task selected after deletion: prefer the next one, else the previous.
  const ordered = getOrderedTasks();
  const index = ordered.findIndex((t) => t.id === task.id);
  const nextSelection = ordered[index + 1] ?? ordered[index - 1] ?? null;
  tasks = tasks.filter((t) => t.id !== task.id);
  selectedTaskId = nextSelection ? nextSelection.id : null;
  updateUI();
  try {
    await window.googleTasks.deleteTask(listId, task.id);
  } catch {
    await resyncAfterError(listId);
  }
}

async function handleRenameTask(task, newTitle) {
  const listId = selectedListId;
  task.title = newTitle;
  updateUI();
  try {
    await window.googleTasks.patchTask(listId, task.id, { title: newTitle });
  } catch {
    await resyncAfterError(listId);
  }
}

async function handleMoveTask(task, previousTaskId, wasCompleted) {
  const listId = selectedListId;
  try {
    // The API rejects moves of completed tasks, so a task dragged from Completed
    // back to Active must be un-completed before it can be positioned.
    if (wasCompleted) {
      await window.googleTasks.patchTask(listId, task.id, { completed: false });
    }
    await window.googleTasks.moveTask(listId, task.id, previousTaskId);
  } catch {
    await resyncAfterError(listId);
  }
}

async function handleUpdateNotes(task, newNotes) {
  const listId = selectedListId;
  task.notes = newNotes.length > 0 ? newNotes : null;
  updateUI();
  try {
    await window.googleTasks.patchTask(listId, task.id, { notes: task.notes });
  } catch {
    await resyncAfterError(listId);
  }
}

function handleTaskDetailTitleBlur() {
  const task = tasks.find((t) => t.id === selectedTaskId);
  if (!task) return;
  const newTitle = taskDetailTitleInput.value.trim();
  if (newTitle !== task.title) {
    handleRenameTask(task, newTitle);
  }
}

function handleTaskDetailNotesBlur() {
  const task = tasks.find((t) => t.id === selectedTaskId);
  if (!task) return;
  const newNotes = taskDetailNotesInput.value;
  if (newNotes !== (task.notes ?? '')) {
    handleUpdateNotes(task, newNotes);
  }
}

async function handleAddTask(title, position) {
  const listId = selectedListId;
  if (!listId) return;
  const activeTasks = tasks.filter((t) => !t.completed);
  const previousTaskId = position === 'bottom' && activeTasks.length > 0
    ? activeTasks[activeTasks.length - 1].id
    : null;
  try {
    const { task } = await window.googleTasks.insertTask(listId, title, previousTaskId);
    if (selectedListId !== listId) return;
    if (position === 'bottom') {
      tasks.splice(tasks.findLastIndex((t) => !t.completed) + 1, 0, task);
    } else {
      tasks.unshift(task);
    }
    addTaskInput.value = '';
    selectedTaskId = task.id;
    updateUI();
  } catch {
    // Leave the input text in place so the user can retry.
  }
}

function handleAddTaskInputKeydown(event) {
  if (event.key !== 'Enter') return;
  const title = addTaskInput.value.trim();
  if (title.length === 0) return;
  // Enter adds at the top of the list; Shift+Enter at the bottom.
  handleAddTask(title, event.shiftKey ? 'bottom' : 'top');
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function getSelectedTask() {
  return tasks.find((t) => t.id === selectedTaskId) ?? null;
}

function applySelectionClasses(taskId) {
  const row = taskList.querySelector(`.task[data-id="${CSS.escape(taskId)}"]`);
  row?.classList.add('task-selected');
  document.getElementById('qa_' + taskId)?.classList.remove('display-none');
}

function selectTask(taskId) {
  if (selectedTaskId === taskId) return;
  deselectTask();
  selectedTaskId = taskId;
  applySelectionClasses(taskId);
  renderTaskDetail();
}

function deselectTask() {
  if (selectedTaskId === null) return;
  taskList.querySelector('.task-selected')?.classList.remove('task-selected');
  document.getElementById('qa_' + selectedTaskId)?.classList.add('display-none');
  selectedTaskId = null;
  renderTaskDetail();
}

// Renders the selected task's title/notes into the right sidebar, or an empty
// message if nothing is selected. Skips fields the user is actively editing so
// an unrelated re-render (e.g. toggling another task) doesn't clobber typing.
function renderTaskDetail() {
  if (!taskDetail || !taskDetailEmpty) return;
  const task = tasks.find((t) => t.id === selectedTaskId);
  if (!task) {
    taskDetail.classList.add('display-none');
    taskDetailEmpty.classList.remove('display-none');
    return;
  }
  taskDetailEmpty.classList.add('display-none');
  taskDetail.classList.remove('display-none');
  if (document.activeElement !== taskDetailTitleInput) {
    taskDetailTitleInput.value = task.title;
    growTaskDetailTitle();
  }
  if (document.activeElement !== taskDetailNotesInput) {
    taskDetailNotesInput.value = task.notes ?? '';
  }
}

// The title textarea has no fixed height (rows="1"); grow it to fit wrapped
// content since a plain <textarea> doesn't auto-size on its own.
function growTaskDetailTitle() {
  taskDetailTitleInput.style.height = 'auto';
  taskDetailTitleInput.style.height = `${taskDetailTitleInput.scrollHeight}px`;
}

function selectAdjacentTask(direction) {
  const ordered = getOrderedTasks();
  if (ordered.length === 0) return;
  const index = ordered.findIndex((t) => t.id === selectedTaskId);
  if (index === -1) {
    selectTask(ordered[0].id);
    return;
  }
  const next = ordered[index + direction];
  if (next) {
    selectTask(next.id);
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// Update UI based on tasks state: show empty state if no tasks, otherwise render the list.
function updateUI() {
  if (tasks.length === 0) {
    taskList.classList.remove('has-tasks');
    emptyState.style.display = 'flex';
  } else {
    taskList.classList.add('has-tasks');
    emptyState.style.display = 'none';
    renderTasks();
  }
  renderTaskDetail();
}

// Full rebuild of both section containers from the tasks array. The array
// (sorted by the main process on fetch) is the authoritative order between
// fetches—never re-sort by position here, optimistic reorders make it stale.
function renderTasks() {
  activeContainer.innerHTML = '';
  completedContainer.innerHTML = '';

  for (const task of tasks) {
    const row = getListItem(task);
    (task.completed ? completedContainer : activeContainer).appendChild(row);
  }

  // Empty sections still need a drop target for cross-section drags.
  if (!tasks.some((t) => !t.completed)) {
    activeContainer.appendChild(getEmptyDropContainer('Drop active tasks here.'));
  }
  if (!tasks.some((t) => t.completed)) {
    completedContainer.appendChild(getEmptyDropContainer('Drop completed tasks here.'));
  }

  // Re-apply selection after the rebuild; drop it if the task no longer exists.
  if (selectedTaskId !== null) {
    if (tasks.some((t) => t.id === selectedTaskId)) {
      applySelectionClasses(selectedTaskId);
    } else {
      selectedTaskId = null;
    }
  }
}

// Builds one task row: [complete circle] [title] [quick actions] [note indicator].
// User data enters the DOM via textContent only (XSS-safe); icon markup is
// static trusted strings from icons.js.
function getListItem(task) {
  const taskDiv = document.createElement('div');
  taskDiv.classList.add('task');
  taskDiv.draggable = true;
  taskDiv.dataset.id = task.id;
  taskDiv.dataset.type = 'selectable';

  // Select on mousedown (not click) so the row is already selected when a drag
  // starts. Gated on data-type so clicks on icons don't re-select.
  taskDiv.addEventListener('mousedown', (event) => {
    if (event.target.classList.contains('task-title-is-editing')) return;
    if (event.target.dataset.type === 'selectable') {
      selectTask(task.id);
    }
  });

  taskDiv.addEventListener('dblclick', (event) => {
    if (event.target.classList.contains('task-title')) {
      beginTitleEdit(event.target, task);
    }
  });

  const circle = getCompleteAction(task);

  const title = document.createElement('div');
  title.dataset.type = 'selectable';
  title.classList.add('task-title');
  if (task.title.length === 0) {
    title.textContent = 'No Title';
    title.classList.add('noTitle');
  } else {
    title.textContent = task.title;
  }
  if (task.completed) {
    title.classList.add('task-title-completed');
  }

  const quickActions = getQuickActions(task);

  // Note indicator: the span is rendered even without notes to keep rows aligned.
  const note = document.createElement('span');
  note.classList.add('icon-note');
  if (typeof task.notes === 'string' && task.notes.trim().length > 0) {
    note.innerHTML = ICONS.note;
  }

  taskDiv.append(circle, title, quickActions, note);
  return taskDiv;
}

function getCompleteAction(task) {
  const circle = document.createElement('span');
  circle.classList.add('icon-circle', 'icon-circle-hover');
  circle.innerHTML = task.completed ? ICONS.circleChecked : ICONS.circleEmpty;
  circle.setAttribute('role', 'checkbox');
  if (task.completed) {
    circle.classList.add('is-checked');
  }
  circle.addEventListener('click', (event) => {
    // Toggling completion shouldn't also select/deselect the row.
    event.stopPropagation();
    handleToggleCompleted(task);
  });
  return circle;
}

// Per-row action strip, hidden until the row is selected (see applySelectionClasses).
function getQuickActions(task) {
  const quickActions = document.createElement('div');
  quickActions.id = 'qa_' + task.id;
  quickActions.classList.add('quick-actions', 'display-none');

  const trash = document.createElement('span');
  trash.classList.add('icon-trash');
  trash.innerHTML = ICONS.trash;
  trash.setAttribute('role', 'button');
  trash.addEventListener('click', (event) => {
    event.stopPropagation();
    showDeleteConfirmModal(task);
  });
  quickActions.appendChild(trash);

  return quickActions;
}

function getEmptyDropContainer(message) {
  const placeholder = document.createElement('div');
  placeholder.classList.add('task-empty');
  const icon = document.createElement('span');
  icon.classList.add('icon-drag-drop');
  icon.innerHTML = ICONS.dragDrop;
  const text = document.createElement('span');
  text.textContent = message;
  placeholder.append(icon, text);
  return placeholder;
}

// ---------------------------------------------------------------------------
// Inline title editing (double-click a title)
// ---------------------------------------------------------------------------

function beginTitleEdit(titleDiv, task) {
  beginInlineEdit(titleDiv, {
    originalValue: task.title,
    onStart: (el) => {
      el.classList.remove('task-title');
      el.classList.add('task-title-is-editing');
      // Disable row dragging while editing, otherwise text selection starts a drag.
      el.parentElement.setAttribute('draggable', 'false');
      if (el.classList.contains('noTitle')) {
        el.classList.remove('noTitle');
        el.textContent = '';
      }
    },
    onFinish: (el, typedValue) => {
      el.classList.add('task-title');
      el.classList.remove('task-title-is-editing');
      el.parentElement.setAttribute('draggable', 'true');
      if (typedValue.length === 0) {
        el.textContent = 'No Title';
        el.classList.add('noTitle');
      } else {
        el.textContent = typedValue;
      }
      return typedValue;
    },
    onCommit: (newTitle) => handleRenameTask(task, newTitle),
  });
}

function setupTaskEventListeners() {
  // The title may have been sized against the sidebar's collapsed (0px) width if a
  // task was selected while it was hidden; recompute once the open transition settles.
  if (sidebarRight) {
    sidebarRight.addEventListener('transitionend', (event) => {
      if (event.propertyName === 'width' && !sidebarRight.classList.contains('is-hidden')) {
        growTaskDetailTitle();
      }
    });
  }

  if (toggleSidebarRightButton && sidebarRight) {
    toggleSidebarRightButton.addEventListener('click', toggleSidebarRight);
  }

  // Enter commits the title (mirrors the add-task input); notes commit on blur only,
  // since Enter should insert a newline in a multi-line notes field.
  if (taskDetailTitleInput) {
    taskDetailTitleInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        taskDetailTitleInput.blur();
      }
    });
    taskDetailTitleInput.addEventListener('input', growTaskDetailTitle);
    taskDetailTitleInput.addEventListener('blur', handleTaskDetailTitleBlur);
  }

  if (taskDetailNotesInput) {
    taskDetailNotesInput.addEventListener('blur', handleTaskDetailNotesBlur);
  }

  if (deleteConfirmCancelBtn) {
    deleteConfirmCancelBtn.addEventListener('click', hideDeleteConfirmModal);
  }

  if (deleteConfirmDeleteBtn) {
    deleteConfirmDeleteBtn.addEventListener('click', confirmPendingDelete);
  }

  // Clicking the overlay backdrop (outside the modal card) cancels, same as Cancel.
  if (deleteConfirmModalOverlay) {
    deleteConfirmModalOverlay.addEventListener('click', (event) => {
      if (event.target === deleteConfirmModalOverlay) {
        hideDeleteConfirmModal();
      }
    });
  }

  if (addTaskInput) {
    addTaskInput.addEventListener('keydown', handleAddTaskInputKeydown);
  }
}
