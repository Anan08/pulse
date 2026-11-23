# Pulse

Pulse is a lightweight, floating Windows desktop command launcher and conversational workflow assistant built with Electron. Inspired by minimal Spotlight-style interfaces, Pulse indexes local development workspaces, installed desktop applications, web bookmarks, and SSH tunnel configurations so multi-step engineering workflows can be searched, chained, executed, and monitored from a single hotkey overlay.

---

## Core Capabilities

- **Global Spotlight Overlay**: Summon or hide Pulse from anywhere on Windows with `Alt+Space` (or fallback hotkey `Ctrl+Shift+Space`).
- **Workspace & Sub-Service Indexing**: Automatically discovers projects, monorepo sub-services (frontend, backend, mobile, dashboard, services), Desktop/Start Menu applications, and `.txt` SSH tunnel definitions in user directories.
- **Compound Command Chaining**: Split and resolve multi-step natural prompts joined by `and`, `then`, `and also`, `+`, or `;` while preserving active project context across clauses.
- **Background Task & Live Log Monitor**: Dedicated `TaskManager` process registry tracking managed dev services and SSH tunnels with:
  - A 400-line stdout/stderr log ring buffer per task and listening port detection.
  - Non-interactive SSH password automation via `SSH_ASKPASS` (`SSH_ASKPASS_REQUIRE=force`) without persisting passwords to history or task metadata.
  - Clean Windows process-tree termination (`taskkill.exe /PID <pid> /T /F`) alongside live Refresh, Rerun, Stop, and Remove UI controls.
- **Multi-Turn Conversational AI**: Pluggable AI parser supporting the Antigravity CLI (`agy.exe`) with `--conversation` session continuity and runtime model selection, plus Google Gemini and OpenAI REST API providers.
- **Automated YouTube Queue & Playlist Generation**: Extracts recommended track lists from conversation turns and resolves YouTube video IDs in parallel into playable multi-track queues (`https://www.youtube.com/watch_videos?video_ids=...`) without requiring YouTube API credentials.
- **Custom Routines & Silent Windows Startup**: Save reusable trigger prompts and register silent login launch under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` using `launch-silent.vbs`.

---

## Project Structure

```text
pulse/
├── src/
│   ├── core/
│   │   ├── config.js         # Persistent configuration, custom routines, aliases, and history
│   │   ├── executor.js       # Action execution engine (editors, apps, URLs, folders, tasks)
│   │   ├── indexer.js        # Workspace, sub-service, Windows app, and SSH tunnel scanner
│   │   ├── parser.js         # Offline compound parser, AI catalog builder, and YouTube queue builder
│   │   ├── startup.js        # Windows registry startup enable/disable/status helpers
│   │   └── task-manager.js   # Background process lifecycle, SSH_ASKPASS wrapper, and log buffers
│   ├── renderer/
│   │   ├── index.html        # Frameless overlay markup, Settings modal, and Task Monitor panel
│   │   ├── styles.css        # Minimalist monochrome light theme styling
│   │   └── app.js            # Keyboard navigation, conversation UI, model menu, and task polling
│   ├── cli-startup.js        # CLI wrapper for Windows startup registration
│   ├── main.js               # Electron main process, global hotkeys, and IPC handlers
│   └── preload.js            # Context-isolated IPC bridge for the renderer
├── test/
│   └── verify.js             # End-to-end verification suite
├── launch-silent.vbs         # Windowless WScript launcher for Windows startup
├── start-assistant.bat       # Convenience launcher script
└── package.json
```

At runtime, user preferences, routines, command history, and temporary askpass helpers are stored in a local `data/` directory (excluded from Git via `.gitignore`).

---

## Requirements

- **Operating System**: Windows 10 or Windows 11
- **Node.js**: v18 or higher (with npm)
- **Optional Integrations**:
  - Visual Studio Code (`code` / `Code.exe`)
  - Antigravity IDE and CLI (`agy.exe`) for built-in local CLI AI mode
  - OpenSSH client (`ssh.exe`) for managed SSH tunnel tasks
  - Google Gemini or OpenAI API key when using API providers instead of `agy`

---

## Installation

1. Clone the repository and navigate into the project folder:

   ```powershell
   git clone <your-repository-url> pulse
   cd pulse
   ```

2. Install dependencies:

   ```powershell
   npm install
   ```

3. Launch Pulse:

   ```powershell
   npm start
   ```

   Or double-click `start-assistant.bat` to launch directly.

---

## Available Scripts

| Command | Description |
| :--- | :--- |
| `npm start` | Launches Pulse via Electron (`electron .`). |
| `npm test` | Runs the automated parser, indexer, task manager, and AI verification suite (`node test/verify.js`). |
| `npm run startup:enable` | Registers `launch-silent.vbs` in Windows startup (`HKCU\...\Run`). |
| `npm run startup:disable` | Removes Pulse from Windows startup. |
| `npm run startup:status` | Prints current Windows startup registration status. |

---

## Prompt Examples

| Prompt | Resolved Behavior |
| :--- | :--- |
| `open vscode from <project>` | Opens the root `<project>` workspace in VS Code. |
| `open <project> <subservice> in antigravity` | Opens the matching sub-service directory in Antigravity IDE. |
| `open <project> fe and be in vscode` | Resolves shared project context across chained clauses into two editor launches. |
| `run <project> both dashboard-v2 and service` | Starts the detected dev commands for both sub-services inside the Task Monitor. |
| `tasks` / `logs` / `services` | Opens the background Tasks panel with live stdout/stderr output and controls. |
| `research <topic>` | Queries the AI assistant with web search enabled and provides a Google Search quick link. |
| `is it possible for u to make me a playlist or queue on youtube for it?` | Converts recommended tracks from chat history into a playable YouTube queue. |

---

## Configuration and Privacy

- On first launch, Pulse initializes `data/config.json` with default workspace paths derived from `os.homedir()` and standard Windows application locations.
- Workspace roots, hotkeys, default editor, AI provider (`agy`, `gemini`, or `openai`), model selection, and API keys can all be edited in the in-app **Settings** panel without modifying source files.
- Personal configuration, API keys, command history, and temporary SSH helper scripts live strictly under `data/`, which is ignored by `.gitignore`.

---

## License

This project is licensed under the MIT License. See [package.json](package.json) for details.
