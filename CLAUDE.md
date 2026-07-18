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
- `main/sidebarWindowSizer.js`: Grows/shrinks the window to make room for the left sidebar (see "Left Sidebar Window Resizing" below); owns the work-area clamp and remembers how much width each open actually gained

**Renderer Process:**

Loaded as plain `<script>` tags (no bundler/module system—see `src/index.html`), so every file shares one global scope, same as `icons.js`'s global `ICONS`. Most cross-file calls happen from within functions invoked later (after `DOMContentLoaded`), so load order is mostly irrelevant—**except** for the shared-mechanics helpers a few files invoke at top level (parse time): `tasks.js`/`taskLists.js` build their confirm modals via `createConfirmModal` (so `confirmModal.js` must load first), and `taskLists.js`/`tasks.js`/`taskDetail.js` build their persisted toggles via `makePersistedToggle` (so `persistedToggle.js` must load first). Keep those helper scripts ahead of their consumers in `index.html`. Split one-per-view/concern, same rationale as the main-process split above:
- `src/index.js`: App shell only—`init()`, wiring up each module's `setup*EventListeners()`, background polling (`pollForUpdates`), and global keyboard shortcuts (`handleGlobalKeydown`). Owns nothing that's specific to task lists or tasks individually, since polling and keydown handling touch both.
- `src/taskLists.js`: Left-sidebar view—state (`taskLists`, `selectedListId`, `isNewListModalOpen`), list CRUD, rename, and rendering (`renderTaskLists`). `getSortedTaskLists()` here is the single definition of sidebar display order (alphabetical), read by every render and the Cmd/Ctrl+1–9 shortcuts.
- `src/tasks.js`: Main task-area view—state (`tasks`, `selectedTaskId`, `draggedTaskId`), task CRUD, selection, list rendering (`renderTasks`), and the whole-area refresh `renderTaskArea()`. DOM-node factories are named `create*` (e.g. `createTaskRow`).
- `src/taskDetail.js`: Right-hand detail pane—renders the selected task's title/notes into editable fields (`renderTaskDetail`), the notes debounce/blur autosave, the row↔detail title mirror (`syncSelectedTaskDetailTitle`), and the right-sidebar collapse toggle. Reads/mutates `tasks`/`selectedTaskId` (owned by `tasks.js`). Exposes `commitPendingDetailEdits()`, which `selectTask` (`tasks.js`) and `selectTaskList` (`taskLists.js`) call to flush a focused field before the selection changes underneath it.
- `src/dragDrop.js`: Native HTML5 drag-and-drop for reordering tasks; reads/writes `tasks` state from `tasks.js`
- `src/auth.js`: Sign-in modal and `initGoogleTasks()`/`handleSignIn()`
- `src/inlineEdit.js`: Shared contenteditable rename mechanics (`beginInlineEdit`), used by both `beginTitleEdit` (`tasks.js`) and `beginListTitleEdit` (`taskLists.js`)
- `src/confirmModal.js`: Shared destructive-confirmation modal mechanics (`createConfirmModal`), used by the delete-task modal (`tasks.js`) and delete-list modal (`taskLists.js`); also exposes `isAnyConfirmModalOpen()`/`handleConfirmModalKeydown()` so `index.js` can gate polling and route Escape/Enter without knowing about each modal individually
- `src/persistedToggle.js`: Shared show/hide-with-persistence mechanics (`makePersistedToggle`), used by the two sidebars and the completed section (`taskLists.js`, `taskDetail.js`, `tasks.js`)
- `src/windowSizing.js`: Renderer half of the left sidebar's window resize (`toggleSidebarLeftWithWindow`), called by `toggleSidebarLeft` in `taskLists.js`; sequences the resize against the sidebar's reveal and pins the task area's width for the duration (see "Left Sidebar Window Resizing" below)
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
- Use the naming convention: `render*` for functions that mutate existing DOM, `create*` for functions that build and return a new DOM node (e.g. `createTaskRow`), `load*` for async data fetches, `handle*` for event listeners. Reserve `get*` for functions that read/return state (e.g. `getSelectedTask`), not DOM factories.

**No premature abstractions.** Three similar lines is fine. Abstract only when you see a clear pattern.

## Important Patterns

### Renderer State Management

All state lives in module-level variables (`tasks`, `taskLists`, `selectedListId`). On state change, call `renderTaskArea()` (main task area, in `tasks.js`) or a specific render function:
```javascript
async function selectTaskList(listId) {
  selectedListId = listId;
  renderTaskLists();
  await loadTasksForSelectedList();
}
```

Static, always-present elements are cached as top-level `const`s in the module that owns them (e.g. `taskList` in `tasks.js`, `sidebarLeftContent` in `taskLists.js`). For elements that come and go with re-renders (task rows, sidebar list buttons), query the DOM or use event delegation instead (see the `sidebarLeftContent` click handler in `taskLists.js`).

### IPC Communication

Renderer → Main: Use `window.googleTasks.*`, `window.windowControls.*`, or `window.windowSizing.*` (exposed in preload.js). `windowSizing.setLeftSidebarOpen` is an `invoke` rather than a `send` (unlike `windowControls`) because the renderer has to know when the resize has actually landed before it continues—see "Left Sidebar Window Resizing" below.  
Main → Renderer: Used for native `Menu` accelerators, plus the one systemwide shortcut registered outside the Menu. `main/menu.js` builds the app menu and each item sends a `menu:*` channel (e.g. `menu:new-task`) via `webContents.send`; `window.appMenu.on*` (exposed in preload.js) subscribes to these in `setupMenuListeners()` in `index.js`, which calls the same functions the equivalent keyboard shortcut would call. Separately, `main.js` registers `Cmd+Shift+'` via `globalShortcut` to toggle window visibility (not a menu accelerator, since it must work while the window isn't focused); on show it sends `app:shown`, exposed as `window.appVisibility.onShown` (preload.js), which the renderer uses only to restore focus to `addTaskInput`—hide/show doesn't reload the page, so the selected list and all other state survive untouched. State otherwise flows via explicit IPC invoke calls with Promise handling.

A shortcut should have exactly one owner. If it's backed by a menu accelerator, it must not also be handled in `handleGlobalKeydown`—a menu accelerator and the renderer's `keydown` listener both fire independently when the window has focus, so having both would double-run the action.

IPC handlers are thin wrappers; business logic (auth, API calls) lives in `main/auth.js` and `main/googleTasksClient.js`.

### Left Sidebar Window Resizing

The two sidebars behave differently. The **right** sidebar collapses the way both used to: it takes its space from `.main-content`. The **left** sidebar instead makes room for itself by widening the window—opening it grows the window by 220px, closing it shrinks the window back, and the window's `x` never moves, so only its right edge travels.

The renderer can't resize the window, so this is split across processes: `toggleSidebarLeft()` (`taskLists.js`) delegates to `toggleSidebarLeftWithWindow()` (`windowSizing.js`), which drives `window:setLeftSidebarOpen` → `main/sidebarWindowSizer.js`.

Two invariants make it work, and both are easy to break:

1. **The sidebar's width is derived, not transitioned.** While the window is resizing, `body.is-window-sizing` sets `--left-sidebar-live: clamp(0px, 100vw - var(--window-base-width), 220px)`—literally "the width the window has gained so far"—and the sidebar's `width`, the header's gradient seam, the toggle button and the offline message all read that one value. A CSS transition would be a second, independent timeline racing the OS resize; run even slightly ahead of the frame, it would claim space the window hasn't gained yet and squeeze the task area, which is the exact thing this feature exists to prevent. Don't reintroduce a width transition on `.sidebar-left` for the duration (opacity is fine—it isn't layout).

   This is also why `sidebarWindowSizer` steps the resize itself, a `setBounds` per frame, instead of using Electron's `animate` flag: Chromium doesn't lay the renderer out during a native animated resize, so `100vw` (and with it the sidebar) wouldn't move until the frame settled—the sidebar would pop in fully-formed at the end.

2. **The class flip happens at opposite ends of the resize.** Opening, `is-hidden` comes off *before* the window grows; closing, it goes on *after* the window has finished shrinking. Reverse either and the sidebar's space lands in the task area for as long as the resize takes. This is why `makePersistedToggle`'s `toggle()` is passed into `windowSizing.js` as a callback instead of being called directly—`restore()` still runs directly at launch, since the persisted window bounds already account for the sidebar.

`.main-content` is additionally pinned to its measured pixel width (`.is-width-pinned`) for the duration, which matters in the clamped case below.

**When the window can't grow the full 220px**—it's flush against the screen edge, maximized, or fullscreen—it grows by whatever it can (possibly nothing) and the sidebar takes the shortfall out of the task area, i.e. it degrades into the old behavior. Growth is deliberately clamped to the display work area rather than allowed offscreen: `body` sets `overflow: hidden`, so a window past the screen edge would push the right sidebar (and its notes field) somewhere unreachable. `sidebarWindowSizer` records what each open actually gained so the close gives back exactly that much.

### Async/Await Error Handling

Most IPC calls include try/catch with fallback rendering (e.g., in `loadTasksForSelectedList()`, errors leave previous tasks in place). Add messages to the UI for critical failures (see `loadTaskLists()` retry pattern).

On the main side, `handleTaskCall` (`main/ipc.js`) wraps each task endpoint and returns the fallback shape (e.g. `{ taskLists: [] }`) on **any** thrown error—so a genuine failure is indistinguishable from a real empty result. In particular an auth/permission error (e.g. a `403` from a token missing the `tasks` scope) looks identical to an empty account or an offline blip. **When data comes back unexpectedly empty, check the actual API response before concluding the account is empty**—the emptiness may be a swallowed error. A quick way to see the real result is to run the app's own `main/auth.js` + `main/googleTasksClient.js` against the stored token from a standalone Electron script (the token is `safeStorage`-encrypted, so it needs the Electron runtime, not plain Node, and the app name set to match `userData`).

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

**Scopes:** the app requests `tasks` plus `openid` and `email` (`SCOPES` in `main/auth.js`)—the identity scopes are only there to surface the signed-in account's email in the app menu (decoded from the `id_token`; see `getUserEmail`). Because Google uses *granular consent*, a user can approve the identity scopes while declining Tasks, producing a token that authenticates but `403`s on every Tasks call. Two guards handle this: `runSignInFlow` rejects a sign-in whose granted `scope` lacks `tasks` (reason `missing_scope`), and `getAuthStatus` reports a token without the `tasks` scope as signed-out so the renderer re-prompts instead of sitting in a broken "signed in but empty" state (see `hasTasksScope`). Tokens cached before the identity scopes were added simply report no email until the next re-auth.

## Testing & Verification

**Build verification:** Running `npm start` or `npm run make` to verify builds succeed is encouraged.

## Known Limitations & TODOs

This list reflects the state of the codebase at last edit and goes stale quickly—verify against the current code (e.g. `grep` for the function, check `git log`) before relying on it, and update or remove an item once it no longer holds:

- No local persistence to disk; task/list data is refreshed from Google Tasks on launch and then periodically via the focus-gated background poll (see "Background Sync (Polling)" above)—there's still no offline cache
- No error recovery UI for network failures (apart from retry buttons on critical errors)
- Linting is not configured (see `npm run lint`)
