const path = require('path');
const zlib = require('zlib');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
} = require('electron');

const {
  loadConfig,
  saveConfig,
  saveRoutine,
  deleteRoutine,
} = require('./core/config');
const { scanProjects } = require('./core/indexer');
const {
  DEFAULT_AGY_MODELS,
  fetchAgyModels,
  parsePrompt,
  parseWithAI,
} = require('./core/parser');
const { executeActions } = require('./core/executor');
const taskManager = require('./core/task-manager');
const {
  ensureLaunchScripts,
  enableStartup,
  disableStartup,
  getStartupStatus,
} = require('./core/startup');

const launchedAtStartup = process.argv.includes('--startup');

let mainWindow = null;
let tray = null;
let config = loadConfig();
let indexData = { projects: [], count: 0, scannedAt: null };
let isBootProtected = launchedAtStartup;
let isSettingsOpen = false;
let lastSummonedAt = 0;
let windowBounds = { x: 0, y: 0, width: 1280, height: 720 };
let registeredHotkeys = [];
let currentAgyConversationId = null;
let agyModels = [...DEFAULT_AGY_MODELS];
let taskBroadcastTimer = null;

function scheduleTasksBroadcast() {
  if (taskBroadcastTimer) return;
  taskBroadcastTimer = setTimeout(() => {
    taskBroadcastTimer = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tasks-updated', taskManager.getTasks());
    }
  }, 250);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  }
  return (c ^ -1) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function makePngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const combined = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function createTrayIcon() {
  const size = 32;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;

  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter type 0
    for (let x = 0; x < size; x++) {
      const idx = rowStart + 1 + x * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= 14.5) {
        // Dark indigo circular backdrop with glowing cyan-violet pulse ring
        let r = 20;
        let g = 24;
        let b = 46;
        let a = 255;

        if (dist > 13.2) {
          a = Math.max(0, Math.round((14.5 - dist) * 195));
        }
        if (dist >= 7.2 && dist <= 10.6) {
          const t = x / size;
          r = Math.round(99 + (56 - 99) * t);
          g = Math.round(102 + (189 - 102) * t);
          b = Math.round(241 + (248 - 241) * t);
        } else if (dist <= 3.6) {
          r = 165;
          g = 243;
          b = 252;
        }
        raw[idx] = r;
        raw[idx + 1] = g;
        raw[idx + 2] = b;
        raw[idx + 3] = a;
      } else {
        raw[idx] = 0;
        raw[idx + 1] = 0;
        raw[idx + 2] = 0;
        raw[idx + 3] = 0;
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(raw);
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', compressed),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);

  return nativeImage.createFromBuffer(png);
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function computeWindowBounds() {
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.bounds;
  windowBounds = { x, y, width, height };
  return windowBounds;
}

function showWindow(openSettings = false) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  computeWindowBounds();
  lastSummonedAt = Date.now();
  if (!launchedAtStartup || mainWindow.isVisible()) {
    isBootProtected = false;
  }
  mainWindow.setBounds(windowBounds);
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('spotlight-focused', { openSettings });
}

function hideWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  isSettingsOpen = false;
  isBootProtected = false;
  mainWindow.hide();
}

function toggleSpotlight() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    hideWindow();
  } else {
    isBootProtected = false;
    showWindow(false);
  }
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  registeredHotkeys = [];
  const candidates = [config.hotkey, config.fallbackHotkey].filter(Boolean);
  for (const shortcut of candidates) {
    try {
      const ok = globalShortcut.register(shortcut, toggleSpotlight);
      if (ok) {
        registeredHotkeys.push(shortcut);
      }
    } catch (err) {
      // Ignore invalid or conflicted shortcut
    }
  }
}

function refreshTrayMenu() {
  if (!tray) return;
  const startupStatus = getStartupStatus();
  const primaryShortcut = registeredHotkeys[0] || config.hotkey || 'Alt+Space';
  const menu = Menu.buildFromTemplate([
    {
      label: `What should we do today? (${primaryShortcut})`,
      click: () => {
        isBootProtected = false;
        showWindow(false);
      },
    },
    {
      label: `Rescan Projects (${indexData.count} indexed)`,
      click: () => {
        indexData = scanProjects(config);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('projects-updated', {
            count: indexData.count,
            scannedAt: indexData.scannedAt,
          });
        }
        refreshTrayMenu();
      },
    },
    { type: 'separator' },
    {
      label: 'Launch on Windows Startup',
      type: 'checkbox',
      checked: startupStatus.enabled,
      click: (menuItem) => {
        if (menuItem.checked) enableStartup();
        else disableStartup();
        refreshTrayMenu();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('startup-updated', getStartupStatus());
        }
      },
    },
    {
      label: 'Settings...',
      click: () => {
        isBootProtected = false;
        showWindow(true);
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Pulse',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

function createWindow() {
  computeWindowBounds();
  mainWindow = new BrowserWindow({
    width: windowBounds.width,
    height: windowBounds.height,
    x: windowBounds.x,
    y: windowBounds.y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    lastSummonedAt = Date.now();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('spotlight-focused', { openSettings: false });
  });

  mainWindow.on('blur', () => {
    if (isBootProtected || isSettingsOpen || !config.autoHideOnBlur) {
      return;
    }
    if (Date.now() - lastSummonedAt < 250) {
      return;
    }
    hideWindow();
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      hideWindow();
    }
  });
}

function setupIPC() {
  ipcMain.handle('get-initial-state', () => {
    return {
      greeting: getGreeting(),
      projectCount: indexData.count,
      appCount: indexData.appCount || 0,
      scannedAt: indexData.scannedAt,
      config,
      agyModels,
      tasks: taskManager.getTasks(),
      startupStatus: getStartupStatus(),
      registeredHotkeys,
      isBootProtected,
    };
  });

  ipcMain.handle('get-agy-models', async () => {
    agyModels = await fetchAgyModels(config);
    return agyModels;
  });

  ipcMain.handle('set-agy-model', (_event, modelId) => {
    const cleanModel = String(modelId || '').trim() || 'gemini-3.8-flash-low';
    config = saveConfig({
      ai: {
        ...(config.ai || {}),
        agyModel: cleanModel,
      },
    });
    return {
      config,
      agyModel: cleanModel,
    };
  });

  ipcMain.handle('query-prompt', (_event, promptText) => {
    return parsePrompt(promptText, indexData, config);
  });

  ipcMain.handle('query-ai', async (_event, payload) => {
    const promptText = typeof payload === 'string' ? payload : payload && payload.promptText;
    const history = (payload && payload.conversationHistory) || [];
    const result = await parseWithAI(
      promptText,
      indexData,
      config,
      history,
      currentAgyConversationId
    );
    if (result && result.agyConversationId) {
      currentAgyConversationId = result.agyConversationId;
    }
    return result;
  });

  ipcMain.handle('reset-conversation', () => {
    currentAgyConversationId = null;
    return { ok: true };
  });

  ipcMain.handle('execute-action', (_event, payload) => {
    const actions = payload && payload.actions ? payload.actions : payload;
    const promptText = (payload && payload.promptText) || '';
    const keepOpen = Boolean(payload && payload.keepOpen);

    const execResult = executeActions(actions, promptText, config);
    config = execResult.config || loadConfig();

    const startedTasks = Array.isArray(execResult.startedTasks) ? execResult.startedTasks : [];
    const openedTasks = startedTasks.length > 0;

    if (openedTasks) {
      scheduleTasksBroadcast();
    } else if (config.hideAfterExecute && !keepOpen) {
      hideWindow();
    }

    return {
      ok: true,
      executedCount: execResult.executedCount,
      openedTasks,
      tasks: taskManager.getTasks(),
      config,
    };
  });

  ipcMain.handle('get-tasks', () => {
    return taskManager.getTasks();
  });

  ipcMain.handle('rerun-task', (_event, id) => {
    const task = taskManager.rerunTask(id);
    scheduleTasksBroadcast();
    return { task, tasks: taskManager.getTasks() };
  });

  ipcMain.handle('stop-task', (_event, id) => {
    const task = taskManager.stopTask(id);
    scheduleTasksBroadcast();
    return { task, tasks: taskManager.getTasks() };
  });

  ipcMain.handle('remove-task', (_event, id) => {
    const tasksList = taskManager.removeTask(id);
    scheduleTasksBroadcast();
    return { tasks: tasksList };
  });

  ipcMain.handle('save-routine', (_event, payload) => {
    const { trigger, prompt, name } = payload || {};
    const res = saveRoutine(trigger, prompt, name);
    config = res.config;
    return res;
  });

  ipcMain.handle('delete-routine', (_event, id) => {
    config = deleteRoutine(id);
    return { config };
  });

  ipcMain.handle('rescan-projects', () => {
    indexData = scanProjects(config);
    refreshTrayMenu();
    return {
      count: indexData.count,
      scannedAt: indexData.scannedAt,
    };
  });

  ipcMain.handle('update-config', (_event, nextPartial) => {
    const prevRoots = JSON.stringify(config.workspaceRoots);
    const prevDepth = config.scanDepth;
    const prevHotkeys = `${config.hotkey}|${config.fallbackHotkey}`;

    config = saveConfig(nextPartial);

    if (
      JSON.stringify(config.workspaceRoots) !== prevRoots ||
      config.scanDepth !== prevDepth
    ) {
      indexData = scanProjects(config);
    }
    if (`${config.hotkey}|${config.fallbackHotkey}` !== prevHotkeys) {
      registerShortcuts();
    }
    refreshTrayMenu();

    return {
      config,
      projectCount: indexData.count,
      registeredHotkeys,
    };
  });

  ipcMain.handle('toggle-startup', (_event, enable) => {
    const status = enable ? enableStartup() : disableStartup();
    refreshTrayMenu();
    return status;
  });

  ipcMain.on('set-window-height', () => {
    // Full-screen transparent window; resizing handled in CSS.
  });

  ipcMain.on('set-settings-open', (_event, open) => {
    isSettingsOpen = Boolean(open);
  });

  ipcMain.on('user-interacted', () => {
    isBootProtected = false;
  });

  ipcMain.on('hide-window', () => {
    hideWindow();
  });
}

app.on('second-instance', () => {
  if (mainWindow) {
    isBootProtected = false;
    showWindow(false);
  }
});

app.whenReady().then(() => {
  ensureLaunchScripts();
  config = loadConfig();
  indexData = scanProjects(config);
  taskManager.setUpdateListener(() => scheduleTasksBroadcast());

  setupIPC();
  createWindow();

  tray = new Tray(createTrayIcon());
  tray.setToolTip('Pulse — What should we do today?');
  tray.on('click', () => {
    isBootProtected = false;
    toggleSpotlight();
  });
  refreshTrayMenu();

  registerShortcuts();

  fetchAgyModels(config)
    .then((models) => {
      if (Array.isArray(models) && models.length > 0) {
        agyModels = models;
      }
    })
    .catch(() => {});
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  taskManager.stopAllTasks();
});
