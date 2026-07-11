// Task lists (left sidebar): state and rendering for the list of task lists,
// list selection, creation, and inline rename.
let taskLists = [];
let selectedListId = null;
// True while the new-list modal is open; gates Escape/Enter in handleGlobalKeydown.
let isNewListModalOpen = false;
// List pending confirmation in the delete-list modal; null when the modal is closed.
let pendingDeleteList = null;
// List the right-click context menu is currently showing for; null when closed.
let contextMenuList = null;

const taskListTitle = document.getElementById('taskListTitle');
const sidebarLeft = document.getElementById('sidebarLeft');
const sidebarLeftAddBtn = sidebarLeft.querySelector('.sidebar-add');
const toggleSidebarLeftButton = document.getElementById('toggleSidebarLeftBtn');
const sidebarLeftContent = sidebarLeft.querySelector('.sidebar-content');
const newListModalOverlay = document.getElementById('newListModalOverlay');
const newListNameInput = document.getElementById('newListNameInput');
const newListCancelBtn = document.getElementById('newListCancelBtn');
const newListCreateBtn = document.getElementById('newListCreateBtn');
const deleteListConfirmModalOverlay = document.getElementById('deleteListConfirmModalOverlay');
const deleteListConfirmModalIcon = document.getElementById('deleteListConfirmModalIcon');
const deleteListConfirmModalMessage = document.getElementById('deleteListConfirmModalMessage');
const deleteListConfirmCancelBtn = document.getElementById('deleteListConfirmCancelBtn');
const deleteListConfirmDeleteBtn = document.getElementById('deleteListConfirmDeleteBtn');
const taskListContextMenu = document.getElementById('taskListContextMenu');
const taskListContextMenuDelete = document.getElementById('taskListContextMenuDelete');

if (deleteListConfirmModalIcon) {
  deleteListConfirmModalIcon.innerHTML = ICONS.trash;
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

// Builds one sidebar list button: [title span]. The title is a dedicated child
// element (not the button's own text) so it can become the contenteditable
// target for inline rename without putting contenteditable directly on a <button>.
function getTaskListItem(list) {
  const button = document.createElement('button');
  button.classList.add('task-list-item');
  button.dataset.listId = list.id;

  const title = document.createElement('span');
  title.classList.add('task-list-item-title');
  title.textContent = list.title;

  button.appendChild(title);
  return button;
}

// Reconciles the sidebar against `taskLists` instead of rebuilding it, so that
// selecting a list (which calls this on every click) or a background poll never
// destroys an in-progress inline rename elsewhere in the sidebar.
function renderTaskLists() {
  if (!sidebarLeftContent) return;
  const sortedLists = [...taskLists].sort((a, b) => a.title.localeCompare(b.title));
  const currentIds = new Set(sortedLists.map((list) => list.id));

  for (const child of [...sidebarLeftContent.children]) {
    if (!currentIds.has(child.dataset.listId)) {
      child.remove();
    }
  }

  sortedLists.forEach((list, index) => {
    let button = sidebarLeftContent.querySelector(`[data-list-id="${CSS.escape(list.id)}"]`);
    if (!button) {
      button = getTaskListItem(list);
    }
    const titleEl = button.querySelector('.task-list-item-title');
    const isEditing = titleEl.classList.contains('task-list-item-title-is-editing');
    if (!isEditing && titleEl.textContent !== list.title) {
      titleEl.textContent = list.title;
    }
    button.classList.toggle('is-selected', list.id === selectedListId);
    // Moving a focused contenteditable node can disturb its active selection
    // range, so leave the row being edited wherever it currently sits.
    if (!isEditing && sidebarLeftContent.children[index] !== button) {
      sidebarLeftContent.insertBefore(button, sidebarLeftContent.children[index] ?? null);
    }
  });

  renderTaskListTitle();
}

function renderTaskListTitle() {
  if (!taskListTitle) return;
  const selectedList = taskLists.find((list) => list.id === selectedListId);
  taskListTitle.textContent = selectedList ? selectedList.title : '';
}

async function selectTaskList(listId) {
  // Re-clicking the already-selected list is a no-op: avoids a pointless
  // re-render and re-fetch on every click of the sidebar.
  if (listId === selectedListId) return;
  selectedListId = listId;
  renderTaskLists();
  await loadTasksForSelectedList();
}

function toggleSidebarLeft() {
  const isHidden = sidebarLeft.classList.toggle('is-hidden');
  localStorage.setItem('sidebarLeftHidden', isHidden);
}

// Applies the persisted collapse state. Called synchronously from init(), before
// the DOM's first paint, so restoring a "collapsed" sidebar doesn't visibly play
// the 0.2s collapse transition on launch—only user-triggered toggles should animate.
// Absent a stored value (first launch), leaves whatever index.html's markup defaults to.
function restoreSidebarLeftState() {
  const stored = localStorage.getItem('sidebarLeftHidden');
  if (stored !== null) {
    sidebarLeft.classList.toggle('is-hidden', stored === 'true');
  }
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

async function handleRenameTaskList(list, newTitle) {
  const previousTitle = list.title;
  list.title = newTitle;
  renderTaskLists();
  try {
    await window.googleTasks.patchTaskList(list.id, newTitle);
  } catch {
    // Revert on failure; there's no separate list-mutation resync path like
    // resyncAfterError, since a failed rename can just restore its own prior value.
    list.title = previousTitle;
    renderTaskLists();
  }
}

// Right-click popup for a sidebar list item, with a single "Delete" option.
function showTaskListContextMenu(list, x, y) {
  contextMenuList = list;
  if (!taskListContextMenu) return;
  taskListContextMenu.classList.remove('is-hidden');
  // Clamp to the viewport so a right-click near the window edge doesn't
  // render the menu partially off-screen.
  const rect = taskListContextMenu.getBoundingClientRect();
  const left = Math.max(4, Math.min(x, window.innerWidth - rect.width - 4));
  const top = Math.max(4, Math.min(y, window.innerHeight - rect.height - 4));
  taskListContextMenu.style.left = `${left}px`;
  taskListContextMenu.style.top = `${top}px`;
}

function hideTaskListContextMenu() {
  contextMenuList = null;
  taskListContextMenu?.classList.add('is-hidden');
}

// Deletion is destructive and irreversible via the UI (and also removes every
// task in the list), so it's gated behind a confirmation modal—same pattern
// as showDeleteConfirmModal in tasks.js, but scoped to lists.
function showDeleteListConfirmModal(list) {
  pendingDeleteList = list;
  if (deleteListConfirmModalMessage) {
    deleteListConfirmModalMessage.textContent = `Delete "${list.title}"? This can't be undone.`;
  }
  if (deleteListConfirmModalOverlay) {
    deleteListConfirmModalOverlay.classList.remove('is-hidden');
  }
}

function hideDeleteListConfirmModal() {
  pendingDeleteList = null;
  if (deleteListConfirmModalOverlay) {
    deleteListConfirmModalOverlay.classList.add('is-hidden');
  }
}

function confirmPendingDeleteList() {
  const list = pendingDeleteList;
  hideDeleteListConfirmModal();
  if (list) handleDeleteTaskList(list);
}

// Optimistic like task deletion in tasks.js: mutate local state, re-render,
// then fire the IPC call; on failure, re-fetch everything to resync, since
// there's no narrower per-list resync path.
async function handleDeleteTaskList(list) {
  const wasSelected = selectedListId === list.id;
  taskLists = taskLists.filter((l) => l.id !== list.id);

  if (wasSelected) {
    selectedListId = null;
    tasks = [];
  }

  if (taskLists.length === 0) {
    renderTaskListTitle();
    renderSidebarMessage('No task lists found.');
    updateUI();
  } else {
    renderTaskLists();
    if (wasSelected) {
      await selectTaskList(taskLists[0].id);
    }
  }

  try {
    await window.googleTasks.deleteTaskList(list.id);
  } catch {
    await loadTaskLists();
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

// Inline rename for a sidebar list title (double-click). Same contenteditable/
// blur/Escape/Enter mechanics as beginTitleEdit (see inlineEdit.js), but list
// titles have no blank placeholder state—an empty commit just reverts to the
// original title.
function beginListTitleEdit(titleSpan, list) {
  // One-way live mirror into the read-only header while editing the selected
  // list's title—the header (unlike the sidebar row) is never itself an edit
  // target, so there's no reciprocal direction to wire up.
  const handleLiveInput = () => {
    if (list.id === selectedListId && taskListTitle) {
      taskListTitle.textContent = titleSpan.textContent;
    }
  };

  beginInlineEdit(titleSpan, {
    originalValue: list.title,
    onStart: (el) => {
      el.classList.add('task-list-item-title-is-editing');
      el.addEventListener('input', handleLiveInput);
    },
    onFinish: (el, typedValue) => {
      el.removeEventListener('input', handleLiveInput);
      el.classList.remove('task-list-item-title-is-editing');
      const finalTitle = typedValue.length === 0 ? list.title : typedValue;
      el.textContent = finalTitle;
      // Reverts a cancelled/emptied edit's live mirror back to the true title—
      // onCommit won't fire in that case since finalTitle === originalValue.
      if (list.id === selectedListId && taskListTitle) {
        taskListTitle.textContent = finalTitle;
      }
      return finalTitle;
    },
    onCommit: (finalTitle) => handleRenameTaskList(list, finalTitle),
  });
}

function setupTaskListEventListeners() {
  if (sidebarLeftAddBtn) {
    sidebarLeftAddBtn.addEventListener('click', addList);
  }

  if (toggleSidebarLeftButton && sidebarLeft) {
    toggleSidebarLeftButton.addEventListener('click', toggleSidebarLeft);
  }

  // Event delegation on sidebarLeftContent: click handler bubbles up to find .task-list-item.
  // This avoids attaching a listener to each item individually when the list re-renders.
  if (sidebarLeftContent) {
    sidebarLeftContent.addEventListener('click', (event) => {
      // A click inside a title that's mid inline-edit is placing the caret;
      // clearing the selection here would wipe that caret (a collapsed range)
      // and leave the contenteditable unable to accept typing. Same guard as
      // the task row's mousedown handler in tasks.js.
      if (event.target.classList.contains('task-list-item-title-is-editing')) return;
      const item = event.target.closest('.task-list-item');
      if (item) {
        // Clear any lingering text selection from a previous inline edit.
        window.getSelection().removeAllRanges();
        selectTaskList(item.dataset.listId);
      }
    });

    sidebarLeftContent.addEventListener('dblclick', (event) => {
      if (event.target.classList.contains('task-list-item-title')) {
        const item = event.target.closest('.task-list-item');
        const list = taskLists.find((l) => l.id === item?.dataset.listId);
        if (list) beginListTitleEdit(event.target, list);
      }
    });

    sidebarLeftContent.addEventListener('contextmenu', (event) => {
      const item = event.target.closest('.task-list-item');
      if (!item) return;
      event.preventDefault();
      const list = taskLists.find((l) => l.id === item.dataset.listId);
      if (list) showTaskListContextMenu(list, event.clientX, event.clientY);
    });
  }

  // Clicking anywhere outside the context menu dismisses it. Uses mousedown
  // (not click) so it fires before a click on another list item's own handler.
  document.addEventListener('mousedown', (event) => {
    if (contextMenuList && !taskListContextMenu?.contains(event.target)) {
      hideTaskListContextMenu();
    }
  });

  if (taskListContextMenuDelete) {
    taskListContextMenuDelete.addEventListener('click', () => {
      const list = contextMenuList;
      hideTaskListContextMenu();
      if (list) showDeleteListConfirmModal(list);
    });
  }

  if (deleteListConfirmCancelBtn) {
    deleteListConfirmCancelBtn.addEventListener('click', hideDeleteListConfirmModal);
  }

  if (deleteListConfirmDeleteBtn) {
    deleteListConfirmDeleteBtn.addEventListener('click', confirmPendingDeleteList);
  }

  // Clicking the overlay backdrop (outside the modal card) cancels, same as Cancel.
  if (deleteListConfirmModalOverlay) {
    deleteListConfirmModalOverlay.addEventListener('click', (event) => {
      if (event.target === deleteListConfirmModalOverlay) {
        hideDeleteListConfirmModal();
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
}
