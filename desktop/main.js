/* Freeify desktop app: a thin Electron window around the web app in ./www. */
const { app, BrowserWindow, Menu, shell, session } = require('electron');
const path = require('path');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;
const INDEX = path.join(__dirname, 'www', 'index.html');

// Spotify sign-in: these pages may open inside the app window; everything else opens in the browser.
const SIGN_IN_HOSTS = /(^|\.)(spotify\.com|accounts\.google\.com|appleid\.apple\.com|facebook\.com)$/i;
// Must match the redirect address shown on Freeify's Import page (js/spotify.js DESKTOP_REDIRECT).
const SPOTIFY_REDIRECT = 'http://127.0.0.1:43821/callback';

function isAppUrl(url) {
  return url.startsWith('file:');
}

function isSignInUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && SIGN_IN_HOSTS.test(u.hostname);
  } catch (e) { return false; }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 360,
    minHeight: 560,
    title: 'Freeify',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, 'www', 'icons', 'icon-512.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(INDEX);

  // Links to websites open in the normal browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url) || isSignInUrl(url) || url.startsWith(SPOTIFY_REDIRECT)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  // Escape on a sign-in page returns to Freeify.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && !isAppUrl(win.webContents.getURL())) {
      event.preventDefault();
      win.loadFile(INDEX);
    }
  });

  win.on('closed', () => { win = null; });
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  // When Spotify sends the user back after sign-in, hand the code to the app instead of loading the address.
  session.defaultSession.webRequest.onBeforeRequest({ urls: [`${SPOTIFY_REDIRECT}*`] }, (details, callback) => {
    callback({ cancel: true });
    const search = new URL(details.url).search;
    if (win) win.loadFile(INDEX, { search: search.replace(/^\?/, '') });
  });
  // macOS keeps its standard app menu (Quit, Copy/Paste...). Other systems need none.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
