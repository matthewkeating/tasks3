const { app, BrowserWindow, Menu, nativeTheme, globalShortcut, systemPreferences } = require('electron');
const path = require('node:path');
const { registerIpcHandlers } = require('./main/ipc');
const { buildMenu } = require('./main/menu');
const { loadWindowState, trackWindowState } = require('./main/windowStateStore');

let mainWindow;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

function createWindow () {
  const windowState = loadWindowState();

  const win = new BrowserWindow({
    // remove the default titlebar
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 14, y: 14 },
    minWidth: 495,
    minHeight: 300,
    ...(windowState ? { width: windowState.width, height: windowState.height, x: windowState.x, y: windowState.y } : {}),
    show: false, // don't show until the renderer has painted, to avoid a white flash
    // Matches theme.css's --color-bg-app so there's no white flash before first paint
    // or while the renderer is torn down on close (BrowserWindow defaults to white).
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'src/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  })

  // Create at the saved (un-maximized) size first, then maximize—passing maximized
  // bounds directly to the constructor would leave nothing sane to restore to later.
  if (windowState?.isMaximized) {
    win.maximize();
  }
  trackWindowState(win, windowState);

  win.loadFile('src/index.html')
  Menu.setApplicationMenu(buildMenu(win))

  win.once('ready-to-show', () => {
    win.show();
  });

  mainWindow = win;
}

app.whenReady().then(() => {
  // macOS injects its own "Enter Full Screen" item into any menu titled "View",
  // duplicating the template's togglefullscreen role item. This user default is
  // AppKit's supported opt-out; it must be set before the menu is built.
  if (process.platform === 'darwin') {
    systemPreferences.setUserDefault('NSFullScreenMenuItemEverywhere', 'boolean', false);
  }
  registerIpcHandlers()
  createWindow()
  globalShortcut.register('Cmd+Shift+\'', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
      // Renderer state (selected list, tasks) is untouched by hide/show, so the
      // app naturally reopens on the same list—only focus needs to be restored.
      mainWindow.webContents.send('app:shown');
    }
  });
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  globalShortcut.unregisterAll();
});
