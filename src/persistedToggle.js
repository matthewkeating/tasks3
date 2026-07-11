// Shared class-toggle-with-persistence mechanics: toggle() flips a class on an
// element and mirrors the new state to localStorage; restore() re-applies the
// persisted state. Defaults to the `is-hidden` class, used by the two sidebars
// and the completed section (see taskLists.js, taskDetail.js, tasks.js); the
// task-title word-wrap toggle (tasks.js) passes a different class since it's a
// style switch rather than a show/hide.
function makePersistedToggle(el, storageKey, className = 'is-hidden') {
  return {
    toggle() {
      const isSet = el.classList.toggle(className);
      localStorage.setItem(storageKey, isSet);
    },
    // Called synchronously from init(), before the DOM's first paint, so
    // restoring a "collapsed" state doesn't visibly play the collapse
    // transition on launch—only user-triggered toggles should animate. Absent a
    // stored value (first launch), leaves whatever the markup defaults to.
    restore() {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) {
        el.classList.toggle(className, stored === 'true');
      }
    },
  };
}
