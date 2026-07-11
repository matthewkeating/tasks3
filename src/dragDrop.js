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
