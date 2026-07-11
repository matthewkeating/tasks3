// App shell: bootstraps the renderer, wires up module-level event listeners,
// and owns the few concerns that cut across the task-list and task modules
// (background polling, global keyboard shortcuts). Per-domain state and
// rendering live in taskLists.js (sidebar) and tasks.js (main task area +
// detail pane); inline-edit mechanics are shared via inlineEdit.js and
// drag-and-drop via dragDrop.js.

// Connection state: true when online, false when offline.
// Used to gate mutations and show offline indicator.
let isOnline = navigator.onLine;

// Initialize the app: update UI for initial state, set up event listeners, then fetch auth status.
async function init() {
  initializeIcons();
  // Must run before updateUI()/first paint—see restoreSidebarLeftState in taskLists.js.
  restoreSidebarLeftState();
  restoreSidebarRightState();
  restoreCompletedSectionState();
  updateUI();
  setupConnectionTracking();
  updateOfflineIndicator();
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

function setupConnectionTracking() {
  window.addEventListener('online', () => {
    isOnline = true;
    updateOfflineIndicator();
    // Immediately refresh data instead of waiting for the next poll cycle (10s).
    loadTaskLists();
  });
  window.addEventListener('offline', () => {
    isOnline = false;
    updateOfflineIndicator();
  });
}

function updateOfflineIndicator() {
  const offlineMessage = document.getElementById('offlineMessage');
  const offlineOverlay = document.getElementById('offlineOverlay');
  if (offlineMessage) {
    offlineMessage.classList.toggle('is-hidden', isOnline);
  }
  if (offlineOverlay) {
    offlineOverlay.classList.toggle('is-hidden', isOnline);
  }
}

function setupEventListeners() {
  setupAuthEventListeners();
  setupTaskListEventListeners();
  setupTaskEventListeners();
  setupDragAndDrop();
  window.addEventListener('keydown', handleGlobalKeydown);
  setupMenuListeners();
  // Cmd+Shift+' (main.js) brings the app back into view on whichever list it
  // last showed; only focus needs restoring, so send it straight to the input.
  window.appVisibility?.onShown(() => addTaskInput?.focus());
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
  if (isNewListModalOpen || isAnyConfirmModalOpen() || draggedTaskId) return;
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
    renderTaskListTitle();
    renderSidebarMessage('No task lists found.');
    updateUI();
    return;
  }

  if (!taskLists.some((list) => list.id === selectedListId)) {
    // Alphabetically-first, matching sidebar order (see taskLists.js's loadTaskLists).
    const sortedLists = [...taskLists].sort((a, b) => a.title.localeCompare(b.title));
    selectedListId = sortedLists[0].id;
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

  // While the context menu is open, Escape dismisses it instead of falling
  // through to list shortcuts (e.g. Escape would otherwise deselect a task).
  if (contextMenuList) {
    if (event.key === 'Escape') {
      hideTaskListContextMenu();
    }
    return;
  }

  // While a destructive confirm modal (delete task or delete list) is open,
  // Escape/Enter target it instead of the usual list shortcuts (which would
  // otherwise fire underneath the modal).
  if (handleConfirmModalKeydown(event)) {
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
  // addTaskInput is excluded, same as isEditingSomething(): these shortcuts are held
  // with Cmd/Ctrl rather than typed, and selectTaskList() refocuses addTaskInput on
  // every switch, so without this exclusion the guard would swallow every Cmd+#
  // press after the first list switch.
  if (event.target instanceof Element && event.target !== addTaskInput && event.target.closest('input, [contenteditable]')) {
    return;
  }

  // Cmd/Ctrl+1 through Cmd/Ctrl+9 to select task list by position (sorted alphabetically).
  if ((event.metaKey || event.ctrlKey) && event.key >= '1' && event.key <= '9') {
    const listIndex = parseInt(event.key) - 1;
    const sortedLists = [...taskLists].sort((a, b) => a.title.localeCompare(b.title));
    if (listIndex < sortedLists.length) {
      selectTaskList(sortedLists[listIndex].id);
      event.preventDefault();
    }
    return;
  }

  if (event.key === 'Escape') {
    deselectTask();
  }
}

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', init);
