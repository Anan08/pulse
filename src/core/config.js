const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

const DEFAULT_CONFIG = {
  workspaceRoots: ['D:\\program\\project', 'D:\\program'],
  scanDepth: 3,
  hotkey: 'Alt+Space',
  fallbackHotkey: 'CommandOrControl+Shift+Space',
  hideAfterExecute: true,
  autoHideOnBlur: true,
  editorCommand: 'code',
  vscodePath: path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'Code.exe'),
  antigravityPath: path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'antigravity', 'Antigravity.exe'),
  ai: {
    enabled: true,
    provider: 'agy',
    agyPath: path.join(os.homedir(), 'AppData', 'Local', 'agy', 'bin', 'agy.exe'),
    agyModel: 'gemini-3.8-flash-low',
    apiKey: '',
    geminiModel: 'gemini-2.5-flash',
    openaiModel: 'gpt-4o-mini',
  },
  customRoutines: [
    {
      id: 'qola-workspace',
      name: 'Qola Workspace',
      trigger: 'qola workspace',
      prompt: 'open vscode from qola project',
      createdAt: '2026-11-22T00:00:00.000Z',
    },
  ],
  customAliases: {},
  customApps: {
    Antigravity: path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'antigravity', 'Antigravity.exe'),
    'VS Code': path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'Code.exe'),
    'File Explorer': 'explorer.exe',
    'Windows Terminal': 'wt.exe',
    PowerShell: 'powershell.exe',
    'Command Prompt': 'cmd.exe',
    'Task Manager': 'taskmgr.exe',
    Calculator: 'calc.exe',
    Notepad: 'notepad.exe',
    Paint: 'mspaint.exe',
    'Snipping Tool': 'snippingtool.exe',
    Settings: 'ms-settings:',
    Chrome: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    Edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    Spotify: 'spotify:',
    Discord: 'discord:',
  },
  customSites: {
    GitHub: 'https://github.com',
    Gmail: 'https://mail.google.com',
    YouTube: 'https://youtube.com',
    ChatGPT: 'https://chatgpt.com',
    Google: 'https://google.com',
    'Localhost 3000': 'http://localhost:3000',
    'Localhost 5173': 'http://localhost:5173',
    'Localhost 8080': 'http://localhost:8080',
  },
  recentHistory: [],
};

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function mergeConfig(base, incoming) {
  const result = {
    ...base,
    ...incoming,
    ai: {
      ...base.ai,
      ...(incoming && incoming.ai ? incoming.ai : {}),
    },
    customAliases: {
      ...base.customAliases,
      ...(incoming && incoming.customAliases ? incoming.customAliases : {}),
    },
    customApps: {
      ...base.customApps,
      ...(incoming && incoming.customApps ? incoming.customApps : {}),
    },
    customSites: {
      ...base.customSites,
      ...(incoming && incoming.customSites ? incoming.customSites : {}),
    },
  };

  // Upgrade legacy batch/start wrapper commands in customApps to direct executables/URIs
  const legacyAppReplacements = {
    'VS Code': 'code',
    Chrome: 'start "" chrome',
    Edge: 'start "" msedge',
    Spotify: 'start "" spotify:',
    Discord: 'start "" discord:',
  };
  for (const [appKey, legacyVal] of Object.entries(legacyAppReplacements)) {
    if (result.customApps[appKey] === legacyVal && base.customApps[appKey]) {
      result.customApps[appKey] = base.customApps[appKey];
    }
  }

  if (!Array.isArray(result.workspaceRoots) || result.workspaceRoots.length === 0) {
    result.workspaceRoots = [...base.workspaceRoots];
  }
  if (!Array.isArray(result.customRoutines)) {
    result.customRoutines = [...base.customRoutines];
  }
  if (!Array.isArray(result.recentHistory)) {
    result.recentHistory = [];
  }
  if (typeof result.scanDepth !== 'number' || result.scanDepth < 1 || result.scanDepth > 6) {
    result.scanDepth = base.scanDepth;
  }

  return result;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadConfig(configPath = CONFIG_PATH) {
  const defaults = cloneDefaults();
  try {
    ensureDataDir();
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, JSON.stringify(defaults, null, 2), 'utf8');
      return defaults;
    }
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return mergeConfig(defaults, parsed);
  } catch (err) {
    return defaults;
  }
}

function saveConfig(nextConfig, configPath = CONFIG_PATH) {
  const defaults = cloneDefaults();
  const current = loadConfig(configPath);
  const merged = mergeConfig(defaults, {
    ...current,
    ...nextConfig,
    ai: {
      ...current.ai,
      ...(nextConfig && nextConfig.ai ? nextConfig.ai : {}),
    },
  });
  ensureDataDir();
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

function addRecentHistory(actionsOrAction, promptText = '', configPath = CONFIG_PATH) {
  const config = loadConfig(configPath);
  const actions = Array.isArray(actionsOrAction) ? actionsOrAction : [actionsOrAction];
  const primary = actions[0];
  if (!primary) return config;

  const isBatch = actions.length > 1;
  const entry = {
    type: isBatch ? 'BATCH' : primary.type,
    title: isBatch
      ? actions.map((a) => a.shortTitle || a.title).join(' + ')
      : primary.title,
    subtitle: isBatch
      ? `${actions.length} chained steps`
      : primary.subtitle || primary.path || primary.url || primary.command || '',
    actions,
    path: primary.path || undefined,
    url: primary.url || undefined,
    command: primary.command || undefined,
    editor: primary.editor || undefined,
    browser: primary.browser || undefined,
    appName: primary.appName || undefined,
    siteName: primary.siteName || undefined,
    project: primary.project || undefined,
    prompt: promptText || primary.title,
    timestamp: new Date().toISOString(),
  };

  const filtered = (config.recentHistory || []).filter((item) => {
    return !(item.prompt === entry.prompt && item.title === entry.title);
  });

  const updated = [entry, ...filtered].slice(0, 15);
  return saveConfig({ recentHistory: updated }, configPath);
}

function saveRoutine(trigger, prompt, name = '', configPath = CONFIG_PATH) {
  const cleanTrigger = String(trigger || '').trim();
  const cleanPrompt = String(prompt || '').trim();
  if (!cleanTrigger || !cleanPrompt) {
    throw new Error('Routine trigger and prompt are required.');
  }
  const config = loadConfig(configPath);
  const id = cleanTrigger
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || `routine-${Date.now()}`;

  const routine = {
    id,
    name: (name || cleanTrigger).trim(),
    trigger: cleanTrigger.toLowerCase(),
    prompt: cleanPrompt,
    createdAt: new Date().toISOString(),
  };

  const existing = (config.customRoutines || []).filter(
    (r) => r.id !== id && r.trigger.toLowerCase() !== routine.trigger
  );
  const updated = [routine, ...existing];
  const savedConfig = saveConfig({ customRoutines: updated }, configPath);
  return { routine, config: savedConfig };
}

function deleteRoutine(id, configPath = CONFIG_PATH) {
  const config = loadConfig(configPath);
  const updated = (config.customRoutines || []).filter((r) => r.id !== id);
  return saveConfig({ customRoutines: updated }, configPath);
}

module.exports = {
  DATA_DIR,
  CONFIG_PATH,
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  addRecentHistory,
  saveRoutine,
  deleteRoutine,
};
