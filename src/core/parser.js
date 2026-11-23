const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { normalizeText } = require('./indexer');

const FILLER_TOKENS = new Set([
  'open',
  'launch',
  'start',
  'run',
  'execute',
  'exec',
  'from',
  'in',
  'into',
  'inside',
  'straight',
  'the',
  'a',
  'an',
  'project',
  'projects',
  'dir',
  'directory',
  'folder',
  'folders',
  'repo',
  'repository',
  'workspace',
  'please',
  'for',
  'me',
  'on',
  'to',
  'with',
  'at',
  'using',
  'go',
  'work',
  'working',
  'show',
  'browse',
  'vscode',
  'vs',
  'code',
  'visual',
  'studio',
  'agy',
  'antigravity',
  'editor',
  'explorer',
  'file',
  'files',
  'terminal',
  'powershell',
  'cmd',
  'shell',
  'cli',
  'wt',
  'console',
  'app',
  'both',
  'all',
]);

const APP_ALIASES = {
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

const SITE_ALIASES = {
  github: ['github', 'gh'],
  gmail: ['gmail', 'mail', 'email'],
  youtube: ['youtube', 'yt'],
  chatgpt: ['chatgpt', 'gpt'],
  google: ['google'],
  'localhost 3000': ['localhost 3000', '3000'],
  'localhost 5173': ['localhost 5173', '5173', 'vite'],
  'localhost 8080': ['localhost 8080', '8080'],
};

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

function scoreNameMatch(query, candidateName, candidateNormalized, hasMarker = false) {
  const qRaw = String(query || '').trim().toLowerCase();
  const qNorm = normalizeText(qRaw);
  const nameLower = String(candidateName || '').toLowerCase();
  const norm = candidateNormalized || normalizeText(nameLower);

  if (!qRaw || !qNorm) return 0;

  let score = 0;
  if (qRaw === nameLower) {
    score = 100;
  } else if (qNorm === norm) {
    score = 95;
  } else if (qNorm.length >= 3 && (nameLower.startsWith(qRaw) || norm.startsWith(qNorm))) {
    score = 85;
  } else if (qNorm.length >= 4 && (nameLower.includes(qRaw) || norm.includes(qNorm))) {
    score = 75;
  } else if (qNorm.length >= 4 && norm.length >= 4) {
    const dist = levenshtein(qNorm, norm);
    const maxAllowed = qNorm.length <= 5 ? 1 : 2;
    if (dist <= maxAllowed) {
      score = 68 - dist * 6;
    }
  }

  if (score > 0 && hasMarker) {
    score += 10;
  }
  return score;
}

function detectDevCommand(projectPath) {
  if (!projectPath || !fs.existsSync(projectPath)) {
    return 'npm.cmd run dev';
  }
  const pkgPath = path.join(projectPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const scripts = pkg.scripts || {};
      if (scripts.dev) return 'npm.cmd run dev';
      if (scripts['start:dev']) return 'npm.cmd run start:dev';
      if (scripts.start) return 'npm.cmd start';
      if (scripts.serve) return 'npm.cmd run serve';
    } catch (err) {
      return 'npm.cmd run dev';
    }
    return 'npm.cmd run dev';
  }
  if (
    fs.existsSync(path.join(projectPath, 'docker-compose.yml')) ||
    fs.existsSync(path.join(projectPath, 'compose.yml'))
  ) {
    return 'docker compose up';
  }
  if (fs.existsSync(path.join(projectPath, 'artisan'))) {
    return 'php artisan serve';
  }
  if (fs.existsSync(path.join(projectPath, 'go.mod'))) {
    return 'go run .';
  }
  if (fs.existsSync(path.join(projectPath, 'manage.py'))) {
    return 'python manage.py runserver';
  }
  return 'npm.cmd run dev';
}

function hasRunnableDevScript(projectPath) {
  if (!projectPath || !fs.existsSync(projectPath)) {
    return false;
  }
  const pkgPath = path.join(projectPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const scripts = pkg.scripts || {};
      return Boolean(scripts.dev || scripts['start:dev'] || scripts.start || scripts.serve);
    } catch (err) {
      return false;
    }
  }
  return (
    fs.existsSync(path.join(projectPath, 'docker-compose.yml')) ||
    fs.existsSync(path.join(projectPath, 'compose.yml')) ||
    fs.existsSync(path.join(projectPath, 'artisan')) ||
    fs.existsSync(path.join(projectPath, 'go.mod')) ||
    fs.existsSync(path.join(projectPath, 'manage.py'))
  );
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[/\\]+/g, ' ')
    .replace(/[^a-z0-9._:-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function extractTargetTokens(clause) {
  const tokens = tokenize(clause);
  return tokens.filter((t) => !FILLER_TOKENS.has(t));
}

function matchSubService(subServices, queryTokens) {
  if (!Array.isArray(subServices) || subServices.length === 0 || queryTokens.length === 0) {
    return null;
  }
  const queryJoined = queryTokens.join(' ').toLowerCase();
  const queryNorm = normalizeText(queryJoined);

  let best = null;
  let bestScore = 0;

  for (const sub of subServices) {
    let score = scoreNameMatch(queryJoined, sub.name, sub.normalizedName, sub.hasMarker);

    if (Array.isArray(sub.aliases)) {
      for (const alias of sub.aliases) {
        const aliasLower = alias.toLowerCase();
        const aliasNorm = normalizeText(aliasLower);
        if (queryJoined === aliasLower || queryNorm === aliasNorm) {
          score = Math.max(score, 98 + (sub.hasMarker ? 2 : 0));
        } else if (aliasLower.startsWith(queryJoined) && queryJoined.length >= 2) {
          score = Math.max(score, 84);
        } else if (aliasLower.includes(queryJoined) && queryJoined.length >= 3) {
          score = Math.max(score, 76);
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      best = { subService: sub, score };
    }
  }

  return best && best.score >= 70 ? best : null;
}

function matchProjectsAndSubServices(rawTokens, indexData, config, contextProject = null) {
  const projects = (indexData && indexData.projects) || [];
  if (!rawTokens || rawTokens.length === 0) {
    return [];
  }

  // Check custom aliases first
  const joined = rawTokens.join(' ').toLowerCase();
  const customAliases = (config && config.customAliases) || {};
  for (const [aliasKey, aliasTarget] of Object.entries(customAliases)) {
    if (aliasKey.toLowerCase() === joined) {
      const matched = projects.find((p) => p.path.toLowerCase() === String(aliasTarget).toLowerCase());
      if (matched) {
        return [{ project: matched, subService: null, score: 110 }];
      }
    }
  }

  // First: if we have an active context project and tokens directly match one of its sub-services
  // (e.g. second clause "be in vscode" after "open finfy fe")
  if (contextProject && Array.isArray(contextProject.subServices) && rawTokens.length <= 3) {
    const contextSubMatch = matchSubService(contextProject.subServices, rawTokens);
    if (contextSubMatch) {
      return [
        {
          project: contextProject,
          subService: contextSubMatch.subService,
          score: contextSubMatch.score + 20,
        },
      ];
    }
  }

  const candidates = [];

  for (const project of projects) {
    // 1. Try matching the whole token phrase against project name
    let bestProjectScore = scoreNameMatch(joined, project.name, project.normalizedName, project.hasMarker);
    let matchedLeftover = [];

    // 2. Also try matching contiguous token spans inside rawTokens (e.g. ["qola", "dashboard", "v2"])
    if (rawTokens.length > 1) {
      for (let start = 0; start < rawTokens.length; start++) {
        for (let end = rawTokens.length; end > start; end--) {
          if (start === 0 && end === rawTokens.length) continue;
          const span = rawTokens.slice(start, end).join(' ');
          const spanScore = scoreNameMatch(span, project.name, project.normalizedName, project.hasMarker);
          if (spanScore >= 85) {
            const leftover = [...rawTokens.slice(0, start), ...rawTokens.slice(end)];
            const hasSubMatch =
              leftover.length > 0 &&
              Array.isArray(project.subServices) &&
              matchSubService(project.subServices, leftover);
            const effectiveSpanScore = hasSubMatch
              ? spanScore + 20
              : spanScore - leftover.length * 25;

            if (effectiveSpanScore > bestProjectScore) {
              bestProjectScore = effectiveSpanScore;
              matchedLeftover = leftover;
            }
          }
        }
      }
    }

    if (bestProjectScore >= 60) {
      let resolvedSub = null;
      let finalScore = bestProjectScore;

      // Root-first rule: only target sub-service when leftover tokens exist and match a sub-service
      if (matchedLeftover.length > 0 && Array.isArray(project.subServices) && project.subServices.length > 0) {
        const subMatch = matchSubService(project.subServices, matchedLeftover);
        if (subMatch) {
          resolvedSub = subMatch.subService;
          finalScore = Math.max(bestProjectScore, subMatch.score + 22);
        }
      }

      candidates.push({
        project,
        subService: resolvedSub,
        score: finalScore,
      });
    }
  }

  // Fallback: search sub-services globally if no strong root project match was found
  if (candidates.length === 0 || candidates[0].score < 80) {
    for (const project of projects) {
      if (!Array.isArray(project.subServices) || project.subServices.length === 0) continue;
      const subMatch = matchSubService(project.subServices, rawTokens);
      if (subMatch && subMatch.score >= 82) {
        candidates.push({
          project,
          subService: subMatch.subService,
          score: subMatch.score - 2,
        });
      }
    }
  }

  // Deduplicate by resolved target path
  const deduped = new Map();
  for (const item of candidates.sort((a, b) => b.score - a.score)) {
    const targetPath = (item.subService ? item.subService.path : item.project.path).toLowerCase();
    if (!deduped.has(targetPath)) {
      deduped.set(targetPath, item);
    }
  }

  return Array.from(deduped.values());
}

function matchDesktopApp(clause, indexData, config) {
  const cleaned = tokenize(clause)
    .filter((t) => !['open', 'launch', 'start', 'run', 'please', 'the', 'app', 'application'].includes(t))
    .join(' ');
  if (!cleaned) return null;

  const indexedApps = (indexData && Array.isArray(indexData.apps) && indexData.apps.length > 0)
    ? indexData.apps
    : Object.entries((config && config.customApps) || {}).map(([appName, command]) => ({
        name: appName,
        cleanName: appName,
        normalizedName: normalizeText(appName),
        command,
        aliases: APP_ALIASES[appName.toLowerCase()] || [appName.toLowerCase()],
      }));

  let best = null;
  let bestScore = 0;

  for (const app of indexedApps) {
    const aliases = Array.isArray(app.aliases) && app.aliases.length > 0
      ? app.aliases
      : [app.cleanName.toLowerCase()];
    for (const alias of aliases) {
      const s = scoreNameMatch(cleaned, alias, normalizeText(alias), false);
      if (s > bestScore) {
        bestScore = s;
        best = { appName: app.cleanName || app.name, command: app.command, score: s };
      }
    }
  }

  return best && best.score >= 82 ? best : null;
}

function extractBrowserPreference(clause) {
  let browser = 'default';
  let remaining = String(clause || '').trim();

  const trailingMatch = remaining.match(
    /\s+(?:in|with|using|on)\s+(google\s+chrome|chrome|microsoft\s+edge|msedge|edge|mozilla\s+firefox|firefox)$/i
  );
  if (trailingMatch) {
    const b = trailingMatch[1].toLowerCase();
    if (b.includes('chrome')) browser = 'chrome';
    else if (b.includes('edge')) browser = 'edge';
    else if (b.includes('firefox')) browser = 'firefox';
    remaining = remaining.slice(0, trailingMatch.index).trim();
    return { browser, remaining };
  }

  const leadingBrowserToMatch = remaining.match(
    /^(?:open|launch|start)\s+(google\s+chrome|chrome|microsoft\s+edge|msedge|edge|mozilla\s+firefox|firefox)\s+(?:to|at|on|with|for)\s+(.+)$/i
  );
  if (leadingBrowserToMatch) {
    const b = leadingBrowserToMatch[1].toLowerCase();
    if (b.includes('chrome')) browser = 'chrome';
    else if (b.includes('edge')) browser = 'edge';
    else if (b.includes('firefox')) browser = 'firefox';
    remaining = leadingBrowserToMatch[2].trim();
    return { browser, remaining };
  }

  return { browser, remaining };
}

function matchUrlOrSite(clause, config) {
  const { browser, remaining } = extractBrowserPreference(clause);
  const trimmed = remaining.trim();
  const lower = trimmed.toLowerCase();

  // Explicit http/https URL
  const httpMatch = trimmed.match(/https?:\/\/[^\s]+/i);
  if (httpMatch) {
    const url = httpMatch[0];
    return {
      type: 'OPEN_URL',
      title: `Open ${url}`,
      shortTitle: url,
      subtitle: browser === 'default' ? 'Default browser' : `Open in ${browser}`,
      url,
      browser,
      confidence: 98,
    };
  }

  // Localhost / 127.0.0.1 with port or path
  const localhostMatch = lower.match(/\b(localhost|127\.0\.0\.1)(?::|\s+)(\d{2,5})(\/[^\s]*)?/i);
  if (localhostMatch) {
    const url = `http://${localhostMatch[1]}:${localhostMatch[2]}${localhostMatch[3] || ''}`;
    return {
      type: 'OPEN_URL',
      title: `Open ${url}`,
      shortTitle: url,
      subtitle: browser === 'default' ? 'Default browser' : `Open in ${browser}`,
      url,
      browser,
      confidence: 97,
    };
  }

  // Web search patterns
  const googleSearch = trimmed.match(/^(?:google|search\s+google\s+for|search\s+for|search)\s+(.+)$/i);
  if (googleSearch && !/youtube|github/i.test(lower)) {
    const query = googleSearch[1].trim();
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    return {
      type: 'OPEN_URL',
      title: `Google "${query}"`,
      shortTitle: `Search: ${query}`,
      subtitle: browser === 'default' ? 'Default browser' : `Open in ${browser}`,
      url,
      browser,
      confidence: 92,
    };
  }

  const ytSearch = trimmed.match(/^(?:search\s+youtube\s+for|youtube)\s+(.+)$/i);
  if (ytSearch && ytSearch[1].trim() !== 'in') {
    const query = ytSearch[1].trim();
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    return {
      type: 'OPEN_URL',
      title: `Search YouTube for "${query}"`,
      shortTitle: `YouTube: ${query}`,
      subtitle: browser === 'default' ? 'Default browser' : `Open in ${browser}`,
      url,
      browser,
      confidence: 92,
    };
  }

  // Explicit domain (e.g. vercel.com, docs.nestjs.com)
  const domainMatch = trimmed.match(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|dev|app|ai|co|id|edu|gov)(?:\/[^\s]*)?)\b/i);
  if (domainMatch) {
    const url = `https://${domainMatch[1]}`;
    return {
      type: 'OPEN_URL',
      title: `Open ${domainMatch[1]}`,
      shortTitle: domainMatch[1],
      subtitle: browser === 'default' ? 'Default browser' : `Open in ${browser}`,
      url,
      browser,
      confidence: 94,
    };
  }

  // Configured customSites
  const customSites = (config && config.customSites) || {};
  const cleaned = tokenize(trimmed)
    .filter((t) => !['open', 'launch', 'visit', 'go', 'to', 'website', 'site', 'page'].includes(t))
    .join(' ');
  if (cleaned) {
    let bestSite = null;
    let bestScore = 0;
    for (const [siteName, siteUrl] of Object.entries(customSites)) {
      const keyLower = siteName.toLowerCase();
      const aliases = SITE_ALIASES[keyLower] || [keyLower];
      for (const alias of aliases) {
        const s = scoreNameMatch(cleaned, alias, normalizeText(alias), false);
        if (s > bestScore) {
          bestScore = s;
          bestSite = { siteName, siteUrl, score: s };
        }
      }
    }
    if (bestSite && bestSite.score >= 85) {
      return {
        type: 'OPEN_URL',
        title: `Open ${bestSite.siteName}`,
        shortTitle: bestSite.siteName,
        subtitle:
          browser === 'default'
            ? bestSite.siteUrl
            : `${bestSite.siteUrl} (in ${browser})`,
        url: bestSite.siteUrl,
        siteName: bestSite.siteName,
        browser,
        confidence: bestSite.score,
      };
    }
  }

  return null;
}

function buildProjectAction(intentType, match, config, commandOverride = '', editorOverride = '') {
  const { project, subService } = match;
  const targetPath = subService ? subService.path : project.path;
  const displayName = subService ? `${project.name} / ${subService.name}` : project.name;
  const editor = editorOverride || (config && config.editorCommand) || 'code';

  if (intentType === 'OPEN_FOLDER') {
    return {
      type: 'OPEN_FOLDER',
      title: `Open ${displayName} folder`,
      shortTitle: `${displayName} (Folder)`,
      subtitle: targetPath,
      path: targetPath,
      project,
      subService,
      confidence: match.score,
    };
  }

  if (intentType === 'OPEN_TERMINAL') {
    return {
      type: 'OPEN_TERMINAL',
      title: `Open Terminal in ${displayName}`,
      shortTitle: `${displayName} (Terminal)`,
      subtitle: targetPath,
      path: targetPath,
      project,
      subService,
      confidence: match.score,
    };
  }

  if (intentType === 'RUN_PROJECT_COMMAND') {
    const resolvedCmd =
      commandOverride === 'dev' ? detectDevCommand(targetPath) : commandOverride;
    return {
      type: 'RUN_PROJECT_COMMAND',
      title: `Run "${resolvedCmd}" in ${displayName}`,
      shortTitle: resolvedCmd,
      subtitle: targetPath,
      path: targetPath,
      command: resolvedCmd,
      project,
      subService,
      confidence: match.score,
    };
  }

  const isAntigravity = editor === 'antigravity' || editor === 'agy';
  const editorLabel = isAntigravity ? 'Antigravity' : 'VS Code';

  return {
    type: 'OPEN_PROJECT_EDITOR',
    title: `Open ${displayName} in ${editorLabel}`,
    shortTitle: `${displayName} (${editorLabel})`,
    subtitle: targetPath,
    path: targetPath,
    editor: isAntigravity ? 'antigravity' : editor,
    project,
    subService,
    confidence: match.score,
  };
}

function parseRunCommandClause(clause, indexData, config, contextProject) {
  const trimmed = String(clause || '').trim();
  const lower = trimmed.toLowerCase();

  // Ignore standalone app launches like "start spotify", "run krita", or "run notepad"
  const appMatch = matchDesktopApp(trimmed, indexData, config);
  if (appMatch && !/\b(in|inside|at)\b/i.test(lower)) {
    return null;
  }

  // Case 1: "start dev server in colorify" / "run dev in finfy fe"
  const devInProjectMatch = trimmed.match(
    /^(?:run|start|exec|execute)\s+(?:the\s+)?(?:dev\s+server|dev|server)\s+(?:in|inside|for|on|at)\s+(.+)$/i
  );
  if (devInProjectMatch) {
    const targetTokens = extractTargetTokens(devInProjectMatch[1]);
    const matches = matchProjectsAndSubServices(targetTokens, indexData, config, contextProject);
    if (matches.length > 0) {
      return {
        action: buildProjectAction('RUN_PROJECT_COMMAND', matches[0], config, 'dev'),
        project: matches[0].project,
        candidates: matches,
      };
    }
  }

  // Case 2: "run <cmd> in <project>"
  const cmdInProjectMatch = trimmed.match(
    /^(?:run|exec|execute|start)\s+(.+?)\s+(?:in|inside|at|on|for)\s+(.+)$/i
  );
  if (cmdInProjectMatch) {
    const candidateCmd = cmdInProjectMatch[1].trim();
    const targetTokens = extractTargetTokens(cmdInProjectMatch[2]);
    const matches = matchProjectsAndSubServices(targetTokens, indexData, config, contextProject);
    if (matches.length > 0 && matches[0].score >= 72) {
      const normalizedCmd = /^(?:dev|dev\s+server)$/i.test(candidateCmd) ? 'dev' : candidateCmd;
      return {
        action: buildProjectAction('RUN_PROJECT_COMMAND', matches[0], config, normalizedCmd),
        project: matches[0].project,
        candidates: matches,
      };
    }
  }

  // Case 3: "run <cmd>" or direct dev CLI command using contextProject (e.g. chained "and run docker compose up")
  const directRunMatch = trimmed.match(/^(?:run|exec|execute)\s+(.+)$/i);
  const directCliMatch = lower.match(
    /^(?:npm|pnpm|yarn|bun|npx|docker|docker-compose|python|py|pip|php|go|cargo|flutter|dart|git|uvicorn|node|deno)\s+.+$/i
  );
  const bareDevMatch = lower.match(/^(?:start\s+)?(?:dev|dev\s+server)$/i);

  let rawCmd = null;
  if (bareDevMatch) {
    rawCmd = 'dev';
  } else if (directRunMatch) {
    const candidate = directRunMatch[1].trim();
    const looksLikeShellOrDevCmd =
      /^(?:npm|pnpm|yarn|bun|npx|docker|docker-compose|python|py|pip|php|go|cargo|flutter|dart|git|uvicorn|node|deno|make|gradle|mvn|pytest|vitest|jest|dev|dev\s+server|server|build|test|lint|start)\b/i.test(
        candidate
      );
    if (looksLikeShellOrDevCmd) {
      rawCmd = candidate;
    }
  } else if (directCliMatch) {
    rawCmd = trimmed;
  }

  if (rawCmd && contextProject) {
    const normalizedCmd = /^(?:dev|dev\s+server)$/i.test(rawCmd) ? 'dev' : rawCmd;
    return {
      action: buildProjectAction(
        'RUN_PROJECT_COMMAND',
        { project: contextProject, subService: null, score: 95 },
        config,
        normalizedCmd
      ),
      project: contextProject,
      candidates: [],
    };
  }

  return null;
}

function parseTunnelClause(clause, indexData) {
  const trimmed = String(clause || '').trim();
  const lower = trimmed.toLowerCase();
  if (!/\b(?:tunnel|ssh)\b/i.test(lower)) {
    return null;
  }

  const tunnelFiles = (indexData && Array.isArray(indexData.tunnelFiles) && indexData.tunnelFiles) || [];
  if (tunnelFiles.length === 0) {
    return null;
  }

  const passMatch = trimmed.match(/(?:with\s+)?(?:password|pass|pw)\s+["']?([^\s"']+)["']?/i);
  const sshPassword = passMatch ? passMatch[1] : '';

  const strippedClause = lower
    .replace(/(?:with\s+)?(?:password|pass|pw)\s+["']?[^\s"']+["']?/gi, ' ')
    .replace(/\b(?:called|named|config|should|be|on|in|from|run|start|open|the|a|txt|file)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let bestFile = tunnelFiles[0];
  let bestScore = -1;

  for (const tf of tunnelFiles) {
    const cleanLower = tf.cleanName.toLowerCase();
    let score = 0;
    if (strippedClause.includes(cleanLower)) {
      score = 100 + cleanLower.length;
    } else if (cleanLower.includes('ssh') && /\bssh\b/.test(strippedClause)) {
      score = 90;
    } else if (cleanLower === 'tunnel' && !/\bssh\b/.test(strippedClause)) {
      score = 80;
    } else {
      score = 50;
    }
    if (score > bestScore) {
      bestScore = score;
      bestFile = tf;
    }
  }

  const commandLine = bestFile.commands[0];
  if (!commandLine) {
    return null;
  }

  return {
    action: {
      type: 'RUN_PROJECT_COMMAND',
      isTunnel: true,
      title: `Run SSH Tunnel (${bestFile.name})`,
      shortTitle: `SSH Tunnel (${bestFile.name})`,
      taskName: `SSH Tunnel (${bestFile.name})`,
      subtitle: bestFile.path,
      path: path.dirname(bestFile.path),
      command: commandLine,
      sshPassword,
      tunnelFilePath: bestFile.path,
      confidence: 98,
    },
    project: null,
    candidates: [],
    activeVerb: null,
  };
}

function parseSingleClause(clause, indexData, config, context = {}) {
  const trimmed = String(clause || '').trim();
  const lower = trimmed.toLowerCase();
  const contextProject = context.activeProject || null;
  const contextVerb = context.activeVerb || null;

  if (!trimmed) {
    return null;
  }

  // 0. Check SSH tunnel configuration clauses
  const tunnelResult = parseTunnelClause(trimmed, indexData);
  if (tunnelResult) {
    return tunnelResult;
  }

  // 1. Check explicit shell/dev command execution (e.g., "run docker compose up", "run dev in colorify")
  const runResult = parseRunCommandClause(trimmed, indexData, config, contextProject);
  if (runResult) {
    return {
      action: runResult.action,
      project: runResult.project,
      candidates: runResult.candidates || [],
      activeVerb: 'run',
    };
  }

  // 2. Check URL / Website / Localhost / Search
  const urlAction = matchUrlOrSite(trimmed, config);
  if (urlAction) {
    return {
      action: urlAction,
      project: contextProject,
      candidates: [],
    };
  }

  // 3. Determine explicit intent from clause keywords
  const hasAgyEditorKeyword = /\b(?:agy|antigravity)\b/i.test(lower);
  const hasVscodeKeyword = /\b(?:vscode|vs\s*code|visual\s+studio|code)\b/i.test(lower);
  const hasEditorKeyword = hasAgyEditorKeyword || hasVscodeKeyword || /\beditor\b/i.test(lower);
  const preferredEditor = hasAgyEditorKeyword ? 'antigravity' : '';
  const hasTerminalKeyword =
    /\b(?:terminal|powershell|wt|shell|cli|console)\b/i.test(lower) ||
    (/\bcmd\b/i.test(lower) && !/^open\s+(?:command\s+prompt|cmd)$/i.test(lower));
  const hasFolderKeyword =
    !hasEditorKeyword &&
    /\b(?:folder|folders|explorer|directory|browse|reveal|files)\b/i.test(lower);
  const hasRunVerb = /^(?:run|start)\b/i.test(lower);
  const hasOpenVerb = /^(?:open|launch|code|agy|antigravity)\b/i.test(lower);
  const effectiveVerb = hasEditorKeyword || hasOpenVerb
    ? 'open'
    : hasRunVerb
    ? 'run'
    : contextVerb || 'open';

  let intentType = 'OPEN_PROJECT_EDITOR';
  if (hasTerminalKeyword) intentType = 'OPEN_TERMINAL';
  else if (hasFolderKeyword) intentType = 'OPEN_FOLDER';

  // 4. If no project tokens remain and intent is folder/terminal, use active context project
  const targetTokens = extractTargetTokens(trimmed);
  if (targetTokens.length === 0) {
    if ((intentType === 'OPEN_FOLDER' || intentType === 'OPEN_TERMINAL') && contextProject) {
      return {
        action: buildProjectAction(intentType, { project: contextProject, subService: null, score: 94 }, config),
        project: contextProject,
        candidates: [],
      };
    }
    const appAction = matchDesktopApp(trimmed, indexData, config);
    if (appAction) {
      return {
        action: {
          type: 'LAUNCH_APP',
          title: `Launch ${appAction.appName}`,
          shortTitle: appAction.appName,
          subtitle: appAction.command,
          appName: appAction.appName,
          command: appAction.command,
          confidence: appAction.score,
        },
        project: contextProject,
        candidates: [],
      };
    }
    return null;
  }

  // 5. If user did not explicitly ask for an editor/folder/terminal, check desktop app matches first
  // (unless tokens match a sub-service of the active context project from a chained command)
  const hasContextSubServiceMatch =
    contextProject &&
    Array.isArray(contextProject.subServices) &&
    targetTokens.length <= 3 &&
    Boolean(matchSubService(contextProject.subServices, targetTokens));

  if (!hasEditorKeyword && !hasFolderKeyword && !hasTerminalKeyword && !hasContextSubServiceMatch) {
    const appMatch = matchDesktopApp(trimmed, indexData, config);
    if (appMatch && appMatch.score >= 85) {
      return {
        action: {
          type: 'LAUNCH_APP',
          title: `Launch ${appMatch.appName}`,
          shortTitle: appMatch.appName,
          subtitle: appMatch.command,
          appName: appMatch.appName,
          command: appMatch.command,
          confidence: appMatch.score,
        },
        project: contextProject,
        candidates: [],
      };
    }
  }

  // 6. Match against indexed projects + sub-services (Root-first rule)
  const projectMatches = matchProjectsAndSubServices(targetTokens, indexData, config, contextProject);
  if (projectMatches.length > 0) {
    const top = projectMatches[0];
    const targetPath = top.subService ? top.subService.path : top.project.path;
    if (
      intentType === 'OPEN_PROJECT_EDITOR' &&
      effectiveVerb === 'run' &&
      !hasEditorKeyword &&
      hasRunnableDevScript(targetPath)
    ) {
      return {
        action: buildProjectAction('RUN_PROJECT_COMMAND', top, config, 'dev'),
        project: top.project,
        candidates: projectMatches,
        activeVerb: 'run',
      };
    }
    return {
      action: buildProjectAction(intentType, top, config, '', preferredEditor),
      project: top.project,
      candidates: projectMatches,
      explicitEditorSpecified: hasEditorKeyword,
      activeVerb: effectiveVerb,
    };
  }

  // 7. Fallback to desktop app match at normal threshold
  const appFallback = matchDesktopApp(trimmed, indexData, config);
  if (appFallback) {
    return {
      action: {
        type: 'LAUNCH_APP',
        title: `Launch ${appFallback.appName}`,
        shortTitle: appFallback.appName,
        subtitle: appFallback.command,
        appName: appFallback.appName,
        command: appFallback.command,
        confidence: appFallback.score,
      },
      project: contextProject,
      candidates: [],
    };
  }

  return null;
}

function splitCompoundPrompt(input) {
  return String(input || '')
    .split(/\s+(?:and\s+also|and|then|also)\s+|\s*[+;]\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildSecondaryActionsForProject(match, primaryAction, config) {
  const actions = [];
  const primaryType = typeof primaryAction === 'string' ? primaryAction : primaryAction.type;
  const primaryEditor = typeof primaryAction === 'object' ? primaryAction.editor : '';

  if (primaryType !== 'OPEN_PROJECT_EDITOR') {
    actions.push(buildProjectAction('OPEN_PROJECT_EDITOR', match, config, '', 'code'));
    actions.push(buildProjectAction('OPEN_PROJECT_EDITOR', match, config, '', 'antigravity'));
  } else if (primaryEditor === 'antigravity') {
    actions.push(buildProjectAction('OPEN_PROJECT_EDITOR', match, config, '', 'code'));
  } else {
    actions.push(buildProjectAction('OPEN_PROJECT_EDITOR', match, config, '', 'antigravity'));
  }

  if (primaryType !== 'OPEN_FOLDER') {
    actions.push(buildProjectAction('OPEN_FOLDER', match, config));
  }
  if (primaryType !== 'OPEN_TERMINAL') {
    actions.push(buildProjectAction('OPEN_TERMINAL', match, config));
  }
  return actions;
}

function getTimeGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function isGreetingOrStatusPrompt(raw) {
  return /^(?:hi|hello|hey|yo|hola|sup|good\s+(?:morning|afternoon|evening)|(?:hi|hey|hello)\s+(?:pulse|jarvis|assistant)|jarvis|pulse|are\s+you\s+(?:there|connected|online|ready|alive)|status|who\s+are\s+you|what\s+can\s+you\s+do|help)[\s!?.]*$/i.test(
    String(raw || '').trim()
  );
}

function buildInstantJarvisReply(raw, indexData) {
  const pCount = (indexData && indexData.count) || (indexData && indexData.projects && indexData.projects.length) || 0;
  const aCount = (indexData && indexData.appCount) || (indexData && indexData.apps && indexData.apps.length) || 0;
  const lower = String(raw || '').trim().toLowerCase();

  if (/(?:who\s+are\s+you|what\s+can\s+you\s+do|help)/i.test(lower)) {
    return `I am Pulse, your personal desktop assistant. I can open any of your ${pCount} projects in VS Code or Antigravity, launch ${aCount} installed applications, run commands, or chat with you.`;
  }
  if (/(?:connected|online|status|alive|there|ready)/i.test(lower)) {
    return `Connected and ready. Tracking ${pCount} projects and ${aCount} installed applications on your PC with Antigravity AI active.`;
  }
  return `${getTimeGreeting()}. I am connected and tracking ${pCount} projects and ${aCount} installed apps. What should we do today?`;
}

function extractResearchQuery(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;

  const explicitMatch = trimmed.match(
    /^(?:(?:can|could|would)\s+you\s+)?(?:please\s+)?(?:research|investigate|look\s+up|find\s+out\s+about|search\s+(?:the\s+web|google|on\s+google)\s+(?:for|about)|search\s+about|tell\s+me\s+about)\s+(.+?)\??$/i
  );
  if (explicitMatch) {
    const topic = explicitMatch[1]
      .replace(/\s+(?:on|in|via|using|from)\s+(?:google|the\s+web|web)\s*$/i, '')
      .replace(/^["']|["']$/g, '')
      .trim();
    if (topic) {
      return {
        topic,
        googleSearchUrl: `https://www.google.com/search?q=${encodeURIComponent(topic)}`,
      };
    }
  }

  const questionMatch = trimmed.match(
    /^(?:what\s+(?:is|are)|who\s+is|how\s+does|explain)\s+(.+?)\??$/i
  );
  if (
    questionMatch &&
    !/\b(?:project|projects|pulse|jarvis|you|your|my\s+pc|my\s+apps|status|today)\b/i.test(trimmed)
  ) {
    const topic = questionMatch[1]
      .replace(/\s+(?:on|in|via|using|from)\s+(?:google|the\s+web|web)\s*$/i, '')
      .trim();
    if (topic) {
      return {
        topic,
        googleSearchUrl: `https://www.google.com/search?q=${encodeURIComponent(topic)}`,
      };
    }
  }

  return null;
}

function isConversationalQuestion(raw) {
  const trimmed = String(raw || '')
    .replace(/^(?:(?:hi|hey|hello)\s+)?(?:pulse|jarvis)[,\s]+/i, '')
    .trim();
  if (!trimmed) return false;
  if (extractResearchQuery(trimmed)) return true;
  if (/^(?:can|could|would)\s+you\s+(?:please\s+)?(?:open|launch|start|run)\b/i.test(trimmed)) {
    return false;
  }
  return (
    /^(?:what|how|why|who|where|when|which|tell\s+me|explain|suggest|recommend|summarize|list|i\s+want|i\s+need|are\s+you|do\s+you|is\s+there|can\s+you|could\s+you|would\s+you|thanks|thank\s+you)\b/i.test(
      trimmed
    ) || /\?\s*$/.test(trimmed)
  );
}

function buildOfflineReply(actions) {
  if (!actions || actions.length === 0) return '';
  if (actions.length === 1) {
    const a = actions[0];
    if (a.type === 'OPEN_SETTINGS') return 'Press Enter to open Pulse Settings.';
    if (a.type === 'LAUNCH_APP') return `Press Enter to open ${a.appName || a.shortTitle}.`;
    if (a.type === 'OPEN_URL') return `Press Enter to open ${a.shortTitle || a.url}.`;
    if (a.type === 'OPEN_FOLDER') return `Press Enter to open folder ${a.shortTitle}.`;
    if (a.type === 'OPEN_TERMINAL') return `Press Enter to open terminal in ${a.shortTitle}.`;
    if (a.type === 'RUN_PROJECT_COMMAND') return `Press Enter to run ${a.command} in ${a.project ? a.project.name : 'project'}.`;
    if (a.type === 'OPEN_PROJECT_EDITOR') {
      const ed = a.editor === 'antigravity' ? 'Antigravity' : 'VS Code';
      const name = a.subService ? `${a.project.name} / ${a.subService.name}` : (a.project ? a.project.name : a.shortTitle);
      return `Press Enter to open ${name} in ${ed}.`;
    }
    return `Press Enter to run ${a.title}.`;
  }
  return `Press Enter to run ${actions.length} actions.`;
}

function parsePrompt(input, indexData, config, depth = 0) {
  const raw = String(input || '').trim();
  const routines = (config && config.customRoutines) || [];
  const recent = (config && config.recentHistory) || [];

  if (!raw) {
    return {
      isEmpty: true,
      input: raw,
      routines,
      recent,
      actions: [],
      primaryAction: null,
      results: [],
      confidence: 0,
      suggestAI: false,
      forceAI: false,
    };
  }

  // Explicit AI request (? or ai:)
  const explicitAIMatch = raw.match(/^(?:\?\s*|ai:\s*)(.+)$/i);
  if (explicitAIMatch) {
    return {
      isEmpty: false,
      input: raw,
      cleanPrompt: explicitAIMatch[1].trim(),
      routines: [],
      recent: [],
      actions: [],
      primaryAction: null,
      results: [],
      confidence: 0,
      suggestAI: true,
      forceAI: true,
      isConversational: true,
    };
  }

  // Instant Jarvis response for greetings and connection/status checks
  if (isGreetingOrStatusPrompt(raw)) {
    const reply = buildInstantJarvisReply(raw, indexData);
    return {
      isEmpty: false,
      input: raw,
      isChained: false,
      isConversational: true,
      isInstantReply: true,
      reply,
      matchedRoutine: null,
      matchingRoutines: [],
      actions: [],
      primaryAction: null,
      results: [],
      confidence: 100,
      suggestAI: false,
      forceAI: false,
    };
  }

  // Route open-ended conversational & research questions directly to AI
  const researchInfo = extractResearchQuery(raw);
  if (researchInfo) {
    const browserAction = {
      type: 'OPEN_URL',
      title: 'Open Google Search in Browser',
      shortTitle: `Google: ${researchInfo.topic}`,
      subtitle: researchInfo.googleSearchUrl,
      url: researchInfo.googleSearchUrl,
      browser: 'default',
      confidence: 80,
    };
    return {
      isEmpty: false,
      input: raw,
      isChained: false,
      isConversational: true,
      isResearch: true,
      researchTopic: researchInfo.topic,
      googleSearchUrl: researchInfo.googleSearchUrl,
      matchedRoutine: null,
      matchingRoutines: [],
      actions: [],
      primaryAction: null,
      results: [browserAction],
      confidence: 0,
      suggestAI: true,
      forceAI: true,
    };
  }

  if (isConversationalQuestion(raw)) {
    return {
      isEmpty: false,
      input: raw,
      isChained: false,
      isConversational: true,
      matchedRoutine: null,
      matchingRoutines: [],
      actions: [],
      primaryAction: null,
      results: [],
      confidence: 0,
      suggestAI: true,
      forceAI: true,
    };
  }

  // Strip polite conversational prefix if user asked "can you open ..."
  const commandText = raw
    .replace(/^(?:can|could|would)\s+you\s+(?:please\s+)?/i, '')
    .replace(/\?+$/, '')
    .trim();
  const lower = commandText.toLowerCase();

  // Built-in Pulse Settings command
  if (/^(?:open\s+)?(?:pulse\s+)?(?:settings|preferences)$/i.test(commandText)) {
    const settingsAction = {
      type: 'OPEN_SETTINGS',
      title: 'Pulse Settings',
      shortTitle: 'Settings',
      subtitle: 'Configure startup, workspace roots, and AI',
      confidence: 100,
    };
    return {
      isEmpty: false,
      input: raw,
      isChained: false,
      reply: 'Press Enter to open Pulse Settings.',
      matchedRoutine: null,
      matchingRoutines: [],
      actions: [settingsAction],
      primaryAction: settingsAction,
      results: [{ ...settingsAction, isPrimary: true, secondaryActions: [] }],
      confidence: 100,
      suggestAI: false,
      forceAI: false,
    };
  }

  // Built-in Tasks / Services Monitor command
  if (
    /^(?:open\s+|show\s+|check\s+|view\s+)?(?:running\s+)?(?:tasks|services|processes|monitor|logs|running)(?:\s+(?:monitor|logs))?$/i.test(
      commandText
    )
  ) {
    const tasksAction = {
      type: 'OPEN_TASKS',
      title: 'Running Background Tasks',
      shortTitle: 'Tasks',
      subtitle: 'Monitor logs, refresh, rerun, or stop services',
      confidence: 100,
    };
    return {
      isEmpty: false,
      input: raw,
      isChained: false,
      reply: 'Press Enter to view running tasks and logs.',
      matchedRoutine: null,
      matchingRoutines: [],
      actions: [tasksAction],
      primaryAction: tasksAction,
      results: [{ ...tasksAction, isPrimary: true, secondaryActions: [] }],
      confidence: 100,
      suggestAI: false,
      forceAI: false,
    };
  }

  // Check Saved Routines
  if (depth < 2) {
    const exactRoutine = routines.find((r) => r.trigger.toLowerCase() === lower);
    if (exactRoutine) {
      const expanded = parsePrompt(exactRoutine.prompt, indexData, config, depth + 1);
      return {
        ...expanded,
        input: raw,
        matchedRoutine: exactRoutine,
        confidence: 100,
        suggestAI: false,
      };
    }
  }

  const matchingRoutines = routines.filter(
    (r) => r.trigger.toLowerCase().includes(lower) || r.name.toLowerCase().includes(lower)
  );

  // Multi-command chaining splitter
  const clauses = splitCompoundPrompt(commandText);
  const actions = [];
  const context = { activeProject: null, activeVerb: null };
  let lastCandidates = [];

  for (const clause of clauses) {
    const parsed = parseSingleClause(clause, indexData, config, context);
    if (parsed && parsed.action) {
      actions.push(parsed.action);
      if (parsed.project) {
        context.activeProject = parsed.project;
      }
      if (parsed.activeVerb) {
        context.activeVerb = parsed.activeVerb;
      }
      if (parsed.candidates && parsed.candidates.length > 0) {
        lastCandidates = parsed.candidates;
      }
    }
  }

  // Handle "open finfy fe and be in vscode/antigravity/folder" when final clause carries an explicit intent
  if (clauses.length > 1 && actions.length === clauses.length) {
    const lastClause = clauses[clauses.length - 1].toLowerCase();
    const firstClause = clauses[0].toLowerCase();
    const firstHasExplicit = /\b(?:vscode|vs\s*code|code|agy|antigravity|folder|explorer|terminal|powershell|cmd)\b/i.test(
      firstClause
    );
    const lastAction = actions[actions.length - 1];
    if (!firstHasExplicit && /\b(?:folder|explorer)\b/i.test(lastClause) && lastAction.type === 'OPEN_FOLDER') {
      actions[0] = buildProjectAction(
        'OPEN_FOLDER',
        { project: actions[0].project, subService: actions[0].subService, score: actions[0].confidence },
        config
      );
    } else if (
      !firstHasExplicit &&
      lastAction.type === 'OPEN_PROJECT_EDITOR' &&
      lastAction.editor === 'antigravity' &&
      actions[0].type === 'OPEN_PROJECT_EDITOR'
    ) {
      actions[0] = buildProjectAction(
        'OPEN_PROJECT_EDITOR',
        { project: actions[0].project, subService: actions[0].subService, score: actions[0].confidence },
        config,
        '',
        'antigravity'
      );
    }
  }

  const hasExplicitCommandVerb =
    /^(?:open|launch|start|run|code|vscode|agy|antigravity|explorer|folder|terminal|powershell|cmd|google|search|visit|go\s+to)\b/i.test(
      lower
    );

  // Reject weak non-command guesses (e.g. conversational text) and hand off to AI
  if (
    actions.length === 0 ||
    (!hasExplicitCommandVerb && Math.min(...actions.map((a) => a.confidence || 0)) < 85)
  ) {
    return {
      isEmpty: false,
      input: raw,
      matchedRoutine: null,
      matchingRoutines,
      actions: [],
      primaryAction: null,
      results: [],
      confidence: 0,
      suggestAI: true,
      forceAI: true,
      isConversational: true,
    };
  }

  const minConfidence = Math.min(...actions.map((a) => a.confidence || 75));
  const primaryAction = actions[0];

  // Build clean UI results list (capped at 5 rows)
  const results = [];
  if (actions.length === 1) {
    const primaryMatch = primaryAction.project
      ? {
          project: primaryAction.project,
          subService: primaryAction.subService,
          score: primaryAction.confidence,
        }
      : null;

    const secondaryActions = primaryMatch
      ? buildSecondaryActionsForProject(primaryMatch, primaryAction, config)
      : [];

    results.push({
      ...primaryAction,
      isPrimary: true,
      secondaryActions,
    });

    // When a bare project is typed without specifying an editor, include Antigravity directly in selectable results
    if (
      primaryMatch &&
      primaryAction.type === 'OPEN_PROJECT_EDITOR' &&
      !/\b(?:vscode|vs\s*code|visual\s+studio|code|agy|antigravity|editor)\b/i.test(lower)
    ) {
      results.push({
        ...buildProjectAction('OPEN_PROJECT_EDITOR', primaryMatch, config, '', 'antigravity'),
        isPrimary: false,
        secondaryActions: [],
      });
    }

    // Add other candidate projects if any
    for (const cand of lastCandidates.slice(1, 4)) {
      const alt = buildProjectAction(
        primaryAction.type === 'RUN_PROJECT_COMMAND' ? 'OPEN_PROJECT_EDITOR' : primaryAction.type,
        cand,
        config,
        '',
        primaryAction.editor || ''
      );
      results.push({
        ...alt,
        isPrimary: false,
        secondaryActions: buildSecondaryActionsForProject(cand, alt, config),
      });
    }
  } else {
    results.push(...actions.map((a, idx) => ({ ...a, stepIndex: idx + 1, isPrimary: idx === 0 })));
  }

  const allClausesMatched = actions.length === clauses.length;
  return {
    isEmpty: false,
    input: raw,
    isChained: actions.length > 1,
    reply: buildOfflineReply(actions),
    matchedRoutine: null,
    matchingRoutines,
    actions,
    primaryAction,
    results: results.slice(0, 5),
    confidence: allClausesMatched ? minConfidence : Math.min(minConfidence, 55),
    suggestAI: !allClausesMatched || minConfidence < 70,
    forceAI: false,
  };
}

function getCleanEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  delete env.ELECTRON_ENABLE_LOGGING;
  return env;
}

const CONVERSATION_STOPWORDS = new Set([
  'pulse',
  'jarvis',
  'assistant',
  'check',
  'where',
  'what',
  'which',
  'when',
  'how',
  'who',
  'why',
  'do',
  'did',
  'does',
  'is',
  'are',
  'was',
  'were',
  'i',
  'you',
  'me',
  'my',
  'your',
  'we',
  'put',
  'placed',
  'saved',
  'stored',
  'keep',
  'kept',
  'located',
  'location',
  'path',
  'find',
  'locate',
  'look',
  'for',
  'thesis',
  'forgot',
  'forget',
  'forgotten',
  'since',
  'its',
  'it',
  'been',
  'long',
  'time',
  'ago',
  'called',
  'named',
  'about',
  'tell',
  'need',
  'want',
  'can',
  'could',
  'would',
  'should',
  'have',
  'has',
  'had',
]);

function findRelevantProjectsForPrompt(userPrompt, indexData) {
  const projects = (indexData && indexData.projects) || [];
  if (!userPrompt || projects.length === 0) {
    return [];
  }

  const tokens = tokenize(userPrompt).filter(
    (t) => t.length >= 2 && !FILLER_TOKENS.has(t) && !CONVERSATION_STOPWORDS.has(t)
  );
  if (tokens.length === 0) {
    return [];
  }

  const joined = tokens.join(' ');
  const scored = [];

  for (const project of projects) {
    let bestScore = scoreNameMatch(joined, project.name, project.normalizedName, project.hasMarker);
    for (const token of tokens) {
      if (token.length < 3) continue;
      bestScore = Math.max(
        bestScore,
        scoreNameMatch(token, project.name, project.normalizedName, project.hasMarker)
      );
    }

    if (Array.isArray(project.subServices)) {
      for (const sub of project.subServices) {
        bestScore = Math.max(bestScore, scoreNameMatch(joined, sub.name, sub.normalizedName, sub.hasMarker) - 2);
        for (const token of tokens) {
          if (token.length < 3) continue;
          bestScore = Math.max(
            bestScore,
            scoreNameMatch(token, sub.name, sub.normalizedName, sub.hasMarker) - 2
          );
        }
      }
    }

    if (bestScore >= 70) {
      const hasSubsBonus = Array.isArray(project.subServices) && project.subServices.length > 0 ? 15 : 0;
      scored.push({
        project,
        rankScore: bestScore + hasSubsBonus,
      });
    }
  }

  scored.sort(
    (a, b) =>
      b.rankScore - a.rankScore ||
      a.project.path.length - b.project.path.length ||
      a.project.name.localeCompare(b.project.name)
  );

  return scored.slice(0, 8).map(({ project }) => ({
    name: project.name,
    path: project.path,
    subServices: (project.subServices || []).slice(0, 12).map((s) => ({
      name: s.name,
      path: s.path,
    })),
  }));
}

function buildProjectLocationActions(matchedProj, config) {
  if (!matchedProj || !matchedProj.path) return [];
  const match = {
    project: {
      name: matchedProj.name,
      path: matchedProj.path,
      subServices: matchedProj.subServices || [],
    },
    subService: null,
    score: 95,
  };
  return [
    buildProjectAction('OPEN_FOLDER', match, config),
    buildProjectAction('OPEN_PROJECT_EDITOR', match, config, '', 'code'),
    buildProjectAction('OPEN_PROJECT_EDITOR', match, config, '', 'antigravity'),
  ];
}

function extractTracksFromText(text) {
  if (!text) return [];
  const lines = String(text).split(/\r?\n/);
  const tracks = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const listMatch = line.match(/^(?:\d+[.)]|[-*•])\s+(.+)$/);
    if (!listMatch) continue;
    const content = listMatch[1].replace(/\*\*/g, '').trim();
    if (/^[^-–—]{1,50}:\s+/.test(content)) continue;
    const sepMatch = content.match(/^(.+?)\s+(?:[-–—]|by)\s+(.+)$/i);
    if (!sepMatch) continue;
    const left = sepMatch[1]
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^['"“”‘’]+|['"“”‘’.,;]+$/g, '')
      .trim();
    const right = sepMatch[2]
      .replace(/\([^)]*\)/g, ' ')
      .split(/\s+or\s+/i)[0]
      .split(/\s+[-–—]\s+/)[0]
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^['"“”‘’]+|['"“”‘’.,;]+$/g, '')
      .trim();
    if (left && right && left.length <= 60 && right.length <= 80) {
      tracks.push(`${left} - ${right}`);
    }
  }
  return tracks;
}

function extractTracksFromHistory(conversationHistory = []) {
  if (!Array.isArray(conversationHistory)) return [];
  for (let i = conversationHistory.length - 1; i >= 0; i--) {
    const turn = conversationHistory[i];
    if (!turn || !turn.text) continue;
    const found = extractTracksFromText(turn.text);
    if (found.length >= 2) {
      return found;
    }
  }
  return [];
}

async function resolveYoutubeVideoId(trackQuery) {
  const q = String(trackQuery || '').trim();
  if (!q) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    return match ? match[1] : null;
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function buildYoutubePlaylistActions(tracks, title = '', browser = 'default') {
  const cleanTracks = (Array.isArray(tracks) ? tracks : [])
    .map((t) => String(t || '').trim())
    .filter(Boolean)
    .slice(0, 10);
  if (cleanTracks.length === 0) return [];

  const ids = await Promise.all(cleanTracks.map((t) => resolveYoutubeVideoId(t)));
  const resolved = cleanTracks
    .map((track, idx) => ({ track, videoId: ids[idx] }))
    .filter((item) => Boolean(item.videoId));

  if (resolved.length === 0) {
    const fallbackQuery = cleanTracks.join(' ');
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(fallbackQuery)}`;
    return [
      {
        type: 'OPEN_URL',
        title: title || `Search YouTube Playlist (${cleanTracks.length} tracks)`,
        shortTitle: title || 'YouTube Playlist Search',
        subtitle: searchUrl,
        url: searchUrl,
        browser: browser || 'default',
        isYoutubePlaylist: true,
        tracks: cleanTracks,
        videoIds: [],
        confidence: 95,
        fromAI: true,
      },
    ];
  }

  const videoIds = [];
  for (const item of resolved) {
    if (!videoIds.includes(item.videoId)) {
      videoIds.push(item.videoId);
    }
  }

  const queueUrl = `https://www.youtube.com/watch_videos?video_ids=${videoIds.join(',')}`;
  const queueTitle =
    title && !/^play\s+youtube\s+queue$/i.test(title)
      ? `${title} (${videoIds.length} tracks)`
      : `Play YouTube Queue (${videoIds.length} tracks)`;

  const actions = [
    {
      type: 'OPEN_URL',
      title: queueTitle,
      shortTitle: `YouTube Queue (${videoIds.length} tracks)`,
      subtitle: queueUrl,
      url: queueUrl,
      browser: browser || 'default',
      isYoutubePlaylist: true,
      tracks: resolved.map((r) => r.track),
      videoIds,
      confidence: 98,
      fromAI: true,
    },
  ];

  for (const item of resolved) {
    const watchUrl = `https://www.youtube.com/watch?v=${item.videoId}`;
    actions.push({
      type: 'OPEN_URL',
      title: `Play ${item.track}`,
      shortTitle: item.track,
      subtitle: watchUrl,
      url: watchUrl,
      browser: browser || 'default',
      confidence: 94,
      fromAI: true,
    });
  }

  return actions;
}

function buildAICatalogPrompt(userPrompt, indexData, config, conversationHistory = [], researchInfo = null) {
  const matchedProjects = findRelevantProjectsForPrompt(userPrompt, indexData);
  const recentTracks = extractTracksFromHistory(conversationHistory);
  const projects = ((indexData && indexData.projects) || []).slice(0, 200).map((p) => {
    const subs = (p.subServices || []).slice(0, 10).map((s) => s.name);
    return subs.length > 0
      ? `${p.name} (${p.path}) [${subs.join(', ')}]`
      : `${p.name} (${p.path})`;
  });

  const apps = (
    indexData && Array.isArray(indexData.apps) && indexData.apps.length > 0
      ? indexData.apps.slice(0, 120).map((a) => a.cleanName)
      : Object.keys((config && config.customApps) || {})
  )
    .map((name) => String(name || '').replace(/[^\x20-\x7E]/g, '').trim())
    .filter(Boolean);

  const tunnelFiles = ((indexData && indexData.tunnelFiles) || []).map((f) => ({
    name: f.name,
    commands: f.commands,
  }));

  const sites = Object.keys((config && config.customSites) || {});
  const recentTurns = Array.isArray(conversationHistory)
    ? conversationHistory.slice(-4).map((t) => `${t.role}: ${t.text}`)
    : [];

  return [
    'You are Pulse, a calm, intelligent Jarvis-like personal desktop assistant on Windows.',
    'IMPORTANT: Never call filesystem, directory, or terminal tools (do NOT use find_by_name, grep_search, list_dir, read_file, or run_command). All local projects, exact disk paths, apps, and SSH tunnel files are already provided below. Only use search_web when "Research topic requested" is explicitly provided.',
    'You can chat naturally, research topics on the web using search_web when asked to research/look up something, and return executable JSON actions for Pulse to launch local projects, apps, SSH tunnels, URLs, or commands.',
    'Respond concisely in "reply", and include executable "actions" only when the user wants something opened or run. Never execute terminal commands yourself; return them in "actions".',
    'Return ONLY valid JSON with no markdown fences and no extra commentary.',
    'Schema:',
    '{"reply":"concise conversational reply","actions":[{"type":"OPEN_PROJECT_EDITOR|RUN_PROJECT_COMMAND|OPEN_TERMINAL|OPEN_FOLDER|OPEN_URL|YOUTUBE_PLAYLIST|LAUNCH_APP","title":"label","project":"project name from Projects","subService":"optional sub-service name","editor":"code|antigravity","command":"shell command if RUN_PROJECT_COMMAND","isTunnel":false,"sshPassword":"","url":"full URL if OPEN_URL","tracks":["Artist - Song if YOUTUBE_PLAYLIST"],"browser":"default|chrome|edge|firefox","appName":"app name from Apps if LAUNCH_APP"}]}',
    'Rules:',
    '- If the user asks to research or look something up, use search_web to gather current facts and summarize concisely in "reply" with "actions":[].',
    '- If the user asks to create, make, or play a YouTube playlist or queue (e.g. "is it possible for u to make me a playlist or queue on youtube for it?", "make me a youtube playlist of..."), reply affirmatively and include an action with {"type":"YOUTUBE_PLAYLIST","title":"Play YouTube Queue","tracks":["Artist - Song 1","Artist - Song 2",...]} using the tracks from the conversation or your recommendation. Pulse automatically resolves the YouTube video IDs into a playable multi-track YouTube queue.',
    '- Only include OPEN_URL if the user explicitly asks to open the browser/Google tab as well.',
    '- Default to root project unless a specific sub-service is requested.',
    '- Use editor "antigravity" when user asks for agy or Antigravity; otherwise default to "code".',
    '- Default browser to "default" unless user specifies chrome, edge, or firefox.',
    `Apps: ${JSON.stringify(apps)}`,
    `Sites: ${JSON.stringify(sites)}`,
    tunnelFiles.length > 0 ? `SSH Tunnel Files: ${JSON.stringify(tunnelFiles)}` : '',
    matchedProjects.length > 0 ? `Matched Projects (exact disk paths): ${JSON.stringify(matchedProjects)}` : '',
    `Projects: ${JSON.stringify(projects)}`,
    researchInfo ? `Research topic requested: ${JSON.stringify(researchInfo.topic)}` : '',
    recentTracks.length > 0 ? `Recent Recommended Tracks in Conversation: ${JSON.stringify(recentTracks)}` : '',
    recentTurns.length > 0 ? `Recent conversation:\n${recentTurns.join('\n')}` : '',
    `User: ${JSON.stringify(userPrompt)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildAgyFollowUpPrompt(userPrompt, indexData = null, researchInfo = null, conversationHistory = []) {
  const matchedProjects = findRelevantProjectsForPrompt(userPrompt, indexData);
  const recentTracks = extractTracksFromHistory(conversationHistory);
  return [
    `User: ${JSON.stringify(userPrompt)}`,
    matchedProjects.length > 0
      ? `Matched Projects (exact disk paths): ${JSON.stringify(matchedProjects)}`
      : '',
    recentTracks.length > 0
      ? `Recent Recommended Tracks in Conversation: ${JSON.stringify(recentTracks)}`
      : '',
    researchInfo
      ? `Research topic: ${JSON.stringify(researchInfo.topic)}. Use search_web to look up accurate information and summarize concisely.`
      : 'Do NOT call any tools (no filesystem search, no find_by_name, no list_dir, no run_command, no search_web). Answer directly using the catalog context and Matched Projects below.',
    'If the user asks to make/create/play a YouTube playlist or queue (e.g. "is it possible for u to make me a playlist or queue on youtube for it?"), reply affirmatively and include an action: {"type":"YOUTUBE_PLAYLIST","title":"Play YouTube Queue","tracks":["Artist - Song 1","Artist - Song 2",...]}.',
    'Return ONLY valid JSON: {"reply":"concise conversational reply","actions":[]}',
    'Include actions only when the user asks to launch an app, project, URL, folder, or command.',
  ]
    .filter(Boolean)
    .join('\n');
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('AI response did not contain a valid JSON object.');
  }
  return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
}

function hydrateAIActions(rawActions, indexData, config) {
  const projects = (indexData && indexData.projects) || [];
  const indexedApps = (indexData && indexData.apps) || [];
  const customApps = (config && config.customApps) || {};
  const editor = (config && config.editorCommand) || 'code';

  return (Array.isArray(rawActions) ? rawActions : [])
    .map((item) => {
      if (!item || !item.type) return null;
      const type = String(item.type).toUpperCase();

      if (type === 'OPEN_URL' && item.url) {
        return {
          type: 'OPEN_URL',
          title: item.title || `Open ${item.url}`,
          shortTitle: item.title || item.url,
          subtitle:
            item.browser && item.browser !== 'default'
              ? `${item.url} (in ${item.browser})`
              : item.url,
          url: item.url,
          browser: item.browser || 'default',
          confidence: 95,
          fromAI: true,
        };
      }

      if (type === 'LAUNCH_APP') {
        const targetApp = String(item.appName || item.title || '').trim().toLowerCase();
        const matchedIndexed = indexedApps.find(
          (a) =>
            a.cleanName.toLowerCase() === targetApp ||
            a.name.toLowerCase() === targetApp ||
            (Array.isArray(a.aliases) && a.aliases.includes(targetApp))
        );
        const matchedAppKey = Object.keys(customApps).find(
          (k) => k.toLowerCase() === targetApp
        );
        const appName = matchedIndexed
          ? matchedIndexed.cleanName
          : matchedAppKey || item.appName || item.title || 'App';
        const command = matchedIndexed
          ? matchedIndexed.command
          : matchedAppKey
          ? customApps[matchedAppKey]
          : item.command || appName;

        return {
          type: 'LAUNCH_APP',
          title: item.title || `Launch ${appName}`,
          shortTitle: appName,
          subtitle: command,
          appName,
          command,
          confidence: 95,
          fromAI: true,
        };
      }

      if (
        ['OPEN_PROJECT_EDITOR', 'OPEN_FOLDER', 'OPEN_TERMINAL', 'RUN_PROJECT_COMMAND'].includes(type)
      ) {
        let project = null;
        let subService = null;
        let targetPath = item.path || '';

        if (targetPath) {
          const lowerPath = String(targetPath).toLowerCase();
          project =
            projects.find((p) => p.path.toLowerCase() === lowerPath) ||
            projects.find((p) =>
              (p.subServices || []).some((s) => s.path.toLowerCase() === lowerPath)
            ) ||
            null;
          subService =
            project && project.subServices
              ? project.subServices.find((s) => s.path.toLowerCase() === lowerPath) || null
              : null;
        }

        if (!project && item.project) {
          const projLower = String(item.project).trim().toLowerCase();
          const projNorm = normalizeText(projLower);
          project =
            projects.find(
              (p) => p.name.toLowerCase() === projLower || p.normalizedName === projNorm
            ) ||
            projects.find((p) => p.name.toLowerCase().includes(projLower)) ||
            null;
        }

        if (project && !subService && item.subService && Array.isArray(project.subServices)) {
          const subLower = String(item.subService).trim().toLowerCase();
          const subNorm = normalizeText(subLower);
          subService =
            project.subServices.find(
              (s) =>
                s.name.toLowerCase() === subLower ||
                s.normalizedName === subNorm ||
                (Array.isArray(s.aliases) && s.aliases.includes(subLower))
            ) || null;
        }

        if (!targetPath && project) {
          targetPath = subService ? subService.path : project.path;
        }

        if (!targetPath) {
          return null;
        }

        const itemEditor =
          item.editor && /^(?:agy|antigravity)$/i.test(item.editor)
            ? 'antigravity'
            : editor;

        return {
          type,
          title: item.title || `${type} ${path.basename(targetPath)}`,
          shortTitle: item.command || path.basename(targetPath),
          subtitle: targetPath,
          path: targetPath,
          editor: type === 'OPEN_PROJECT_EDITOR' ? itemEditor : undefined,
          command: type === 'RUN_PROJECT_COMMAND' ? item.command || detectDevCommand(targetPath) : undefined,
          isTunnel: Boolean(item.isTunnel || (item.command && /^\s*ssh\s+/i.test(item.command))),
          sshPassword: item.sshPassword || '',
          project,
          subService,
          confidence: 95,
          fromAI: true,
        };
      }

      if (type === 'RUN_PROJECT_COMMAND' && item.command) {
        return {
          type: 'RUN_PROJECT_COMMAND',
          title: item.title || `Run ${item.command}`,
          shortTitle: item.title || item.command,
          subtitle: os.homedir(),
          path: os.homedir(),
          command: item.command,
          isTunnel: Boolean(item.isTunnel || /^\s*ssh\s+/i.test(item.command)),
          sshPassword: item.sshPassword || '',
          confidence: 95,
          fromAI: true,
        };
      }

      return null;
    })
    .filter(Boolean);
}

function resolveAgyExecutable(config) {
  const configured = config && config.ai && config.ai.agyPath;
  if (configured && fs.existsSync(configured)) {
    return configured;
  }
  const defaultPath = path.join(os.homedir(), 'AppData', 'Local', 'agy', 'bin', 'agy.exe');
  if (fs.existsSync(defaultPath)) {
    return defaultPath;
  }
  return 'agy';
}

function invokeAgyOnce(agyBin, model, promptText, agyConversationId = null) {
  return new Promise((resolve, reject) => {
    const args = [
      '--output-format',
      'json',
      '--disable-slash-commands',
      '--model',
      model,
    ];
    if (agyConversationId) {
      args.push('--conversation', agyConversationId);
    }

    const child = spawn(agyBin, args, {
      cwd: os.tmpdir(),
      env: getCleanEnv(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch (err) {
        // Ignore kill error on already exited process
      }
    }, 60000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(err.message || 'agy CLI invocation failed'));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const cleanStderr = String(stderr || '')
        .split(/\r?\n/)
        .filter((line) => line.trim() && !/^\s*warning:/i.test(line))
        .join('\n')
        .trim();

      let envelope = null;
      try {
        envelope = extractJsonObject(stdout);
      } catch (parseErr) {
        envelope = null;
      }

      if (envelope && envelope.status === 'SUCCESS') {
        return resolve({
          conversationId: envelope.conversation_id || agyConversationId || null,
          response: String(envelope.response || '').trim(),
        });
      }

      if (timedOut) {
        return reject(new Error(cleanStderr || 'agy CLI request timed out after 60s.'));
      }

      if (code !== 0) {
        return reject(
          new Error(
            cleanStderr ||
              (envelope && envelope.error) ||
              `agy exited with code ${code}`
          )
        );
      }

      if (envelope) {
        return resolve({
          conversationId: envelope.conversation_id || agyConversationId || null,
          response: String(envelope.response || '').trim(),
        });
      }

      resolve({
        conversationId: agyConversationId || null,
        response: String(stdout || '').trim(),
      });
    });

    try {
      child.stdin.write(String(promptText || ''), 'utf8');
      child.stdin.end();
    } catch (writeErr) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(writeErr.message || 'Failed to write prompt to agy CLI stdin'));
      }
    }
  });
}

const DEFAULT_AGY_MODELS = [
  { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
  { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
  { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
  { id: 'gemini-4-argon-low', label: 'Gemini 4 Argon (Low)' },
  { id: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (Medium)' },
  { id: 'gemini-4-argon-high', label: 'Gemini 4 Argon (High)' },
  { id: 'gemini-4-neon-low', label: 'Gemini 4 Neon (Low)' },
  { id: 'gemini-4-neon-medium', label: 'Gemini 4 Neon (Medium)' },
  { id: 'gemini-4-neon-high', label: 'Gemini 4 Neon (High)' },
  { id: 'gemini-4-neon-xhigh', label: 'Gemini 4 Neon (XHigh)' },
  { id: 'gemini-4-hydrogen-low', label: 'Gemini 4 Hydrogen (Low)' },
  { id: 'gemini-4-hydrogen-medium', label: 'Gemini 4 Hydrogen (Medium)' },
  { id: 'gemini-4-hydrogen-high', label: 'Gemini 4 Hydrogen (High)' },
  { id: 'gemini-4-hydrogen-xhigh', label: 'Gemini 4 Hydrogen (XHigh)' },
  { id: 'claude-sonnet-5-5-low', label: 'Claude Sonnet 5.5 (Low)' },
  { id: 'claude-sonnet-5-5-medium', label: 'Claude Sonnet 5.5 (Medium)' },
  { id: 'claude-sonnet-5-5-high', label: 'Claude Sonnet 5.5 (High)' },
  { id: 'claude-opus-5-5-low', label: 'Claude Opus 5.5 (Low)' },
  { id: 'claude-opus-5-5-medium', label: 'Claude Opus 5.5 (Medium)' },
  { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 (High)' },
  { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' },
];

function fetchAgyModels(config = {}) {
  return new Promise((resolve) => {
    const agyBin = resolveAgyExecutable(config);
    execFile(
      agyBin,
      ['models'],
      {
        cwd: os.tmpdir(),
        env: getCleanEnv(),
        timeout: 10000,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error || !stdout) {
          return resolve([...DEFAULT_AGY_MODELS]);
        }
        const parsed = [];
        for (const line of String(stdout).split(/\r?\n/)) {
          const tabIdx = line.indexOf('\t');
          if (tabIdx <= 0) continue;
          const id = line.slice(0, tabIdx).trim();
          const label = line.slice(tabIdx + 1).trim();
          if (id && label) {
            parsed.push({ id, label });
          }
        }
        resolve(parsed.length > 0 ? parsed : [...DEFAULT_AGY_MODELS]);
      }
    );
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function invokeAgyCLI(promptText, config, agyConversationId = null, fallbackFullPrompt = null) {
  const agyBin = resolveAgyExecutable(config);
  const model = (config && config.ai && config.ai.agyModel) || 'gemini-3.8-flash-low';

  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const useConvId = attempt === 0 ? agyConversationId : null;
    const textToSend = useConvId ? promptText : (fallbackFullPrompt || promptText);
    try {
      return await invokeAgyOnce(agyBin, model, textToSend, useConvId);
    } catch (err) {
      lastErr = err;
      const msg = String(err && err.message ? err.message : '');
      const isTransientConversationErr =
        /empty conversation id|failed to start conversation/i.test(msg);
      if ((useConvId || isTransientConversationErr) && attempt < 2) {
        await sleep(700);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function invokeGeminiAPI(promptText, config) {
  const apiKey = config && config.ai && config.ai.apiKey;
  if (!apiKey) throw new Error('Gemini API key is not configured.');
  const model = (config && config.ai && config.ai.geminiModel) || 'gemini-2.5-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini API error (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function invokeOpenAIAPI(promptText, config) {
  const apiKey = config && config.ai && config.ai.apiKey;
  if (!apiKey) throw new Error('OpenAI API key is not configured.');
  const model = (config && config.ai && config.ai.openaiModel) || 'gpt-4o-mini';

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Return only valid JSON matching the requested schema.' },
        { role: 'user', content: promptText },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI API error (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

async function parseWithAI(
  input,
  indexData,
  config,
  conversationHistory = [],
  agyConversationId = null
) {
  const cleanInput = String(input || '')
    .replace(/^(?:\?\s*|ai:\s*)/i, '')
    .trim();
  if (!cleanInput) {
    throw new Error('Please enter a prompt before asking AI.');
  }

  const aiCfg = (config && config.ai) || {};
  const provider = aiCfg.provider || 'agy';
  const researchInfo = extractResearchQuery(cleanInput);
  const matchedProjects = findRelevantProjectsForPrompt(cleanInput, indexData);
  const strippedWake = cleanInput
    .replace(/^(?:(?:hi|hey|hello)\s+)?(?:pulse|jarvis)[,\s]+/i, '')
    .trim();
  const isLocationQuestion = /\b(?:where|check\s+where|forgot|location|path|located|which\s+folder|which\s+directory)\b/i.test(
    strippedWake
  );
  const isQuestion = isConversationalQuestion(strippedWake) || isLocationQuestion;
  const isPlaylistRequest =
    /\b(?:playlist|queue)\b/i.test(strippedWake) ||
    (/\b(?:youtube|yt)\b/i.test(strippedWake) &&
      /\b(?:for\s+it|for\s+them|those|these|songs?|tracks?|recommendations?)\b/i.test(
        strippedWake
      ));
  const isRecommendationPrompt = /\b(?:recommend|suggest|similar\s+to|same\s+vibe)\b/i.test(
    strippedWake
  );

  let rawResponseText = '';
  let nextConversationId = agyConversationId || null;

  try {
    if (provider === 'gemini') {
      const fullPrompt = buildAICatalogPrompt(
        cleanInput,
        indexData,
        config,
        conversationHistory,
        researchInfo
      );
      rawResponseText = await invokeGeminiAPI(fullPrompt, config);
    } else if (provider === 'openai') {
      const fullPrompt = buildAICatalogPrompt(
        cleanInput,
        indexData,
        config,
        conversationHistory,
        researchInfo
      );
      rawResponseText = await invokeOpenAIAPI(fullPrompt, config);
    } else {
      const fullPrompt = buildAICatalogPrompt(
        cleanInput,
        indexData,
        config,
        conversationHistory,
        researchInfo
      );
      const promptToSend = agyConversationId
        ? buildAgyFollowUpPrompt(cleanInput, indexData, researchInfo, conversationHistory)
        : fullPrompt;
      const agyOut = await invokeAgyCLI(promptToSend, config, agyConversationId, fullPrompt);
      rawResponseText = agyOut.response;
      nextConversationId = agyOut.conversationId || nextConversationId;
    }
  } catch (err) {
    if (matchedProjects.length > 0 && isLocationQuestion) {
      const top = matchedProjects[0];
      const subNames = (top.subServices || []).map((s) => s.name);
      const subInfo = subNames.length > 0 ? ` (sub-services: ${subNames.join(', ')})` : '';
      const otherPaths = matchedProjects
        .slice(1, 4)
        .map((p) => `${p.name}: ${p.path}`)
        .join('; ');
      const extraInfo = otherPaths ? ` Related folders: ${otherPaths}.` : '';
      const fallbackReply = `Your ${top.name} project is located at ${top.path}${subInfo}.${extraInfo}`;
      const fallbackActions = buildProjectLocationActions(top, config);

      return {
        isEmpty: false,
        input,
        fromAI: true,
        fromLocalFallback: true,
        provider,
        agyConversationId: nextConversationId,
        reply: fallbackReply,
        explanation: fallbackReply,
        isConversational: true,
        shouldAutoExecute: false,
        isResearch: false,
        suggestedUrl: null,
        isChained: false,
        actions: fallbackActions,
        primaryAction: fallbackActions[0] || null,
        results: fallbackActions.map((a, idx) => ({ ...a, stepIndex: idx + 1, isPrimary: idx === 0 })),
        confidence: 95,
        suggestAI: false,
        forceAI: false,
      };
    }
    throw err;
  }

  let parsed;
  try {
    parsed = extractJsonObject(rawResponseText);
  } catch (err) {
    parsed = {
      reply: String(rawResponseText || '').trim(),
      actions: [],
    };
  }

  let actions = hydrateAIActions(parsed.actions, indexData, config);
  let reply = String(parsed.reply || parsed.explanation || '').trim();

  if (isLocationQuestion && matchedProjects.length > 0 && actions.length === 0) {
    actions = buildProjectLocationActions(matchedProjects[0], config);
  }

  const rawActionsList = Array.isArray(parsed.actions) ? parsed.actions : [];
  const rawPlaylistAction = rawActionsList.find(
    (item) =>
      item &&
      (String(item.type || '').toUpperCase() === 'YOUTUBE_PLAYLIST' ||
        (Array.isArray(item.tracks) && item.tracks.length > 0))
  );

  let playlistTracks = [];
  if (rawPlaylistAction && Array.isArray(rawPlaylistAction.tracks) && rawPlaylistAction.tracks.length > 0) {
    playlistTracks = rawPlaylistAction.tracks.map((t) => String(t || '').trim()).filter(Boolean);
  } else {
    playlistTracks = extractTracksFromText(reply);
    if (playlistTracks.length === 0 && isPlaylistRequest) {
      playlistTracks = extractTracksFromHistory(conversationHistory);
    }
  }

  if (
    rawPlaylistAction ||
    (isPlaylistRequest && playlistTracks.length > 0) ||
    (isRecommendationPrompt && playlistTracks.length >= 2)
  ) {
    const ytActions = await buildYoutubePlaylistActions(
      playlistTracks,
      (rawPlaylistAction && rawPlaylistAction.title) || 'Play YouTube Queue',
      (rawPlaylistAction && rawPlaylistAction.browser) || 'default'
    );
    if (ytActions.length > 0) {
      if (isPlaylistRequest || rawPlaylistAction) {
        const nonYtActions = actions.filter(
          (a) =>
            !(
              a.type === 'OPEN_URL' &&
              (!a.url || /youtube\.com\/results|youtube\.com\/playlist/i.test(a.url))
            )
        );
        actions = [...ytActions, ...nonYtActions];
      } else {
        actions = [...actions, ...ytActions];
      }

      if (
        isPlaylistRequest &&
        (!reply || /\b(?:cannot|can't|unable|not\s+able|don't\s+have)\b/i.test(reply))
      ) {
        reply = `Yes — I generated a playable YouTube queue for all ${playlistTracks.length} tracks (${playlistTracks.join(', ')}). Click Play YouTube Queue below to launch it in your browser.`;
      }
    }
  }

  if (actions.length === 0 && !reply) {
    throw new Error('AI returned an empty response.');
  }

  return {
    isEmpty: false,
    input,
    fromAI: true,
    provider,
    agyConversationId: nextConversationId,
    reply: reply || buildOfflineReply(actions),
    explanation: reply || parsed.explanation || 'AI execution plan',
    isConversational: actions.length === 0,
    shouldAutoExecute: !isQuestion && !isRecommendationPrompt && actions.length > 0,
    isResearch: Boolean(researchInfo),
    suggestedUrl: researchInfo
      ? { title: 'Open on Google', url: researchInfo.googleSearchUrl }
      : null,
    isChained: actions.length > 1,
    actions,
    primaryAction: actions[0] || null,
    results: actions.map((a, idx) => ({ ...a, stepIndex: idx + 1, isPrimary: idx === 0 })),
    confidence: 95,
    suggestAI: false,
    forceAI: false,
  };
}

module.exports = {
  DEFAULT_AGY_MODELS,
  fetchAgyModels,
  parsePrompt,
  parseWithAI,
  extractResearchQuery,
  extractTracksFromText,
  buildYoutubePlaylistActions,
  splitCompoundPrompt,
  detectDevCommand,
  extractJsonObject,
  resolveAgyExecutable,
};
