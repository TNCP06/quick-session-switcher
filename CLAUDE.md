# Quick Session Switcher — Project Rules

## Session Start (run every session, no exceptions)

```
git fetch origin
git status
git log --oneline -5
git log --oneline origin/main -3
```

Then automatically:
1. If `origin/main` is ahead of local `main` → `git fetch origin main:main`
2. If current branch is clean and behind upstream → `git pull`
3. Check `PENDING_COMMIT.md` vs `git log`:
   - Pending commit already in log → clear the file
   - Pending commit not yet committed → fold or propose committing first

**Claude NEVER runs `git commit`** — write the command to `PENDING_COMMIT.md` and let the user run it. A hook will block any attempt to run `git commit` directly.

---

## Documentation Syncing (Continuous Requirement)

Whenever structural, logical, or flow changes are made during a session, the AI **MUST** evaluate and update the documentation in the `docs/` folder accordingly:
1. **Business Flow changes** (new user actions, modified system behaviors) → Update `docs/BUSINESS_FLOW.md`.
2. **Architecture changes** (new components, altered API interactions, new storage mechanisms) → Update `docs/ARCHITECTURE.md`.
3. **File changes** (new files created, files renamed, or core responsibilities altered) → Update `docs/CODE_MAP.md`.
4. **General changes** (setup, installation, or user-facing overview) → Update `README.md`.

Never leave the documentation out of sync with the codebase.

---

## Collaboration Style

Before implementing any request, evaluate whether it's the right call:

- **Clearly good** (bug fix, simple improvement, follows existing patterns) → execute directly, no preamble
- **Questionable** (adds complexity, has a simpler alternative, might have unintended side effects, feels like YAGNI) → state the concern in 1–2 sentences, give a recommendation, let the user decide
- **Clearly bad** (security risk, contradicts architecture rules, destructive, over-engineering without benefit) → push back by default, explain why briefly, proceed only if the user explicitly insists

Do not be a yes-machine. Act like a senior collaborator. A good response to a questionable request is "ini punya alternatif lebih sederhana: X" or "ini menambah kompleksitas tanpa manfaat nyata karena Y."

Calibration: this review applies to requests with architectural, complexity, or directional impact. Do not over-analyze trivial changes (renaming, minor UI tweaks, typo fixes) — just execute those.

## Suggestions Log

During any session (code review, bug fix, feature work), if an improvement opportunity is spotted but is out of scope for the current task, add it to `SUGGESTIONS.md` — do **not** execute it.

Rules:
- Each entry needs: what, why it would help, and rough effort (low / medium / high)
- Group by category: `Bug`, `Improvement`, `Feature`, `Chore`
- Do **not** execute suggestions from `SUGGESTIONS.md` unless the user explicitly asks — never auto-pick them at the start of a session
- Remove an entry once it has been implemented or deliberately decided against

## Architecture

This is a **Chrome Extension Manifest V3** project. Three execution contexts exist and must stay separate:

- **Service Worker** (`background.js`) — handles all `chrome.cookies` and `chrome.storage` API calls
- **Popup** (`popup/popup.js`) — UI only; communicates with background via `chrome.runtime.sendMessage`
- **Utils** (`utils/`) — imported into the service worker via `importScripts()`

**Never** access `chrome.cookies` directly from `popup.js`. All cookie operations go through `background.js`.

## Message Protocol

All popup→background communication uses `{ action: string, payload?: Object }`.  
All responses must be `{ success: boolean, data?: any, error?: string }`.

When adding a new action:
1. Add the `case` in `background.js` `handleMessage()` switch
2. Add a dedicated `handle*()` function — no inline logic in the switch
3. Send response via `sendResponse()`, never throw without catching

## Cookie Handling Rules

- Always query **4 domain variants** (with/without dot prefix, with/without www) — see `captureSessionCookies()`. Chrome and Brave handle stored cookie domains inconsistently.
- Deduplicate by `name|domain|path` key before storing.
- Skip non-portable cookies via `SKIP_COOKIE_PATTERNS` (Cloudflare `__cf_*`, reCAPTCHA `rc::*`). Add new patterns to that array, not inline.
- `__Host-` and `__Secure-` prefixed cookies must NOT have a `domain` attribute on inject — see `injectSingleCookie()`.
- Always verify injection via `chrome.cookies.get()` after `chrome.cookies.set()` to catch silent drops (Brave bug).

### Adding Support for a New Site

If a new site uses multiple auth subdomains (e.g. `auth.example.com`, `api.example.com`), add a case to `getExtraDomains()` in `background.js`. This function is the single source of truth for which extra domains are captured and cleared alongside the primary domain. Without an entry here, subdomain cookies will be missed on both save and load.

## Storage Rules

- All `chrome.storage.local` access must go through `storageManager`. `background.js` must not call `chrome.storage` directly.
- All sessions live under a single `"sessions"` key. Use the read-modify-write pattern in `saveSession()` and `deleteSession()` — never partial-set.
- `chrome.storage.sync` is off-limits for cookies (100 KB limit). Local only.

### Storage Schema Migration

The `sessionData` shape is currently:
```
{ name, domain, extraDomains, savedAt, cookieCount, cookies }
```

If a new field is added, always read it with a fallback (`session.newField ?? default`) so existing stored sessions don't break. Never assume a field exists without a default — users may have sessions saved from an older version.

## Error Handling

- All `async` functions in `background.js` and `utils/` must `try/catch` and either rethrow or `sendResponse({ success: false, error: err.message })`.
- Use `Promise.allSettled()` for batch operations where partial failure is acceptable (see `clearDomainCookies`).
- Always check `chrome.runtime.lastError` inside every callback that invokes a Chrome API.

## Security

- Never use `innerHTML` to render user-supplied content. Use `textContent` or `createElement` — see `createSessionItem()`.
- Cookie values are stored plain text in `chrome.storage.local`. Do not log full cookie values — log names only.
- Validate all `payload` fields in each `handle*()` function before using them (check for empty string, wrong type).

## Compatibility

- `resolveStoreId()` handles Brave's broken `cookieStoreId`. When reading a tab's cookie store, always call this helper — never read `tab.cookieStoreId` directly.
- Tab queries use different window targets depending on context:
  - `background.js` → `lastFocusedWindow: true` — because the extension popup has its own `windowId` and `currentWindow` would resolve to the popup's window, not the user's browser window.
  - `popup.js` → `currentWindow: true` — correct here because the popup is attached to the browser window the user is looking at.
  Do not swap these.
- `importScripts()` is used over ES Modules for broader MV3 compatibility. Exports use `globalThis.*` namespace. If migrating to ES Modules, update all `importScripts` calls and `globalThis` assignments together.

## Manifest Permissions

- Do not add permissions beyond what is currently in `manifest.json` without documenting the reason.
- `<all_urls>` in `host_permissions` is required for cross-domain cookie injection. Do not remove it.
- `incognito: "spanning"` is intentional — the extension must work in incognito windows.

## Code Style

- `'use strict'` at the top of every JS file.
- Constants in `SCREAMING_SNAKE_CASE` at the file top.
- Async/await everywhere — no raw `.then()` chains.
- Section dividers use the full-width format: `/* ================================================================ */`. Maintain this grouping when adding new functions.
- Comments explain *why*, never *what*. Only add one when there is a hidden constraint, browser quirk, or known bug that would surprise a reader.
- Logging convention:
  - `console.log` — permanent operational logs, always prefixed with `[ModuleName]` (e.g. `[Background]`, `[CookieManager]`)
  - `console.warn` — non-fatal issues (partial inject failure, skipped cookie)
  - `console.error` — caught errors before rethrowing or returning a failure response
  - `console.debug` — verbose logs only needed during development; safe to remove before merging

## Known Dead Code

`restoreSessionCookies()` in `utils/cookieManager.js` is exported but not called — `background.js` calls `clearDomainCookies()` and `injectCookies()` directly. Do not remove it without verifying no external callers, but do not build new flows on top of it without updating `background.js` to use it consistently.

## Git Workflow

### Branches

- `main` — production-ready only. Never commit directly to `main`.
- Feature branches: `feat/<short-description>` (e.g. `feat/export-sessions`)
- Bug fix branches: `fix/<short-description>` (e.g. `fix/brave-cookie-storeId`)
- Chore/refactor branches: `chore/<short-description>` (e.g. `chore/cleanup-popup-css`)

Branch names use kebab-case, no uppercase, no slashes beyond the type prefix.

### Commit Messages

Follow **Conventional Commits**:

```
<type>(<scope>): <short description>

[optional body — only for non-obvious why]
```

**Types:** `feat`, `fix`, `chore`, `refactor`, `docs`, `style`, `test`  
**Scopes:** `background`, `popup`, `cookies`, `storage`, `manifest`, `utils`

Examples:
```
feat(cookies): add 4-variant domain query for Brave compatibility
fix(background): use lastFocusedWindow to resolve incognito tab correctly
chore(manifest): bump version to 1.1.0
refactor(storage): extract chromeStorageGet into shared wrapper
```

Rules:
- Subject line max 72 characters, lowercase, no period at end.
- Use imperative mood ("add", "fix", "remove" — not "added", "fixes").
- Body only when the commit needs context that isn't obvious from the diff.
- Do not reference issue numbers in the subject line — put them in the body.

### Pull Requests

- Every feature or fix goes through a PR, even when working solo.
- PR title follows the same Conventional Commits format as the commit subject.
- PR description must include:
  - **What** changed (1–3 bullets)
  - **Why** it was needed (bug, feature request, browser quirk)
  - **How to test** — specific steps (e.g. "Open ChatGPT, save session, load in incognito")
  - **Browser tested** — at minimum Chrome + Brave
- Squash merge into `main`. One PR = one squashed commit on `main`.
- Delete the source branch after merge.

### Tags & Releases

- Version string lives in two places: `manifest.json` (`"version"`) and `popup.html` footer (`.version-tag`). Never update one without the other.
- Do NOT bump the version on every commit — only on release.
- Patch (`v1.0.x`) — bug fixes, no new permissions.
- Minor (`v1.x.0`) — new features, backwards-compatible.
- Major (`vX.0.0`) — breaking change to storage schema, new required permissions, or manifest restructure.
- When the user says "release" or "release as vX.Y.Z": determine the semver type from the `[Unreleased]` section in `CHANGELOG.md`, then automatically: (1) update `manifest.json` version, (2) update `popup.html` footer version, (3) move `[Unreleased]` entries to a new `## [x.y.z] — YYYY-MM-DD` section in CHANGELOG, (4) update the comparison links at the bottom of CHANGELOG.
- Tag every release on `main` as `v<semver>`. Write a GitHub Release note that mirrors the CHANGELOG entry.

### Commit Hygiene

- Never commit `.env` files, API keys, or personal session data.
- `node_modules/` and `*.zip`/`*.crx` build artifacts are already in `.gitignore` — keep them out.
- Remove `console.debug` calls before merging. Permanent `console.log` with a module prefix is fine to keep.

### Git Execution Rules

Claude executes git commands directly rather than listing them for the user to run manually. The one exception is `git commit`.

**Claude runs autonomously** (no user action needed):
- Read-only: `git fetch`, `git status`, `git log`, `git diff`, `git branch`
- Sync: `git fetch origin main:main` (session-start main update), `git pull`
- State changes: `git stash`, `git checkout`, `git switch`, branch create/delete, `git push`, `gh pr create`

**Claude NEVER runs `git commit`** — always write the exact commit command to `PENDING_COMMIT.md` and let the user run it. Reason: `git commit` via Claude adds a "Co-Authored-By: Claude" line that appears in public GitHub history.

**Propose before executing** — the Collaboration Style review (clearly good / questionable / clearly bad) applies to git operations too. State-changing operations that alter branch context or history (checkout to a different branch, stash + rebranch, force-push) are "questionable" and must be proposed with a 1–2 sentence rationale before Claude runs them. Read-only and simple sync operations (fetch, pull, push a branch the user just asked to push) are "clearly good" and can run without asking.

### Pending Changes Log

**At the start of every session**, run the following in order:

```bash
git fetch origin
git status
git log --oneline -5
git log --oneline origin/main -3  # compare remote main
```

Then execute these steps **automatically** — do not wait for the user to ask:

1. **Sync local `main` with remote** — always check if `origin/main` is ahead of local `main`, even when on a feature branch. If so, update local main immediately using `git fetch origin main:main` (safe: no checkout, no working-tree impact). This keeps the local reference accurate without disturbing uncommitted work. Only skip if local `main` has diverged (non-fast-forward) — in that case warn: "main lokal diverged, perlu manual check."

2. **Pull current branch** — if the current branch is clean (no uncommitted changes) AND behind its upstream, run `git pull` automatically. If the working tree is dirty, skip the pull and warn: "ada perubahan belum di-commit, selesaikan dulu sebelum pull."

3. **PENDING_COMMIT.md check** — cross-check the file against `git log`:
   - Uncommitted changes still exist → previous session was never committed. Decide:
     - **Unrelated new work** → suggest committing/pushing first before continuing
     - **Related or overlapping work** → fold new changes into the existing pending entry, update the file
   - Pending commit already appears in `git log` → clear `PENDING_COMMIT.md` and start fresh
   - Working tree is on a branch that has already been merged into `origin/main` → offer to move uncommitted work onto a new branch from main (`git stash → git checkout -b <new-branch> main → git stash pop`)

**After every session where code is modified**, always overwrite `PENDING_COMMIT.md` with:

- **Status** — current git state (branch, uncommitted files)
- **Branch** — suggested branch name following the naming conventions above
- **Commit** — full commit message following Conventional Commits format above
- **Changed** — 1–3 bullet points of what changed
- **Commands** — exact terminal commands to create the branch, stage the right files, commit, push, and open a PR

Rules:
- Overwrite on each update — do not append history
- Clear the file after a commit lands on `main`
- Always derive branch type and scope from the actual changes, not from what was asked
- If changes span multiple scopes, list all in the commit subject (e.g. `fix(popup,background):`)
