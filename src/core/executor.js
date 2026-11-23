const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { addRecentHistory } = require('./config');
const taskManager = require('./task-manager');

function getCleanEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return env;
}

function getElectronShell() {
  try {
    const electronMod = require('electron');
    if (electronMod && typeof electronMod === 'object' && electronMod.shell) {
      return electronMod.shell;
    }
  } catch (err) {
    // Not running inside Electron main process
  }
  return null;
}

function resolveAntigravityExe(config = {}) {
  const candidates = [
    config.antigravityPath,
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'antigravity', 'Antigravity.exe'),
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Programs', 'antigravity', 'Antigravity.exe')
      : null,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveVSCodeExe(config = {}) {
  const candidates = [
    config.vscodePath,
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'Code.exe'),
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe')
      : null,
    'C:\\Program Files\\Microsoft VS Code\\Code.exe',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveBrowserExe(browser) {
  const b = String(browser || '').toLowerCase();
  const candidatesMap = {
    chrome: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
        : null,
    ],
    edge: [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ],
    firefox: [
      'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
      'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
    ],
  };

  const candidates = (candidatesMap[b] || []).filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

let cachedHasWt = null;

function hasWindowsTerminal() {
  if (cachedHasWt !== null) {
    return cachedHasWt;
  }
  try {
    const res = spawnSync('where.exe', ['wt.exe'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    cachedHasWt = res.status === 0;
  } catch (err) {
    cachedHasWt = false;
  }
  return cachedHasWt;
}

function spawnDetached(executable, args, options = {}) {
  const child = spawn(executable, args, {
    detached: true,
    stdio: 'ignore',
    env: options.env || getCleanEnv(),
    windowsHide: options.windowsHide !== undefined ? options.windowsHide : true,
    windowsVerbatimArguments: Boolean(options.windowsVerbatimArguments),
  });
  child.unref();
  return child;
}

function openPathNative(targetPath) {
  const shell = getElectronShell();
  if (shell) {
    shell.openPath(targetPath);
    return;
  }
  spawnDetached('explorer.exe', [targetPath], { windowsHide: false });
}

function openExternalNative(uri) {
  const shell = getElectronShell();
  if (shell) {
    shell.openExternal(uri);
    return;
  }
  spawnDetached('explorer.exe', [uri], { windowsHide: false });
}

function escapePowerShellSingleQuote(value) {
  return String(value || '').replace(/'/g, "''");
}

function executeSingleAction(action, config = {}) {
  if (!action || !action.type) {
    throw new Error('Invalid action object.');
  }

  const type = action.type;

  if (type === 'OPEN_PROJECT_EDITOR') {
    const editor = action.editor || config.editorCommand || 'code';
    const targetPath = action.path;
    if (!targetPath) throw new Error('Missing project path.');

    if (editor === 'antigravity' || editor === 'agy') {
      const agyExe = resolveAntigravityExe(config);
      if (agyExe) {
        spawnDetached(agyExe, [targetPath], { windowsHide: false });
      } else {
        spawnDetached('cmd.exe', ['/c', 'antigravity', targetPath], { windowsHide: true });
      }
      return { ok: true, type, editor: 'antigravity', target: targetPath };
    }

    const vscodeExe = resolveVSCodeExe(config);
    if (vscodeExe) {
      spawnDetached(vscodeExe, [targetPath], { windowsHide: false });
    } else {
      spawnDetached('cmd.exe', ['/c', editor, targetPath], { windowsHide: true });
    }
    return { ok: true, type, editor, target: targetPath };
  }

  if (type === 'OPEN_FOLDER') {
    const targetPath = action.path;
    if (!targetPath) throw new Error('Missing folder path.');
    openPathNative(targetPath);
    return { ok: true, type, target: targetPath };
  }

  if (type === 'OPEN_TERMINAL') {
    const targetPath = action.path || process.cwd();
    if (hasWindowsTerminal()) {
      spawnDetached('wt.exe', ['-d', targetPath], { windowsHide: false });
    } else {
      const psCmd = `Set-Location -LiteralPath '${escapePowerShellSingleQuote(targetPath)}'`;
      spawnDetached(
        'cmd.exe',
        ['/c', 'start', '"Pulse Terminal"', 'powershell.exe', '-NoExit', '-Command', psCmd],
        { windowsHide: false, windowsVerbatimArguments: true }
      );
    }
    return { ok: true, type, target: targetPath };
  }

  if (type === 'RUN_PROJECT_COMMAND') {
    const targetPath = action.path || process.cwd();
    const command = action.command;
    if (!command) throw new Error('Missing terminal command.');
    const taskName =
      action.taskName ||
      (action.subService && action.project
        ? `${action.project.name} / ${action.subService.name}`
        : action.shortTitle || action.title || command);

    const task = taskManager.startTask({
      name: taskName,
      command,
      cwd: targetPath,
      isTunnel: Boolean(action.isTunnel),
      sshPassword: action.sshPassword || '',
    });
    return { ok: true, type, target: targetPath, command, task };
  }

  if (type === 'OPEN_URL') {
    const url = action.url;
    if (!url) throw new Error('Missing URL.');
    const browser = String(action.browser || 'default').toLowerCase();
    const browserExe = browser !== 'default' ? resolveBrowserExe(browser) : null;

    if (browserExe) {
      spawnDetached(browserExe, [url], { windowsHide: false });
    } else {
      openExternalNative(url);
    }
    return { ok: true, type, target: url, browser };
  }

  if (type === 'LAUNCH_APP') {
    let command = String(action.command || '').trim();
    if (!command) throw new Error('Missing app command.');

    // Normalize legacy "start "" target" commands if loaded from old history
    const legacyStartMatch = command.match(/^start\s+""\s+(.+)$/i);
    if (legacyStartMatch) {
      command = legacyStartMatch[1].trim().replace(/^"|"$/g, '');
    }

    if (command.toLowerCase() === 'code' || action.appName === 'VS Code') {
      const vscodeExe = resolveVSCodeExe(config);
      if (vscodeExe) {
        spawnDetached(vscodeExe, [], { windowsHide: false });
        return { ok: true, type, target: vscodeExe };
      }
    }

    if (action.appName === 'Antigravity') {
      const agyExe = resolveAntigravityExe(config);
      if (agyExe) {
        spawnDetached(agyExe, [], { windowsHide: false });
        return { ok: true, type, target: agyExe };
      }
    }

    const browserExe = resolveBrowserExe(
      command === 'msedge' ? 'edge' : command
    );
    if (browserExe) {
      spawnDetached(browserExe, [], { windowsHide: false });
      return { ok: true, type, target: browserExe };
    }

    if (/\.exe$/i.test(command) && fs.existsSync(command)) {
      spawnDetached(command, [], { windowsHide: false });
      return { ok: true, type, target: command };
    }

    if (/\.(?:lnk|url)$/i.test(command) && fs.existsSync(command)) {
      openPathNative(command);
      return { ok: true, type, target: command };
    }

    if (/^[a-z][a-z0-9+.-]*:/i.test(command)) {
      openExternalNative(command);
      return { ok: true, type, target: command };
    }

    const SYSTEM_BINARIES = new Set([
      'calc.exe',
      'notepad.exe',
      'taskmgr.exe',
      'mspaint.exe',
      'snippingtool.exe',
      'explorer.exe',
      'wt.exe',
      'powershell.exe',
      'cmd.exe',
    ]);
    if (SYSTEM_BINARIES.has(command.toLowerCase())) {
      spawnDetached(command, [], { windowsHide: false });
      return { ok: true, type, target: command };
    }

    spawnDetached('cmd.exe', ['/c', command], { windowsHide: true });
    return { ok: true, type, target: command };
  }

  throw new Error(`Unsupported action type: ${type}`);
}

function executeActions(actionsOrAction, promptText = '', config = {}, options = {}) {
  const actions = Array.isArray(actionsOrAction) ? actionsOrAction : [actionsOrAction];
  const validActions = actions.filter(Boolean);
  if (validActions.length === 0) {
    throw new Error('No actions to execute.');
  }

  const results = [];
  for (const action of validActions) {
    results.push(executeSingleAction(action, config));
  }

  let updatedConfig = config;
  if (!options.skipHistory) {
    const sanitizedForHistory = validActions.map((act) => {
      if (!act || !act.sshPassword) return act;
      const copy = { ...act };
      delete copy.sshPassword;
      return copy;
    });
    updatedConfig = addRecentHistory(sanitizedForHistory, promptText, options.configPath);
  }

  return {
    ok: true,
    executedCount: results.length,
    startedTasks: results.filter((r) => r.task).map((r) => r.task),
    results,
    config: updatedConfig,
  };
}

module.exports = {
  hasWindowsTerminal,
  resolveVSCodeExe,
  resolveAntigravityExe,
  resolveBrowserExe,
  executeSingleAction,
  executeActions,
};
