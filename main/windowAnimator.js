// Handles smooth window resizing animations for sidebar toggle operations.
// When a sidebar is toggled, this module smoothly animates the window dimensions
// and position to expand or contract horizontally.

const ANIMATION_DURATION_MS = 350;
const ANIMATION_FRAME_RATE = 60;
const FRAME_DURATION_MS = 1000 / ANIMATION_FRAME_RATE;

// Sidebar widths (must match CSS values in sidebar.css)
const SIDEBAR_WIDTHS = {
  left: 220,
  right: 275,
};

// Easing function for smooth animation (ease-out)
function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}

// Animates the window from current bounds to target bounds over ANIMATION_DURATION_MS.
// For the left sidebar: adjusts both x and width (window expands/contracts leftward).
// For the right sidebar: adjusts only width (window expands/contracts rightward, x stays fixed).
async function animateWindowResize(win, targetBounds) {
  return new Promise((resolve) => {
    const startBounds = win.getBounds();
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / ANIMATION_DURATION_MS, 1);
      const eased = easeOut(progress);

      // Interpolate bounds between start and target
      const currentBounds = {
        x: Math.round(startBounds.x + (targetBounds.x - startBounds.x) * eased),
        y: startBounds.y,
        width: Math.round(startBounds.width + (targetBounds.width - startBounds.width) * eased),
        height: startBounds.height,
      };

      win.setBounds(currentBounds, false);

      if (progress < 1) {
        setTimeout(animate, FRAME_DURATION_MS);
      } else {
        // Final frame: ensure we land exactly on target
        win.setBounds(targetBounds, false);
        resolve();
      }
    };

    animate();
  });
}

// Handles a sidebar toggle by calculating new window bounds and animating.
// sidebarId: 'left' or 'right'
// isNowVisible: true if sidebar is being shown, false if being hidden
async function handleSidebarToggle(win, sidebarId, isNowVisible) {
  const currentBounds = win.getBounds();
  const sidebarWidth = SIDEBAR_WIDTHS[sidebarId];
  
  let newBounds = { ...currentBounds };

  if (sidebarId === 'left') {
    if (isNowVisible) {
      // Showing left sidebar: expand window leftward (decrease x, increase width)
      newBounds.x -= sidebarWidth;
      newBounds.width += sidebarWidth;
    } else {
      // Hiding left sidebar: contract window rightward (increase x, decrease width)
      newBounds.x += sidebarWidth;
      newBounds.width -= sidebarWidth;
    }
  } else if (sidebarId === 'right') {
    if (isNowVisible) {
      // Showing right sidebar: expand window rightward (width only, x unchanged)
      newBounds.width += sidebarWidth;
    } else {
      // Hiding right sidebar: contract window leftward (width only, x unchanged)
      newBounds.width -= sidebarWidth;
    }
  }

  await animateWindowResize(win, newBounds);
}

module.exports = { handleSidebarToggle };
