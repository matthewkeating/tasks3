// App shell: bootstraps the renderer, wires up module-level event listeners,
// and owns the few concerns that cut across the task-list and task modules
// (background polling, global keyboard shortcuts). Per-domain state and
// rendering live in taskLists.js (sidebar) and tasks.js (main task area +
// detail pane); inline-edit mechanics are shared via inlineEdit.js and
// drag-and-drop via dragDrop.js.

// Initialize the app: update UI for initial state, set up event listeners, then fetch auth status.
async function init() {
  initializeIcons();
  // Must run before updateUI()/first paint—see restoreSidebarLeftState in taskLists.js.
  restoreSidebarLeftState();
  restoreSidebarRightState();
  restoreCompletedSectionState();
  updateUI();
  setupEventListeners();
  setupPolling();
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
  setupAuthEventListeners();
  setupTaskListEventListeners();
  setupTaskEventListeners();
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

// True while focus is inside any input, textarea, or contenteditable region
// tied to *existing* content (an inline title edit, the task detail fields,
// etc.). Used to gate the background poll so it never overwrites text the
// user is actively typing. addTaskInput is excluded deliberately: it's
// outside the #taskList subtree a poll rebuilds, so focus/typed text there
// survive a refresh untouched—unlike an in-progress rename or note edit.
function isEditingSomething() {
  const active = document.activeElement;
  return active instanceof Element
    && active !== addTaskInput
    && active.closest('input, textarea, [contenteditable]') !== null;
}

// Picks up changes made outside the app (e.g. from Google Tasks on another
// device). Runs on a fixed interval (see setupPolling) rather than in response
// to any event, so it deliberately skips whenever local state shouldn't be
// disturbed: window unfocused, an edit or drag in progress, a modal open, or
// nothing loaded yet (not signed in).
async function pollForUpdates() {
  if (!document.hasFocus()) return;
  if (isEditingSomething()) return;
  if (isNewListModalOpen || pendingDeleteTask || draggedTaskId) return;
  if (taskLists.length === 0) return;

  let lists;
  try {
    ({ taskLists: lists } = await window.googleTasks.listTaskLists());
  } catch {
    return;
  }
  taskLists = lists;

  if (taskLists.length === 0) {
    selectedListId = null;
    tasks = [];
    renderSidebarMessage('No task lists found.');
    updateUI();
    return;
  }

  if (!taskLists.some((list) => list.id === selectedListId)) {
    selectedListId = taskLists[0].id;
  }
  renderTaskLists();
  await loadTasksForSelectedList();
}

function setupPolling() {
  setInterval(pollForUpdates, 10000);
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

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
