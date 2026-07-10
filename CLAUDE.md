# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A desktop task management app built with Electron that integrates with Google Tasks. The app provides a UI to:
- browse and manage tasks lists with sidebar navigation
- browse and manage tasks in a tasks area
The UI will support automatic switching between light and dark theme.

## Architecture

The app follows an **Electron main/renderer split** with **secure IPC communication**:

- **Main process** (`main.js`, `main/*.js`): Handles Electron window management, OAuth authentication, and Google Tasks API calls
- **Renderer process** (`src/`): Browser-based UI rendering and state management
- **IPC Bridge** (`src/preload.js`): Exposes secure APIs to the renderer using `contextBridge`, isolating renderer from Node.js

### Key Modules

Main process files are split one-per-concern (IPC wiring, auth, API client, token persistence)—new main-process functionality should get its own file rather than growing an existing one. Current split, as of this writing:
- `main/ipc.js`: Registers IPC handlers that the renderer invokes (auth, task list operations)
- `main/auth.js`: OAuth2 flow for Google signin—starts a local HTTP server to capture the callback, opens browser, manages credentials
- `main/googleTasksClient.js`: Wraps the googleapis library for Tasks API (pagination built-in)
- `main/tokenStore.js`: Persists OAuth tokens to disk
- `main/menu.js`: Builds the native application `Menu`; menu accelerators are the single owner of app-level keyboard shortcuts (see IPC Communication below)

**Renderer Process:**
- `src/index.js`: App state (`tasks`, `taskLists`, `selectedListId`) and UI rendering logic; all DOM mutations flow through render functions
- `src/index.html`: Static structure for header, sidebar, main task area, and empty state
- `src/css/app.css`: Dark theme with animated sidebar collapse

If `src/index.js` grows past a few hundred lines or gains a second distinct view, consider splitting state/rendering into separate modules rather than continuing to extend one file.

## Development Workflow

### Setup

1. Download a Google OAuth "Desktop app" client secret from [Google Cloud Console](https://console.cloud.google.com)
2. Save it as `google-client-secret.json` in the project root
3. `npm install`

### Commands

- `npm start` — Launch the app with hot reload (via electron-forge)
- `npm run make` — Build distributable binaries
- `npm run package` — Package the app (cross-platform)
- `npm run lint` — (Currently no-op; use your linter of choice)

### Debugging

The app runs two processes:
- Use browser DevTools in the renderer (Ctrl+Shift+I when running)
- Check main process logs in the console where you ran `npm start`

## Code Style

**Vanilla JavaScript, no frameworks.** Prefer clarity and modularity over brevity.

**Comments:** Include moderate comments that explain *why*, not *what*. Add a comment:
- When working around a constraint (e.g., "OAuth state prevents CSRF")
- When an invariant is non-obvious (e.g., "signInInFlight prevents race conditions")
- When a workaround is needed (e.g., browser limitations, API quirks)

Omit comments for straightforward code (good naming speaks for itself).

**Modularity:**
- Keep renderer functions small and single-purpose; compose them via explicit calls
- Separate IPC handlers from business logic (e.g., auth logic lives in `main/auth.js`, IPC wiring in `main/ipc.js`)
- Use the naming convention: `render*` for functions that mutate DOM, `load*` for async data fetches, `handle*` for event listeners

**No premature abstractions.** Three similar lines is fine. Abstract only when you see a clear pattern.

## Important Patterns

### Renderer State Management

All state lives in module-level variables (`tasks`, `taskLists`, `selectedListId`). On state change, call `updateUI()` or a specific render function:
```javascript
async function selectTaskList(listId) {
  selectedListId = listId;
  renderTaskLists();
  await loadTasksForSelectedList();
}
```

Avoid storing DOM references; query the DOM or use event delegation when needed (see `sidebarContent` click handler).

### IPC Communication

Renderer → Main: Use `window.googleTasks.*` or `window.windowControls.*` (exposed in preload.js).  
Main → Renderer: Only used for native `Menu` accelerators. `main/menu.js` builds the app menu and each item sends a `menu:*` channel (e.g. `menu:new-task`) via `webContents.send`; `window.appMenu.on*` (exposed in preload.js) subscribes to these in `setupMenuListeners()` in `index.js`, which calls the same functions the equivalent keyboard shortcut would call. State otherwise flows via explicit IPC invoke calls with Promise handling.

A shortcut should have exactly one owner. If it's backed by a menu accelerator, it must not also be handled in `handleGlobalKeydown`—a menu accelerator and the renderer's `keydown` listener both fire independently when the window has focus, so having both would double-run the action.

IPC handlers are thin wrappers; business logic (auth, API calls) lives in `main/auth.js` and `main/googleTasksClient.js`.

### Async/Await Error Handling

Most IPC calls include try/catch with fallback rendering (e.g., in `loadTasksForSelectedList()`, errors leave previous tasks in place). Add messages to the UI for critical failures (see `loadTaskLists()` retry pattern).

### HTML Escaping

Use `escapeHtml()` (defined in `index.js`) when inserting user data or API responses into the DOM. This prevents XSS.

## Google Tasks Setup

To test the app locally:
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project (or use an existing one)
3. Enable the Google Tasks API
4. Create an OAuth 2.0 Desktop application credential
5. Download the JSON and save as `google-client-secret.json`
6. The app handles all subsequent OAuth flows

Tokens are cached in the system's app data folder (via `tokenStore`). Deleting cached tokens forces re-authentication.

## Testing & Verification

**Build verification:** Running `npm start` or `npm run make` to verify builds succeed is encouraged.

**Functionality testing:** Do not run the app to verify UI changes through screenshots or manual interaction. The developer will handle testing app functionality yourself. Focus on code verification (type checking, linting, code review) and confirming builds succeed.

## Known Limitations & TODOs

This list reflects the state of the codebase at last edit and goes stale quickly—verify against the current code (e.g. `grep` for the function, check `git log`) before relying on it, and update or remove an item once it no longer holds:

- `addList()` is a stub; not yet wired to the Google Tasks API (task creation/edit/delete/reorder are wired)
- No local persistence; all state is fetched fresh from Google Tasks on each app launch
- No error recovery UI for network failures (apart from retry buttons on critical errors)
- Linting is not configured (see `npm run lint`)
