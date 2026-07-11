// Shared destructive-confirmation modal mechanics: track a pending item, show
// the overlay with a message, wire Cancel/confirm/backdrop-click, and track
// which modals are open so callers can route Escape/Enter without knowing
// about each modal individually (see handleConfirmModalKeydown, used by
// handleGlobalKeydown in index.js). Used for both the delete-task modal (see
// tasks.js) and the delete-list modal (see taskLists.js), which differ only
// in which overlay/buttons they wire up and what onConfirm does.
function createConfirmModal({ overlay, icon, iconMarkup, title, message, cancelBtn, deleteBtn, onConfirm }) {
  let pendingItem = null;

  if (icon && iconMarkup) {
    icon.innerHTML = iconMarkup;
  }

  function hide() {
    pendingItem = null;
    overlay?.classList.add('is-hidden');
    openConfirmModals.delete(modal);
  }

  function show(item, titleText, messageText) {
    pendingItem = item;
    if (title) {
      title.textContent = titleText;
    }
    if (message) {
      message.textContent = messageText;
    }
    overlay?.classList.remove('is-hidden');
    openConfirmModals.add(modal);
    // Cancel is the non-destructive action, so it's the default focus when the modal opens.
    cancelBtn?.focus();
  }

  function confirm() {
    const item = pendingItem;
    hide();
    if (item) onConfirm(item);
  }

  // Only two stops exist (Cancel/Delete), so Tab and Shift+Tab both just swap
  // between them—same reasoning as the title/notes toggle in index.js.
  function toggleFocus() {
    if (document.activeElement === cancelBtn) {
      deleteBtn?.focus();
    } else {
      cancelBtn?.focus();
    }
  }

  // Enter activates whichever button currently holds focus, matching native
  // button semantics, instead of always confirming the destructive action
  // regardless of where focus landed.
  function activateFocused() {
    if (document.activeElement === deleteBtn) {
      confirm();
    } else {
      hide();
    }
  }

  cancelBtn?.addEventListener('click', hide);
  deleteBtn?.addEventListener('click', confirm);
  // Clicking the overlay backdrop (outside the modal card) cancels, same as Cancel.
  overlay?.addEventListener('click', (event) => {
    if (event.target === overlay) hide();
  });

  const modal = { show, hide, confirm, toggleFocus, activateFocused };
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

// Routes Escape/Enter/Tab to whichever confirm modal is open, and swallows
// every other key so list shortcuts don't fire underneath the modal. Returns
// true if a modal was open (and thus handled, or intentionally ignored, the
// event), so handleGlobalKeydown knows to stop processing.
function handleConfirmModalKeydown(event) {
  if (openConfirmModals.size === 0) return false;
  // At most one confirm modal is ever open at a time (each requires the
  // previous one closed first), so acting on the first entry is safe.
  const modal = openConfirmModals.values().next().value;
  if (event.key === 'Escape') {
    modal.hide();
  } else if (event.key === 'Enter') {
    // Prevent the focused button's native Enter-activation from also firing,
    // which would otherwise double-invoke confirm()/hide().
    event.preventDefault();
    modal.activateFocused();
  } else if (event.key === 'Tab') {
    event.preventDefault();
    modal.toggleFocus();
  }
  return true;
}
