const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const VALUE_NAME = 'Pulse';
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const VBS_PATH = path.join(PROJECT_ROOT, 'launch-silent.vbs');
const BAT_PATH = path.join(PROJECT_ROOT, 'start-assistant.bat');

function ensureLaunchScripts() {
  const vbsContent = [
    'Set WshShell = CreateObject("WScript.Shell")',
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    'appDir = fso.GetParentFolderName(WScript.ScriptFullName)',
    'electronExe = appDir & "\\node_modules\\electron\\dist\\electron.exe"',
    'WshShell.CurrentDirectory = appDir',
    'If fso.FileExists(electronExe) Then',
    '  WshShell.Run """" & electronExe & """ . --startup", 0, False',
    'Else',
    '  WshShell.Run "cmd /c npm.cmd start -- --startup", 0, False',
    'End If',
    '',
  ].join('\r\n');

  const batContent = [
    '@echo off',
    'cd /d "%~dp0"',
    'if exist "node_modules\\electron\\dist\\electron.exe" (',
    '  start "" "node_modules\\electron\\dist\\electron.exe" .',
    ') else (',
    '  npm.cmd start',
    ')',
    '',
  ].join('\r\n');

  fs.writeFileSync(VBS_PATH, vbsContent, 'utf8');
  fs.writeFileSync(BAT_PATH, batContent, 'utf8');
  return { vbsPath: VBS_PATH, batPath: BAT_PATH };
}

function getStartupCommandValue() {
  return `wscript.exe "${VBS_PATH}"`;
}

function getStartupStatus() {
  try {
    const out = execFileSync('reg.exe', ['query', REG_KEY, '/v', VALUE_NAME], {
      encoding: 'utf8',
      windowsHide: true,
    });
    const match = out.match(new RegExp(`${VALUE_NAME}\\s+REG_SZ\\s+(.+)`, 'i'));
    const command = match ? match[1].trim() : null;
    const expected = getStartupCommandValue().toLowerCase();
    return {
      enabled: Boolean(command),
      matchesCurrentPath: Boolean(command && command.toLowerCase() === expected),
      command,
      vbsPath: VBS_PATH,
    };
  } catch (err) {
    return {
      enabled: false,
      matchesCurrentPath: false,
      command: null,
      vbsPath: VBS_PATH,
    };
  }
}

function enableStartup() {
  ensureLaunchScripts();
  const value = getStartupCommandValue();
  execFileSync(
    'reg.exe',
    ['add', REG_KEY, '/v', VALUE_NAME, '/t', 'REG_SZ', '/d', value, '/f'],
    { encoding: 'utf8', windowsHide: true }
  );
  return getStartupStatus();
}

function disableStartup() {
  try {
    execFileSync('reg.exe', ['delete', REG_KEY, '/v', VALUE_NAME, '/f'], {
      encoding: 'utf8',
      windowsHide: true,
    });
  } catch (err) {
    // Ignore if already absent
  }
  return getStartupStatus();
}

module.exports = {
  REG_KEY,
  VALUE_NAME,
  PROJECT_ROOT,
  VBS_PATH,
  BAT_PATH,
  ensureLaunchScripts,
  getStartupStatus,
  enableStartup,
  disableStartup,
};
