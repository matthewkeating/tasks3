// Shared show/hide-with-persistence mechanics: toggle() flips the `is-hidden`
// class on an element and mirrors the new state to localStorage; restore()
// re-applies the persisted state. Used for the two sidebars and the completed
// section (see taskLists.js, taskDetail.js, tasks.js), which differ only in the
// element and the storage key.
function makePersistedToggle(el, storageKey) {
  return {
    toggle() {
      const isHidden = el.classList.toggle('is-hidden');
      localStorage.setItem(storageKey, isHidden);
    },
    // Called synchronously from init(), before the DOM's first paint, so
    // restoring a "collapsed" state doesn't visibly play the collapse
    // transition on launch—only user-triggered toggles should animate. Absent a
    // stored value (first launch), leaves whatever the markup defaults to.
    restore() {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) {
        el.classList.toggle('is-hidden', stored === 'true');
      }
    },
  };
}
