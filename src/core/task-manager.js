const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { DATA_DIR } = require('./config');

const MAX_LOG_LINES = 400;
const ANSI_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*\x07)/g;

const tasks = new Map();
let globalUpdateListener = null;

function setUpdateListener(listener) {
  globalUpdateListener = typeof listener === 'function' ? listener : null;
}

function getCleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  delete env.ELECTRON_ENABLE_LOGGING;
  return env;
}

function stripAnsi(str) {
  return String(str || '').replace(ANSI_REGEX, '');
}

function formatTimeStamp() {
  const now = new Date();
  return now.toTimeString().slice(0, 8);
}

function ensureAskPassScript() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const scriptPath = path.join(DATA_DIR, 'ssh-askpass.cmd');
  const content = '@echo off\r\necho %PULSE_SSH_PASSWORD%\r\n';
  fs.writeFileSync(scriptPath, content, 'utf8');
  return scriptPath;
}

function splitCommandArgs(cmdLine) {
  const args = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = regex.exec(String(cmdLine || ''))) !== null) {
    args.push(match[1] !== undefined ? match[1] : match[2] !== undefined ? match[2] : match[3]);
  }
  return args;
}

function buildTaskId(spec) {
  const key = `${String(spec.cwd || '').toLowerCase()}|${String(spec.command || '').trim()}`;
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `task-${(hash >>> 0).toString(16)}`;
}

function killProcessTree(pid) {
  if (!pid) return;
  try {
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch (err) {
    try {
      process.kill(pid);
    } catch (e) {
      // Process may have already exited
    }
  }
}

function extractPortsFromText(text, existingPorts) {
  const ports = new Set(existingPorts || []);
  const patterns = [
    /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})/gi,
    /Local connections to [^:\s]+:(\d{2,5})/gi,
    /Local forwarding listening on [^ ]+ port (\d{2,5})/gi,
    /(?:listening|started|running)\s+(?:on|at)\s+(?:https?:\/\/[^:]+:|port\s+|:)(\d{2,5})/gi,
  ];
  for (const regex of patterns) {
    let m;
    while ((m = regex.exec(text)) !== null) {
      const port = Number(m[1]);
      if (port >= 80 && port <= 65535) {
        ports.add(port);
      }
    }
  }
  return Array.from(ports);
}

function appendLogLines(task, rawText, prefix = '') {
  const clean = stripAnsi(rawText).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = clean.split('\n');
  const stamp = formatTimeStamp();
  let changed = false;

  for (const line of lines) {
    const trimmedEnd = line.replace(/\s+$/, '');
    if (!trimmedEnd) continue;
    const formatted = `[${stamp}] ${prefix}${trimmedEnd}`;
    task.logs.push(formatted);
    task.detectedPorts = extractPortsFromText(trimmedEnd, task.detectedPorts);
    changed = true;
  }

  if (task.logs.length > MAX_LOG_LINES) {
    task.logs = task.logs.slice(-MAX_LOG_LINES);
  }
  return changed;
}

function serializeTask(task) {
  return {
    id: task.id,
    name: task.name,
    command: task.command,
    cwd: task.cwd,
    type: task.type,
    pid: task.pid,
    status: task.status,
    startedAt: task.startedAt,
    endedAt: task.endedAt,
    exitCode: task.exitCode,
    detectedPorts: [...task.detectedPorts],
    logs: [...task.logs],
  };
}

function notifyTaskUpdate(task, onUpdate) {
  const serialized = serializeTask(task);
  if (typeof onUpdate === 'function') {
    onUpdate(serialized);
  }
  if (typeof globalUpdateListener === 'function') {
    globalUpdateListener(serialized);
  }
}

function startTask(taskSpec, onUpdate = null, options = {}) {
  const command = String(taskSpec.command || '').trim();
  if (!command) {
    throw new Error('Missing command for background task.');
  }

  const cwd = taskSpec.cwd || taskSpec.path || process.cwd();
  const isTunnel = Boolean(taskSpec.isTunnel) || /^\s*ssh\s+/i.test(command);
  const id = taskSpec.id || buildTaskId({ cwd, command });

  const existing = tasks.get(id);
  if (existing && existing.status === 'running' && existing.pid) {
    existing.manualStop = true;
    killProcessTree(existing.pid);
  }

  const initialLogs = Array.isArray(options.preserveLogs) ? [...options.preserveLogs] : [];
  if (initialLogs.length > 0) {
    initialLogs.push(`[${formatTimeStamp()}] [pulse] --- Restarting task ---`);
  } else {
    initialLogs.push(`[${formatTimeStamp()}] [pulse] Starting: ${command}`);
    initialLogs.push(`[${formatTimeStamp()}] [pulse] Working directory: ${cwd}`);
  }

  // Extract forwarded ports from -L flags upfront for tunnel tasks
  const initialPorts = [];
  if (isTunnel) {
    const fwdRegex = /-L\s+(?:[^:\s]+:)?(\d{2,5}):/g;
    let m;
    while ((m = fwdRegex.exec(command)) !== null) {
      const p = Number(m[1]);
      if (p >= 80 && p <= 65535 && !initialPorts.includes(p)) {
        initialPorts.push(p);
      }
    }
  }

  const task = {
    id,
    name: taskSpec.name || taskSpec.shortTitle || taskSpec.title || command,
    command,
    cwd,
    type: isTunnel ? 'tunnel' : 'service',
    sshPassword: taskSpec.sshPassword || '',
    pid: null,
    status: 'running',
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
    detectedPorts: initialPorts,
    logs: initialLogs.slice(-MAX_LOG_LINES),
    child: null,
    manualStop: false,
    onUpdate,
  };

  tasks.set(id, task);

  let child;
  if (isTunnel && /^\s*ssh\b/i.test(command)) {
    const rawArgs = splitCommandArgs(command).slice(1);
    const sshArgs = [
      '-v',
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'UserKnownHostsFile=NUL',
      '-o',
      'ServerAliveInterval=30',
      ...rawArgs,
    ];

    const extraEnv = {};
    if (task.sshPassword) {
      const askPassPath = ensureAskPassScript();
      extraEnv.SSH_ASKPASS = askPassPath;
      extraEnv.SSH_ASKPASS_REQUIRE = 'force';
      extraEnv.DISPLAY = 'pulse:0';
      extraEnv.PULSE_SSH_PASSWORD = task.sshPassword;
    }

    child = spawn('ssh', sshArgs, {
      cwd: fs.existsSync(cwd) ? cwd : process.cwd(),
      env: getCleanEnv(extraEnv),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } else {
    child = spawn(command, {
      shell: true,
      cwd: fs.existsSync(cwd) ? cwd : process.cwd(),
      env: getCleanEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  }

  task.child = child;
  task.pid = child.pid || null;

  let stdoutCarry = '';
  let stderrCarry = '';

  if (child.stdout) {
    child.stdout.on('data', (chunk) => {
      const combined = stdoutCarry + chunk.toString('utf8');
      const lastNewline = Math.max(combined.lastIndexOf('\n'), combined.lastIndexOf('\r'));
      if (lastNewline >= 0) {
        const complete = combined.slice(0, lastNewline + 1);
        stdoutCarry = combined.slice(lastNewline + 1);
        if (appendLogLines(task, complete)) {
          notifyTaskUpdate(task, onUpdate);
        }
      } else {
        stdoutCarry = combined;
      }
    });
  }

  if (child.stderr) {
    child.stderr.on('data', (chunk) => {
      const combined = stderrCarry + chunk.toString('utf8');
      const lastNewline = Math.max(combined.lastIndexOf('\n'), combined.lastIndexOf('\r'));
      if (lastNewline >= 0) {
        const complete = combined.slice(0, lastNewline + 1);
        stderrCarry = combined.slice(lastNewline + 1);
        if (appendLogLines(task, complete)) {
          notifyTaskUpdate(task, onUpdate);
        }
      } else {
        stderrCarry = combined;
      }
    });
  }

  child.on('error', (err) => {
    task.status = 'error';
    task.endedAt = new Date().toISOString();
    appendLogLines(task, `Process error: ${err.message}`, '[error] ');
    notifyTaskUpdate(task, onUpdate);
  });

  child.on('close', (code) => {
    if (stdoutCarry.trim()) appendLogLines(task, stdoutCarry);
    if (stderrCarry.trim()) appendLogLines(task, stderrCarry);
    stdoutCarry = '';
    stderrCarry = '';

    task.endedAt = new Date().toISOString();
    task.exitCode = code;
    if (task.manualStop) {
      task.status = 'stopped';
      appendLogLines(task, 'Task stopped.', '[pulse] ');
    } else {
      task.status = code === 0 ? 'exited' : 'error';
      appendLogLines(task, `Process exited with code ${code}.`, '[pulse] ');
    }
    task.child = null;
    notifyTaskUpdate(task, onUpdate);
  });

  notifyTaskUpdate(task, onUpdate);
  return serializeTask(task);
}

function stopTask(id) {
  const task = tasks.get(id);
  if (!task) return null;

  if (task.status === 'running' && task.pid) {
    task.manualStop = true;
    killProcessTree(task.pid);
    task.status = 'stopped';
    task.endedAt = new Date().toISOString();
    task.child = null;
    appendLogLines(task, 'Task stopped by user.', '[pulse] ');
    notifyTaskUpdate(task, task.onUpdate);
  }
  return serializeTask(task);
}

function rerunTask(id) {
  const task = tasks.get(id);
  if (!task) return null;

  const spec = {
    id: task.id,
    name: task.name,
    command: task.command,
    cwd: task.cwd,
    isTunnel: task.type === 'tunnel',
    sshPassword: task.sshPassword,
  };
  const savedLogs = [...task.logs];
  if (task.status === 'running' && task.pid) {
    task.manualStop = true;
    killProcessTree(task.pid);
  }
  return startTask(spec, task.onUpdate, { preserveLogs: savedLogs });
}

function removeTask(id) {
  const task = tasks.get(id);
  if (!task) return getTasks();
  if (task.status === 'running' && task.pid) {
    task.manualStop = true;
    killProcessTree(task.pid);
  }
  tasks.delete(id);
  return getTasks();
}

function stopAllTasks() {
  for (const task of tasks.values()) {
    if (task.status === 'running' && task.pid) {
      task.manualStop = true;
      killProcessTree(task.pid);
      task.status = 'stopped';
    }
  }
}

function getTasks() {
  return Array.from(tasks.values())
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .map(serializeTask);
}

function getTaskLogs(id) {
  const task = tasks.get(id);
  return task ? [...task.logs] : [];
}

module.exports = {
  setUpdateListener,
  startTask,
  stopTask,
  rerunTask,
  removeTask,
  stopAllTasks,
  getTasks,
  getTaskLogs,
};
