const { contextBridge, ipcRenderer } = require('electron');

// The only bridge between the page and the main process.
contextBridge.exposeInMainWorld('calcWindow', {
  // Grow/shrink the window when the scientific keys are shown or hidden.
  setScientific: (on) => ipcRenderer.send('calc:set-scientific', Boolean(on)),
  // 'system' | 'light' | 'dark' — keeps the Windows title bar in step with the page.
  setTheme: (choice) => ipcRenderer.send('calc:set-theme', String(choice)),
  // { version, copyright } for the About dialog.
  getInfo: () => ipcRenderer.invoke('calc:get-info'),
});
