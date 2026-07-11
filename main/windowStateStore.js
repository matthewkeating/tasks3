const { app, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// Persists window bounds (size, position, maximized state) so the app reopens
// where the user left it. Unlike tokenStore, this isn't sensitive data, so it's
// stored as plain, unencrypted JSON.

const SAVE_DEBOUNCE_MS = 500;

function getStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

// A saved position can land off-screen if a monitor was disconnected or the
// resolution changed since the last launch; only trust bounds that still
// overlap a currently connected display.
function isOnScreen(bounds) {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return bounds.x < area.x + area.width
      && bounds.x + bounds.width > area.x
      && bounds.y < area.y + area.height
      && bounds.y + bounds.height > area.y;
  });
}

// Returns the last-saved window state, or null if there's none, it's malformed,
// or it would now open off-screen—callers should fall back to Electron's defaults.
function loadWindowState() {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(getStatePath(), 'utf8'));
  } catch {
    return null;
  }
  if (typeof state?.width !== 'number' || typeof state?.height !== 'number'
    || typeof state?.x !== 'number' || typeof state?.y !== 'number') {
    return null;
  }
  return isOnScreen(state) ? state : null;
}

function write(state) {
  try {
    fs.writeFileSync(getStatePath(), JSON.stringify(state));
  } catch {
    // Non-critical: worst case the next launch falls back to default placement.
  }
}

// Wires up listeners that keep the on-disk state in sync with the window, debounced
// so dragging/resizing doesn't hammer disk I/O, plus an immediate flush on close to
// catch the final position (which the debounce could otherwise drop before quit).
//
// Bounds while maximized are just the full work area, not a useful "restored" size,
// so the last known un-maximized bounds are tracked separately in `lastBounds` and
// paired with an `isMaximized` flag—`resize`/`move` only update it while unmaximized,
// so a maximize never clobbers the geometry to return to on next launch.
function trackWindowState(win, initialState) {
  let lastBounds = initialState
    ? { x: initialState.x, y: initialState.y, width: initialState.width, height: initialState.height }
    : win.getBounds();
  let saveTimer = null;

  const captureIfRestored = () => {
    if (!win.isMaximized()) {
      lastBounds = win.getBounds();
    }
  };

  const save = () => write({ ...lastBounds, isMaximized: win.isMaximized() });

  const scheduleSave = () => {
    captureIfRestored();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DEBOUNCE_MS);
  };

  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  win.on('maximize', scheduleSave);
  win.on('unmaximize', scheduleSave);
  win.on('close', () => {
    clearTimeout(saveTimer);
    captureIfRestored();
    save();
  });
}

module.exports = { loadWindowState, trackWindowState };
