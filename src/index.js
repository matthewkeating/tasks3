// Renderer process: UI state and rendering logic.
// All state (tasks, taskLists, selectedListId) lives in module scope.
// On state change, call updateUI() or specific render functions to mutate the DOM.
let tasks = [];
let taskLists = [];
let selectedListId = null;
let selectedTaskId = null;
let draggedTaskId = null;

const taskList = document.getElementById('taskList');
const activeContainer = document.getElementById('activeContainer');
const completedContainer = document.getElementById('completedContainer');
const completedSection = document.getElementById('completedSection');
const addTaskInput = document.getElementById('addTaskInput');
const taskListTitle = document.getElementById('taskListTitle');
const emptyState = document.querySelector('.empty-state');
const sidebarLeft = document.getElementById('sidebarLeft');
const sidebarLeftAddBtn = sidebarLeft.querySelector('.sidebar-add');
const toggleSidebarLeftButton = document.getElementById('toggleSidebarLeftBtn');
const sidebarLeftContent = sidebarLeft.querySelector('.sidebar-content');
const sidebarRight = document.getElementById('sidebarRight');
const toggleSidebarRightButton = document.getElementById('toggleSidebarRightBtn');
const taskDetailEmpty = document.getElementById('taskDetailEmpty');
const taskDetail = document.getElementById('taskDetail');
const taskDetailTitleInput = document.getElementById('taskDetailTitle');
const taskDetailNotesInput = document.getElementById('taskDetailNotes');
const signinModalOverlay = document.getElementById('signinModalOverlay');
const signinModalBtn = document.getElementById('signinModalBtn');
const deleteConfirmModalOverlay = document.getElementById('deleteConfirmModalOverlay');
const deleteConfirmModalMessage = document.getElementById('deleteConfirmModalMessage');
const deleteConfirmCancelBtn = document.getElementById('deleteConfirmCancelBtn');
const deleteConfirmDeleteBtn = document.getElementById('deleteConfirmDeleteBtn');
const newListModalOverlay = document.getElementById('newListModalOverlay');
const newListNameInput = document.getElementById('newListNameInput');
const newListCancelBtn = document.getElementById('newListCancelBtn');
const newListCreateBtn = document.getElementById('newListCreateBtn');

// Task pending confirmation in the delete modal; null when the modal is closed.
let pendingDeleteTask = null;
// True while the new-list modal is open; gates Escape/Enter in handleGlobalKeydown.
let isNewListModalOpen = false;

// Initialize the app: update UI for initial state, set up event listeners, then fetch auth status.
async function init() {
  initializeIcons();
  updateUI();
  setupEventListeners();
  await initGoogleTasks();
}

function initializeIcons() {
  const sidebarLeftIconContainer = document.getElementById('sidebarLeftIconContainer');
  const plusIconContainer = document.getElementById('plusIconContainer');
  const sidebarRightIconContainer = document.getElementById('sidebarRightIconContainer');
  if (sidebarLeftIconContainer) {
    sidebarLeftIconContainer.innerHTML = ICONS.sidebarLeft;
  }
  if (plusIconContainer) {
    plusIconContainer.innerHTML = ICONS.plus;
  }
  if (sidebarRightIconContainer) {
    sidebarRightIconContainer.innerHTML = ICONS.sidebarRight;
  }
}

function setupEventListeners() {
  if (sidebarLeftAddBtn) {
    sidebarLeftAddBtn.addEventListener('click', addList);
  }

  if (toggleSidebarLeftButton && sidebarLeft) {
    toggleSidebarLeftButton.addEventListener('click', toggleSidebarLeft);
  }

  if (toggleSidebarRightButton && sidebarRight) {
    toggleSidebarRightButton.addEventListener('click', toggleSidebarRight);
  }

  // The title may have been sized against the sidebar's collapsed (0px) width if a
  // task was selected while it was hidden; recompute once the open transition settles.
  if (sidebarRight) {
    sidebarRight.addEventListener('transitionend', (event) => {
      if (event.propertyName === 'width' && !sidebarRight.classList.contains('is-hidden')) {
        growTaskDetailTitle();
      }
    });
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

  if (signinModalBtn) {
    signinModalBtn.addEventListener('click', handleSignIn);
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

  if (newListCancelBtn) {
    newListCancelBtn.addEventListener('click', hideNewListModal);
  }

  if (newListCreateBtn) {
    newListCreateBtn.addEventListener('click', handleCreateList);
  }

  if (newListModalOverlay) {
    newListModalOverlay.addEventListener('click', (event) => {
      if (event.target === newListModalOverlay) {
        hideNewListModal();
      }
    });
  }

  // Event delegation on sidebarLeftContent: click handler bubbles up to find .task-list-item.
  // This avoids attaching a listener to each item individually when the list re-renders.
  if (sidebarLeftContent) {
    sidebarLeftContent.addEventListener('click', (event) => {
      const item = event.target.closest('.task-list-item');
      if (item) {
        selectTaskList(item.dataset.listId);
      }
    });
  }

  if (addTaskInput) {
    addTaskInput.addEventListener('keydown', handleAddTaskInputKeydown);
  }

  setupDragAndDrop();
  window.addEventListener('keydown', handleGlobalKeydown);
  setupMenuListeners();
}

// Menu accelerators (main/menu.js) are the single owner of these commands; wiring
// them here to the same functions handleGlobalKeydown calls keeps one implementation
// per action instead of duplicating logic across both entry points.
function setupMenuListeners() {
  window.appMenu?.onNewTask(() => addTaskInput?.focus());
  window.appMenu?.onToggleLeftSidebar(() => toggleSidebarLeft());
  window.appMenu?.onToggleRightSidebar(() => toggleSidebarRight());
  window.appMenu?.onToggleCompletedSection(() => toggleCompletedSection());
  window.appMenu?.onToggleCompleted(() => {
    const selectedTask = getSelectedTask();
    if (selectedTask) handleToggleCompleted(selectedTask);
  });
  window.appMenu?.onDeleteTask(() => {
    const selectedTask = getSelectedTask();
    if (selectedTask) showDeleteConfirmModal(selectedTask);
  });
  window.appMenu?.onSelectNext(() => selectAdjacentTask(1));
  window.appMenu?.onSelectPrevious(() => selectAdjacentTask(-1));
}

// HTML escaping for XSS prevention: converts unsafe strings to safe text via textContent.
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function showSigninModal() {
  if (signinModalOverlay) {
    signinModalOverlay.classList.remove('is-hidden');
  }
}

function hideSigninModal() {
  if (signinModalOverlay) {
    signinModalOverlay.classList.add('is-hidden');
  }
}

async function initGoogleTasks() {
  // Check auth status on app startup. If config is missing, show error message.
  let signedIn;
  try {
    ({ signedIn } = await window.googleTasks.getAuthStatus());
  } catch {
    renderSidebarMessage('Google Tasks is not configured. Add google-client-secret.json and restart the app.');
    return;
  }

  if (signedIn) {
    hideSigninModal();
    await loadTaskLists();
  } else {
    // User not signed in; show signin modal.
    showSigninModal();
  }
}

async function handleSignIn() {
  // Disable the button during signin to prevent multiple clicks
  if (signinModalBtn) {
    signinModalBtn.disabled = true;
    signinModalBtn.textContent = 'Signing in…';
  }

  const result = await window.googleTasks.signIn();
  if (result.ok) {
    // Signin succeeded; load task lists from Google Tasks.
    hideSigninModal();
    await loadTaskLists();
  } else {
    // Signin failed or cancelled; show error and re-enable button.
    const reason = result.reason === 'access_denied' ? 'Sign-in was cancelled.' : 'Sign-in timed out.';
    if (signinModalBtn) {
      signinModalBtn.disabled = false;
      signinModalBtn.textContent = `Try again: ${reason}`;
    }
  }
}

function renderSidebarMessage(html) {
  if (sidebarLeftContent) {
    sidebarLeftContent.innerHTML = `<div class="sidebar-message">${html}</div>`;
  }
}

async function loadTaskLists() {
  renderSidebarMessage('Loading lists…');
  try {
    const { taskLists: lists } = await window.googleTasks.listTaskLists();
    taskLists = lists;
  } catch {
    // Network or API error; show retry button and leave previous state in place.
    renderSidebarMessage('Could not load task lists. <button class="sidebar-signin-btn" id="retryListsBtn">Retry</button>');
    document.getElementById('retryListsBtn')?.addEventListener('click', loadTaskLists);
    return;
  }

  if (taskLists.length === 0) {
    renderSidebarMessage('No task lists found.');
    return;
  }

  renderTaskLists();
  // Auto-select the first list and load its tasks.
  await selectTaskList(taskLists[0].id);
}

function renderTaskLists() {
  if (!sidebarLeftContent) return;
  const sortedLists = [...taskLists].sort((a, b) => a.title.localeCompare(b.title));
  sidebarLeftContent.innerHTML = sortedLists.map((list) => `
    <button class="task-list-item ${list.id === selectedListId ? 'is-selected' : ''}" data-list-id="${escapeHtml(list.id)}">
      ${escapeHtml(list.title)}
    </button>
  `).join('');
  renderTaskListTitle();
}

function renderTaskListTitle() {
  if (!taskListTitle) return;
  const selectedList = taskLists.find((list) => list.id === selectedListId);
  taskListTitle.textContent = selectedList ? selectedList.title : '';
}

async function selectTaskList(listId) {
  // Update selected list and re-render the sidebar to reflect selection.
  selectedListId = listId;
  renderTaskLists();
  await loadTasksForSelectedList();
}

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

function toggleSidebarLeft() {
  const isCollapsed = sidebarLeft.classList.toggle('is-hidden');
}

function toggleSidebarRight() {
  const isCollapsed = sidebarRight.classList.toggle('is-hidden');
}

function toggleCompletedSection() {
  completedSection.classList.toggle('is-hidden');
}

function addList() {
  showNewListModal();
}

function showNewListModal() {
  isNewListModalOpen = true;
  if (newListNameInput) {
    newListNameInput.value = '';
  }
  if (newListModalOverlay) {
    newListModalOverlay.classList.remove('is-hidden');
  }
  newListNameInput?.focus();
}

function hideNewListModal() {
  isNewListModalOpen = false;
  if (newListModalOverlay) {
    newListModalOverlay.classList.add('is-hidden');
  }
}

// Pessimistic like handleAddTask: the server assigns the list's id, so the
// sidebar isn't updated until the API call resolves.
async function handleCreateList() {
  const title = newListNameInput.value.trim();
  if (title.length === 0) return;
  hideNewListModal();
  try {
    const { taskList: newList } = await window.googleTasks.insertTaskList(title);
    taskLists.push(newList);
    await selectTaskList(newList.id);
  } catch {
    // Creation failed; nothing was added locally, so there's nothing to resync.
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
  const originalTitle = task.title;
  titleDiv.classList.remove('task-title');
  titleDiv.classList.add('task-title-is-editing');
  titleDiv.setAttribute('contenteditable', 'plaintext-only');
  // Disable row dragging while editing, otherwise text selection starts a drag.
  titleDiv.parentElement.setAttribute('draggable', 'false');
  if (titleDiv.classList.contains('noTitle')) {
    titleDiv.classList.remove('noTitle');
    titleDiv.textContent = '';
  }
  titleDiv.focus();
  const range = document.createRange();
  range.selectNodeContents(titleDiv);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  let cancelled = false;

  const exitEdit = () => {
    titleDiv.removeEventListener('blur', exitEdit);
    titleDiv.removeEventListener('keydown', keyCheck);
    titleDiv.classList.add('task-title');
    titleDiv.classList.remove('task-title-is-editing');
    titleDiv.removeAttribute('contenteditable');
    titleDiv.parentElement.setAttribute('draggable', 'true');
    const newTitle = cancelled ? originalTitle : titleDiv.innerText.trim();
    if (newTitle.length === 0) {
      titleDiv.textContent = 'No Title';
      titleDiv.classList.add('noTitle');
    } else {
      titleDiv.textContent = newTitle;
    }
    if (!cancelled && newTitle !== originalTitle) {
      handleRenameTask(task, newTitle);
    }
  };

  const keyCheck = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      titleDiv.blur();
    } else if (event.key === 'Escape') {
      cancelled = true;
      titleDiv.blur();
    }
  };

  titleDiv.addEventListener('blur', exitEdit);
  titleDiv.addEventListener('keydown', keyCheck);
}

// ---------------------------------------------------------------------------
// Drag and drop (native HTML5 DnD)
//
// Listeners are registered once on the persistent section containers—renderTasks
// only replaces their children, so registering here (not per row) survives
// re-renders. Reordering live-inserts the dragged row during dragover, then the
// drop handler reads the new DOM order back into the model.
// ---------------------------------------------------------------------------

function setupDragAndDrop() {
  for (const container of [activeContainer, completedContainer]) {
    container.addEventListener('dragstart', (event) => {
      const row = event.target.closest('.task');
      if (!row) return;
      draggedTaskId = row.dataset.id;
      row.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
    });

    // dragend only fires here for cancelled drags (a completed drop re-renders,
    // detaching the source row). Re-rendering restores the DOM from the model,
    // undoing any live insertions the aborted drag left behind.
    container.addEventListener('dragend', () => {
      draggedTaskId = null;
      completedContainer.classList.remove('dragover-completed');
      updateUI();
    });
  }

  activeContainer.addEventListener('dragover', (event) => {
    event.preventDefault();
    const dragging = taskList.querySelector('.dragging');
    if (!dragging) return;
    const afterElement = getDragAfterElement(activeContainer, event.clientY);
    if (afterElement == null) {
      activeContainer.appendChild(dragging);
    } else {
      activeContainer.insertBefore(dragging, afterElement);
    }
  });
  activeContainer.addEventListener('drop', handleDropOnActive);

  // The completed section is not reorderable (the API orders completed tasks by
  // completion time), so hovering just highlights the container as a drop target.
  completedContainer.addEventListener('dragover', (event) => {
    event.preventDefault();
    completedContainer.classList.add('dragover-completed');
  });
  completedContainer.addEventListener('dragleave', () => {
    completedContainer.classList.remove('dragover-completed');
  });
  completedContainer.addEventListener('drop', handleDropOnCompleted);
}

// Classic midpoint algorithm: the row whose vertical center is closest below
// the cursor is the one the dragged row should be inserted before.
function getDragAfterElement(container, y) {
  const rows = [...container.querySelectorAll('.task:not(.dragging)')];
  return rows.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    return offset < 0 && offset > closest.offset ? { offset, element: child } : closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function handleDropOnActive(event) {
  event.preventDefault();
  const task = tasks.find((t) => t.id === draggedTaskId);
  draggedTaskId = null;
  if (!task) return;

  // Read the new order from the DOM (dragover already live-inserted the row).
  const orderedIds = [...activeContainer.querySelectorAll('.task')].map((row) => row.dataset.id);
  const index = orderedIds.indexOf(task.id);
  if (index === -1) return;
  const previousTaskId = index > 0 ? orderedIds[index - 1] : null;

  const wasCompleted = task.completed;
  task.completed = false;
  // Rebuild the array: active tasks in the DOM's new order, completed unchanged.
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const completed = tasks.filter((t) => t.completed);
  tasks = [...orderedIds.map((id) => byId.get(id)).filter(Boolean), ...completed];
  updateUI();
  handleMoveTask(task, previousTaskId, wasCompleted);
}

function handleDropOnCompleted(event) {
  event.preventDefault();
  completedContainer.classList.remove('dragover-completed');
  const task = tasks.find((t) => t.id === draggedTaskId);
  draggedTaskId = null;
  // Drags within the completed section are a no-op (dragend re-render snaps back).
  if (!task || task.completed) return;
  handleToggleCompleted(task);
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

function getSelectedTask() {
  return tasks.find((t) => t.id === selectedTaskId) ?? null;
}

// Cmd/Ctrl+N, Cmd/Ctrl+Shift+K, Cmd/Ctrl+Backspace, and Cmd/Ctrl+Shift+[/] are owned
// by the native Menu (main/menu.js -> setupMenuListeners) instead of here, since a menu
// accelerator and this keydown listener would otherwise both fire for the same combo.
function handleGlobalKeydown(event) {
  // The app has no defined tab order, so the browser's default focus-traversal
  // behavior would jump focus unpredictably between buttons/inputs; suppress it,
  // except to toggle focus between the task detail title/notes textareas, where
  // both Tab and Shift+Tab move to the other field regardless of direction.
  if (event.key === 'Tab') {
    event.preventDefault();
    if (event.target === taskDetailTitleInput) {
      taskDetailNotesInput.focus();
    } else if (event.target === taskDetailNotesInput) {
      taskDetailTitleInput.focus();
    }
    return;
  }

  // While the delete confirmation modal is open, Escape/Enter target it instead of
  // the usual list shortcuts (which would otherwise fire underneath the modal).
  if (pendingDeleteTask) {
    if (event.key === 'Escape') {
      hideDeleteConfirmModal();
    } else if (event.key === 'Enter') {
      confirmPendingDelete();
    }
    return;
  }

  // Same reasoning while the new-list modal is open, so Enter in the name input
  // submits and Escape cancels instead of falling through to list shortcuts.
  if (isNewListModalOpen) {
    if (event.key === 'Escape') {
      hideNewListModal();
    } else if (event.key === 'Enter') {
      handleCreateList();
    }
    return;
  }

  // While typing in an input or inline title edit, don't let list shortcuts fire.
  if (event.target instanceof Element && event.target.closest('input, [contenteditable]')) {
    return;
  }

  if (event.key === 'Escape') {
    deselectTask();
  }
}

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', init);
