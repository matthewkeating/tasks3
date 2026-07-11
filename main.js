const { app, BrowserWindow, Menu } = require('electron');
const path = require('node:path');
const { registerIpcHandlers } = require('./main/ipc');
const { buildMenu } = require('./main/menu');
const { loadWindowState, trackWindowState } = require('./main/windowStateStore');

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
    ...(windowState ? { width: windowState.width, height: windowState.height, x: windowState.x, y: windowState.y } : {}),
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
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
