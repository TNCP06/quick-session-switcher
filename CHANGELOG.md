# Changelog

All notable changes to this project will be documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Fixed
- `handleLoad` in popup now shows an error toast with the failed count when cookie injection partially fails, instead of always reporting success
- `getExtraDomains` in background now filters the primary domain from its own return value, preventing redundant double-queries on save and double-clears on load
- `handleSaveSession` in background validates session name length ≤ 40 chars on the backend (mirrors frontend `maxlength`)
- Removed `console.debug` from `cookieManager.js` per commit-hygiene rule

---

## [1.0.0] — 2025-04-25

### Added
- Cookie snapshot and restore via `chrome.cookies` API
- Service Worker (`background.js`) handles all cookie and storage operations
- Popup UI (`popup/popup.js`) with session list, save, load, delete, and clear-cookies actions
- `cookieManager.js` — 4-variant domain query to capture cookies correctly on both Chrome and Brave
- `storageManager.js` — atomic read-modify-write pattern for `chrome.storage.local`
- `resolveStoreId()` workaround for Brave's broken `tab.cookieStoreId`
- `getExtraDomains()` for multi-subdomain sites (Google, YouTube, OpenAI)
- `SKIP_COOKIE_PATTERNS` for non-portable cookies (`__cf_*`, `rc::*`)
- `__Host-` and `__Secure-` prefix handling — strips `domain` attribute on inject
- Incognito window support via `incognito: "spanning"` in manifest
- Silent-drop verification via `chrome.cookies.get()` after every `chrome.cookies.set()`

[Unreleased]: https://github.com/TNCP06/quick-session-switcher/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/TNCP06/quick-session-switcher/releases/tag/v1.0.0
