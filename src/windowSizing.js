// Renderer half of the left sidebar's window resize: opening the sidebar widens
// the window to make room for itself instead of taking space from the task area
// (which is still what the right sidebar does), and closing it shrinks the window
// back. Only the window's right edge moves; its x never changes.
//
// The sidebar's width is not transitioned while this happens. It's derived from
// the window's live width (see body.is-window-sizing in layout.css), so it tracks
// the OS resize frame for frame, however long the OS takes and whatever curve it
// uses. A CSS transition would be a second, independent timeline: run it even
// slightly ahead of the resize and the sidebar claims space the window hasn't
// gained yet, squeezing the task area—the very thing this feature exists to
// prevent. Deriving the width makes that unrepresentable rather than merely
// unlikely. Everything else anchored to the sidebar's edge (the header seam, the
// toggle button, the offline message) reads the same derived value, so nothing can
// drift out of step with it either.
//
// The task area is additionally pinned to its measured width for the duration.
// That matters when the window can't gain the full 220px (see
// main/sidebarWindowSizer.js): the sidebar stops short mid-slide, and without the
// pin the task area would reflow to absorb the difference while the frame was
// still moving.

const LEFT_SIDEBAR_WIDTH = 220; // keep in sync with .sidebar's width in css/sidebar.css

const mainContent = document.querySelector('.main-content');
// Named to avoid colliding with taskLists.js's `sidebarLeft`: these scripts share
// one global scope, so two top-level consts of the same name would be a redeclaration.
const leftSidebar = document.getElementById('sidebarLeft');

// The window is only busy for the length of the resize, and a toggle arriving
// mid-resize would measure widths that are still in motion, so extra toggles are
// dropped rather than queued.
let isResizingWindow = false;

// `baseWidth` is the window's width *without* the sidebar; the sidebar's derived
// width is the difference between that and the window's live width, so it has to
// be in place before the resize starts.
function beginWindowSizing(baseWidth) {
  mainContent.style.width = `${mainContent.getBoundingClientRect().width}px`;
  mainContent.classList.add('is-width-pinned');
  document.body.style.setProperty('--window-base-width', `${baseWidth}px`);
  document.body.classList.add('is-window-sizing');
}

// Hands the sidebar's width back to the plain CSS rules. Normally a no-op, since
// the derived width has already arrived at 0 or 220—but when the window couldn't
// gain (or give back) the full 220px, the sidebar is left part-way and .sidebar's
// own width transition carries it the rest of the way, taking the shortfall out of
// the task area exactly as the app behaved before this feature.
function endWindowSizing() {
  document.body.classList.remove('is-window-sizing');
  document.body.style.removeProperty('--window-base-width');
  mainContent.classList.remove('is-width-pinned');
  mainContent.style.width = '';
  leftSidebar.classList.remove('is-content-hidden');
}

// Starts the contents' fade-in (see .sidebar-left.is-content-hidden in sidebar.css).
// A transition only runs from a value the browser has settled on, and every class
// change in the toggle otherwise lands in a single style resolution—the contents
// would go straight to opacity 1 and snap, whatever duration the CSS asked for. So
// the hidden state is applied, styles are flushed to make it real, and only then is
// it released.
function fadeInSidebarContents() {
  leftSidebar.classList.add('is-content-hidden');
  leftSidebar.getBoundingClientRect();
  leftSidebar.classList.remove('is-content-hidden');
}

// `applyToggle` flips the sidebar's is-hidden class (and persists it), and runs at
// opposite ends of the resize depending on direction: opening, the sidebar has to
// be un-hidden before the window grows, or the new width would land in the task
// area for as long as the resize takes; closing, it has to stay un-hidden until
// the window has finished shrinking, or the sidebar would vanish and leave the
// task area holding its space until the frame caught up.
async function toggleSidebarLeftWithWindow(isOpening, applyToggle) {
  if (isResizingWindow) return;
  isResizingWindow = true;

  try {
    beginWindowSizing(isOpening ? window.innerWidth : window.innerWidth - LEFT_SIDEBAR_WIDTH);
    if (isOpening) {
      applyToggle();
      fadeInSidebarContents();
    }

    await window.windowSizing.setLeftSidebarOpen(isOpening);
    // The resize has landed in the main process, but the renderer's viewport may
    // be a frame behind it; unpinning against a stale width would show up as a
    // final flicker in the task area.
    await new Promise((resolve) => requestAnimationFrame(resolve));

    if (!isOpening) applyToggle();
  } finally {
    endWindowSizing();
    isResizingWindow = false;
  }
}
