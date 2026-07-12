const { screen } = require('electron');

// Resizes the window to make room for a sidebar: opening one widens the window
// rather than taking space from the task area, and closing it shrinks the window
// back. Both sidebars work this way, and both grow the window on the same edge—
// only the width changes, never x—so the window's origin, and with it everything
// the renderer has already painted, never shifts. The two sides are tracked
// independently, so a window with both open is wider by the sum of the two.
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

// Keep in sync with .sidebar-left / .sidebar-right in src/css/sidebar.css.
const SIDEBAR_WIDTHS = { left: 220, right: 275 };

// The whole length of a slide: the window's growth and the sidebar's width are the
// same motion, so this is the only speed knob. The two are not equal—they're matched
// in px/ms, so the wider right sidebar's longer travel takes proportionally longer
// and both slides move at the same speed. The opacity transitions in
// body.is-window-sizing-* (sidebar.css) are matched to these by hand.
const RESIZE_DURATION_MS = { left: 400, right: 500 };
const FRAME_MS = 16;

// What each window actually gained when a sidebar opened, per side, so that closing
// one gives back exactly that much and not a blind 220/275px. A side with no entry
// was opened by a previous session—bounds and sidebar state are persisted and
// restored together—which grew by the full width, or the sidebar couldn't have been
// open to begin with.
const appliedGrowth = new WeakMap();

function growthRecord(win) {
  if (!appliedGrowth.has(win)) appliedGrowth.set(win, {});
  return appliedGrowth.get(win);
}

function canResize(win) {
  return !win.isMaximized() && !win.isFullScreen();
}

function roomOnRight(win) {
  const bounds = win.getBounds();
  const { workArea } = screen.getDisplayMatching(bounds);
  return Math.max(0, (workArea.x + workArea.width) - (bounds.x + bounds.width));
}

// Steps the window's width to `targetWidth` over `durationMs`, one setBounds per
// frame, and resolves when it lands.
//
// Electron's own animated setBounds (the `animate` flag) is no good here: Chromium
// doesn't lay the renderer out during it, so the viewport width—which the sidebar's
// width is derived from—doesn't budge until the frame settles, and the sidebar
// appears fully-formed at the end instead of sliding. Each step below is a real
// resize the renderer lays out against, so the sidebar tracks it exactly.
//
// Bounds are re-read every step rather than interpolated from a snapshot, so that a
// window the user is dragging mid-animation keeps its position.
function animateWidth(win, targetWidth, durationMs) {
  const startWidth = win.getBounds().width;
  const startTime = Date.now();

  return new Promise((resolve) => {
    const step = () => {
      if (win.isDestroyed()) {
        resolve();
        return;
      }
      const progress = Math.min(1, (Date.now() - startTime) / durationMs);
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

// `side` is 'left' or 'right'.
async function setSidebarOpen(win, side, isOpen) {
  const growthBySide = growthRecord(win);

  if (!canResize(win)) {
    growthBySide[side] = 0;
    return;
  }

  const growth = isOpen
    ? Math.min(SIDEBAR_WIDTHS[side], roomOnRight(win))
    : -(growthBySide[side] ?? SIDEBAR_WIDTHS[side]);
  growthBySide[side] = isOpen ? growth : 0;
  if (growth === 0) return;

  const [minWidth] = win.getMinimumSize();
  await animateWidth(win, Math.max(minWidth, win.getBounds().width + growth), RESIZE_DURATION_MS[side]);
}

module.exports = { setSidebarOpen };
