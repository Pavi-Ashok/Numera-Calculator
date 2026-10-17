/*
 * Renders src/assets/logo.svg to build/icon.png (512×512). electron-builder turns it
 * into the Windows .ico, and the app uses it as the window icon during development.
 * Run with: npm run icon
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SIZE = 512;
const root = path.join(__dirname, '..');
const outFile = path.join(root, 'build', 'icon.png');
const svg = fs.readFileSync(path.join(root, 'src', 'assets', 'logo.svg'));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  const html = `<body style="margin:0;background:transparent">
    <img src="data:image/svg+xml;base64,${svg.toString('base64')}" style="width:${SIZE}px;height:${SIZE}px;display:block">`;
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  await new Promise((resolve) => setTimeout(resolve, 500)); // let the offscreen frame paint
  const image = (await win.webContents.capturePage()).resize({ width: SIZE, height: SIZE, quality: 'best' });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, image.toPNG());
  console.log(`wrote ${path.relative(root, outFile)} (${SIZE}×${SIZE})`);
  app.exit(0);
});
