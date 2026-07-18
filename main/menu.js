const { Menu } = require('electron');
const auth = require('./auth');

// Builds the native application menu. Accelerators here are the single source of
// truth for app-level shortcuts; the renderer's handleGlobalKeydown must not also
// bind these combos, since a menu accelerator and a DOM keydown both fire independently
// when the window has focus, causing the underlying action to run twice.
//
// `account` ({ signedIn, email }) drives the File menu's identity block. The menu is
// static native UI built once, so it must be rebuilt (applyApplicationMenu) whenever
// auth state changes—see the auth:signIn/signOut IPC handlers.
function buildMenu(win, account = {}) {
  const send = (channel) => () => win.webContents.send(channel);
  const { signedIn = false, email = null } = account;

  // Only offer Sign Out while actually signed in. The "Signed in as…" line is a
  // disabled label (identity, not an action) and appears only once the email is
  // known—so a pre-email-scope token degrades to just Sign Out rather than nothing.
  const accountItems = signedIn
    ? [
        { type: 'separator' },
        ...(email ? [{ label: `Signed in as ${email}`, enabled: false }] : []),
        {
          label: 'Sign Out',
          click: send('menu:sign-out'),
        },
      ]
    : [];

  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Task',
          accelerator: 'CmdOrCtrl+N',
          click: send('menu:new-task'),
        },
        {
          label: 'New List',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: send('menu:new-list'),
        },
        ...accountItems,
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Left Sidebar',
          accelerator: 'CmdOrCtrl+Shift+,',
          click: send('menu:toggle-left-sidebar'),
        },
        {
          label: 'Toggle Right Sidebar',
          accelerator: 'CmdOrCtrl+Shift+.',
          click: send('menu:toggle-right-sidebar'),
        },
        { type: 'separator' },
        {
          label: 'Show/Hide Completed',
          accelerator: 'CmdOrCtrl+Shift+C',
          click: send('menu:toggle-completed-section'),
        },
        {
          label: 'Toggle Word Wrap',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: send('menu:toggle-word-wrap'),
        },
        // Deliberately no Full Screen menu item: declaring a togglefullscreen
        // role here reliably produced a duplicate on this app's macOS/Electron
        // combination, for a reason that wasn't pinned down (title-matching,
        // fullscreenable:false, and the NSFullScreenMenuItemEverywhere default
        // all failed to fix it). Full Screen is still reachable via the native
        // green traffic-light button—the window itself is still fullscreenable.
      ],
    },
    {
      label: 'Task',
      submenu: [
        {
          label: 'Toggle Completed',
          accelerator: 'CmdOrCtrl+Shift+K',
          click: send('menu:toggle-completed'),
        },
        {
          label: 'Delete Task',
          accelerator: 'CmdOrCtrl+Backspace',
          click: send('menu:delete-task'),
        },
        { type: 'separator' },
        {
          label: 'Select Next Task',
          accelerator: 'CmdOrCtrl+Shift+]',
          click: send('menu:select-next'),
        },
        {
          label: 'Select Previous Task',
          accelerator: 'CmdOrCtrl+Shift+[',
          click: send('menu:select-previous'),
        },
      ],
    },
    {
      role: 'windowMenu',
      // Specifying a submenu on a role-based menu replaces its auto-filled
      // contents, so the standard window items are re-declared here alongside
      // the added Developer Tools entry.
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin' ? [{ type: 'separator' }, { role: 'front' }] : [{ role: 'close' }]),
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'help', submenu: [] },
  ];

  return Menu.buildFromTemplate(template);
}

// Builds and installs the application menu with the current auth snapshot. Call
// this at startup and after any auth state change so the File menu's identity
// block stays in sync (the native menu doesn't re-read state on its own).
function applyApplicationMenu(win) {
  Menu.setApplicationMenu(buildMenu(win, auth.getAccountInfo()));
}

module.exports = { buildMenu, applyApplicationMenu };
