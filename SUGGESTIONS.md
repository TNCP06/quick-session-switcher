# Suggestions

Items found during development that are worth considering but not urgent.
Do not implement unless explicitly requested.

---

## Bug

### `activeSessionId` tidak persisten saat popup ditutup-buka
**Why:** Setelah user load session lalu tutup popup, saat dibuka lagi tidak ada item yang ditandai aktif — padahal session itu masih berlaku di tab. Ini membuat tampilan badge `● active` tidak konsisten.
**Effort:** Low — simpan `activeSessionId` ke `chrome.storage.session` (bukan local) supaya hilang sendiri saat browser tutup.

---

## Improvement

### Warning saat nama session duplikat
**Why:** User bisa menyimpan dua session dengan nama identik, membuat list membingungkan saat sudah banyak session. Tidak perlu block, cukup tampilkan warning toast sebelum save.
**Effort:** Low — cek di `handleSaveSession` apakah ada session dengan nama yang sama sebelum menyimpan.

### Peringatan storage hampir penuh
**Why:** `chrome.storage.local` limit 5 MB. Saat ini tidak ada indikator, jadi save bisa gagal diam-diam kalau sudah penuh. `storageManager.getStorageInfo()` sudah ada, tinggal dipakai.
**Effort:** Low — panggil `getStorageInfo()` sebelum save, tampilkan warning di UI footer kalau usage > 80%.

### Retry otomatis saat Service Worker belum siap
**Why:** MV3 Service Worker bisa sleep dan belum aktif saat popup pertama kali dibuka, menyebabkan `sendMessage` gagal dengan "Could not establish connection". Saat ini user harus tutup-buka popup sendiri.
**Effort:** Medium — tambahkan simple retry (1–2x) dengan jeda singkat di `sendMessage()` khusus untuk error koneksi.

---

## Feature

### Domain alias yang bisa dikonfigurasi user
**Why:** `getExtraDomains()` di `background.js` sekarang hardcode hanya untuk Google/YouTube/OpenAI. User yang punya kebutuhan multi-subdomain lain (misal `app.company.com` + `auth.company.com`) tidak bisa menambah sendiri tanpa edit kode.
**Effort:** High — butuh settings UI di popup dan schema storage baru. Pertimbangkan dulu seberapa sering kasus ini terjadi.

---

## Chore

### Sinkronisasi versi antara `manifest.json` dan `popup.html` otomatis
**Why:** Versi saat ini ditulis dua kali secara manual (`"version"` di manifest dan teks di footer HTML). Mudah lupa salah satu saat bump versi.
**Effort:** Low — bisa pakai build script sederhana atau baca versi dari manifest lewat `chrome.runtime.getManifest().version` di popup.js lalu inject ke footer secara dinamis.
