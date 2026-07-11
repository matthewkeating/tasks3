// Task lists (left sidebar): state and rendering for the list of task lists,
// list selection, creation, and inline rename.
let taskLists = [];
let selectedListId = null;
// True while the new-list modal is open; gates Escape/Enter in handleGlobalKeydown.
let isNewListModalOpen = false;
// List the right-click context menu is currently showing for; null when closed.
let contextMenuList = null;

const taskListTitle = document.getElementById('taskListTitle');
const sidebarLeft = document.getElementById('sidebarLeft');
const sidebarLeftAddBtn = sidebarLeft.querySelector('.sidebar-add');
const toggleSidebarLeftButton = document.getElementById('toggleSidebarLeftBtn');
const sidebarLeftContent = sidebarLeft.querySelector('.sidebar-left-content');
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

// Deletion is destructive and irreversible via the UI (and also removes every
// task in the list), so it's gated behind a confirmation modal—same pattern
// as the delete-task modal in tasks.js, but scoped to lists.
const deleteListConfirmModal = createConfirmModal({
  overlay: deleteListConfirmModalOverlay,
  icon: deleteListConfirmModalIcon,
  iconMarkup: ICONS.trash,
  message: deleteListConfirmModalMessage,
  cancelBtn: deleteListConfirmCancelBtn,
  deleteBtn: deleteListConfirmDeleteBtn,
  onConfirm: handleDeleteTaskList,
});

function showDeleteListConfirmModal(list) {
  deleteListConfirmModal.show(list, `Delete "${list.title}"? This can't be undone.`);
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
  // Auto-select the alphabetically-first list (matching sidebar order) and load its tasks.
  const sortedLists = [...taskLists].sort((a, b) => a.title.localeCompare(b.title));
  await selectTaskList(sortedLists[0].id);
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

  const count = document.createElement('span');
  count.classList.add('task-list-item-count');
  count.textContent = list.activeTaskCount ?? '';

  button.appendChild(title);
  button.appendChild(count);
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
    // null means the count fetch failed for this poll (see googleTasksClient.js);
    // leave whatever's already showing rather than blanking a known-good number.
    const countEl = button.querySelector('.task-list-item-count');
    if (list.activeTaskCount !== null) {
      const countText = String(list.activeTaskCount ?? '');
      if (countEl.textContent !== countText) {
        countEl.textContent = countText;
      }
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
  // Mirrors the row-title guard in renderTaskLists: a re-render triggered while
  // the header is mid inline-edit (e.g. syncSelectedListActiveCount firing from
  // a task completion) must not stomp on the live typed text.
  if (taskListTitle.classList.contains('task-list-title-is-editing')) return;
  const selectedList = taskLists.find((list) => list.id === selectedListId);
  taskListTitle.textContent = selectedList ? selectedList.title : '';
}

// tasks.js mutates its own `tasks` array (add/complete/delete) without touching
// taskLists state, so this lets updateUI() keep the sidebar's count in sync
// immediately rather than leaving it stale until the next poll.
function syncSelectedListActiveCount(activeCount) {
  const list = taskLists.find((l) => l.id === selectedListId);
  if (!list || list.activeTaskCount === activeCount) return;
  list.activeTaskCount = activeCount;
  renderTaskLists();
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
    newList.activeTaskCount = 0;
    taskLists.push(newList);
    await selectTaskList(newList.id);
  } catch {
    // Creation failed; nothing was added locally, so there's nothing to resync.
  }
}

// Inline rename shared by the sidebar row title and the header title (double-
// click either to edit—see beginListTitleEdit and beginTaskListTitleHeaderEdit
// below). Same contenteditable/blur/Escape/Enter mechanics as beginTitleEdit
// (see inlineEdit.js), but list titles have no blank placeholder state—an
// empty commit just reverts to the original title. While editing, every
// keystroke is mirrored live into `mirrorEl` (the other element showing this
// same list's title); on cancel/empty-commit onCommit never fires, so the
// revert to the true title is mirrored explicitly too.
function beginSyncedListTitleEdit(el, editingClass, mirrorEl, list) {
  const handleLiveInput = () => {
    if (mirrorEl) mirrorEl.textContent = el.textContent;
  };

  beginInlineEdit(el, {
    originalValue: list.title,
    onStart: (target) => {
      target.classList.add(editingClass);
      target.addEventListener('input', handleLiveInput);
    },
    onFinish: (target, typedValue) => {
      target.removeEventListener('input', handleLiveInput);
      target.classList.remove(editingClass);
      const finalTitle = typedValue.length === 0 ? list.title : typedValue;
      target.textContent = finalTitle;
      if (mirrorEl) mirrorEl.textContent = finalTitle;
      return finalTitle;
    },
    onCommit: (finalTitle) => handleRenameTaskList(list, finalTitle),
  });
}

function beginListTitleEdit(titleSpan, list) {
  // The header only ever displays the selected list's title, so it's only a
  // valid mirror target when this row is the selected one.
  const mirrorEl = list.id === selectedListId ? taskListTitle : null;
  beginSyncedListTitleEdit(titleSpan, 'task-list-item-title-is-editing', mirrorEl, list);
}

// The header always shows the selected list, so its sidebar counterpart is
// always findable by id—no selection check needed (unlike the row's case).
function beginTaskListTitleHeaderEdit(list) {
  const rowTitleEl = sidebarLeftContent?.querySelector(
    `[data-list-id="${CSS.escape(list.id)}"] .task-list-item-title`,
  ) ?? null;
  beginSyncedListTitleEdit(taskListTitle, 'task-list-title-is-editing', rowTitleEl, list);
}

function setupTaskListEventListeners() {
  if (taskListTitle) {
    taskListTitle.addEventListener('dblclick', () => {
      const list = taskLists.find((l) => l.id === selectedListId);
      if (list) beginTaskListTitleHeaderEdit(list);
    });
  }

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
