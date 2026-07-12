const { screen } = require('electron');

// Resizes the window to make room for the left sidebar: opening it widens the
// window rather than taking space from the task area, and closing it shrinks the
// window back. Only the right edge moves—x stays put—so the window's origin, and
// with it everything the renderer has already painted, never shifts.
//
// Growth is clamped to the display's work area. A window extending past the screen
// edge would push the right sidebar (and the notes field inside it) somewhere the
// user can't click, with no way to scroll it back into view since body sets
// `overflow: hidden`. Growing short is the far gentler failure: the sidebar just
// takes the shortfall out of the task area, which is what the app did for both
// sidebars before this existed. Same reasoning for a maximized or fullscreen
// window, where the OS owns the frame and there's nothing to grow into.
//
// Resizes are animated here, a frame at a time, so that the renderer can derive the
// sidebar's width from the window's live width and stay in lockstep with the frame
// (see src/windowSizing.js and animateWidth below).

const LEFT_SIDEBAR_WIDTH = 220; // keep in sync with .sidebar's width in src/css/sidebar.css
// The whole length of the slide: the window's growth and the sidebar's width are
// the same motion, so this is the only speed knob. The opacity transition in
// body.is-window-sizing .sidebar-left (sidebar.css) is matched to it by hand.
const RESIZE_DURATION_MS = 400;
const FRAME_MS = 16;

// What each window actually gained when its left sidebar opened, so that closing
// it gives back exactly that much and not a blind 220px. A window with no entry
// was opened by a previous session—bounds and sidebar state are persisted and
// restored together—which grew by the full width, or the sidebar couldn't have
// been open to begin with.
const appliedGrowth = new WeakMap();

function canResize(win) {
  return !win.isMaximized() && !win.isFullScreen();
}

function roomOnRight(win) {
  const bounds = win.getBounds();
  const { workArea } = screen.getDisplayMatching(bounds);
  return Math.max(0, (workArea.x + workArea.width) - (bounds.x + bounds.width));
}

// Steps the window's width to `targetWidth` over RESIZE_DURATION_MS, one setBounds
// per frame, and resolves when it lands.
//
// Electron's own animated setBounds (the `animate` flag) is no good here: Chromium
// doesn't lay the renderer out during it, so the viewport width—which the sidebar's
// width is derived from—doesn't budge until the frame settles, and the sidebar
// appears fully-formed at the end instead of sliding. Each step below is a real
// resize the renderer lays out against, so the sidebar tracks it exactly.
//
// Bounds are re-read every step rather than interpolated from a snapshot, so that a
// window the user is dragging mid-animation keeps its position.
function animateWidth(win, targetWidth) {
  const startWidth = win.getBounds().width;
  const startTime = Date.now();

  return new Promise((resolve) => {
    const step = () => {
      if (win.isDestroyed()) {
        resolve();
        return;
      }
      const progress = Math.min(1, (Date.now() - startTime) / RESIZE_DURATION_MS);
      const eased = 1 - (1 - progress) ** 3;
      const bounds = win.getBounds();
      win.setBounds({ ...bounds, width: Math.round(startWidth + (targetWidth - startWidth) * eased) });
      if (progress === 1) {
        resolve();
        return;
      }
      setTimeout(step, FRAME_MS);
    };
    step();
  });
}

async function setLeftSidebarOpen(win, isOpen) {
  if (!canResize(win)) {
    appliedGrowth.set(win, 0);
    return;
  }

  const growth = isOpen
    ? Math.min(LEFT_SIDEBAR_WIDTH, roomOnRight(win))
    : -(appliedGrowth.get(win) ?? LEFT_SIDEBAR_WIDTH);
  appliedGrowth.set(win, isOpen ? growth : 0);
  if (growth === 0) return;

  const [minWidth] = win.getMinimumSize();
  await animateWidth(win, Math.max(minWidth, win.getBounds().width + growth));
}

module.exports = { setLeftSidebarOpen };
