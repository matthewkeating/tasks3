// Shared contenteditable-based inline rename mechanics: focus, select-all,
// Enter-to-commit, Escape-to-cancel. Used for both task titles and sidebar
// list titles (see beginTitleEdit in tasks.js and beginListTitleEdit in
// taskLists.js), which differ only in class toggling, empty-value handling,
// and which mutation to fire on commit—those are left to the caller via
// onStart/onFinish/onCommit.
function beginInlineEdit(el, { originalValue, onStart, onFinish, onCommit }) {
  onStart(el);
  el.setAttribute('contenteditable', 'plaintext-only');
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  let cancelled = false;

  const exitEdit = () => {
    el.removeEventListener('blur', exitEdit);
    el.removeEventListener('keydown', keyCheck);
    el.removeAttribute('contenteditable');
    const typedValue = cancelled ? originalValue : el.innerText.trim();
    const finalValue = onFinish(el, typedValue);
    if (!cancelled && finalValue !== originalValue) {
      onCommit(finalValue);
    }
  };

  const keyCheck = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      el.blur();
    } else if (event.key === 'Escape') {
      cancelled = true;
      el.blur();
    }
  };

  el.addEventListener('blur', exitEdit);
  el.addEventListener('keydown', keyCheck);
}
