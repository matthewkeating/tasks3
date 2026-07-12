// Renderer half of the sidebars' window resize: opening a sidebar widens the
// window to make room for itself instead of taking space from the task area, and
// closing it shrinks the window back. Both sidebars grow the window on the same
// edge—only its width changes, its x never does—and the two sides are independent,
// so opening both leaves the window wider by the sum of the two.
//
// The sidebar's width is not transitioned while this happens. It's derived from
// the window's live width (see body.is-window-sizing in layout.css), so it tracks
// the OS resize frame for frame, however long the OS takes and whatever curve it
// uses. A CSS transition would be a second, independent timeline: run it even
// slightly ahead of the resize and the sidebar claims space the window hasn't
// gained yet, squeezing the task area—the very thing this feature exists to
// prevent. Deriving the width makes that unrepresentable rather than merely
// unlikely. Everything else anchored to a sidebar's edge (the header seams, the
// left toggle button, the offline message) reads the same derived value, so nothing
// can drift out of step with it either.
//
// The task area is additionally pinned to its measured width for the duration.
// That matters when the window can't gain the sidebar's full width (see
// main/sidebarWindowSizer.js): the sidebar stops short mid-slide, and without the
// pin the task area would reflow to absorb the difference while the frame was
// still moving.

// Keep in sync with .sidebar-left / .sidebar-right in css/sidebar.css.
const SIDEBAR_WIDTHS = { left: 220, right: 275 };

const mainContent = document.querySelector('.main-content');
// Named to avoid colliding with taskLists.js's `sidebarLeft` and taskDetail.js's
// `sidebarRight`: these scripts share one global scope, so two top-level consts of
// the same name would be a redeclaration.
const windowSizedSidebars = {
  left: document.getElementById('sidebarLeft'),
  right: document.getElementById('sidebarRight'),
};

// The window is only busy for the length of one resize, and a toggle arriving
// mid-resize would measure widths that are still in motion, so extra toggles are
// dropped rather than queued. This is app-wide rather than per-side: the two
// sidebars grow the same window edge, so they can't be in motion at once.
let isResizingWindow = false;

// `baseWidth` is the window's width *without* the sidebar being animated; that
// sidebar's derived width is the difference between it and the window's live width,
// so it has to be in place before the resize starts. It's measured from the
// sidebar's current width rather than assumed to be the full 220/275px, so a
// sidebar that only got part of its width (because the window couldn't grow that
// far) still closes from wherever it actually sits.
function beginWindowSizing(side) {
  const sidebarWidth = windowSizedSidebars[side].getBoundingClientRect().width;
  mainContent.style.width = `${mainContent.getBoundingClientRect().width}px`;
  mainContent.classList.add('is-width-pinned');
  document.body.style.setProperty('--window-base-width', `${window.innerWidth - sidebarWidth}px`);
  document.body.style.setProperty('--sidebar-target-width', `${SIDEBAR_WIDTHS[side]}px`);
  document.body.classList.add('is-window-sizing', `is-window-sizing-${side}`);
}

// Hands the sidebar's width back to the plain CSS rules. Normally a no-op, since
// the derived width has already arrived at 0 or its full width—but when the window
// couldn't gain (or give back) all of it, the sidebar is left part-way and .sidebar's
// own width transition carries it the rest of the way, taking the shortfall out of
// the task area exactly as the app behaved before this feature.
function endWindowSizing(side) {
  document.body.classList.remove('is-window-sizing', `is-window-sizing-${side}`);
  document.body.style.removeProperty('--window-base-width');
  document.body.style.removeProperty('--sidebar-target-width');
  mainContent.classList.remove('is-width-pinned');
  mainContent.style.width = '';
  windowSizedSidebars[side].classList.remove('is-content-hidden');
}

// Starts the contents' fade-in (see .sidebar.is-content-hidden in sidebar.css).
// A transition only runs from a value the browser has settled on, and every class
// change in the toggle otherwise lands in a single style resolution—the contents
// would go straight to opacity 1 and snap, whatever duration the CSS asked for. So
// the hidden state is applied, styles are flushed to make it real, and only then is
// it released.
function fadeInSidebarContents(side) {
  const sidebar = windowSizedSidebars[side];
  sidebar.classList.add('is-content-hidden');
  sidebar.getBoundingClientRect();
  sidebar.classList.remove('is-content-hidden');
}

// `applyToggle` flips the sidebar's is-hidden class (and persists it), and runs at
// opposite ends of the resize depending on direction: opening, the sidebar has to
// be un-hidden before the window grows, or the new width would land in the task
// area for as long as the resize takes; closing, it has to stay un-hidden until
// the window has finished shrinking, or the sidebar would vanish and leave the
// task area holding its space until the frame caught up.
async function toggleSidebarWithWindow(side, isOpening, applyToggle) {
  if (isResizingWindow) return;
  isResizingWindow = true;

  try {
    beginWindowSizing(side);
    if (isOpening) {
      applyToggle();
      fadeInSidebarContents(side);
    }

    await window.windowSizing.setSidebarOpen(side, isOpening);
    // The resize has landed in the main process, but the renderer's viewport may
    // be a frame behind it; unpinning against a stale width would show up as a
    // final flicker in the task area.
    await new Promise((resolve) => requestAnimationFrame(resolve));

    if (!isOpening) applyToggle();
  } finally {
    endWindowSizing(side);
    isResizingWindow = false;
  }
}
