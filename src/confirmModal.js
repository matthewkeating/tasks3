// Shared destructive-confirmation modal mechanics: track a pending item, show
// the overlay with a message, wire Cancel/confirm/backdrop-click, and track
// which modals are open so callers can route Escape/Enter without knowing
// about each modal individually (see handleConfirmModalKeydown, used by
// handleGlobalKeydown in index.js). Used for both the delete-task modal (see
// tasks.js) and the delete-list modal (see taskLists.js), which differ only
// in which overlay/buttons they wire up and what onConfirm does.
function createConfirmModal({ overlay, icon, iconMarkup, message, cancelBtn, deleteBtn, onConfirm }) {
  let pendingItem = null;

  if (icon && iconMarkup) {
    icon.innerHTML = iconMarkup;
  }

  function hide() {
    pendingItem = null;
    overlay?.classList.add('is-hidden');
    openConfirmModals.delete(modal);
  }

  function show(item, messageText) {
    pendingItem = item;
    if (message) {
      message.textContent = messageText;
    }
    overlay?.classList.remove('is-hidden');
    openConfirmModals.add(modal);
  }

  function confirm() {
    const item = pendingItem;
    hide();
    if (item) onConfirm(item);
  }

  cancelBtn?.addEventListener('click', hide);
  deleteBtn?.addEventListener('click', confirm);
  // Clicking the overlay backdrop (outside the modal card) cancels, same as Cancel.
  overlay?.addEventListener('click', (event) => {
    if (event.target === overlay) hide();
  });

  const modal = { show, hide, confirm };
  return modal;
}

// Modals currently showing, so isAnyConfirmModalOpen/handleConfirmModalKeydown
// don't need to know about each modal instance by name.
const openConfirmModals = new Set();

// Lets pollForUpdates (index.js) skip a refresh while any confirm modal is open,
// same as it already does for the new-list modal and an in-progress drag.
function isAnyConfirmModalOpen() {
  return openConfirmModals.size > 0;
}

// Routes Escape/Enter to whichever confirm modal is open, and swallows every
// other key so list shortcuts don't fire underneath the modal. Returns true if
// a modal was open (and thus handled, or intentionally ignored, the event), so
// handleGlobalKeydown knows to stop processing.
function handleConfirmModalKeydown(event) {
  if (openConfirmModals.size === 0) return false;
  // At most one confirm modal is ever open at a time (each requires the
  // previous one closed first), so acting on the first entry is safe.
  const modal = openConfirmModals.values().next().value;
  if (event.key === 'Escape') {
    modal.hide();
  } else if (event.key === 'Enter') {
    modal.confirm();
  }
  return true;
}
