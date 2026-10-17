const { app, BrowserWindow, ipcMain, nativeTheme, screen } = require('electron');
const fs = require('fs');
const path = require('path');

const APP_ID = 'com.numera.calculator';
const PRODUCT_NAME = 'Numera Calculator';
const COPYRIGHT = '© 2026 Numera';

// Window heights for the standard keypad and the full scientific keypad.
const SIZES = {
  standard: { height: 600, minHeight: 520 },
  scientific: { height: 820, minHeight: 660 },
};
const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 340;
const THEMES = ['system', 'light', 'dark'];
const BACKGROUND = { light: '#f3f3f3', dark: '#202020' };

// ---------- settings (window position, theme) ----------

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch {
    /* non-fatal: settings just won't persist */
  }
}

const settings = loadSettings();

// Restore the saved position only if it is still on a connected display.
function restoredPosition() {
  const b = settings.bounds;
  if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y)) return {};
  const visible = screen.getAllDisplays().some(({ workArea: a }) =>
    b.x >= a.x - 50 && b.y >= a.y - 10 && b.x < a.x + a.width - 100 && b.y < a.y + a.height - 100
  );
  return visible ? { x: b.x, y: b.y } : {};
}

// ---------- window ----------

let mainWindow = null;

function createWindow() {
  nativeTheme.themeSource = THEMES.includes(settings.theme) ? settings.theme : 'system';
  const width = Math.max(MIN_WIDTH, Number(settings.bounds?.width) || DEFAULT_WIDTH);

  mainWindow = new BrowserWindow({
    ...restoredPosition(),
    width,
    height: SIZES.standard.height,
    minWidth: MIN_WIDTH,
    minHeight: SIZES.standard.minHeight,
    title: PRODUCT_NAME,
    // The packaged .exe carries its own icon; during development use the build icon.
    ...(app.isPackaged ? {} : { icon: path.join(__dirname, 'build', 'icon.png') }),
    backgroundColor: nativeTheme.shouldUseDarkColors ? BACKGROUND.dark : BACKGROUND.light,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.removeMenu();
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', () => {
    const { x, y, width: w } = mainWindow.getNormalBounds();
    settings.bounds = { x, y, width: w };
    saveSettings(settings);
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Links never open inside the calculator window.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

// ---------- IPC from the page ----------

ipcMain.on('calc:set-scientific', (event, on) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isMaximized() || win.isFullScreen()) return;
  const size = on ? SIZES.scientific : SIZES.standard;
  const bounds = win.getBounds();
  // Keep the grown window on screen.
  const area = screen.getDisplayMatching(bounds).workArea;
  const y = Math.max(area.y, Math.min(bounds.y, area.y + area.height - size.height));
  win.setMinimumSize(MIN_WIDTH, size.minHeight);
  win.setBounds({ x: bounds.x, y, width: bounds.width, height: size.height }, true);
});

ipcMain.on('calc:set-theme', (event, choice) => {
  if (!THEMES.includes(choice)) return;
  nativeTheme.themeSource = choice;
  BrowserWindow.fromWebContents(event.sender)?.setBackgroundColor(
    nativeTheme.shouldUseDarkColors ? BACKGROUND.dark : BACKGROUND.light
  );
  if (settings.theme !== choice) {
    settings.theme = choice;
    saveSettings(settings);
  }
});

ipcMain.handle('calc:get-info', () => ({ version: app.getVersion(), copyright: COPYRIGHT }));

// ---------- app lifecycle ----------

app.setAppUserModelId(APP_ID);

// One calculator at a time: launching again focuses the open window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
