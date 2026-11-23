const state = {
  config: null,
  startupStatus: { enabled: false },
  projectCount: 0,
  appCount: 0,
  greeting: 'Hello',
  isExpanded: false,
  isSettingsOpen: false,
  isAskingAI: false,
  lastParseResult: null,
  selectableItems: [],
  selectedIndex: 0,
  hasManualSelection: false,
  conversationHistory: [],
  chatMessages: [],
  agyModels: [],
  isModelMenuOpen: false,
  tasks: [],
  selectedTaskId: null,
  isTasksOpen: false,
};

const backdrop = document.getElementById('backdrop');
const assistantMessage = document.getElementById('assistant-message');
const promptInput = document.getElementById('prompt-input');
const tasksBtn = document.getElementById('tasks-btn');
const tasksBtnDot = document.getElementById('tasks-btn-dot');
const tasksBtnLabel = document.getElementById('tasks-btn-label');
const modelSelectorBtn = document.getElementById('model-selector-btn');
const modelSelectorLabel = document.getElementById('model-selector-label');
const modelMenu = document.getElementById('model-menu');
const modelMenuList = document.getElementById('model-menu-list');
const resultsPanel = document.getElementById('results-panel');
const resultsList = document.getElementById('results-list');

const chatPanel = document.getElementById('chat-panel');
const chatStatus = document.getElementById('chat-status');
const clearChatBtn = document.getElementById('clear-chat-btn');
const chatThread = document.getElementById('chat-thread');

const tasksPanel = document.getElementById('tasks-panel');
const tasksSummary = document.getElementById('tasks-summary');
const refreshTasksBtn = document.getElementById('refresh-tasks-btn');
const closeTasksBtn = document.getElementById('close-tasks-btn');
const tasksList = document.getElementById('tasks-list');
const taskLogViewer = document.getElementById('task-log-viewer');
const taskLogTitle = document.getElementById('task-log-title');
const refreshLogBtn = document.getElementById('refresh-log-btn');
const rerunLogTaskBtn = document.getElementById('rerun-log-task-btn');
const taskLogOutput = document.getElementById('task-log-output');

const settingsPanel = document.getElementById('settings-panel');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const settingStartup = document.getElementById('setting-startup');
const settingAutohide = document.getElementById('setting-autohide');
const settingAiProvider = document.getElementById('setting-ai-provider');
const agyModelRow = document.getElementById('agy-model-row');
const settingAgyModel = document.getElementById('setting-agy-model');
const apiKeyRow = document.getElementById('api-key-row');
const settingApiKey = document.getElementById('setting-api-key');
const settingRoots = document.getElementById('setting-roots');
const rescanBtn = document.getElementById('rescan-btn');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const settingsFeedback = document.getElementById('settings-feedback');

function getActiveAgyModelId() {
  return (state.config && state.config.ai && state.config.ai.agyModel) || 'gemini-3.8-flash-low';
}

function getModelDisplayLabel(modelId) {
  const found = (state.agyModels || []).find((m) => m.id === modelId);
  return found ? found.label : modelId;
}

function populateModelUI() {
  const activeId = getActiveAgyModelId();
  const provider = (state.config && state.config.ai && state.config.ai.provider) || 'agy';
  modelSelectorBtn.classList.toggle('hidden', provider !== 'agy');
  modelSelectorLabel.textContent = getModelDisplayLabel(activeId);

  modelMenuList.innerHTML = '';
  settingAgyModel.innerHTML = '';

  const models =
    state.agyModels && state.agyModels.length > 0
      ? state.agyModels
      : [{ id: activeId, label: activeId }];

  models.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    settingAgyModel.appendChild(opt);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `model-option${m.id === activeId ? ' active' : ''}`;

    const labelSpan = document.createElement('span');
    labelSpan.className = 'model-option-label';
    labelSpan.textContent = m.label;

    const idSpan = document.createElement('span');
    idSpan.className = 'model-option-id';
    idSpan.textContent = m.id;

    btn.appendChild(labelSpan);
    btn.appendChild(idSpan);
    btn.addEventListener('click', async () => {
      const res = await window.pulseAPI.setAgyModel(m.id);
      if (res && res.config) {
        state.config = res.config;
      }
      populateModelUI();
      closeModelMenu(true);
    });
    modelMenuList.appendChild(btn);
  });

  settingAgyModel.value = activeId;
}

function openModelMenu() {
  state.isModelMenuOpen = true;
  if (state.isSettingsOpen) {
    closeSettings(false);
  }
  resultsPanel.classList.add('hidden');
  chatPanel.classList.add('hidden');
  modelMenu.classList.remove('hidden');
  populateModelUI();

  window.pulseAPI.getAgyModels().then((models) => {
    if (Array.isArray(models) && models.length > 0) {
      state.agyModels = models;
      populateModelUI();
    }
  }).catch(() => {});
}

function closeModelMenu(refocus = false) {
  if (!state.isModelMenuOpen) return;
  state.isModelMenuOpen = false;
  modelMenu.classList.add('hidden');
  if (!state.isSettingsOpen) {
    if (promptInput.value.trim() || state.isExpanded) {
      resultsPanel.classList.remove('hidden');
    }
    renderChatThread();
  }
  if (refocus) {
    promptInput.focus();
  }
}

function setDefaultAssistantMessage() {
  assistantMessage.textContent = `${state.greeting}. What should we do today?`;
}

function pushConversationTurn(userText, assistantText) {
  if (userText) {
    state.conversationHistory.push({ role: 'user', text: userText });
  }
  if (assistantText) {
    state.conversationHistory.push({ role: 'assistant', text: assistantText });
  }
  if (state.conversationHistory.length > 8) {
    state.conversationHistory = state.conversationHistory.slice(-8);
  }
}

function renderChatThread() {
  if (
    state.isSettingsOpen ||
    state.isTasksOpen ||
    state.isModelMenuOpen ||
    state.chatMessages.length === 0 ||
    (!resultsPanel.classList.contains('hidden') && !state.isAskingAI)
  ) {
    chatPanel.classList.add('hidden');
    return;
  }

  chatPanel.classList.remove('hidden');
  chatStatus.textContent = state.isAskingAI ? 'Thinking...' : 'Conversation';
  chatThread.innerHTML = '';

  state.chatMessages.forEach((msg) => {
    const row = document.createElement('div');
    row.className = `chat-msg ${msg.role}${msg.pending ? ' pending' : ''}`;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.textContent = msg.text;
    row.appendChild(bubble);

    const hasActions = Array.isArray(msg.actions) && msg.actions.length > 0;
    const hasSuggestedUrl = Boolean(msg.suggestedUrl && msg.suggestedUrl.url);
    if (!msg.pending && (hasActions || hasSuggestedUrl)) {
      const actionsRow = document.createElement('div');
      actionsRow.className = 'chat-actions';

      if (hasActions) {
        msg.actions.forEach((act) => {
          const pill = document.createElement('button');
          pill.type = 'button';
          pill.className = 'chat-action-pill';
          pill.textContent = act.title || act.shortTitle || 'Open';
          pill.addEventListener('click', () => {
            executeCurrentActions([act], msg.text, false);
          });
          actionsRow.appendChild(pill);
        });
      }

      if (hasSuggestedUrl) {
        const googlePill = document.createElement('button');
        googlePill.type = 'button';
        googlePill.className = 'chat-action-pill';
        googlePill.textContent = msg.suggestedUrl.title || 'Open on Google';
        googlePill.addEventListener('click', () => {
          executeCurrentActions(
            [
              {
                type: 'OPEN_URL',
                title: msg.suggestedUrl.title || 'Open on Google',
                shortTitle: 'Google Search',
                subtitle: msg.suggestedUrl.url,
                url: msg.suggestedUrl.url,
                browser: 'default',
              },
            ],
            msg.suggestedUrl.url,
            false
          );
        });
        actionsRow.appendChild(googlePill);
      }

      row.appendChild(actionsRow);
    }

    chatThread.appendChild(row);
  });

  chatThread.scrollTop = chatThread.scrollHeight;
}

function updateTasksBadge() {
  const runningCount = (state.tasks || []).filter((t) => t.status === 'running').length;
  tasksBtn.classList.toggle('has-running', runningCount > 0);
  tasksBtnDot.classList.toggle('hidden', runningCount === 0);
  tasksBtnLabel.textContent = runningCount > 0 ? `Tasks (${runningCount})` : 'Tasks';
}

function renderTasksPanel() {
  updateTasksBadge();
  if (!state.isTasksOpen) {
    tasksPanel.classList.add('hidden');
    return;
  }

  tasksPanel.classList.remove('hidden');
  const allTasks = state.tasks || [];
  const runningCount = allTasks.filter((t) => t.status === 'running').length;
  tasksSummary.textContent =
    allTasks.length === 0
      ? 'Background Tasks'
      : `Background Tasks - ${runningCount} running, ${allTasks.length} total`;

  tasksList.innerHTML = '';
  if (allTasks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'tasks-empty';
    empty.textContent =
      'No background services or tunnels are running yet. Try "run qola both the dashboard-v2 and the service".';
    tasksList.appendChild(empty);
    taskLogViewer.classList.add('hidden');
    return;
  }

  if (!state.selectedTaskId || !allTasks.some((t) => t.id === state.selectedTaskId)) {
    state.selectedTaskId = allTasks[0].id;
  }

  allTasks.forEach((task) => {
    const row = document.createElement('div');
    row.className = `task-row${task.id === state.selectedTaskId ? ' selected' : ''}`;
    row.addEventListener('click', () => {
      state.selectedTaskId = task.id;
      renderTasksPanel();
    });

    const info = document.createElement('div');
    info.className = 'task-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'task-name';
    nameEl.textContent = task.name;
    info.appendChild(nameEl);

    const metaEl = document.createElement('div');
    metaEl.className = 'task-meta';

    const statusSpan = document.createElement('span');
    statusSpan.className =
      task.status === 'running'
        ? 'task-status-running'
        : task.status === 'error'
        ? 'task-status-error'
        : 'task-status-stopped';
    statusSpan.textContent = task.status.toUpperCase();
    metaEl.appendChild(statusSpan);

    const metaParts = [];
    if (task.pid) metaParts.push(`PID ${task.pid}`);
    if (task.detectedPorts && task.detectedPorts.length > 0) {
      metaParts.push(`ports ${task.detectedPorts.join(', ')}`);
    }
    if (task.cwd) metaParts.push(task.cwd);
    if (metaParts.length > 0) {
      metaEl.appendChild(document.createTextNode(` | ${metaParts.join(' | ')}`));
    }
    info.appendChild(metaEl);
    row.appendChild(info);

    const controls = document.createElement('div');
    controls.className = 'task-controls';

    const logsBtn = document.createElement('button');
    logsBtn.type = 'button';
    logsBtn.className = 'task-ctrl-btn';
    logsBtn.textContent = 'Logs';
    logsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.selectedTaskId = task.id;
      renderTasksPanel();
    });
    controls.appendChild(logsBtn);

    const rerunBtn = document.createElement('button');
    rerunBtn.type = 'button';
    rerunBtn.className = 'task-ctrl-btn';
    rerunBtn.textContent = 'Rerun';
    rerunBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const res = await window.pulseAPI.rerunTask(task.id);
      if (res && res.tasks) {
        state.tasks = res.tasks;
        state.selectedTaskId = task.id;
        renderTasksPanel();
      }
    });
    controls.appendChild(rerunBtn);

    if (task.status === 'running') {
      const stopBtn = document.createElement('button');
      stopBtn.type = 'button';
      stopBtn.className = 'task-ctrl-btn';
      stopBtn.textContent = 'Stop';
      stopBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const res = await window.pulseAPI.stopTask(task.id);
        if (res && res.tasks) {
          state.tasks = res.tasks;
          renderTasksPanel();
        }
      });
      controls.appendChild(stopBtn);
    } else {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'task-ctrl-btn';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const res = await window.pulseAPI.removeTask(task.id);
        if (res && res.tasks) {
          state.tasks = res.tasks;
          renderTasksPanel();
        }
      });
      controls.appendChild(removeBtn);
    }

    row.appendChild(controls);
    tasksList.appendChild(row);
  });

  const selectedTask = allTasks.find((t) => t.id === state.selectedTaskId);
  if (selectedTask) {
    taskLogViewer.classList.remove('hidden');
    taskLogTitle.textContent = `${selectedTask.name} - ${selectedTask.command}`;
    const wasAtBottom =
      taskLogOutput.scrollTop + taskLogOutput.clientHeight >= taskLogOutput.scrollHeight - 24;
    taskLogOutput.textContent =
      selectedTask.logs && selectedTask.logs.length > 0
        ? selectedTask.logs.join('\n')
        : 'Waiting for output...';
    if (wasAtBottom) {
      taskLogOutput.scrollTop = taskLogOutput.scrollHeight;
    }
  } else {
    taskLogViewer.classList.add('hidden');
  }
}

async function refreshTasks() {
  const fresh = await window.pulseAPI.getTasks();
  if (Array.isArray(fresh)) {
    state.tasks = fresh;
  }
  updateTasksBadge();
  if (state.isTasksOpen) {
    renderTasksPanel();
  }
}

function openTasksPanel() {
  closeModelMenu(false);
  if (state.isSettingsOpen) {
    closeSettings(false);
  }
  state.isTasksOpen = true;
  state.isExpanded = false;
  resultsPanel.classList.add('hidden');
  chatPanel.classList.add('hidden');
  tasksPanel.classList.remove('hidden');
  window.pulseAPI.userInteracted();
  refreshTasks();
}

function closeTasksPanel(refocus = true) {
  if (!state.isTasksOpen) return;
  state.isTasksOpen = false;
  tasksPanel.classList.add('hidden');
  if (promptInput.value.trim() || state.isExpanded) {
    resultsPanel.classList.remove('hidden');
  }
  renderChatThread();
  if (refocus) {
    promptInput.focus();
  }
}

async function resetChat() {
  state.chatMessages = [];
  state.conversationHistory = [];
  await window.pulseAPI.resetConversation();
  setDefaultAssistantMessage();
  renderChatThread();
  promptInput.focus();
}

function getTypeLabel(item) {
  switch (item.type) {
    case 'OPEN_PROJECT_EDITOR':
      return item.editor === 'antigravity' ? 'Antigravity' : 'VS Code';
    case 'OPEN_FOLDER':
      return 'Folder';
    case 'OPEN_TERMINAL':
      return 'Terminal';
    case 'RUN_PROJECT_COMMAND':
      return 'Command';
    case 'OPEN_URL':
      if (item.browser && item.browser !== 'default') {
        return item.browser.charAt(0).toUpperCase() + item.browser.slice(1);
      }
      return 'Browser';
    case 'LAUNCH_APP':
      return 'Application';
    case 'OPEN_SETTINGS':
      return 'Settings';
    case 'OPEN_TASKS':
      return 'Monitor';
    case 'ROUTINE':
      return 'Routine';
    case 'BATCH':
      return 'Chain';
    default:
      return 'Action';
  }
}

function createActionCard(item, index, onClickRun) {
  const card = document.createElement('div');
  card.className = `result-item${index === state.selectedIndex ? ' selected' : ''}`;
  card.dataset.idx = String(index);

  const mainRow = document.createElement('div');
  mainRow.className = 'result-main';

  const textWrap = document.createElement('div');
  textWrap.className = 'result-text';

  const titleEl = document.createElement('div');
  titleEl.className = 'result-title';
  titleEl.textContent = item.stepIndex ? `${item.stepIndex}. ${item.title}` : item.title;
  textWrap.appendChild(titleEl);

  if (item.subtitle) {
    const subEl = document.createElement('div');
    subEl.className = 'result-subtitle';
    subEl.textContent = item.subtitle;
    textWrap.appendChild(subEl);
  }

  mainRow.appendChild(textWrap);

  const typeEl = document.createElement('span');
  typeEl.className = 'result-type';
  typeEl.textContent = getTypeLabel(item);
  mainRow.appendChild(typeEl);

  card.appendChild(mainRow);

  if (
    item.project &&
    Array.isArray(item.project.subServices) &&
    item.project.subServices.length > 0 &&
    item.isPrimary &&
    !item.stepIndex
  ) {
    const subRow = document.createElement('div');
    subRow.className = 'sub-services-row';
    const targetEditor = item.editor || 'code';
    const editorLabel = targetEditor === 'antigravity' ? 'Antigravity' : 'VS Code';

    item.project.subServices.slice(0, 6).forEach((sub) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'sub-chip';
      chip.title = `Open ${sub.name} in ${editorLabel}`;
      chip.textContent = sub.name;
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        executeCurrentActions([
          {
            type: 'OPEN_PROJECT_EDITOR',
            title: `Open ${item.project.name} / ${sub.name} in ${editorLabel}`,
            shortTitle: `${sub.name} (${editorLabel})`,
            subtitle: sub.path,
            path: sub.path,
            editor: targetEditor,
            project: item.project,
            subService: sub,
          },
        ]);
      });
      subRow.appendChild(chip);
    });

    card.appendChild(subRow);
  }

  card.addEventListener('click', () => onClickRun());
  return card;
}

function renderResults(parsed) {
  state.lastParseResult = parsed;
  state.selectableItems = [];
  state.hasManualSelection = false;
  state.selectedIndex = parsed && parsed.isResearch ? -1 : 0;
  resultsList.innerHTML = '';

  if (state.isAskingAI) {
    assistantMessage.textContent = 'Thinking...';
  } else if (parsed && parsed.aiError) {
    assistantMessage.textContent = `Could not reach AI: ${parsed.aiError}`;
  } else if (parsed && parsed.reply) {
    assistantMessage.textContent = parsed.reply;
  } else if (parsed && parsed.isResearch) {
    assistantMessage.textContent = 'Press Enter to research with AI, or press Down to open Google Search.';
  } else if (parsed && parsed.isConversational) {
    assistantMessage.textContent = 'Press Enter to ask Pulse.';
  } else if (parsed && parsed.isEmpty) {
    setDefaultAssistantMessage();
  }

  if (!state.isExpanded || state.isSettingsOpen) {
    resultsPanel.classList.add('hidden');
    renderChatThread();
    return;
  }

  if (parsed && parsed.isEmpty) {
    const routines = parsed.routines || [];
    const recent = parsed.recent || [];
    resultsPanel.classList.remove('hidden');

    if (routines.length > 0) {
      const lbl = document.createElement('div');
      lbl.className = 'section-label';
      lbl.textContent = 'Routines';
      resultsList.appendChild(lbl);

      routines.slice(0, 3).forEach((routine) => {
        const idx = state.selectableItems.length;
        const item = {
          type: 'ROUTINE',
          title: routine.name,
          subtitle: `${routine.trigger} - ${routine.prompt}`,
          routine,
        };
        state.selectableItems.push({ kind: 'routine', item });
        resultsList.appendChild(createActionCard(item, idx, () => runRoutineItem(routine)));
      });
    }

    if (recent.length > 0) {
      const lbl = document.createElement('div');
      lbl.className = 'section-label';
      lbl.textContent = 'Recent';
      resultsList.appendChild(lbl);

      recent.slice(0, 4).forEach((entry) => {
        const idx = state.selectableItems.length;
        state.selectableItems.push({ kind: 'history', item: entry });
        resultsList.appendChild(
          createActionCard(entry, idx, () => {
            const acts = entry.actions && entry.actions.length > 0 ? entry.actions : [entry];
            executeCurrentActions(acts, entry.prompt);
          })
        );
      });
    }

    if (routines.length === 0 && recent.length === 0) {
      resultsPanel.classList.add('hidden');
    }
    renderChatThread();
    return;
  }

  const items = ((parsed && parsed.results) || []).slice(0, 5);
  if (items.length === 0) {
    resultsPanel.classList.add('hidden');
    renderChatThread();
    return;
  }

  resultsPanel.classList.remove('hidden');
  items.forEach((item) => {
    const idx = state.selectableItems.length;
    state.selectableItems.push({ kind: 'action', item });
    resultsList.appendChild(
      createActionCard(item, idx, () => {
        if (item.type === 'OPEN_SETTINGS') {
          openSettings();
        } else if (item.type === 'OPEN_TASKS') {
          openTasksPanel();
        } else if (parsed.isChained) {
          executeCurrentActions(parsed.actions);
        } else {
          executeCurrentActions([item]);
        }
      })
    );
  });
  renderChatThread();
}

async function runRoutineItem(routine) {
  promptInput.value = routine.prompt;
  const parsed = await window.pulseAPI.queryPrompt(routine.prompt);
  if (parsed && parsed.actions && parsed.actions.length > 0) {
    await executeCurrentActions(parsed.actions, routine.trigger);
  }
}

async function executeCurrentActions(actions, overridePrompt = null, keepOpen = false) {
  if (!actions || actions.length === 0) return;
  if (actions.length === 1 && actions[0].type === 'OPEN_SETTINGS') {
    openSettings();
    return;
  }
  if (actions.length === 1 && actions[0].type === 'OPEN_TASKS') {
    promptInput.value = '';
    openTasksPanel();
    return;
  }
  const promptText = overridePrompt !== null ? overridePrompt : promptInput.value.trim();
  const executedLabel = `Launched ${actions[0].shortTitle || actions[0].title}.`;
  pushConversationTurn(promptText, executedLabel);

  const res = await window.pulseAPI.executeAction({
    actions,
    promptText,
    keepOpen,
  });
  if (res && res.config) {
    state.config = res.config;
  }
  if (res && Array.isArray(res.tasks)) {
    state.tasks = res.tasks;
    updateTasksBadge();
  }

  promptInput.value = '';
  state.isExpanded = false;
  resultsPanel.classList.add('hidden');
  resultsList.innerHTML = '';

  if (res && res.openedTasks) {
    if (state.tasks.length > 0) {
      state.selectedTaskId = state.tasks[0].id;
    }
    assistantMessage.textContent = 'Running in background. Monitoring live output below.';
    openTasksPanel();
    return;
  }

  if (!keepOpen) {
    setDefaultAssistantMessage();
  }
  renderChatThread();
}

async function handlePromptInput() {
  window.pulseAPI.userInteracted();
  if (state.isSettingsOpen) {
    closeSettings(false);
  }
  if (state.isTasksOpen) {
    closeTasksPanel(false);
  }
  const val = promptInput.value;
  if (!val.trim()) {
    state.isExpanded = false;
    renderResults({ isEmpty: true, routines: [], recent: [], actions: [], results: [] });
    return;
  }
  state.isExpanded = true;
  const parsed = await window.pulseAPI.queryPrompt(val);
  renderResults(parsed);
}

async function runAIQuery(autoExecute = false) {
  const val = promptInput.value.trim();
  if (!val || state.isAskingAI) return;
  window.pulseAPI.userInteracted();

  const isResearchPrompt =
    state.lastParseResult && state.lastParseResult.isResearch;

  state.isAskingAI = true;
  state.isExpanded = false;
  resultsPanel.classList.add('hidden');
  resultsList.innerHTML = '';

  state.chatMessages.push({ role: 'user', text: val });
  const pendingMsg = {
    role: 'assistant',
    text: isResearchPrompt ? 'Researching...' : 'Thinking...',
    pending: true,
    actions: [],
    suggestedUrl: null,
  };
  state.chatMessages.push(pendingMsg);
  promptInput.value = '';
  assistantMessage.textContent = isResearchPrompt ? 'Researching...' : 'Thinking...';
  renderChatThread();

  try {
    const aiResult = await window.pulseAPI.queryAI(val, state.conversationHistory);
    state.isAskingAI = false;

    const replyText = aiResult.reply || aiResult.explanation || 'Done.';
    pendingMsg.pending = false;
    pendingMsg.text = replyText;
    pendingMsg.actions = aiResult.actions || [];
    pendingMsg.suggestedUrl = aiResult.suggestedUrl || null;

    assistantMessage.textContent = `${state.greeting}. What should we do today?`;
    pushConversationTurn(val, replyText);
    renderChatThread();

    if (
      autoExecute &&
      aiResult.shouldAutoExecute !== false &&
      aiResult.actions &&
      aiResult.actions.length > 0
    ) {
      await executeCurrentActions(aiResult.actions, val, false);
    } else {
      promptInput.focus();
    }
  } catch (err) {
    state.isAskingAI = false;
    pendingMsg.pending = false;
    pendingMsg.text = `Could not reach AI: ${err.message || 'AI request failed'}`;
    assistantMessage.textContent = `${state.greeting}. What should we do today?`;
    renderChatThread();
    promptInput.focus();
  }
}

function updateSelectionHighlight() {
  const cards = resultsList.querySelectorAll('.result-item');
  cards.forEach((card) => {
    const idx = Number(card.dataset.idx);
    card.classList.toggle('selected', idx === state.selectedIndex);
    if (idx === state.selectedIndex) {
      card.scrollIntoView({ block: 'nearest' });
    }
  });
}

function syncAiProviderFields() {
  const provider = settingAiProvider.value;
  agyModelRow.classList.toggle('hidden', provider !== 'agy');
  apiKeyRow.classList.toggle('hidden', provider === 'agy');
}

function openSettings() {
  closeModelMenu(false);
  closeTasksPanel(false);
  state.isSettingsOpen = true;
  window.pulseAPI.setSettingsOpen(true);
  window.pulseAPI.userInteracted();

  resultsPanel.classList.add('hidden');
  chatPanel.classList.add('hidden');
  settingsPanel.classList.remove('hidden');
  settingsFeedback.textContent = '';

  const cfg = state.config || {};
  const ai = cfg.ai || {};
  settingStartup.checked = Boolean(state.startupStatus && state.startupStatus.enabled);
  settingAutohide.checked = cfg.autoHideOnBlur !== false;
  settingAiProvider.value = ai.provider || 'agy';
  populateModelUI();
  settingAgyModel.value = ai.agyModel || 'gemini-3.8-flash-low';
  settingApiKey.value = ai.apiKey || '';
  settingRoots.value = (cfg.workspaceRoots || []).join('\n');

  syncAiProviderFields();
}

function closeSettings(refocus = true) {
  state.isSettingsOpen = false;
  window.pulseAPI.setSettingsOpen(false);
  settingsPanel.classList.add('hidden');
  if (promptInput.value.trim() || state.isExpanded) {
    resultsPanel.classList.remove('hidden');
  }
  renderChatThread();
  if (refocus) {
    promptInput.focus();
  }
}

backdrop.addEventListener('mousedown', (e) => {
  if (e.target === backdrop) {
    closeModelMenu(false);
    window.pulseAPI.hideWindow();
  }
});

tasksBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  window.pulseAPI.userInteracted();
  if (state.isTasksOpen) {
    closeTasksPanel(true);
  } else {
    openTasksPanel();
  }
});

refreshTasksBtn.addEventListener('click', () => refreshTasks());
closeTasksBtn.addEventListener('click', () => closeTasksPanel(true));
refreshLogBtn.addEventListener('click', async () => {
  await refreshTasks();
  taskLogOutput.scrollTop = taskLogOutput.scrollHeight;
});
rerunLogTaskBtn.addEventListener('click', async () => {
  if (!state.selectedTaskId) return;
  const res = await window.pulseAPI.rerunTask(state.selectedTaskId);
  if (res && res.tasks) {
    state.tasks = res.tasks;
    renderTasksPanel();
  }
});

modelSelectorBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  window.pulseAPI.userInteracted();
  if (state.isModelMenuOpen) {
    closeModelMenu(true);
  } else {
    openModelMenu();
  }
});

promptInput.addEventListener('input', () => {
  closeModelMenu(false);
  handlePromptInput();
});

promptInput.addEventListener('focus', () => {
  window.pulseAPI.userInteracted();
});

promptInput.addEventListener('keydown', async (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    closeModelMenu(false);
    await runAIQuery(false);
    return;
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    if (state.isModelMenuOpen) {
      closeModelMenu(true);
      return;
    }
    if (state.isTasksOpen) {
      closeTasksPanel(true);
      return;
    }
    if (state.isSettingsOpen) {
      closeSettings();
      return;
    }
    if (promptInput.value.trim() || state.isExpanded) {
      promptInput.value = '';
      state.isExpanded = false;
      renderResults({ isEmpty: true, routines: [], recent: [], actions: [], results: [] });
    } else {
      window.pulseAPI.hideWindow();
    }
    return;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (!state.isExpanded) {
      state.isExpanded = true;
      const parsed = await window.pulseAPI.queryPrompt(promptInput.value);
      renderResults(parsed);
      return;
    }
    if (state.selectableItems.length > 0) {
      state.hasManualSelection = true;
      state.selectedIndex =
        state.selectedIndex < 0
          ? 0
          : (state.selectedIndex + 1) % state.selectableItems.length;
      updateSelectionHighlight();
    }
    return;
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (state.selectableItems.length > 0) {
      state.hasManualSelection = true;
      state.selectedIndex =
        state.selectedIndex < 0
          ? state.selectableItems.length - 1
          : (state.selectedIndex - 1 + state.selectableItems.length) %
            state.selectableItems.length;
      updateSelectionHighlight();
    }
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    const rawVal = promptInput.value.trim();
    const parsed = state.lastParseResult;

    if (!rawVal) {
      const selected = state.selectableItems[state.selectedIndex];
      if (selected) {
        if (selected.kind === 'routine') {
          await runRoutineItem(selected.item.routine);
        } else if (selected.kind === 'history') {
          const entry = selected.item;
          const acts = entry.actions && entry.actions.length > 0 ? entry.actions : [entry];
          await executeCurrentActions(acts, entry.prompt);
        }
      }
      return;
    }

    // Instant Jarvis greeting / status check
    if (parsed && parsed.isInstantReply) {
      state.chatMessages.push({ role: 'user', text: rawVal });
      state.chatMessages.push({ role: 'assistant', text: parsed.reply, pending: false });
      pushConversationTurn(rawVal, parsed.reply);
      promptInput.value = '';
      state.isExpanded = false;
      resultsPanel.classList.add('hidden');
      setDefaultAssistantMessage();
      renderChatThread();
      return;
    }

    // If user explicitly navigated down to a selectable action (e.g. Open Google Search in Browser)
    const selected = state.selectableItems[state.selectedIndex];
    if (
      parsed &&
      parsed.isResearch &&
      state.hasManualSelection &&
      selected &&
      selected.kind === 'action'
    ) {
      await executeCurrentActions([selected.item]);
      return;
    }

    // Conversational question, research prompt, or weak/unmatched offline intent -> ask connected AI
    if (
      !parsed ||
      parsed.forceAI ||
      parsed.isConversational ||
      !parsed.actions ||
      parsed.actions.length === 0 ||
      parsed.confidence < 85
    ) {
      await runAIQuery(true);
      return;
    }

    if (parsed.isChained && parsed.actions.length > 1) {
      await executeCurrentActions(parsed.actions);
      return;
    }

    if (selected && selected.kind === 'action') {
      await executeCurrentActions([selected.item]);
    } else if (parsed.primaryAction) {
      await executeCurrentActions([parsed.primaryAction]);
    }
  }
});

clearChatBtn.addEventListener('click', () => resetChat());

closeSettingsBtn.addEventListener('click', () => closeSettings());
settingAiProvider.addEventListener('change', () => syncAiProviderFields());

settingStartup.addEventListener('change', async () => {
  state.startupStatus = await window.pulseAPI.toggleStartup(settingStartup.checked);
  settingsFeedback.textContent = state.startupStatus.enabled
    ? 'Windows startup enabled.'
    : 'Windows startup disabled.';
});

rescanBtn.addEventListener('click', async () => {
  rescanBtn.disabled = true;
  rescanBtn.textContent = 'Scanning...';
  const res = await window.pulseAPI.rescanProjects();
  state.projectCount = res.count;
  rescanBtn.disabled = false;
  rescanBtn.textContent = 'Rescan';
  settingsFeedback.textContent = `Indexed ${res.count} projects.`;
});

saveSettingsBtn.addEventListener('click', async () => {
  const roots = settingRoots.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const res = await window.pulseAPI.updateConfig({
    autoHideOnBlur: settingAutohide.checked,
    workspaceRoots: roots,
    ai: {
      enabled: true,
      provider: settingAiProvider.value,
      agyModel: settingAgyModel.value.trim() || 'gemini-3.8-flash-low',
      apiKey: settingApiKey.value.trim(),
    },
  });

  if (res) {
    state.config = res.config;
    state.projectCount = res.projectCount;
    populateModelUI();
    settingsFeedback.textContent = `Saved (${res.projectCount} projects indexed).`;
  }
});

window.pulseAPI.onSpotlightFocused((data = {}) => {
  closeModelMenu(false);
  closeTasksPanel(false);
  if (data.openSettings) {
    openSettings();
    return;
  }
  closeSettings();
  promptInput.value = '';
  state.isExpanded = false;
  resultsPanel.classList.add('hidden');
  resultsList.innerHTML = '';
  setDefaultAssistantMessage();
  renderChatThread();
  refreshTasks();
  promptInput.focus();
});

window.pulseAPI.onProjectsUpdated((data = {}) => {
  state.projectCount = data.count || 0;
});

window.pulseAPI.onStartupUpdated((status) => {
  state.startupStatus = status || { enabled: false };
  if (state.isSettingsOpen) {
    settingStartup.checked = Boolean(state.startupStatus.enabled);
  }
});

window.pulseAPI.onTasksUpdated((tasks) => {
  if (Array.isArray(tasks)) {
    state.tasks = tasks;
    updateTasksBadge();
    if (state.isTasksOpen) {
      renderTasksPanel();
    }
  }
});

async function bootstrap() {
  const initial = await window.pulseAPI.getInitialState();
  state.greeting = initial.greeting || 'Hello';
  state.projectCount = initial.projectCount || 0;
  state.appCount = initial.appCount || 0;
  state.config = initial.config;
  state.agyModels = initial.agyModels || [];
  state.tasks = initial.tasks || [];
  state.startupStatus = initial.startupStatus || { enabled: false };
  populateModelUI();
  updateTasksBadge();
  setDefaultAssistantMessage();
  promptInput.focus();
}

bootstrap();
