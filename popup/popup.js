/**
 * popup.js — Quick Session Switcher
 * ===================================
 * Bertanggung jawab atas:
 * 1. Inisialisasi popup saat dibuka
 * 2. Render daftar session dari storage
 * 3. Handle event: Save, Load, Delete
 * 4. Komunikasi ke background.js via chrome.runtime.sendMessage
 * 5. Feedback UI: toast, status dot, loading state
 *
 * ARSITEKTUR KOMUNIKASI:
 * popup.js  →  chrome.runtime.sendMessage({ action, payload })
 *                    ↓
 *             background.js (mendengarkan via chrome.runtime.onMessage)
 *                    ↓
 *             chrome.cookies API + chrome.storage.local
 *                    ↓
 *             response: { success: true/false, data, error }
 *
 * Kenapa semua operasi cookies lewat background.js dan tidak langsung
 * dari popup.js?
 * → chrome.cookies API hanya dapat diakses dari Service Worker (background)
 *   atau extension pages yang memiliki izin penuh. Popup bisa mengaksesnya
 *   secara teknis, tapi Service Worker lebih andal karena tidak terikat
 *   lifecycle popup yang bisa tertutup kapan saja.
 */

'use strict';

/* ── KONSTANTA ────────────────────────────────────────────────── */

/** Warna avatar berdasarkan index session (index % AVATAR_COLORS.length) */
const AVATAR_COLORS = ['avatar-purple', 'avatar-green', 'avatar-amber', 'avatar-rose'];

/** Durasi toast tampil sebelum hilang (ms) */
const TOAST_DURATION = 2200;

/* ── REFERENSI ELEMEN DOM ─────────────────────────────────────── */
/*
  Semua elemen di-cache di awal agar tidak perlu querySelector
  berulang kali saat render. Lebih performa dan lebih mudah dibaca.
*/
const $ = {
  currentDomain:    document.getElementById('current-domain'),
  sessionNameInput: document.getElementById('session-name-input'),
  btnSave:          document.getElementById('btn-save'),
  sessionList:      document.getElementById('session-list'),
  sessionCount:     document.getElementById('session-count'),
  emptyState:       document.getElementById('empty-state'),
  statusDot:        document.getElementById('status-dot'),
  statusText:       document.getElementById('status-text'),
  toast:            document.getElementById('toast'),
};

/* ── STATE LOKAL ──────────────────────────────────────────────── */
/*
  Menyimpan ID session yang sedang aktif (terakhir di-load).
  Digunakan untuk menandai item dengan class .is-active di UI.
  Nilai null berarti belum ada session yang di-load sejak popup dibuka.
*/
let activeSessionId = null;

/* ================================================================
   INISIALISASI
================================================================ */

/**
 * init() — Titik masuk utama, dipanggil saat popup.html selesai dimuat.
 *
 * Urutan:
 * 1. Tampilkan domain tab aktif di header
 * 2. Load dan render daftar session dari storage
 * 3. Pasang event listener untuk tombol Save dan input Enter
 */
async function init() {
  setStatus('loading', 'Memuat…');

  try {
    // 1. Ambil domain tab aktif untuk ditampilkan di header badge
    const domain = await getCurrentDomain();
    $.currentDomain.textContent = domain || '—';

    // 2. Render session list dari storage
    await refreshSessionList();

    // 3. Event listeners
    $.btnSave.addEventListener('click', handleSave);

    // Tekan Enter di input = klik Save
    $.sessionNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSave();
    });

    setStatus('ready', 'Storage ready');

  } catch (err) {
    console.error('[SessionSwitcher] init error:', err);
    setStatus('error', 'Gagal memuat');
    showToast('Error saat inisialisasi', 'error');
  }
}

/* ================================================================
   FUNGSI UTAMA: SAVE, LOAD, DELETE
================================================================ */

/**
 * handleSave() — Mengambil cookies tab aktif dan menyimpannya sebagai session baru.
 *
 * Flow:
 * 1. Validasi nama session tidak kosong
 * 2. Set UI ke loading state
 * 3. Kirim pesan 'SAVE_SESSION' ke background.js
 * 4. Refresh list + tampilkan feedback
 */
async function handleSave() {
  const name = $.sessionNameInput.value.trim();

  if (!name) {
    $.sessionNameInput.focus();
    $.sessionNameInput.style.borderColor = '#f43f5e';
    setTimeout(() => { $.sessionNameInput.style.borderColor = ''; }, 1200);
    return;
  }

  setLoadingState(true);
  setStatus('loading', 'Menyimpan session…');

  try {
    // Kirim perintah ke background.js
    const response = await sendMessage({ action: 'SAVE_SESSION', payload: { name } });

    if (response.success) {
      $.sessionNameInput.value = '';
      await refreshSessionList();
      showToast(`✓ "${name}" tersimpan`, 'success');
      setStatus('ready', 'Storage ready');
    } else {
      throw new Error(response.error || 'Gagal menyimpan');
    }

  } catch (err) {
    console.error('[SessionSwitcher] handleSave error:', err);
    showToast('Gagal menyimpan session', 'error');
    setStatus('error', err.message);
  } finally {
    // Selalu kembalikan UI ke normal meski error
    setLoadingState(false);
  }
}

/**
 * handleLoad(sessionId) — Inject cookies dari session tersimpan ke tab aktif.
 *
 * @param {string} sessionId - Key unik session di storage
 *
 * Flow:
 * 1. Set UI loading
 * 2. Kirim 'LOAD_SESSION' ke background.js
 * 3. Background akan: hapus cookies lama → inject baru → reload tab
 * 4. Update activeSessionId → re-render list
 */
async function handleLoad(sessionId) {
  setLoadingState(true);
  setStatus('loading', 'Memuat session…');

  try {
    const response = await sendMessage({ action: 'LOAD_SESSION', payload: { sessionId } });

    if (response.success) {
      activeSessionId = sessionId;
      await refreshSessionList(); // re-render agar badge .is-active terupdate
      showToast('✓ Session berhasil dimuat', 'success');
      setStatus('ready', 'Session aktif');

      /*
        Tab akan di-reload oleh background.js.
        Popup Chrome otomatis tertutup saat tab di-reload,
        tapi kita tetap update UI sebelum itu terjadi
        untuk menghindari flash state yang salah.
      */
    } else {
      throw new Error(response.error || 'Gagal memuat session');
    }

  } catch (err) {
    console.error('[SessionSwitcher] handleLoad error:', err);
    showToast('Gagal memuat session', 'error');
    setStatus('error', err.message);
  } finally {
    setLoadingState(false);
  }
}

/**
 * handleDelete(sessionId, sessionName) — Hapus session dari storage.
 *
 * @param {string} sessionId   - Key unik session
 * @param {string} sessionName - Nama session (untuk pesan konfirmasi)
 *
 * Tidak ada konfirmasi dialog karena:
 * a) Extension popup terlalu kecil untuk dialog
 * b) Aksi ini reversible (user bisa save ulang)
 * c) Toast memberikan feedback cukup
 */
async function handleDelete(sessionId, sessionName) {
  setLoadingState(true);

  try {
    const response = await sendMessage({ action: 'DELETE_SESSION', payload: { sessionId } });

    if (response.success) {
      // Jika session yang dihapus adalah yang aktif, reset activeSessionId
      if (activeSessionId === sessionId) activeSessionId = null;

      await refreshSessionList();
      showToast(`"${sessionName}" dihapus`, 'success');
    } else {
      throw new Error(response.error || 'Gagal menghapus');
    }

  } catch (err) {
    console.error('[SessionSwitcher] handleDelete error:', err);
    showToast('Gagal menghapus session', 'error');
  } finally {
    setLoadingState(false);
  }
}

/* ================================================================
   RENDER UI
================================================================ */

/**
 * refreshSessionList() — Ambil semua session dari storage lalu render ulang.
 *
 * Dipanggil setiap kali ada perubahan data (save, load, delete).
 * Pendekatan "full re-render" dipilih karena:
 * - Data session kecil (< 50 item realistis)
 * - Lebih mudah dipahami daripada partial DOM update
 * - Tidak ada performa issue di skala ini
 */
async function refreshSessionList() {
  const response = await sendMessage({ action: 'GET_ALL_SESSIONS' });

  if (!response.success) {
    console.error('[SessionSwitcher] Gagal mengambil sessions:', response.error);
    return;
  }

  const sessions = response.data || {};
  renderSessionList(sessions);
}

/**
 * renderSessionList(sessions) — Buat elemen DOM untuk setiap session.
 *
 * @param {Object} sessions - Object dari storage: { [sessionId]: sessionData }
 *
 * Format sessionData:
 * {
 *   name: string,
 *   domain: string,
 *   savedAt: number (timestamp),
 *   cookieCount: number
 * }
 */
function renderSessionList(sessions) {
  const entries = Object.entries(sessions);

  // Update counter di header list
  $.sessionCount.textContent = `${entries.length} session${entries.length !== 1 ? 's' : ''}`;

  // Toggle empty state vs list
  if (entries.length === 0) {
    $.sessionList.style.display = 'none';
    $.emptyState.style.display  = 'flex';
    return;
  }

  $.emptyState.style.display  = 'none';
  $.sessionList.style.display = 'flex';

  // Sort: session terbaru di atas
  entries.sort((a, b) => (b[1].savedAt || 0) - (a[1].savedAt || 0));

  // Bersihkan list lama sebelum isi ulang
  $.sessionList.innerHTML = '';

  entries.forEach(([sessionId, sessionData], index) => {
    const item = createSessionItem(sessionId, sessionData, index);
    $.sessionList.appendChild(item);
  });
}

/**
 * createSessionItem(sessionId, data, index) — Buat satu elemen .session-item.
 *
 * @param {string} sessionId  - Key unik session
 * @param {Object} data       - Data session (name, domain, savedAt, cookieCount)
 * @param {number} index      - Urutan untuk warna avatar
 * @returns {HTMLElement}
 *
 * Kenapa createElement dan bukan innerHTML string?
 * → Lebih aman dari XSS: nama session yang mengandung HTML tag
 *   tidak akan di-parse sebagai HTML karena kita set .textContent,
 *   bukan .innerHTML.
 */
function createSessionItem(sessionId, data, index) {
  const isActive = sessionId === activeSessionId;
  const avatarColor = AVATAR_COLORS[index % AVATAR_COLORS.length];
  const initial = (data.name || '?')[0].toUpperCase();
  const timeAgo = formatTimeAgo(data.savedAt);
  const cookieLabel = `${data.cookieCount || 0} cookies`;

  // ── Wrapper item ──
  const item = document.createElement('div');
  item.className = `session-item${isActive ? ' is-active' : ''}`;
  item.dataset.sessionId = sessionId;

  // ── Avatar ──
  const avatar = document.createElement('div');
  avatar.className = `session-avatar ${avatarColor}`;
  avatar.textContent = initial;

  // ── Info ──
  const info = document.createElement('div');
  info.className = 'session-info';

  const nameEl = document.createElement('div');
  nameEl.className = 'session-name';
  nameEl.textContent = data.name; // textContent = aman dari XSS

  const metaEl = document.createElement('div');
  metaEl.className = 'session-meta';
  // Tanda ● untuk session aktif
  metaEl.textContent = `${isActive ? '● active · ' : ''}${timeAgo} · ${cookieLabel}`;

  info.appendChild(nameEl);
  info.appendChild(metaEl);

  // ── Action buttons ──
  const actions = document.createElement('div');
  actions.className = 'session-actions';

  const btnLoad = document.createElement('button');
  btnLoad.className = 'btn-load';
  btnLoad.textContent = 'Load';
  // Gunakan closure untuk capture sessionId yang benar
  btnLoad.addEventListener('click', (e) => {
    e.stopPropagation(); // cegah bubbling ke item (jika nanti item punya klik sendiri)
    handleLoad(sessionId);
  });

  const btnDelete = document.createElement('button');
  btnDelete.className = 'btn-delete';
  btnDelete.textContent = '✕';
  btnDelete.title = 'Hapus session';
  btnDelete.addEventListener('click', (e) => {
    e.stopPropagation();
    handleDelete(sessionId, data.name);
  });

  actions.appendChild(btnLoad);
  actions.appendChild(btnDelete);

  // ── Rakit semua ──
  item.appendChild(avatar);
  item.appendChild(info);
  item.appendChild(actions);

  return item;
}

/* ================================================================
   HELPER: KOMUNIKASI BACKGROUND
================================================================ */

/**
 * sendMessage(message) — Wrapper Promise untuk chrome.runtime.sendMessage.
 *
 * @param {Object} message - { action: string, payload?: Object }
 * @returns {Promise<Object>} - Response dari background.js
 *
 * Kenapa perlu di-wrap?
 * → chrome.runtime.sendMessage menggunakan callback, bukan Promise.
 *   Dengan wrapper ini semua pemanggil bisa pakai async/await.
 *
 * Kenapa cek chrome.runtime.lastError?
 * → Jika background Service Worker sedang sleep atau ada error koneksi,
 *   Chrome akan set lastError. Jika tidak dicek, Chrome akan lempar
 *   "Unchecked runtime.lastError" warning di console.
 */
function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

/* ================================================================
   HELPER: TAB & DOMAIN
================================================================ */

/**
 * getCurrentDomain() — Ambil hostname tab yang sedang aktif.
 *
 * @returns {Promise<string|null>} - Contoh: "app.example.com"
 *
 * Menggunakan chrome.tabs.query langsung dari popup (bukan lewat background)
 * karena ini operasi read-only yang ringan dan tidak perlu Service Worker.
 */
function getCurrentDomain() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError || !tabs || !tabs[0] || !tabs[0].url) {
        resolve(null);
        return;
      }
      try {
        const url = new URL(tabs[0].url);
        // Kembalikan hostname saja (tanpa protokol dan path)
        resolve(url.hostname);
      } catch {
        resolve(null);
      }
    });
  });
}

/* ================================================================
   HELPER: FEEDBACK UI
================================================================ */

/**
 * setLoadingState(isLoading) — Disable/enable semua tombol interaktif.
 *
 * Mencegah user mengklik Save berkali-kali saat proses async berlangsung.
 * Semua .btn-load dan .btn-delete juga di-disable untuk konsistensi.
 */
function setLoadingState(isLoading) {
  $.btnSave.disabled = isLoading;

  // Disable semua action button yang ada di list saat ini
  document.querySelectorAll('.btn-load, .btn-delete').forEach((btn) => {
    btn.disabled = isLoading;
  });
}

/**
 * setStatus(type, text) — Update status dot dan teks di footer.
 *
 * @param {'ready'|'loading'|'error'} type
 * @param {string} text
 */
function setStatus(type, text) {
  // Hapus semua class dot dulu
  $.statusDot.classList.remove('dot-ready', 'dot-loading', 'dot-error');
  $.statusDot.classList.add(`dot-${type}`);
  $.statusText.textContent = text;
}

/**
 * showToast(message, type) — Tampilkan notifikasi singkat di bagian bawah popup.
 *
 * @param {string} message
 * @param {'success'|'error'} type
 *
 * Timeout handle disimpan di showToast.timer agar toast sebelumnya
 * langsung digantikan jika ada toast baru sebelum timer habis.
 */
function showToast(message, type = 'success') {
  // Batalkan timer toast sebelumnya jika masih aktif
  if (showToast.timer) clearTimeout(showToast.timer);

  $.toast.textContent = message;
  $.toast.className = `toast toast-${type} toast-visible`;

  showToast.timer = setTimeout(() => {
    $.toast.className = 'toast toast-hidden';
  }, TOAST_DURATION);
}

/* ================================================================
   HELPER: FORMAT WAKTU
================================================================ */

/**
 * formatTimeAgo(timestamp) — Ubah timestamp jadi label waktu relatif.
 *
 * @param {number} timestamp - Unix timestamp dalam ms (Date.now())
 * @returns {string} - Contoh: "saved 2h ago", "saved 3d ago"
 */
function formatTimeAgo(timestamp) {
  if (!timestamp) return 'saved recently';

  const diffMs  = Date.now() - timestamp;
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr  = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1)   return 'just now';
  if (diffMin < 60)  return `saved ${diffMin}m ago`;
  if (diffHr  < 24)  return `saved ${diffHr}h ago`;
  if (diffDay < 30)  return `saved ${diffDay}d ago`;
  return 'saved long ago';
}

/* ================================================================
   JALANKAN
================================================================ */

// Popup sudah fully loaded karena <script> ada di akhir <body>
init();
