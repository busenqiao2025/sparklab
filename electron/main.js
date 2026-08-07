const { app, BrowserWindow, ipcMain, session, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let skipInjection = false;
let uiInjected = false;
let pollTimer = null;
let lastVersionData = null;
let pendingChangelog = null;
let updateCheckTimer = null;
const APP_URL = 'https://ankomon.dpdns.org';
const versionFilePath = path.join(app.getPath('userData'), 'last-version.json');

app.commandLine.appendSwitch('no-proxy-server');
app.disableHardwareAcceleration();

function setupRequestRedirect() {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (details.url.startsWith('http://localhost:18765/api/')) {
      callback({ redirectURL: details.url.replace('http://localhost:18765/api/', APP_URL + '/api/') });
    } else {
      callback({});
    }
  });
}

function getLastKnownVersion() {
  try {
    return JSON.parse(fs.readFileSync(versionFilePath, 'utf8')).version;
  } catch {
    return null;
  }
}

function saveLastKnownVersion(version) {
  try {
    fs.writeFileSync(versionFilePath, JSON.stringify({ version }));
  } catch (e) {
    console.error('[Update] Failed to save version:', e.message);
  }
}

async function checkForUpdates() {
  if (!mainWindow) return;

  try {
    const response = await fetch(APP_URL + '/version.json');
    if (!response.ok) return;
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return;
    const data = await response.json();
    lastVersionData = data;

    const lastVersion = getLastKnownVersion();
    if (lastVersion === data.version) return;

    console.log('[Update] New version detected:', data.version, '(was:', lastVersion + ')');

    const loggedIn = await mainWindow.webContents.executeJavaScript(
      'var ms = document.getElementById("mainScreen"); return !!(ms && ms.offsetParent !== null);'
    ).catch(() => false);

    if (!loggedIn) {
      console.log('[Update] User not logged in, deferring notification');
      return;
    }

    saveLastKnownVersion(data.version);
    pendingChangelog = data;

    if (Notification.isSupported()) {
      const notification = new Notification({
        title: 'SparkMinds Lab 已更新',
        body: '检测到新版本 ' + data.version + '，正在刷新页面...',
      });
      notification.show();
    }

    setTimeout(() => {
      if (mainWindow) {
        console.log('[Update] Refreshing page...');
        mainWindow.reload();
      }
    }, 2000);
  } catch (e) {
    console.error('[Update] Check failed:', e.message);
  }
}

function startUpdateChecking() {
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  updateCheckTimer = setInterval(checkForUpdates, 5 * 60 * 1000);
}

function showChangelog(data) {
  if (!mainWindow) return;

  var dataJson = JSON.stringify(data);

  var script = `
    (function() {
      var data = ${dataJson};

      var existing = document.getElementById('desktop-changelog-overlay');
      if (existing) existing.remove();

      var style = document.createElement('style');
      style.id = 'dc-animation-style';
      style.textContent = '@keyframes dcFadeIn{from{opacity:0}to{opacity:1}}@keyframes dcSlideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}';
      if (!document.getElementById('dc-animation-style')) document.head.appendChild(style);

      var changesHtml = data.changes.map(function(c) {
        return '<li style="padding:10px 0;border-bottom:1px solid var(--border-light);font-size:13px;color:var(--fg-dim);line-height:1.5">\\u2022 ' + c + '</li>';
      }).join('');

      var overlay = document.createElement('div');
      overlay.id = 'desktop-changelog-overlay';
      overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:var(--font,system-ui,sans-serif);animation:dcFadeIn 0.2s ease';

      var dialog = document.createElement('div');
      dialog.style.cssText = 'background:var(--bg2);border:1px solid var(--border);border-radius:16px;padding:32px;max-width:480px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3);position:relative;animation:dcSlideUp 0.25s ease';

      var closeBtn = document.createElement('button');
      closeBtn.innerHTML = '\\u00d7';
      closeBtn.style.cssText = 'position:absolute;top:16px;right:16px;background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted);width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center';

      var title = document.createElement('div');
      title.style.cssText = 'font-size:20px;font-weight:700;color:var(--fg);margin-bottom:4px';
      title.textContent = data.title || ('SparkMinds Lab ' + data.version);

      var dateEl = document.createElement('div');
      dateEl.style.cssText = 'font-size:13px;color:var(--muted);margin-bottom:20px';
      dateEl.textContent = data.date || '';

      var list = document.createElement('ul');
      list.style.cssText = 'margin:0;padding:0;list-style:none';
      list.innerHTML = changesHtml;

      var okBtn = document.createElement('button');
      okBtn.textContent = '知道了';
      okBtn.style.cssText = 'margin-top:24px;width:100%;padding:12px;background:var(--accent);color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer';

      dialog.appendChild(closeBtn);
      dialog.appendChild(title);
      dialog.appendChild(dateEl);
      dialog.appendChild(list);
      dialog.appendChild(okBtn);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      var close = function() { overlay.remove(); };
      closeBtn.addEventListener('click', close);
      okBtn.addEventListener('click', close);
      overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
    })();
  `;

  mainWindow.webContents.executeJavaScript(script).catch(function(e) {
    console.error('[Update] Dialog failed:', e.message);
  });
}

function injectDesktopUI() {
  if (!mainWindow) return;
  if (skipInjection) {
    console.log('[Desktop UI] Injection skipped (Ctrl+Shift+D)');
    return;
  }
  if (uiInjected) {
    console.log('[Desktop UI] Already injected, skipping');
    return;
  }

  const cssPath = path.join(__dirname, 'desktop-ui.css');
  const jsPath = path.join(__dirname, 'desktop-ui.js');

  try {
    const css = fs.readFileSync(cssPath, 'utf8');
    mainWindow.webContents.insertCSS(css).then(() => {
      console.log('[Desktop UI] CSS injected OK');
    }).catch((e) => {
      console.error('[Desktop UI] CSS inject failed:', e.message);
    });
  } catch (e) {
    console.error('[Desktop UI] Failed to read desktop-ui.css:', e.message);
  }

  try {
    const js = fs.readFileSync(jsPath, 'utf8');
    mainWindow.webContents.executeJavaScript(js).then(() => {
      console.log('[Desktop UI] JS injected OK');
    }).catch((e) => {
      console.error('[Desktop UI] JS inject failed:', e.message);
    });
  } catch (e) {
    console.error('[Desktop UI] Failed to read desktop-ui.js:', e.message);
  }

  uiInjected = true;
}

function checkAndInject() {
  if (!mainWindow || uiInjected || skipInjection) return;

  mainWindow.webContents.executeJavaScript(`
    (function() {
      var sidebar = document.querySelector('.trae-sidebar');
      var mainScreen = document.getElementById('mainScreen');
      if (!sidebar || !mainScreen) return false;
      var style = getComputedStyle(mainScreen);
      return style.display !== 'none' && mainScreen.offsetParent !== null;
    })()
  `).then((ready) => {
    if (ready && !uiInjected && !skipInjection) {
      console.log('[Desktop UI] Login detected, injecting UI...');
      injectDesktopUI();
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      setTimeout(() => { checkForUpdates(); }, 2000);
    }
  }).catch((e) => {
    console.error('[Desktop UI] Polling error:', e.message);
  });
}

function startLoginPolling() {
  if (pollTimer) clearInterval(pollTimer);
  uiInjected = false;
  pollTimer = setInterval(checkAndInject, 1000);
  checkAndInject();
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    title: 'SparkMinds Lab',
    backgroundColor: '#0f1117',
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  console.log('[App] Loading URL:', APP_URL);
  mainWindow.loadURL(APP_URL);

  mainWindow.once('ready-to-show', () => {
    console.log('[App] ready-to-show triggered');
    mainWindow.show();
  });
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      console.log('[App] Force showing window after 5s timeout');
      mainWindow.show();
    }
  }, 5000);

  mainWindow.webContents.on('did-start-loading', () => {
    console.log('[App] Page started loading');
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[App] Page finished loading');
    startLoginPolling();

    if (pendingChangelog) {
      var cl = pendingChangelog;
      pendingChangelog = null;
      setTimeout(() => { showChangelog(cl); }, 1500);
    }

    setTimeout(() => {
      checkForUpdates();
      startUpdateChecking();
    }, 5000);
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('[App] Load failed:', errorCode, errorDescription, validatedURL);
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (updateCheckTimer) { clearInterval(updateCheckTimer); updateCheckTimer = null; }
    setTimeout(() => {
      if (mainWindow) {
        console.log('[App] Retrying load in 2s...');
        mainWindow.loadURL(APP_URL);
      }
    }, 2000);
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    if (input.key === 'F12') {
      event.preventDefault();
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
      }
      return;
    }

    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      event.preventDefault();
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
      }
      return;
    }

    if (input.control && input.shift && input.key.toLowerCase() === 'd') {
      event.preventDefault();
      skipInjection = !skipInjection;
      uiInjected = false;
      console.log('[Desktop UI] Injection ' + (skipInjection ? 'DISABLED' : 'ENABLED') + ', reloading...');
      mainWindow.reload();
      return;
    }

    if (input.control && input.shift && input.key.toLowerCase() === 'u') {
      event.preventDefault();
      if (lastVersionData) {
        showChangelog(lastVersionData);
      } else {
        checkForUpdates().then(() => {
          if (lastVersionData) showChangelog(lastVersionData);
        });
      }
      return;
    }
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (updateCheckTimer) { clearInterval(updateCheckTimer); updateCheckTimer = null; }
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  setupRequestRedirect();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ===== IPC Handlers ===== */
ipcMain.handle('app-version', () => app.getVersion());

ipcMain.handle('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.handle('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('window-is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});
