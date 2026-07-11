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
- `main/windowStateStore.js`: Persists window bounds (size, position, maximized state) to disk so the app reopens where the user left it

**Renderer Process:**

Loaded as plain `<script>` tags (no bundler/module system—see `src/index.html`), so every file shares one global scope, same as `icons.js`'s global `ICONS`. Load order in `index.html` matters only in that a file must appear before another file whose top-level code runs immediately at parse time; nothing here does that, since all cross-file calls happen from within functions invoked later (after `DOMContentLoaded`). Split one-per-view/concern, same rationale as the main-process split above:
- `src/index.js`: App shell only—`init()`, wiring up each module's `setup*EventListeners()`, background polling (`pollForUpdates`), and global keyboard shortcuts (`handleGlobalKeydown`). Owns nothing that's specific to task lists or tasks individually, since polling and keydown handling touch both.
- `src/taskLists.js`: Left-sidebar view—state (`taskLists`, `selectedListId`, `isNewListModalOpen`), list CRUD, rename, and rendering (`renderTaskLists`)
- `src/tasks.js`: Main task area + right-hand detail pane—state (`tasks`, `selectedTaskId`, `draggedTaskId`), task CRUD, selection, and rendering (`renderTasks`, `renderTaskDetail`)
- `src/dragDrop.js`: Native HTML5 drag-and-drop for reordering tasks; reads/writes `tasks` state from `tasks.js`
- `src/auth.js`: Sign-in modal and `initGoogleTasks()`/`handleSignIn()`
- `src/inlineEdit.js`: Shared contenteditable rename mechanics (`beginInlineEdit`), used by both `beginTitleEdit` (`tasks.js`) and `beginListTitleEdit` (`taskLists.js`)
- `src/confirmModal.js`: Shared destructive-confirmation modal mechanics (`createConfirmModal`), used by the delete-task modal (`tasks.js`) and delete-list modal (`taskLists.js`); also exposes `isAnyConfirmModalOpen()`/`handleConfirmModalKeydown()` so `index.js` can gate polling and route Escape/Enter without knowing about each modal individually
- `src/index.html`: Static structure for header, sidebar, main task area, and empty state
- `src/css/`: Split one-per-area (`layout`, `sidebar`, `task-list`, `task-detail`, `modal`, `theme`), each theme-aware via CSS custom properties defined in `theme.css`

If any one of these files grows past a few hundred lines or gains a second distinct concern, consider splitting further rather than continuing to extend it.

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

Static, always-present elements are cached as top-level `const`s in the module that owns them (e.g. `taskList` in `tasks.js`, `sidebarLeftContent` in `taskLists.js`). For elements that come and go with re-renders (task rows, sidebar list buttons), query the DOM or use event delegation instead (see the `sidebarLeftContent` click handler in `taskLists.js`).

### IPC Communication

Renderer → Main: Use `window.googleTasks.*` or `window.windowControls.*` (exposed in preload.js).  
Main → Renderer: Only used for native `Menu` accelerators. `main/menu.js` builds the app menu and each item sends a `menu:*` channel (e.g. `menu:new-task`) via `webContents.send`; `window.appMenu.on*` (exposed in preload.js) subscribes to these in `setupMenuListeners()` in `index.js`, which calls the same functions the equivalent keyboard shortcut would call. State otherwise flows via explicit IPC invoke calls with Promise handling.

A shortcut should have exactly one owner. If it's backed by a menu accelerator, it must not also be handled in `handleGlobalKeydown`—a menu accelerator and the renderer's `keydown` listener both fire independently when the window has focus, so having both would double-run the action.

IPC handlers are thin wrappers; business logic (auth, API calls) lives in `main/auth.js` and `main/googleTasksClient.js`.

### Async/Await Error Handling

Most IPC calls include try/catch with fallback rendering (e.g., in `loadTasksForSelectedList()`, errors leave previous tasks in place). Add messages to the UI for critical failures (see `loadTaskLists()` retry pattern).

### HTML Escaping

User data and API responses enter the DOM via `textContent` (or `.value`), never `innerHTML`—this is inherently XSS-safe, so there's no separate escaping helper to call. `innerHTML` is only ever assigned static, trusted strings (icon markup from `icons.js`, hardcoded UI messages like the sidebar's "Loading lists…").

### Offline Handling

The app tracks connection state via `navigator.onLine` and `online`/`offline` window events. When offline:
- A semi-transparent overlay covers the entire UI, blocking all interaction
- An "Offline" message appears centered in the header (in `--color-accent`) above the overlay
- The background poll continues to retry every 10s; when the connection restores, the overlay and message automatically disappear and fresh data begins syncing
- All mutations (add/edit/delete task, create/rename list) are prevented by the overlay's `pointer-events: auto`

No data is lost if the network drops mid-sync—errors are caught and the poll resync loop restores consistency.

### Background Sync (Polling)

`pollForUpdates()` re-fetches task lists (and the selected list's tasks) every 10s via `setInterval` (started in `init()`), to pick up changes made outside the app (e.g. Google Tasks edited on another device)—there's no push/webhook mechanism, so this is the only source of truth refresh beyond direct user actions.

The poll is gated so it never disturbs in-flight local state: it skips if `!document.hasFocus()`, if `isEditingSomething()` is true, if a modal is open (`isNewListModalOpen`, `pendingDeleteTask`), or if a task is mid-drag (`draggedTaskId`). `isEditingSomething()` checks whether focus is inside an `input`/`textarea`/`[contenteditable]`—except `addTaskInput`, which is deliberately excluded: it sits outside the `#taskList` subtree that task rendering rebuilds, so a poll firing mid-type there doesn't disturb focus or typed text, unlike an in-progress rename or note edit, which live in DOM the poll actually touches.

This is also why `renderTaskLists()` reconciles the sidebar's list buttons against `taskLists` (matching by `data-list-id`, updating only what changed) instead of rebuilding via `innerHTML`, unlike `renderTasks()` which still does a full teardown/rebuild each call. `renderTaskLists()` runs on every sidebar click *and* every poll tick, so a full rebuild there would destroy an in-progress inline list-title rename mid-edit; `renderTasks()` doesn't need the same treatment since the poll already skips entirely whenever `isEditingSomething()` is true.

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

- No local persistence to disk; task/list data is refreshed from Google Tasks on launch and then periodically via the focus-gated background poll (see "Background Sync (Polling)" above)—there's still no offline cache
- No error recovery UI for network failures (apart from retry buttons on critical errors)
- Linting is not configured (see `npm run lint`)
