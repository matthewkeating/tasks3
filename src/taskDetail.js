// Task detail pane (right sidebar): renders the selected task's title/notes into
// editable fields, commits edits back to `tasks` (owned by tasks.js), and owns
// the right sidebar's collapse toggle. The main task-list view lives in tasks.js;
// this module reads/mutates the shared `tasks`/`selectedTaskId` state and the
// task mutations (handleRenameTask/handleUpdateNotes) defined there.

// The task the detail pane's title/notes fields belong to, captured on focus.
// Clicking another task row updates selectedTaskId (via its mousedown handler)
// before the blur fires on whichever detail field was focused, so blur handlers
// can't trust selectedTaskId to still name the task being edited—they need the
// id captured at focus time instead.
let detailEditingTaskId = null;
// Notes autosave: committed on blur (see handleTaskDetailNotesBlur) and also
// after a pause in typing, so a long editing session without blurring still
// persists periodically. Timer is cleared on blur to avoid a stale debounced
// save firing (and re-diffing against the wrong task) after the field commits.
let notesDebounceTimer = null;
const NOTES_DEBOUNCE_MS = 700;

const sidebarRight = document.getElementById('sidebarRight');
const toggleSidebarRightButton = document.getElementById('toggleSidebarRightBtn');
const taskDetailEmpty = document.getElementById('taskDetailEmpty');
const taskDetail = document.getElementById('taskDetail');
const taskDetailTitleInput = document.getElementById('taskDetailTitle');
const taskDetailNotesInput = document.getElementById('taskDetailNotes');

// Shared toggle/persist/restore mechanics live in persistedToggle.js.
//
// This sidebar doesn't take its space from the task area—the window grows and
// shrinks around it (as it does for the left sidebar too)—so the class flip is
// handed to windowSizing.js to apply at the right moment relative to the resize
// rather than being applied here. restore() stays direct: it runs at launch, where
// the persisted window bounds already account for the sidebar, so there's nothing
// to resize.
const sidebarRightToggle = makePersistedToggle(sidebarRight, 'sidebarRightHidden');
async function toggleSidebarRight() {
  const isOpening = sidebarRight.classList.contains('is-hidden');
  await toggleSidebarWithWindow('right', isOpening, () => sidebarRightToggle.toggle());
  // The pane's width is derived from the window's while it resizes, not transitioned,
  // so no transitionend fires to size the title textarea against the width it ended
  // up with (see setupTaskDetailEventListeners).
  if (isOpening) growTaskDetailTitle();
}
function restoreSidebarRightState() {
  sidebarRightToggle.restore();
}

// Reveals the right sidebar if needed and focuses the notes field with its
// full text selected, ready to be typed over. Shared by the Enter shortcut
// (handleGlobalKeydown in index.js) and the row's edit icon (tasks.js).
function focusTaskNotesForEdit() {
  if (sidebarRight.classList.contains('is-hidden')) {
    // Deliberately not awaited: the pane is un-hidden synchronously, before the
    // window has finished growing around it, so the field can take focus right away
    // rather than after the slide—typing is never held up by the animation.
    toggleSidebarRight();
  }
  taskDetailNotesInput.focus();
  // .focus() alone leaves the cursor wherever it last was—select the full
  // text instead, so typing immediately replaces the note (and an empty
  // note just leaves the cursor at position 0, since there's nothing to
  // select) rather than inserting mid-text.
  taskDetailNotesInput.setSelectionRange(0, taskDetailNotesInput.value.length);
}

// Force a synchronous blur/commit of whichever detail field is focused. Called
// before selection or the current list changes underneath the field (see
// selectTask in tasks.js and selectTaskList in taskLists.js). Without this, the
// field stays focused through the state change; by the time it naturally blurs,
// detailEditingTaskId no longer resolves in `tasks`, and the pending edit—along
// with the correct repaint of the detail pane for the newly selected task—is
// silently dropped. Blurring here runs handleTaskDetail*Blur while
// detailEditingTaskId still names the outgoing task, so the edit commits first.
function commitPendingDetailEdits() {
  taskDetailTitleInput?.blur();
  taskDetailNotesInput?.blur();
}

function handleTaskDetailTitleBlur() {
  const task = tasks.find((t) => t.id === detailEditingTaskId);
  if (!task) return;
  const newTitle = taskDetailTitleInput.value.trim();
  if (newTitle !== task.title) {
    handleRenameTask(task, newTitle);
  }
}

function commitNotesIfChanged() {
  const task = tasks.find((t) => t.id === detailEditingTaskId);
  if (!task) return;
  const newNotes = taskDetailNotesInput.value;
  if (newNotes !== (task.notes ?? '')) {
    handleUpdateNotes(task, newNotes);
  }
}

function handleTaskDetailNotesInput() {
  clearTimeout(notesDebounceTimer);
  notesDebounceTimer = setTimeout(() => {
    notesDebounceTimer = null;
    commitNotesIfChanged();
  }, NOTES_DEBOUNCE_MS);
}

function handleTaskDetailNotesBlur() {
  // Cancel any pending debounced save—commitNotesIfChanged below covers it,
  // and a timer left running would fire after blur, re-reading
  // detailEditingTaskId once it may already point at a different task.
  clearTimeout(notesDebounceTimer);
  notesDebounceTimer = null;
  commitNotesIfChanged();
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

// Mirrors live typing in a row's contenteditable title into the detail pane's
// title textarea (reciprocal of syncSelectedTaskTitleRow in tasks.js), so the
// two stay in sync while editing. Only fires for the selected task, since that's
// the only one the detail pane is ever showing. This row<->detail mirroring is a
// parallel of the row<->header list-title mirroring in beginSyncedListTitleEdit
// (taskLists.js); the two are intentionally kept separate.
function syncSelectedTaskDetailTitle(taskId, rawText) {
  if (selectedTaskId !== taskId || document.activeElement === taskDetailTitleInput) return;
  taskDetailTitleInput.value = rawText;
  growTaskDetailTitle();
}

function setupTaskDetailEventListeners() {
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

  // Enter commits the title (mirrors the add-task input); notes have no Enter
  // handling, since Enter should insert a newline in a multi-line notes field—
  // they commit on blur and, via handleTaskDetailNotesInput, on a typing pause.
  if (taskDetailTitleInput) {
    taskDetailTitleInput.addEventListener('focus', () => {
      detailEditingTaskId = selectedTaskId;
    });
    taskDetailTitleInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        taskDetailTitleInput.blur();
      }
    });
    taskDetailTitleInput.addEventListener('input', () => {
      growTaskDetailTitle();
      syncSelectedTaskTitleRow();
    });
    taskDetailTitleInput.addEventListener('blur', handleTaskDetailTitleBlur);
  }

  if (taskDetailNotesInput) {
    taskDetailNotesInput.addEventListener('focus', () => {
      detailEditingTaskId = selectedTaskId;
    });
    taskDetailNotesInput.addEventListener('input', handleTaskDetailNotesInput);
    taskDetailNotesInput.addEventListener('blur', handleTaskDetailNotesBlur);
  }
}
