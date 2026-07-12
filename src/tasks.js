// Tasks (main list area): state and rendering for the selected list's tasks,
// selection, mutation, and inline title editing. The right-hand detail pane
// (title/notes fields for the selected task) lives in taskDetail.js and reads
// this module's `tasks`/`selectedTaskId` state.
let tasks = [];
let selectedTaskId = null;
let draggedTaskId = null;

const taskList = document.getElementById('taskList');
const activeContainer = document.getElementById('activeContainer');
const completedContainer = document.getElementById('completedContainer');
const completedSection = document.getElementById('completedSection');
const addTaskInput = document.getElementById('addTaskInput');
const emptyState = document.querySelector('.empty-state');
const deleteConfirmModalOverlay = document.getElementById('deleteConfirmModalOverlay');
const deleteConfirmModalIcon = document.getElementById('deleteConfirmModalIcon');
const deleteConfirmModalTitle = document.getElementById('deleteConfirmModalTitle');
const deleteConfirmModalMessage = document.getElementById('deleteConfirmModalMessage');
const deleteConfirmCancelBtn = document.getElementById('deleteConfirmCancelBtn');
const deleteConfirmDeleteBtn = document.getElementById('deleteConfirmDeleteBtn');

// Deletion is destructive and irreversible via the UI, so it's gated behind a
// confirmation modal rather than firing immediately from the trash icon or shortcut.
const deleteTaskConfirmModal = createConfirmModal({
  overlay: deleteConfirmModalOverlay,
  icon: deleteConfirmModalIcon,
  iconMarkup: ICONS.warning,
  title: deleteConfirmModalTitle,
  message: deleteConfirmModalMessage,
  cancelBtn: deleteConfirmCancelBtn,
  deleteBtn: deleteConfirmDeleteBtn,
  onConfirm: handleDeleteTask,
});

function showDeleteConfirmModal(task) {
  const title = task.title || 'Untitled task';
  deleteTaskConfirmModal.show(task, `Are you sure you want to delete "${title}"?`, `This item will be deleted immediately. You can't undo this action.`);
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
  renderTaskArea();
}

// Shared toggle/persist/restore mechanics live in persistedToggle.js; restore()
// runs pre-paint from init() (see the note there).
const completedSectionToggle = makePersistedToggle(completedSection, 'completedSectionHidden');
function toggleCompletedSection() {
  completedSectionToggle.toggle();
  // Hiding the section can hide the currently selected task (if it's completed,
  // it's still in the DOM per renderTasks, just CSS-hidden—see the same note in
  // selectAdjacentTask). Reselect the last active task so selection doesn't
  // point at an invisible row; if there's no active task either, clear
  // selection and fall back to the add-task input.
  if (completedSection.classList.contains('is-hidden') && getSelectedTask()?.completed) {
    const activeTasks = getOrderedTasks().filter((t) => !t.completed);
    const lastActiveTask = activeTasks[activeTasks.length - 1];
    if (lastActiveTask) {
      selectTask(lastActiveTask.id);
    } else {
      deselectTask();
      addTaskInput?.focus();
    }
  }
}
function restoreCompletedSectionState() {
  completedSectionToggle.restore();
}

// Word-wrap is on by default (task-list.css's .task-title base rule); this
// class switches back to the original single-line ellipsis truncation.
const taskTitleWrapToggle = makePersistedToggle(taskList, 'taskTitleTruncated', 'task-title-truncated');
function toggleTaskTitleWrap() {
  taskTitleWrapToggle.toggle();
}
function restoreTaskTitleWrapState() {
  taskTitleWrapToggle.restore();
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
  const wasCompleted = task.completed;
  const wasSelected = task.id === selectedTaskId;
  // Captured before flipping `completed` below, since completing the task
  // removes it from this filter—these are its neighbors in the active list
  // as it existed just before the move.
  const activeTasks = tasks.filter((t) => !t.completed);
  const activeIndex = activeTasks.findIndex((t) => t.id === task.id);
  task.completed = !task.completed;
  if (wasCompleted) {
    // Un-completing: nothing ever reorders `tasks` on a plain completed-flag
    // flip, so without this the task snaps straight back to whatever array
    // index it held before it was completed (its old spot, not the bottom)
    // the instant you uncomplete it—then jumps again when the moveTask call
    // below lands and the next poll picks up the new server-side position.
    // Moving it here keeps the local order and the server's `position` (about
    // to be set below) in agreement from the start. Mirrors the array rebuild
    // handleDropOnActive does before its own call to handleMoveTask.
    tasks = tasks.filter((t) => t.id !== task.id);
    const lastActiveIndex = tasks.findLastIndex((t) => !t.completed);
    tasks.splice(lastActiveIndex + 1, 0, task);
  }
  renderTaskArea();
  // Completing the selected task moves it out of the active list, so move
  // selection along with it: prefer the task that sat just after it, else
  // the one just before, else fall back to addTaskInput once no active tasks
  // remain (mirrors the reselect-on-hide logic in toggleCompletedSection).
  if (!wasCompleted && wasSelected) {
    const nextSelection = activeTasks[activeIndex + 1] ?? activeTasks[activeIndex - 1] ?? null;
    if (nextSelection) {
      selectTask(nextSelection.id);
    } else {
      deselectTask();
      addTaskInput?.focus();
    }
  }
  try {
    await window.googleTasks.patchTask(listId, task.id, { completed: task.completed });
    // Un-completing: the API leaves the task's pre-completion `position` field
    // untouched, so without an explicit move the next poll (which re-sorts
    // active tasks by `position`) would silently snap it back to wherever it
    // sat before it was completed, instead of staying at the bottom where the
    // local reorder above already placed it. Same fix the drag-and-drop path
    // already applies via handleMoveTask's wasCompleted branch.
    if (wasCompleted) {
      const activeTasks = tasks.filter((t) => !t.completed && t.id !== task.id);
      const previousTaskId = activeTasks.length > 0 ? activeTasks[activeTasks.length - 1].id : null;
      await window.googleTasks.moveTask(listId, task.id, previousTaskId);
    }
  } catch {
    await resyncAfterError(listId);
  }
}

async function handleDeleteTask(task) {
  const listId = selectedListId;
  // Keep a task selected after deletion: prefer the next one, else the previous.
  const ordered = getOrderedTasks();
  const index = ordered.findIndex((t) => t.id === task.id);
  const nextSelection = ordered[index + 1] ?? ordered[index - 1] ?? null;
  tasks = tasks.filter((t) => t.id !== task.id);
  selectedTaskId = nextSelection ? nextSelection.id : null;
  renderTaskArea();
  try {
    await window.googleTasks.deleteTask(listId, task.id);
  } catch {
    await resyncAfterError(listId);
  }
}

async function handleRenameTask(task, newTitle) {
  const listId = selectedListId;
  task.title = newTitle;
  renderTaskArea();
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
  renderTaskArea();
  try {
    await window.googleTasks.patchTask(listId, task.id, { notes: task.notes });
  } catch {
    await resyncAfterError(listId);
  }
}

// Mirrors live typing in the detail title textarea into the corresponding row
// in the list (reciprocal of syncSelectedTaskDetailTitle in taskDetail.js).
// Skipped if the row is itself mid inline-edit (its title div won't match
// `.task-title` while editing—see beginTitleEdit)—that direction is handled by
// the row's own live-input listener instead. Called from the detail title
// input's listener, which lives in taskDetail.js.
function syncSelectedTaskTitleRow() {
  if (!selectedTaskId) return;
  const rowTitle = taskList.querySelector(`.task[data-id="${CSS.escape(selectedTaskId)}"] .task-title`);
  if (rowTitle) {
    applyTaskTitleDisplay(rowTitle, taskDetailTitleInput.value);
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
    renderTaskArea();
    // Enter never blurs a text input on its own (unlike a row click), so do it
    // explicitly—same reasoning as the blur in selectTask()—to hand focus back
    // to the newly-added row rather than leaving it in addTaskInput.
    addTaskInput?.blur();
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

// The row's quick-actions strip is shown purely via the `.task-selected` class
// in CSS (see task-list.css), so this only needs to toggle that one class.
function applySelectionClasses(taskId) {
  const row = taskList.querySelector(`.task[data-id="${CSS.escape(taskId)}"]`);
  row?.classList.add('task-selected');
}

function selectTask(taskId) {
  if (selectedTaskId === taskId) return;
  // Commit and flush any focused detail field before selectedTaskId changes
  // underneath it (see commitPendingDetailEdits in taskDetail.js for why).
  commitPendingDetailEdits();
  // Clicking a row blurs addTaskInput naturally (mousedown shifts focus away),
  // but keyboard-driven selection (Cmd+Shift+[/]) never touches focus on its
  // own, so do it explicitly here to cover both paths.
  addTaskInput?.blur();
  deselectTask();
  selectedTaskId = taskId;
  applySelectionClasses(taskId);
  renderTaskDetail();
}

function deselectTask() {
  if (selectedTaskId === null) return;
  taskList.querySelector('.task-selected')?.classList.remove('task-selected');
  selectedTaskId = null;
  renderTaskDetail();
}

function selectAdjacentTask(direction) {
  // Completed tasks are always in the DOM (just CSS-hidden—see renderTasks), so
  // when the completed section is collapsed, keyboard navigation must skip them
  // too; otherwise Cmd+Shift+[/] would silently jump into rows the user can't see.
  const completedHidden = completedSection.classList.contains('is-hidden');
  const ordered = getOrderedTasks().filter((t) => !completedHidden || !t.completed);
  if (ordered.length === 0) return;
  const index = ordered.findIndex((t) => t.id === selectedTaskId);
  const target = index === -1 ? ordered[0] : ordered[index + direction];
  if (!target) return;
  selectTask(target.id);
  // Unlike a click (already visible when made), keyboard navigation can move
  // selection outside the scroll area's current viewport; bring it into view.
  taskList.querySelector(`.task[data-id="${CSS.escape(target.id)}"]`)?.scrollIntoView({ block: 'nearest' });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// Re-render the main task area from `tasks` state: show the empty state if
// there are no tasks, otherwise render the list, then refresh the detail pane
// and the sidebar's active-task count. (Named for its scope—it owns the task
// area only; the sidebar list is rendered by renderTaskLists in taskLists.js.)
function renderTaskArea() {
  if (tasks.length === 0) {
    taskList.classList.remove('has-tasks');
    emptyState.style.display = 'flex';
  } else {
    taskList.classList.add('has-tasks');
    emptyState.style.display = 'none';
    renderTasks();
  }
  renderTaskDetail();
  syncSelectedListActiveCount(tasks.filter((t) => !t.completed).length);
}

// Full rebuild of both section containers from the tasks array. The array
// (sorted by the main process on fetch) is the authoritative order between
// fetches—never re-sort by position here, optimistic reorders make it stale.
function renderTasks() {
  activeContainer.innerHTML = '';
  completedContainer.innerHTML = '';

  for (const task of tasks) {
    const row = createTaskRow(task);
    (task.completed ? completedContainer : activeContainer).appendChild(row);
  }

  // Empty sections still need a drop target for cross-section drags.
  if (!tasks.some((t) => !t.completed)) {
    activeContainer.appendChild(createEmptyDropContainer('Drop active tasks here.'));
  }
  if (!tasks.some((t) => t.completed)) {
    completedContainer.appendChild(createEmptyDropContainer('Drop completed tasks here.'));
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

// Shared idle-state rendering for a task title: empty titles show the "No Title"
// placeholder (italicized via .task-title-empty) instead of blank text. Used for both the
// initial row render and the live sync from the detail textarea (see
// syncSelectedTaskTitleRow), so the two stay visually consistent.
function applyTaskTitleDisplay(el, title) {
  if (title.length === 0) {
    el.textContent = 'No Title';
    el.classList.add('task-title-empty');
  } else {
    el.textContent = title;
    el.classList.remove('task-title-empty');
  }
}

// Builds one task row: [complete circle] [title] [quick actions] [note indicator].
// User data enters the DOM via textContent only (XSS-safe); icon markup is
// static trusted strings from icons.js.
function createTaskRow(task) {
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

  const circle = createCompleteAction(task);

  const title = document.createElement('div');
  title.dataset.type = 'selectable';
  title.classList.add('task-title');
  applyTaskTitleDisplay(title, task.title);
  if (task.completed) {
    title.classList.add('task-title-completed');
  }

  const quickActions = createQuickActions(task);

  // Note indicator: the span is rendered even without notes to keep rows aligned.
  const note = document.createElement('span');
  note.classList.add('icon-note');
  if (typeof task.notes === 'string' && task.notes.trim().length > 0) {
    note.innerHTML = ICONS.note;
  }

  taskDiv.append(circle, title, quickActions, note);
  return taskDiv;
}

function createCompleteAction(task) {
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

// Per-row action strip. Visibility is driven entirely by the row's
// `.task-selected` class in CSS (see task-list.css)—no per-row toggling needed.
function createQuickActions(task) {
  const quickActions = document.createElement('div');
  quickActions.classList.add('quick-actions');

  // Row is already selected whenever this strip is visible (see the
  // .task-selected gate above), so this just jumps straight to editing its
  // notes—same behavior as the Enter shortcut (focusTaskNotesForEdit, taskDetail.js).
  const edit = document.createElement('span');
  edit.classList.add('icon-edit');
  edit.innerHTML = ICONS.edit;
  edit.setAttribute('role', 'button');
  edit.addEventListener('click', (event) => {
    event.stopPropagation();
    focusTaskNotesForEdit();
  });
  quickActions.appendChild(edit);

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

function createEmptyDropContainer(message) {
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

// beginTitleEdit mirrors each keystroke into the detail pane via
// syncSelectedTaskDetailTitle (defined in taskDetail.js), the reciprocal of
// syncSelectedTaskTitleRow above.
function beginTitleEdit(titleDiv, task) {
  const handleLiveInput = () => syncSelectedTaskDetailTitle(task.id, titleDiv.textContent);

  beginInlineEdit(titleDiv, {
    originalValue: task.title,
    onStart: (el) => {
      el.classList.remove('task-title');
      el.classList.add('task-title-is-editing');
      // Disable row dragging while editing, otherwise text selection starts a drag.
      el.parentElement.setAttribute('draggable', 'false');
      if (el.classList.contains('task-title-empty')) {
        el.classList.remove('task-title-empty');
        el.textContent = '';
      }
      el.addEventListener('input', handleLiveInput);
    },
    onFinish: (el, typedValue) => {
      el.removeEventListener('input', handleLiveInput);
      el.classList.add('task-title');
      el.classList.remove('task-title-is-editing');
      el.parentElement.setAttribute('draggable', 'true');
      applyTaskTitleDisplay(el, typedValue);
      return typedValue;
    },
    onCommit: (newTitle) => handleRenameTask(task, newTitle),
  });
}

// Detail-pane listeners (right sidebar title/notes) are wired separately in
// setupTaskDetailEventListeners (taskDetail.js); this covers only the main
// task area's own inputs.
function setupTaskEventListeners() {
  if (addTaskInput) {
    addTaskInput.addEventListener('keydown', handleAddTaskInputKeydown);
    // Focusing the add-task input signals intent to create a new task, not act
    // on the current selection, so drop it (e.g. after Cmd+Shift+' restores focus here).
    addTaskInput.addEventListener('focus', deselectTask);
  }
}
