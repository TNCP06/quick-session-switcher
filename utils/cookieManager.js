'use strict';

const SKIP_COOKIE_PATTERNS = [
  /^__cf_/,
  /^_cf/,
  /^cf_/,
  /^rc::/,
];

function shouldSkipCookie(name) {
  return SKIP_COOKIE_PATTERNS.some(pattern => pattern.test(name));
}

/* ================================================================
   SNAPSHOT
================================================================ */

/**
 * captureSessionCookies(domain) — Ambil semua cookies untuk domain.
 *
 * FIX v1.2: Query exhaustive — 4 variasi domain untuk pastikan semua
 * cookies tertangkap, termasuk yang stored dengan leading dot.
 *
 * Masalah sebelumnya: chrome.cookies.getAll({ domain: "chatgpt.com" })
 * di Brave kadang miss cookies yang stored sebagai ".chatgpt.com"
 * (dengan leading dot). __Secure-next-auth.session-token adalah salah
 * satunya — stored di ".chatgpt.com", miss saat query "chatgpt.com".
 *
 * Solusi: query 4 variasi sekaligus, deduplikasi hasilnya.
 */
async function captureSessionCookies(domain) {
  try {
    const cleanDomain = domain.startsWith('.') ? domain.slice(1) : domain;
    const withoutWww  = cleanDomain.replace(/^www\./, '');

    // Query semua variasi domain — Chrome/Brave matching tidak konsisten
    // antara "chatgpt.com" vs ".chatgpt.com" tergantung versi dan flag
    const queries = [
      { domain: cleanDomain },           // "chatgpt.com"
      { domain: withoutWww },            // "chatgpt.com" (tanpa www jika ada)
      { domain: `.${cleanDomain}` },     // ".chatgpt.com" — explicit dot prefix
      { domain: `.${withoutWww}` },      // ".chatgpt.com" (tanpa www)
    ];

    // Deduplikasi query list itu sendiri
    const seen = new Set();
    const uniqueQueries = queries.filter(q => {
      if (seen.has(q.domain)) return false;
      seen.add(q.domain);
      return true;
    });

    let allCookies = [];
    for (const q of uniqueQueries) {
      try {
        const cookies = await chromeGetAllCookies(q);
        if (cookies.length > 0) {
          console.log(`[CookieManager] Query "${q.domain}": ${cookies.length} cookies`);
        }
        allCookies = allCookies.concat(cookies);
      } catch (err) {
        // Jangan stop jika satu query gagal — lanjut query berikutnya
        console.warn(`[CookieManager] Query "${q.domain}" error:`, err.message);
      }
    }

    // Deduplikasi berdasarkan nama+domain+path
    const seenKeys = new Set();
    const sanitized = allCookies
      .filter(cookie => {
        const key = `${cookie.name}|${cookie.domain}|${cookie.path}`;
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      })
      .map(sanitizeCookie);

    // DEBUG: List semua nama cookie yang berhasil di-capture
    // Berguna untuk konfirmasi apakah __Secure-next-auth.session-token ada
    console.log(
      `[CookieManager] Captured ${sanitized.length} unique cookies dari "${domain}":\n` +
      sanitized.map(c => `  ${c.httpOnly ? '[HttpOnly] ' : ''}${c.name}`).join('\n')
    );

    return sanitized;

  } catch (err) {
    console.error('[CookieManager] captureSessionCookies error:', err);
    throw err;
  }
}

function sanitizeCookie(cookie) {
  return {
    name:           cookie.name,
    value:          cookie.value,
    domain:         cookie.domain,
    path:           cookie.path || '/',
    secure:         cookie.secure || false,
    httpOnly:       cookie.httpOnly || false,
    sameSite:       cookie.sameSite || 'unspecified',
    expirationDate: cookie.expirationDate,
  };
}

/* ================================================================
   RESTORE
================================================================ */

async function restoreSessionCookies(domain, cookies, tabUrl, storeId) {
  try {
    await clearDomainCookies(domain, storeId);
    return await injectCookies(cookies, tabUrl, storeId);
  } catch (err) {
    console.error('[CookieManager] restoreSessionCookies error:', err);
    throw err;
  }
}

async function clearDomainCookies(domain, storeId) {
  try {
    const cleanDomain = domain.startsWith('.') ? domain.slice(1) : domain;
    const query = { domain: cleanDomain };
    if (storeId) query.storeId = storeId;

    const cookies = await chromeGetAllCookies(query);
    if (!cookies || cookies.length === 0) return 0;

    const results = await Promise.allSettled(
      cookies.map(cookie => deleteSingleCookie(cookie, storeId))
    );
    return results.filter(r => r.status === 'fulfilled').length;
  } catch (err) {
    console.error('[CookieManager] clearDomainCookies error:', err);
    throw err;
  }
}

function deleteSingleCookie(cookie, storeId) {
  return new Promise((resolve, reject) => {
    const cleanDomain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
    const protocol    = cookie.secure ? 'https' : 'http';
    const url         = `${protocol}://${cleanDomain}${cookie.path || '/'}`;
    const details     = { url, name: cookie.name };
    if (storeId) details.storeId = storeId;

    chrome.cookies.remove(details, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result);
    });
  });
}

async function injectCookies(cookies, tabUrl, storeId) {
  let injected = 0, failed = 0, skipped = 0;
  const errors  = [];
  const isHttps = tabUrl.startsWith('https://');

  for (const cookie of cookies) {
    if (shouldSkipCookie(cookie.name)) {
      skipped++;
      continue;
    }

    try {
      await injectSingleCookie(cookie, isHttps, storeId);
      injected++;
    } catch (err) {
      failed++;
      errors.push({ cookieName: cookie.name, error: err.message });
      console.warn(`[CookieManager] Gagal inject "${cookie.name}":`, err.message);
    }
  }

  console.log(
    `[CookieManager] Inject selesai — injected: ${injected}, skipped: ${skipped}, failed: ${failed}`
  );
  return { injected, skipped, failed, errors };
}

function getCookiePrefix(name) {
  if (name.startsWith('__Host-'))   return '__Host-';
  if (name.startsWith('__Secure-')) return '__Secure-';
  return null;
}

function injectSingleCookie(cookie, isHttps, storeId) {
  return new Promise((resolve, reject) => {
    const cleanDomain = cookie.domain.startsWith('.')
      ? cookie.domain.slice(1)
      : cookie.domain;
    const prefix = getCookiePrefix(cookie.name);

    const forceHttps = prefix === '__Host-' || prefix === '__Secure-';
    const useHttps   = forceHttps ? true : (cookie.secure && isHttps);
    const protocol   = useHttps ? 'https' : 'http';
    const cookieUrl  = `${protocol}://${cleanDomain}${cookie.path || '/'}`;

    const cookieDetails = {
      url:      cookieUrl,
      name:     cookie.name,
      value:    cookie.value,
      path:     cookie.path || '/',
      secure:   useHttps,
      httpOnly: cookie.httpOnly || false,
      sameSite: normalizeSameSite(cookie.sameSite),
    };

    // __Host- dan __Secure- tidak boleh punya domain attribute eksplisit
    const stripDomain = prefix === '__Host-' || prefix === '__Secure-';
    if (!stripDomain) {
      cookieDetails.domain = cookie.domain;
    }

    if (cookie.expirationDate && typeof cookie.expirationDate === 'number') {
      cookieDetails.expirationDate = cookie.expirationDate;
    }

    if (storeId) cookieDetails.storeId = storeId;

    chrome.cookies.set(cookieDetails, (result) => {
      if (chrome.runtime.lastError) {
        console.warn(
          `[CookieManager] lastError "${cookie.name}":`,
          chrome.runtime.lastError.message,
          '| details:', JSON.stringify(cookieDetails)
        );
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!result) {
        reject(new Error(`Cookie "${cookie.name}" ditolak browser (null result)`));
        return;
      }

      // Verifikasi cookie masuk ke store yang benar
      const verifyDetails = { url: cookieUrl, name: cookie.name };
      if (storeId) verifyDetails.storeId = storeId;

      chrome.cookies.get(verifyDetails, (check) => {
        if (chrome.runtime.lastError) {
          // Store mungkin sudah tutup — anggap OK karena set() return non-null
          resolve();
          return;
        }
        if (!check) {
          reject(new Error(
            `Silent drop "${cookie.name}" — set() OK tapi tidak ada di store "${storeId || 'default'}"`
          ));
          return;
        }
        resolve();
      });
    });
  });
}

function normalizeSameSite(value) {
  if (!value) return 'unspecified';
  switch (value.toLowerCase()) {
    case 'no_restriction': return 'no_restriction';
    case 'none':           return 'no_restriction';
    case 'lax':            return 'lax';
    case 'strict':         return 'strict';
    default:               return 'unspecified';
  }
}

/* ================================================================
   UTILITAS
================================================================ */

function getDomainFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function chromeGetAllCookies(details) {
  return new Promise((resolve, reject) => {
    chrome.cookies.getAll(details, (cookies) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(cookies || []);
    });
  });
}

/* ================================================================
   EXPORT
================================================================ */
globalThis.cookieManager = {
  captureSessionCookies,
  restoreSessionCookies,
  clearDomainCookies,
  injectCookies,
  getDomainFromUrl,
};