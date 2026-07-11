const { Menu } = require('electron');

// Builds the native application menu. Accelerators here are the single source of
// truth for app-level shortcuts; the renderer's handleGlobalKeydown must not also
// bind these combos, since a menu accelerator and a DOM keydown both fire independently
// when the window has focus, causing the underlying action to run twice.
function buildMenu(win) {
  const send = (channel) => () => win.webContents.send(channel);

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
        { type: 'separator' },
        // The single Full Screen entry; macOS's own auto-injected duplicate is
        // suppressed via NSFullScreenMenuItemEverywhere in main.js.
        { role: 'togglefullscreen' },
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

module.exports = { buildMenu };
