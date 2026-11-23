const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadConfig, saveRoutine, deleteRoutine } = require('../src/core/config');
const { scanProjects } = require('../src/core/indexer');
const {
  DEFAULT_AGY_MODELS,
  fetchAgyModels,
  parsePrompt,
  parseWithAI,
  extractTracksFromText,
  buildYoutubePlaylistActions,
} = require('../src/core/parser');
const { resolveVSCodeExe, resolveAntigravityExe } = require('../src/core/executor');
const taskManager = require('../src/core/task-manager');
const {
  enableStartup,
  getStartupStatus,
  VBS_PATH,
} = require('../src/core/startup');

async function runTests() {
  console.log('--- Pulse Verification Suite ---');

  // 0. Electron binary check
  const electronExe = path.resolve(
    __dirname,
    '..',
    'node_modules',
    'electron',
    'dist',
    'electron.exe'
  );
  assert.ok(fs.existsSync(electronExe), `Expected Electron binary at ${electronExe}`);
  console.log('[PASS] Electron binary exists:', electronExe);

  // 1. Load config & scan projects
  const config = loadConfig();
  const indexData = scanProjects(config);
  assert.ok(indexData.count > 0, 'Expected indexed projects > 0');

  const qola = indexData.projects.find((p) => p.name.toLowerCase() === 'qola');
  assert.ok(qola, 'Expected qola project to be indexed');
  assert.strictEqual(
    qola.path.toLowerCase(),
    'd:\\program\\learning\\abhipraya-work-project\\qola'
  );
  const qolaSubNames = (qola.subServices || []).map((s) => s.name);
  assert.ok(
    qolaSubNames.includes('dashboard-v2-media-intelligence'),
    `Expected qola sub-services to include dashboard-v2-media-intelligence, got: ${qolaSubNames.join(', ')}`
  );
  assert.ok(
    qolaSubNames.includes('service-media-intelligence'),
    'Expected qola sub-services to include service-media-intelligence'
  );
  assert.ok(
    qolaSubNames.includes('ai-media-intelligence'),
    'Expected qola sub-services to include ai-media-intelligence'
  );
  console.log(`[PASS] Indexed ${indexData.count} projects; qola found with ${qolaSubNames.length} sub-services.`);

  // 2. Root-first rule for "open vscode from qola project"
  const p1 = parsePrompt('open vscode from qola project', indexData, config);
  assert.ok(p1.primaryAction, 'Expected primaryAction for qola prompt');
  assert.strictEqual(p1.primaryAction.type, 'OPEN_PROJECT_EDITOR');
  assert.strictEqual(p1.primaryAction.editor, 'code');
  assert.strictEqual(
    p1.primaryAction.path.toLowerCase(),
    'd:\\program\\learning\\abhipraya-work-project\\qola'
  );
  console.log('[PASS] "open vscode from qola project" -> root qola in VS Code');

  // 3. Explicit sub-service targeting: "open qola dashboard v2 in vscode"
  const p2 = parsePrompt('open qola dashboard v2 in vscode', indexData, config);
  assert.ok(p2.primaryAction, 'Expected primaryAction for qola dashboard v2');
  assert.strictEqual(p2.primaryAction.type, 'OPEN_PROJECT_EDITOR');
  assert.strictEqual(
    p2.primaryAction.path.toLowerCase(),
    'd:\\program\\learning\\abhipraya-work-project\\qola\\dashboard-v2-media-intelligence'
  );
  console.log('[PASS] "open qola dashboard v2 in vscode" -> dashboard-v2-media-intelligence');

  // 4. Shared-project multi-service split: "open finfy fe and be in vscode"
  const p3 = parsePrompt('open finfy fe and be in vscode', indexData, config);
  assert.strictEqual(p3.actions.length, 2, `Expected 2 actions for finfy fe and be, got ${p3.actions.length}`);
  assert.strictEqual(p3.actions[0].type, 'OPEN_PROJECT_EDITOR');
  assert.strictEqual(p3.actions[1].type, 'OPEN_PROJECT_EDITOR');
  assert.strictEqual(p3.actions[0].path.toLowerCase(), 'd:\\program\\project\\finfy\\finfy_fe');
  assert.strictEqual(p3.actions[1].path.toLowerCase(), 'd:\\program\\project\\finfy\\finfy_be');
  console.log('[PASS] "open finfy fe and be in vscode" -> 2 actions (finfy_fe + finfy_be)');

  // 5. Chained multi-command with context carryover + explicit chrome browser
  const p4 = parsePrompt(
    'open vscode from qola project and run docker compose up and open localhost:3000 in chrome',
    indexData,
    config
  );
  assert.strictEqual(p4.actions.length, 3, `Expected 3 chained actions, got ${p4.actions.length}`);
  assert.strictEqual(p4.actions[0].type, 'OPEN_PROJECT_EDITOR');
  assert.strictEqual(
    p4.actions[0].path.toLowerCase(),
    'd:\\program\\learning\\abhipraya-work-project\\qola'
  );
  assert.strictEqual(p4.actions[1].type, 'RUN_PROJECT_COMMAND');
  assert.strictEqual(
    p4.actions[1].path.toLowerCase(),
    'd:\\program\\learning\\abhipraya-work-project\\qola'
  );
  assert.strictEqual(p4.actions[1].command, 'docker compose up');
  assert.strictEqual(p4.actions[2].type, 'OPEN_URL');
  assert.strictEqual(p4.actions[2].url, 'http://localhost:3000');
  assert.strictEqual(p4.actions[2].browser, 'chrome');
  console.log('[PASS] Chained 3-step prompt (VS Code + docker compose up + Chrome localhost:3000)');

  // 6. Default browser test
  const p5 = parsePrompt('open localhost:3000', indexData, config);
  assert.ok(p5.primaryAction, 'Expected action for open localhost:3000');
  assert.strictEqual(p5.primaryAction.type, 'OPEN_URL');
  assert.strictEqual(p5.primaryAction.url, 'http://localhost:3000');
  assert.strictEqual(p5.primaryAction.browser, 'default');
  console.log('[PASS] "open localhost:3000" -> default browser');

  // 7. Folder, Terminal, App, and Site intents
  const pFolder = parsePrompt('open qola folder', indexData, config);
  assert.strictEqual(pFolder.primaryAction.type, 'OPEN_FOLDER');
  assert.strictEqual(
    pFolder.primaryAction.path.toLowerCase(),
    'd:\\program\\learning\\abhipraya-work-project\\qola'
  );

  const pTerm = parsePrompt('open terminal in finfy', indexData, config);
  assert.strictEqual(pTerm.primaryAction.type, 'OPEN_TERMINAL');
  assert.strictEqual(pTerm.primaryAction.path.toLowerCase(), 'd:\\program\\project\\finfy');

  const pApp = parsePrompt('open chrome', indexData, config);
  assert.strictEqual(pApp.primaryAction.type, 'LAUNCH_APP');

  const pSite = parsePrompt('open github', indexData, config);
  assert.strictEqual(pSite.primaryAction.type, 'OPEN_URL');
  assert.strictEqual(pSite.primaryAction.url, 'https://github.com');
  console.log('[PASS] Folder, Terminal, Desktop App, and Site intents resolved accurately.');

  // 7b. Antigravity (agy) App & Project Editor intents
  const expectedAgyExe = path.join(
    os.homedir(),
    'AppData',
    'Local',
    'Programs',
    'antigravity',
    'Antigravity.exe'
  );
  const expectedVscodeExe = path.join(
    os.homedir(),
    'AppData',
    'Local',
    'Programs',
    'Microsoft VS Code',
    'Code.exe'
  );
  assert.strictEqual(resolveVSCodeExe(config), expectedVscodeExe);
  assert.ok(fs.existsSync(resolveVSCodeExe(config)), 'Expected Code.exe to exist');
  assert.strictEqual(resolveAntigravityExe(config), expectedAgyExe);
  assert.ok(fs.existsSync(resolveAntigravityExe(config)), 'Expected Antigravity.exe to exist');

  const pVscodeApp = parsePrompt('open vscode', indexData, config);
  assert.strictEqual(pVscodeApp.primaryAction.type, 'LAUNCH_APP');
  assert.strictEqual(pVscodeApp.primaryAction.command, expectedVscodeExe);
  console.log('[PASS] "open vscode" -> Code.exe & both editor binaries verified on disk.');

  const pAgyApp1 = parsePrompt('open agy', indexData, config);
  assert.strictEqual(pAgyApp1.primaryAction.type, 'LAUNCH_APP');
  assert.strictEqual(pAgyApp1.primaryAction.command, expectedAgyExe);

  const pAgyApp2 = parsePrompt('open antigravity', indexData, config);
  assert.strictEqual(pAgyApp2.primaryAction.type, 'LAUNCH_APP');
  assert.strictEqual(pAgyApp2.primaryAction.command, expectedAgyExe);

  const pAgyQola1 = parsePrompt('open agy from qola project', indexData, config);
  assert.strictEqual(pAgyQola1.primaryAction.type, 'OPEN_PROJECT_EDITOR');
  assert.strictEqual(pAgyQola1.primaryAction.editor, 'antigravity');
  assert.strictEqual(
    pAgyQola1.primaryAction.path.toLowerCase(),
    'd:\\program\\learning\\abhipraya-work-project\\qola'
  );

  const pAgyQola2 = parsePrompt('open antigravity from qola project', indexData, config);
  assert.strictEqual(pAgyQola2.primaryAction.type, 'OPEN_PROJECT_EDITOR');
  assert.strictEqual(pAgyQola2.primaryAction.editor, 'antigravity');
  assert.strictEqual(
    pAgyQola2.primaryAction.path.toLowerCase(),
    'd:\\program\\learning\\abhipraya-work-project\\qola'
  );

  const pBareQola = parsePrompt('qola', indexData, config);
  assert.ok(
    pBareQola.results.some((r) => r.type === 'OPEN_PROJECT_EDITOR' && r.editor === 'code'),
    'Expected bare project prompt to offer VS Code option'
  );
  assert.ok(
    pBareQola.results.some((r) => r.type === 'OPEN_PROJECT_EDITOR' && r.editor === 'antigravity'),
    'Expected bare project prompt to offer Antigravity option'
  );

  const pSettings = parsePrompt('settings', indexData, config);
  assert.strictEqual(pSettings.primaryAction.type, 'OPEN_SETTINGS');
  console.log('[PASS] Antigravity (agy), dual-editor bare project, and settings intents verified.');

  // 7c. Zero emoji / emoticon UI verification
  const uiFiles = [
    path.resolve(__dirname, '..', 'src', 'renderer', 'index.html'),
    path.resolve(__dirname, '..', 'src', 'renderer', 'styles.css'),
    path.resolve(__dirname, '..', 'src', 'renderer', 'app.js'),
  ];
  const emojiRegex = /[\u{1F300}-\u{1FAFF}\u2600-\u27BF\u21B5\u2B50\u2728]/u;
  for (const filePath of uiFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(!emojiRegex.test(content), `Unexpected emoji/symbol found in ${filePath}`);
  }
  console.log('[PASS] Zero emojis/emoticons in renderer UI files.');

  // 7d. Installed Windows Apps (Krita) & Meridian multi-service + Conversational guard
  assert.ok(Array.isArray(indexData.apps) && indexData.appCount > 15, 'Expected installed Windows apps to be scanned');
  const kritaApp = indexData.apps.find((a) => a.cleanName.toLowerCase() === 'krita');
  assert.ok(kritaApp, 'Expected Krita to be discovered in Start Menu apps');

  const pKrita = parsePrompt('open krita', indexData, config);
  assert.ok(pKrita.primaryAction, 'Expected primaryAction for open krita');
  assert.strictEqual(pKrita.primaryAction.type, 'LAUNCH_APP');
  assert.strictEqual(
    pKrita.primaryAction.command.toLowerCase(),
    'c:\\programdata\\microsoft\\windows\\start menu\\programs\\krita\\krita (x64).lnk'
  );
  console.log('[PASS] "open krita" -> Launch Krita (.lnk shortcut)');

  const pMeridianBoth = parsePrompt('run meridian both be and fe', indexData, config);
  assert.strictEqual(
    pMeridianBoth.actions.length,
    2,
    `Expected 2 actions for meridian both be and fe, got ${pMeridianBoth.actions.length}`
  );
  assert.strictEqual(
    pMeridianBoth.actions[0].path.toLowerCase(),
    'd:\\program\\project\\saas\\meridian\\meridian_be'
  );
  assert.strictEqual(
    pMeridianBoth.actions[1].path.toLowerCase(),
    'd:\\program\\project\\saas\\meridian\\meridian_fe'
  );
  console.log('[PASS] "run meridian both be and fe" -> meridian_be + meridian_fe');

  const pHi = parsePrompt('hi', indexData, config);
  assert.strictEqual(pHi.isConversational, true);
  assert.strictEqual(pHi.isInstantReply, true);
  assert.strictEqual(pHi.actions.length, 0);
  assert.ok(pHi.reply && pHi.reply.length > 10, 'Expected Jarvis reply for "hi"');

  const pQuestion = parsePrompt('what projects should I work on?', indexData, config);
  assert.strictEqual(pQuestion.isConversational, true);
  assert.strictEqual(pQuestion.actions.length, 0);
  assert.strictEqual(pQuestion.forceAI, true);

  const pOpenGoogle = parsePrompt('open google', indexData, config);
  assert.ok(pOpenGoogle.primaryAction, 'Expected primaryAction for open google');
  assert.strictEqual(pOpenGoogle.primaryAction.type, 'OPEN_URL');
  assert.strictEqual(pOpenGoogle.primaryAction.url, 'https://google.com');

  const pResearch = parsePrompt('research clean architecture on google', indexData, config);
  assert.strictEqual(pResearch.isConversational, true);
  assert.strictEqual(pResearch.isResearch, true);
  assert.ok(
    pResearch.googleSearchUrl && pResearch.googleSearchUrl.includes('clean%20architecture'),
    `Expected googleSearchUrl to contain clean%20architecture, got ${pResearch.googleSearchUrl}`
  );
  assert.ok(
    pResearch.results.some((r) => r.type === 'OPEN_URL' && r.url === pResearch.googleSearchUrl),
    'Expected optional Open Google Search result row'
  );
  console.log('[PASS] Conversational inputs ("hi", "what projects...", "open google", "research clean architecture on google") verified.');

  // 8. Saved Routines round-trip in isolated temp config
  const tmpCfgPath = path.join(os.tmpdir(), `pulse-test-${Date.now()}.json`);
  const { routine, config: cfgWithRoutine } = saveRoutine(
    'qola stack',
    'open vscode from qola project and run docker compose up',
    'Qola Stack',
    tmpCfgPath
  );
  const pRoutine = parsePrompt('qola stack', indexData, cfgWithRoutine);
  assert.ok(pRoutine.matchedRoutine, 'Expected matchedRoutine for saved routine trigger');
  assert.strictEqual(pRoutine.actions.length, 2);
  const cfgAfterDel = deleteRoutine(routine.id, tmpCfgPath);
  assert.ok(!cfgAfterDel.customRoutines.some((r) => r.id === routine.id));
  if (fs.existsSync(tmpCfgPath)) fs.unlinkSync(tmpCfgPath);
  console.log('[PASS] Saved Routine creation, expansion, and deletion verified.');

  // 9. Windows Startup Registration
  const startupStatus = enableStartup();
  assert.strictEqual(startupStatus.enabled, true, 'Expected Windows startup to be enabled');
  assert.strictEqual(startupStatus.matchesCurrentPath, true, 'Expected registry entry to point to current VBS');
  assert.ok(fs.existsSync(VBS_PATH), `Expected VBS script at ${VBS_PATH}`);
  const queried = getStartupStatus();
  assert.strictEqual(queried.enabled, true);
  console.log('[PASS] Windows Startup registry entry verified:', queried.command);

  // 10. Built-in AGY AI test (action + conversational)
  console.log('Testing built-in AGY AI parser (agy.exe)...');
  const aiResult = await parseWithAI(
    'launch the qola project in my editor and open localhost 5173',
    indexData,
    config
  );
  assert.strictEqual(aiResult.fromAI, true);
  assert.ok(aiResult.reply && aiResult.reply.length > 0, 'Expected AI conversational reply');
  assert.ok(aiResult.actions.length >= 2, `Expected >=2 AI actions, got ${aiResult.actions.length}`);
  assert.ok(
    aiResult.actions.some(
      (a) =>
        a.type === 'OPEN_PROJECT_EDITOR' &&
        a.path.toLowerCase().includes('qola')
    ),
    'Expected AI result to include OPEN_PROJECT_EDITOR for qola'
  );
  assert.ok(
    aiResult.actions.some((a) => a.type === 'OPEN_URL' && a.url.includes('5173')),
    'Expected AI result to include OPEN_URL for localhost:5173'
  );
  console.log('[PASS] Built-in AGY AI action plan verified:', aiResult.actions.map((a) => a.type).join(' + '));

  const aiChat = await parseWithAI(
    'what projects should I work on today? give a brief recommendation.',
    indexData,
    config
  );
  assert.strictEqual(aiChat.fromAI, true);
  assert.strictEqual(aiChat.isConversational, true);
  assert.strictEqual(aiChat.actions.length, 0);
  assert.ok(aiChat.agyConversationId, 'Expected agyConversationId from Turn 1');
  assert.ok(aiChat.reply && aiChat.reply.length > 10, 'Expected conversational Jarvis reply from AGY AI');
  console.log('[PASS] Built-in AGY AI conversational Turn 1 verified:', aiChat.reply);

  const aiTurn2 = await parseWithAI(
    'summarize that first recommendation in one short sentence.',
    indexData,
    config,
    [
      { role: 'user', text: 'what projects should I work on today? give a brief recommendation.' },
      { role: 'assistant', text: aiChat.reply },
    ],
    aiChat.agyConversationId
  );
  assert.strictEqual(aiTurn2.fromAI, true);
  assert.strictEqual(aiTurn2.agyConversationId, aiChat.agyConversationId, 'Expected Turn 2 to reuse same agyConversationId');
  assert.ok(aiTurn2.reply && aiTurn2.reply.length > 10, 'Expected follow-up reply from AGY AI Turn 2');
  console.log('[PASS] Built-in AGY AI multi-turn (--conversation) Turn 2 verified:', aiTurn2.reply);

  const finfyLookup = await parseWithAI(
    'Pulse i need you to check where do i put a project called finfy for my thesis (i forgot since its been a long time)',
    indexData,
    config,
    [],
    aiChat.agyConversationId
  );
  assert.strictEqual(finfyLookup.fromAI, true);
  assert.ok(
    finfyLookup.reply && finfyLookup.reply.toLowerCase().includes('finfy'),
    `Expected finfy in reply, got: ${finfyLookup.reply}`
  );
  assert.ok(
    finfyLookup.reply.toLowerCase().includes('d:\\program\\project\\finfy'),
    `Expected D:\\program\\project\\finfy path in reply, got: ${finfyLookup.reply}`
  );
  assert.strictEqual(finfyLookup.shouldAutoExecute, false);
  assert.ok(
    Array.isArray(finfyLookup.actions) && finfyLookup.actions.length > 0,
    'Expected quick-open actions on finfy location lookup reply'
  );
  console.log('[PASS] Built-in AGY AI project location lookup (finfy) verified:', finfyLookup.reply);

  // 10b. Automated YouTube playlist & queue generator
  const sampleNeverMeantReply = [
    "If you love the twinkly open-tuned guitars, nostalgic melancholy, and intricate rhythms of 'Never Meant', here are a few standout recommendations with that same Midwest emo and math-rock vibe:",
    '',
    "1. TTNG (This Town Needs Guns) – 'Baboon' or 'Chinchilla'",
    "2. Owen – 'Bad News' (Mike Kinsella's solo project)",
    "3. Mineral – 'Gloria'",
    "4. Marietta – 'Cinco De Mayo Shit Show'",
    "5. Tiny Moving Parts – 'Always Focused'",
    "6. The Hotelier – 'Your Deep Rest'",
  ].join('\n');

  const extractedTracks = extractTracksFromText(sampleNeverMeantReply);
  assert.deepStrictEqual(extractedTracks, [
    'TTNG - Baboon',
    'Owen - Bad News',
    'Mineral - Gloria',
    'Marietta - Cinco De Mayo Shit Show',
    'Tiny Moving Parts - Always Focused',
    'The Hotelier - Your Deep Rest',
  ]);
  console.log('[PASS] extractTracksFromText extracted all 6 Midwest emo tracks cleanly.');

  const directYtActions = await buildYoutubePlaylistActions(extractedTracks, 'Play YouTube Queue');
  assert.ok(directYtActions.length >= 2, 'Expected queue + track actions from buildYoutubePlaylistActions');
  assert.ok(
    directYtActions[0].url.startsWith('https://www.youtube.com/watch_videos?video_ids='),
    `Expected watch_videos queue URL, got: ${directYtActions[0].url}`
  );
  assert.ok(
    directYtActions[0].videoIds.length >= 4,
    `Expected >=4 resolved YouTube video IDs, got ${directYtActions[0].videoIds.length}`
  );
  console.log('[PASS] buildYoutubePlaylistActions resolved live YouTube queue:', directYtActions[0].url);

  const ytPlaylistRes = await parseWithAI(
    'is it possible for u to make me a playlist or queue on youtube for it?',
    indexData,
    config,
    [
      { role: 'user', text: 'recommend me a music with the same vibe as never meant by american football' },
      { role: 'assistant', text: sampleNeverMeantReply },
    ]
  );
  assert.strictEqual(ytPlaylistRes.fromAI, true);
  assert.strictEqual(ytPlaylistRes.shouldAutoExecute, false);
  assert.ok(
    Array.isArray(ytPlaylistRes.actions) && ytPlaylistRes.actions.length >= 2,
    `Expected >=2 playlist/track actions from parseWithAI, got ${ytPlaylistRes.actions && ytPlaylistRes.actions.length}`
  );
  assert.ok(
    ytPlaylistRes.actions[0].url.startsWith('https://www.youtube.com/watch_videos?video_ids='),
    `Expected parseWithAI first action to be YouTube watch_videos queue, got: ${ytPlaylistRes.actions[0].url}`
  );
  assert.ok(
    ytPlaylistRes.actions[0].videoIds.length >= 4,
    `Expected >=4 video IDs in parseWithAI queue, got ${ytPlaylistRes.actions[0].videoIds.length}`
  );
  console.log('[PASS] AI follow-up YouTube playlist/queue request verified:', ytPlaylistRes.actions[0].url);

  // 11. AGY models discovery check
  assert.ok(
    Array.isArray(DEFAULT_AGY_MODELS) &&
      DEFAULT_AGY_MODELS.some((m) => m.id === 'gemini-3.8-flash-low'),
    'Expected DEFAULT_AGY_MODELS to include gemini-3.8-flash-low'
  );
  const fetchedModels = await fetchAgyModels(config);
  assert.ok(
    Array.isArray(fetchedModels) &&
      fetchedModels.length >= 10 &&
      fetchedModels.some((m) => m.id === 'gemini-3.8-flash-low'),
    `Expected fetchAgyModels to return valid agy models, got ${fetchedModels.length}`
  );
  console.log(`[PASS] fetchAgyModels verified (${fetchedModels.length} models including gemini-3.8-flash-low).`);

  // 12. Qola multi-service run + SSH tunnel config parsing + Tasks command
  const pQolaRun = parsePrompt(
    'run qola both the dashboard-v2 and the service and also run the  tunnel config should be on ssh tunnel called txt with password example_ssh_pass',
    indexData,
    config
  );
  assert.strictEqual(
    pQolaRun.actions.length,
    3,
    `Expected 3 actions for qola + ssh tunnel prompt, got ${pQolaRun.actions.length}`
  );
  assert.strictEqual(pQolaRun.actions[0].type, 'RUN_PROJECT_COMMAND');
  assert.strictEqual(
    pQolaRun.actions[0].path.toLowerCase(),
    'd:\\program\\learning\\abhipraya-work-project\\qola\\dashboard-v2-media-intelligence'
  );
  assert.strictEqual(pQolaRun.actions[0].command, 'npm.cmd run dev');
  assert.strictEqual(pQolaRun.actions[1].type, 'RUN_PROJECT_COMMAND');
  assert.strictEqual(
    pQolaRun.actions[1].path.toLowerCase(),
    'd:\\program\\learning\\abhipraya-work-project\\qola\\service-media-intelligence'
  );
  assert.strictEqual(pQolaRun.actions[1].command, 'npm.cmd run start:dev');
  assert.strictEqual(pQolaRun.actions[2].type, 'RUN_PROJECT_COMMAND');
  assert.strictEqual(pQolaRun.actions[2].isTunnel, true);
  assert.ok(
    pQolaRun.actions[2].command.includes('ssh -N -L 19092:localhost:19092'),
    `Expected ssh tunnel command, got ${pQolaRun.actions[2].command}`
  );
  assert.strictEqual(pQolaRun.actions[2].sshPassword, 'example_ssh_pass');
  console.log('[PASS] Qola dashboard-v2 + service + SSH tunnel (ssh tunnel.txt) parsed cleanly into 3 tasks.');

  const pTasks = parsePrompt('tasks', indexData, config);
  assert.strictEqual(pTasks.primaryAction.type, 'OPEN_TASKS');
  console.log('[PASS] "tasks" command -> OPEN_TASKS.');

  // 13. TaskManager start, live stdout log capture, rerun, and stop
  const testTask = taskManager.startTask({
    name: 'Verify Log Task',
    command: 'node -e "console.log(\'PULSE_TASK_READY:31337\'); setInterval(() => {}, 1000);"',
    cwd: path.resolve(__dirname, '..'),
  });
  await new Promise((r) => setTimeout(r, 800));
  let tasksNow = taskManager.getTasks();
  let current = tasksNow.find((t) => t.id === testTask.id);
  assert.ok(current, 'Expected started task to be registered');
  assert.strictEqual(current.status, 'running');
  assert.ok(
    current.logs.some((l) => l.includes('PULSE_TASK_READY:31337')),
    `Expected live stdout log to contain PULSE_TASK_READY:31337, got: ${current.logs.join(' | ')}`
  );

  const rerun = taskManager.rerunTask(testTask.id);
  assert.strictEqual(rerun.status, 'running');
  await new Promise((r) => setTimeout(r, 600));
  const stopped = taskManager.stopTask(testTask.id);
  assert.strictEqual(stopped.status, 'stopped');
  taskManager.removeTask(testTask.id);
  console.log('[PASS] TaskManager start, live log capture, rerun, and stop verified.');

  console.log('--- ALL VERIFICATION CHECKS PASSED ---');
}

runTests().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
