'use strict';

importScripts(
  'utils/storageManager.js',
  'utils/cookieManager.js'
);

/* ================================================================
   MESSAGE HANDLER UTAMA
================================================================ */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.tab && sender.frameId !== undefined) {
    return false;
  }
  handleMessage(message, sendResponse);
  return true;
});

async function handleMessage(message, sendResponse) {
  const { action, payload } = message;
  console.log(`[Background] Received action: ${action}`, payload || '');

  try {
    switch (action) {
      case 'SAVE_SESSION':
        await handleSaveSession(payload, sendResponse);
        break;
      case 'LOAD_SESSION':
        await handleLoadSession(payload, sendResponse);
        break;
      case 'DELETE_SESSION':
        await handleDeleteSession(payload, sendResponse);
        break;
      case 'GET_ALL_SESSIONS':
        await handleGetAllSessions(sendResponse);
        break;
      case 'CLEAR_CURRENT_COOKIES':
        await handleClearCurrentCookies(sendResponse);
        break;
      default:
        sendResponse({ success: false, error: `Action tidak dikenal: ${action}` });
    }
  } catch (err) {
    console.error(`[Background] Unexpected error handling ${action}:`, err);
    sendResponse({ success: false, error: err.message });
  }
}

/* ================================================================
   HANDLER PER ACTION
================================================================ */

async function handleSaveSession(payload, sendResponse) {
  const { name } = payload;

  if (!name || typeof name !== 'string' || !name.trim()) {
    sendResponse({ success: false, error: 'Nama session tidak boleh kosong' });
    return;
  }

  const tab = await getActiveTab();
  if (!tab || !tab.url) {
    sendResponse({ success: false, error: 'Tidak bisa membaca tab aktif' });
    return;
  }

  const domain = cookieManager.getDomainFromUrl(tab.url);
  if (!domain) {
    sendResponse({ success: false, error: 'URL tab tidak valid' });
    return;
  }

  const extraDomains = getExtraDomains(domain);
  const allDomains = [domain, ...extraDomains];
  let allCookies = [];

  for (const d of allDomains) {
    const cookies = await cookieManager.captureSessionCookies(d);
    allCookies = allCookies.concat(cookies);
  }

  const seen = new Set();
  const uniqueCookies = allCookies.filter(c => {
    const key = `${c.name}|${c.domain}|${c.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (uniqueCookies.length === 0) {
    sendResponse({
      success: false,
      error: `Tidak ada cookies ditemukan untuk ${domain}. Pastikan Anda sudah login.`
    });
    return;
  }

  const sessionId   = `session_${Date.now()}`;
  const sessionData = {
    name:        name.trim(),
    domain,
    extraDomains,
    savedAt:     Date.now(),
    cookieCount: uniqueCookies.length,
    cookies:     uniqueCookies,
  };

  await storageManager.saveSession(sessionId, sessionData);
  sendResponse({ success: true });
}

function getExtraDomains(domain) {
  if (domain.includes('youtube.com') || domain.includes('google.com')) {
    return ['google.com', 'accounts.google.com', 'youtube.com'];
  }
  if (domain.includes('openai.com') || domain.includes('chatgpt.com')) {
    return ['openai.com', 'auth.openai.com'];
  }
  if (domain.includes('gmail.com')) {
    return ['google.com', 'accounts.google.com', 'mail.google.com'];
  }
  return [];
}

async function handleLoadSession(payload, sendResponse) {
  const { sessionId } = payload;

  if (!sessionId) {
    sendResponse({ success: false, error: 'sessionId diperlukan' });
    return;
  }

  const session = await storageManager.getSession(sessionId);
  if (!session) {
    sendResponse({ success: false, error: 'Session tidak ditemukan' });
    return;
  }

  const targetUrl = `https://${session.domain}/`;

  // Buka tab baru ke domain session
  const newTab = await createTab(targetUrl);
  const storeId = resolveStoreId(newTab);

  console.log(
    `[Background] handleLoadSession (new tab): tabId=${newTab.id}, ` +
    `incognito=${newTab.incognito}, storeId="${storeId}"`
  );

  // Hapus cookies lama untuk semua domain terkait session
  const allDomains = [session.domain, ...(session.extraDomains || [])];
  for (const d of allDomains) {
    await cookieManager.clearDomainCookies(d, storeId);
  }

  // Inject cookies session ke store tab baru
  const result = await cookieManager.injectCookies(
    session.cookies,
    targetUrl,
    storeId
  );

  if (result.failed > 0) {
    console.warn(`[Background] ${result.failed} cookies gagal di-inject:`, result.errors);
  }

  // Reload tab baru agar halaman membaca cookies yang baru di-inject
  await reloadTab(newTab.id);

  sendResponse({ success: true, data: { injected: result.injected, failed: result.failed } });
}

async function handleClearCurrentCookies(sendResponse) {
  const tab = await getActiveTab();
  if (!tab || !tab.url) {
    sendResponse({ success: false, error: 'Tidak bisa membaca tab aktif' });
    return;
  }

  const domain = cookieManager.getDomainFromUrl(tab.url);
  if (!domain) {
    sendResponse({ success: false, error: 'URL tab tidak valid' });
    return;
  }

  const storeId = resolveStoreId(tab);
  const cleared = await cookieManager.clearDomainCookies(domain, storeId);

  await reloadTab(tab.id);
  sendResponse({ success: true, data: { cleared } });
}

async function handleDeleteSession(payload, sendResponse) {
  const { sessionId } = payload;
  if (!sessionId) {
    sendResponse({ success: false, error: 'sessionId diperlukan' });
    return;
  }
  await storageManager.deleteSession(sessionId);
  sendResponse({ success: true });
}

async function handleGetAllSessions(sendResponse) {
  const sessions = await storageManager.getAllSessions();
  sendResponse({ success: true, data: sessions });
}

/* ================================================================
   PRIVATE HELPERS
================================================================ */

/**
 * resolveStoreId(tab) — Resolve cookie store ID yang benar dari tab object.
 *
 * MASALAH:
 * Brave mengembalikan tab.cookieStoreId sebagai undefined meski extension
 * punya permission "cookies". Ini menyebabkan semua inject masuk ke
 * default store (normal window) bukan incognito store.
 *
 * SOLUSI:
 * Gunakan tab.incognito boolean (selalu reliable) sebagai fallback.
 * Di semua Chromium-based browsers, store ID adalah konstanta:
 *   Normal window:    cookieStoreId = "0"
 *   Incognito window: cookieStoreId = "1"
 *
 * @param {chrome.tabs.Tab} tab
 * @returns {string} - "0" untuk normal, "1" untuk incognito
 */
function resolveStoreId(tab) {
  if (tab.cookieStoreId && tab.cookieStoreId !== 'undefined') {
    return tab.cookieStoreId;
  }
  // Fallback: derive dari incognito flag
  return tab.incognito ? '1' : '0';
}

/**
 * getActiveTab() — Ambil tab aktif di window yang sedang difokus user.
 *
 * lastFocusedWindow:true (bukan currentWindow:true) karena popup
 * extension punya windowId sendiri yang bisa menyebabkan currentWindow
 * resolve ke window yang salah saat incognito aktif.
 */
function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        console.error('[Background] getActiveTab error:', chrome.runtime.lastError.message);
        resolve(null);
        return;
      }

      if (!tabs || tabs.length === 0) {
        console.warn('[Background] getActiveTab: tidak ada tab aktif ditemukan');
        resolve(null);
        return;
      }

      const tab = tabs[0];
      console.log(
        `[Background] getActiveTab: id=${tab.id}, incognito=${tab.incognito}, ` +
        `cookieStoreId="${tab.cookieStoreId}", url=${tab.url}`
      );
      resolve(tab);
    });
  });
}

/**
 * createTab(url) — Buka tab baru dan kembalikan tab object-nya.
 */
function createTab(url) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: true }, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tab);
    });
  });
}

/**
 * reloadTab(tabId) — Reload tab berdasarkan ID.
 */
function reloadTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.reload(tabId, {}, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

console.log('[Background] Service Worker aktif dan siap menerima pesan.');