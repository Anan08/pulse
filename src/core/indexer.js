const fs = require('fs');
const os = require('os');
const path = require('path');

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.github',
  '.next',
  '.nuxt',
  '.expo',
  '.dart_tool',
  '.idea',
  '.vscode',
  '.claude',
  '.kilo',
  'vendor',
  'venv',
  '.venv',
  '__pycache__',
  'dist',
  'build',
  'out',
  'target',
  'bin',
  'obj',
  'storage',
  'bootstrap',
  'migrations',
  'seeders',
  'factories',
  'controllers',
  'middlewares',
  'middleware',
  'models',
  'routes',
  'views',
  'templates',
  'public',
  'src',
  'app',
  'config',
  'database',
  'resources',
  'assets',
  'components',
  'pages',
  'constants',
  'contexts',
  'hooks',
  'utils',
  'lib',
  'pkg',
  'cmd',
  'internal',
  'test',
  'tests',
  'docs',
  'local-docs',
  'work-docs',
  'uploads',
  'logs',
  'data',
  'backup',
  'caches',
  'new folder (2)',
  'zip',
  'android',
  'ios',
  'linux',
  'macos',
  'windows',
  'web',
  'plan',
  'implementation-plans',
  'laporan',
  'kafka-data',
]);

const PROJECT_MARKERS = new Set([
  '.git',
  'package.json',
  'composer.json',
  'go.mod',
  'cargo.toml',
  'pubspec.yaml',
  'pyproject.toml',
  'requirements.txt',
  'docker-compose.yml',
  'dockerfile',
  'gemini.md',
  'readme.md',
  'artisan',
]);

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function detectMarkers(entries) {
  const markers = [];
  for (const entry of entries) {
    const lower = entry.name.toLowerCase();
    if (PROJECT_MARKERS.has(lower) || lower.endsWith('.sln')) {
      markers.push(entry.name);
    }
  }
  return markers;
}

function buildSubServiceAliases(dirName, parentName = '') {
  const lower = dirName.toLowerCase();
  const parentLower = parentName.toLowerCase();
  const spaced = lower.replace(/[-_]+/g, ' ').trim();
  const aliases = new Set([lower, spaced, normalizeText(lower)]);

  // Strip parent prefix/suffix if present (e.g. finfy_be -> be, fe-ransum-bunda -> fe)
  if (parentLower) {
    const stripped = spaced
      .replace(new RegExp(`\\b${parentLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), '')
      .replace(/\s+/g, ' ')
      .trim();
    if (stripped) {
      aliases.add(stripped);
      aliases.add(normalizeText(stripped));
    }
  }

  // Strip common verbose monorepo suffixes
  const compact = spaced
    .replace(/\bmedia intelligence\b/g, '')
    .replace(/\bmain\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (compact && compact !== spaced) {
    aliases.add(compact);
    aliases.add(normalizeText(compact));
  }

  // Semantic role aliases
  const tokens = spaced.split(/\s+/).filter(Boolean);
  if (tokens.includes('fe') || tokens.includes('frontend')) {
    ['fe', 'frontend', 'front', 'web', 'client'].forEach((a) => aliases.add(a));
  }
  if (tokens.includes('be') || tokens.includes('backend') || tokens.includes('server')) {
    ['be', 'backend', 'back', 'server', 'api'].forEach((a) => aliases.add(a));
  }
  if (tokens.includes('mobile')) {
    ['mobile', 'app'].forEach((a) => aliases.add(a));
  }
  if (tokens.includes('ai')) {
    aliases.add('ai');
  }
  if (lower.includes('dashboard-v2') || (tokens.includes('dashboard') && tokens.includes('v2'))) {
    ['dashboard v2', 'dashboard-v2', 'v2', 'dash v2'].forEach((a) => aliases.add(a));
  } else if (tokens.includes('dashboard')) {
    ['dashboard', 'dash'].forEach((a) => aliases.add(a));
  }
  if (tokens.includes('service')) {
    ['service', 'backend', 'api'].forEach((a) => aliases.add(a));
  }
  if (tokens.includes('scrapers') || tokens.includes('scraper')) {
    ['scrapers', 'scraper', 'crawler'].forEach((a) => aliases.add(a));
  }
  if (tokens.includes('crawler')) {
    ['crawler', 'scraper'].forEach((a) => aliases.add(a));
  }
  if (tokens.includes('report') || tokens.includes('reports')) {
    ['report', 'reports'].forEach((a) => aliases.add(a));
  }
  if (tokens.includes('landing')) {
    ['landing', 'landing page', 'landing-page'].forEach((a) => aliases.add(a));
  }

  return Array.from(aliases).filter(Boolean);
}

function scanSubServices(projectPath, parentName) {
  let entries;
  try {
    entries = fs.readdirSync(projectPath, { withFileTypes: true });
  } catch (err) {
    return [];
  }

  const subServices = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const lower = entry.name.toLowerCase();
    if (lower.startsWith('.') || SKIP_DIRS.has(lower)) continue;

    const subPath = path.resolve(path.join(projectPath, entry.name));
    let subEntries = [];
    try {
      subEntries = fs.readdirSync(subPath, { withFileTypes: true });
    } catch (err) {
      subEntries = [];
    }

    const markers = detectMarkers(subEntries);
    subServices.push({
      name: entry.name,
      normalizedName: normalizeText(entry.name),
      path: subPath,
      parentName,
      aliases: buildSubServiceAliases(entry.name, parentName),
      hasMarker: markers.length > 0,
      markers,
    });
  }

  return subServices.sort((a, b) => a.name.localeCompare(b.name));
}

function scanInstalledApps(config = {}) {
  const customApps = (config && config.customApps) || {};
  const byCleanName = new Map();

  const BUILTIN_ALIASES = {
    antigravity: ['antigravity', 'agy'],
    'vs code': ['vscode', 'vs code', 'code', 'visual studio code'],
    'file explorer': ['explorer', 'file explorer', 'files', 'my computer', 'this pc'],
    'windows terminal': ['wt', 'windows terminal', 'terminal'],
    powershell: ['powershell', 'ps'],
    'command prompt': ['cmd', 'command prompt'],
    'task manager': ['taskmgr', 'task manager', 'tasks'],
    calculator: ['calc', 'calculator'],
    notepad: ['notepad', 'notes'],
    paint: ['paint', 'mspaint'],
    'snipping tool': ['snipping', 'snipping tool', 'screenshot'],
    settings: ['settings', 'windows settings'],
    chrome: ['chrome', 'google chrome'],
    edge: ['edge', 'msedge', 'microsoft edge'],
    spotify: ['spotify', 'music'],
    discord: ['discord'],
  };

  for (const [appName, command] of Object.entries(customApps)) {
    const cleanLower = appName.toLowerCase();
    const aliases = Array.from(
      new Set([cleanLower, normalizeText(cleanLower), ...(BUILTIN_ALIASES[cleanLower] || [])])
    );
    byCleanName.set(cleanLower, {
      name: appName,
      cleanName: appName,
      normalizedName: normalizeText(appName),
      command,
      aliases,
      source: 'custom',
    });
  }

  const shortcutRoots = [
    process.env.APPDATA
      ? path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
      : null,
    path.join(
      process.env.ProgramData || 'C:\\ProgramData',
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs'
    ),
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Desktop') : null,
    'C:\\Users\\Public\\Desktop',
  ].filter(Boolean);

  const IGNORE_APP_REGEX =
    /\b(?:uninstall|readme|help|manual|website|documentation|release\s+notes|license|changelog|troubleshoot|command\s+prompt|developer\s+powershell)\b/i;

  function walkShortcuts(dir, depth) {
    if (!fs.existsSync(dir) || depth > 4) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkShortcuts(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile() || !/\.lnk$/i.test(entry.name)) {
        continue;
      }

      const rawName = entry.name.replace(/\.lnk$/i, '').trim();
      if (!rawName || IGNORE_APP_REGEX.test(rawName)) {
        continue;
      }

      const cleanName = rawName
        .replace(/\s*\((?:x64|x86|64-bit|32-bit|user|system)\)\s*/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const cleanKey = cleanName.toLowerCase();
      if (!cleanKey) continue;

      const alreadyCustom = Array.from(byCleanName.values()).some(
        (existing) =>
          existing.source === 'custom' &&
          (existing.cleanName.toLowerCase() === cleanKey ||
            existing.aliases.includes(cleanKey))
      );
      if (alreadyCustom || byCleanName.has(cleanKey)) {
        continue;
      }

      const aliases = Array.from(
        new Set([
          rawName.toLowerCase(),
          cleanKey,
          normalizeText(rawName),
          normalizeText(cleanName),
        ])
      ).filter(Boolean);

      byCleanName.set(cleanKey, {
        name: rawName,
        cleanName,
        normalizedName: normalizeText(cleanName),
        command: fullPath,
        aliases,
        source: 'shortcut',
      });
    }
  }

  for (const root of shortcutRoots) {
    walkShortcuts(root, 0);
  }

  return Array.from(byCleanName.values()).sort((a, b) =>
    a.cleanName.localeCompare(b.cleanName)
  );
}

function scanCommandFiles() {
  const dirs = [
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Documents') : null,
    path.join(os.homedir(), 'Documents'),
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Desktop') : null,
    path.join(os.homedir(), 'Desktop'),
  ].filter(Boolean);

  const uniqueDirs = Array.from(new Set(dirs.map((d) => path.resolve(d))));
  const found = [];
  const seenPaths = new Set();

  for (const dir of uniqueDirs) {
    if (!fs.existsSync(dir)) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !/\.txt$/i.test(entry.name)) continue;
      const fullPath = path.resolve(path.join(dir, entry.name));
      const lowerPath = fullPath.toLowerCase();
      if (seenPaths.has(lowerPath)) continue;
      seenPaths.add(lowerPath);

      let content = '';
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > 64 * 1024) continue;
        content = fs.readFileSync(fullPath, 'utf8');
      } catch (err) {
        continue;
      }

      const sshCommands = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^ssh\s+/i.test(line));

      if (sshCommands.length > 0) {
        found.push({
          name: entry.name,
          cleanName: entry.name.replace(/\.txt$/i, '').trim(),
          path: fullPath,
          content,
          commands: sshCommands,
        });
      }
    }
  }

  return found.sort((a, b) => a.name.localeCompare(b.name));
}

function scanProjects(config = {}) {
  const roots =
    Array.isArray(config.workspaceRoots) && config.workspaceRoots.length > 0
      ? config.workspaceRoots
      : ['D:\\program\\project', 'D:\\program'];
  const maxDepth = typeof config.scanDepth === 'number' && config.scanDepth > 0 ? config.scanDepth : 3;

  const normalizedRoots = roots.map((r) => path.resolve(r));
  const rootSet = new Set(normalizedRoots.map((r) => r.toLowerCase()));
  const byPath = new Map();

  for (const rootDir of normalizedRoots) {
    if (!fs.existsSync(rootDir)) {
      continue;
    }

    const rootBaseName = path.basename(rootDir).toLowerCase();
    const isTopProgramRoot = rootBaseName === 'program';

    function walk(currentDir, depth) {
      let entries;
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch (err) {
        return;
      }

      const subDirs = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const lowerName = entry.name.toLowerCase();
        if (lowerName.startsWith('.') || SKIP_DIRS.has(lowerName)) continue;
        subDirs.push(entry);
      }

      for (const dirEntry of subDirs) {
        const fullPath = path.resolve(path.join(currentDir, dirEntry.name));
        const normalizedFullPath = fullPath.toLowerCase();

        // Avoid re-walking another explicit workspace root from inside a parent root.
        if (depth > 0 && rootSet.has(normalizedFullPath)) {
          continue;
        }
        if (depth === 0 && rootSet.has(normalizedFullPath) && normalizedFullPath !== path.resolve(rootDir).toLowerCase()) {
          continue;
        }

        const nextDepth = depth + 1;
        let childEntries = [];
        try {
          childEntries = fs.readdirSync(fullPath, { withFileTypes: true });
        } catch (err) {
          childEntries = [];
        }

        const markers = detectMarkers(childEntries);
        const hasMarker = markers.length > 0;
        const parentName = path.basename(currentDir);

        // Skip top-level category container folders inside D:\program unless they are actual projects with markers,
        // while still traversing inside them to find leaf projects like qola.
        const isCategoryContainer = isTopProgramRoot && nextDepth === 1 && !hasMarker;

        if (!isCategoryContainer) {
          const existing = byPath.get(normalizedFullPath);
          if (!existing || (hasMarker && !existing.hasMarker)) {
            const subServices = scanSubServices(fullPath, dirEntry.name);
            byPath.set(normalizedFullPath, {
              name: dirEntry.name,
              normalizedName: normalizeText(dirEntry.name),
              path: fullPath,
              parentName,
              hasMarker,
              markers,
              subServices,
              depth: nextDepth,
              root: rootDir,
            });
          }
        }

        if (nextDepth < maxDepth) {
          walk(fullPath, nextDepth);
        }
      }
    }

    walk(rootDir, 0);
  }

  const projects = Array.from(byPath.values()).sort((a, b) => {
    if (a.hasMarker !== b.hasMarker) {
      return a.hasMarker ? -1 : 1;
    }
    if (a.depth !== b.depth) {
      return a.depth - b.depth;
    }
    return a.name.localeCompare(b.name);
  });

  const apps = scanInstalledApps(config);
  const tunnelFiles = scanCommandFiles();

  return {
    projects,
    apps,
    tunnelFiles,
    scannedAt: new Date().toISOString(),
    roots: normalizedRoots,
    count: projects.length,
    appCount: apps.length,
  };
}

module.exports = {
  SKIP_DIRS,
  PROJECT_MARKERS,
  normalizeText,
  buildSubServiceAliases,
  scanSubServices,
  scanInstalledApps,
  scanCommandFiles,
  scanProjects,
};
