# Alur Bisnis (Business Flow)

Dokumen ini menjelaskan alur kerja utama dari ekstensi Profile Switcher dari perspektif pengguna dan proses sistem di belakangnya.

## 1. Penyimpanan Sesi (Save Session)

**Tujuan:** Mengambil dan menyimpan seluruh *cookies* sesi dari domain yang sedang aktif (termasuk *port* jika ada) agar dapat dipulihkan di lain waktu.

**Alur Pengguna:**
1. Pengguna membuka sebuah *website* dan melakukan *login* ke akun A.
2. Pengguna membuka ekstensi Profile Switcher melalui ikon *toolbar* browser.
3. Ekstensi otomatis mendeteksi URL dan *host* domain (termasuk *port*).
4. Pengguna memasukkan nama sesi (misalnya: "Akun Utama" atau "Dev Port 3000") dan menekan tombol **+ Save**.
5. Sesi muncul dalam daftar sesi yang tersimpan di antarmuka ekstensi.

**Alur Sistem:**
1. **Popup UI (`popup.js`)** mengirimkan pesan aksi `SAVE_SESSION` beserta nama sesi ke *Service Worker*.
2. **Service Worker (`background.js`)** menerima pesan tersebut dan mengekstraksi identitas *host* dari URL tab yang sedang aktif.
3. Service Worker memanggil **Cookie Manager (`cookieManager.js`)** untuk membaca *cookies*. Cookie manager akan otomatis mencari dan mendeduplikasi segala macam *cookies* pada *domain* (*port* dihilangkan secara internal khusus untuk permintaan API Browser karena limitasi bawaan `chrome.cookies`).
4. Setelah kumpulan *cookies* divalidasi, data sesi (meliputi nama, target URL asli, domain/host spesifik, kuantitas *cookies*, *timestamp*) disimpan menggunakan **Storage Manager (`storageManager.js`)** ke pangkalan basis data lokal ekstensi (`chrome.storage.local`).
5. Antarmuka UI merender ulang dengan daftar yang baru saja diperbarui.

---

## 2. Pemuatan Sesi (Load Session)

**Tujuan:** Memulihkan (inject) *cookies* dari sesi yang sebelumnya telah disimpan sehingga pengguna secara instan *login* sebagai akun tersebut tanpa harus memasukkan kredensial lagi.

**Alur Pengguna:**
1. Pengguna membuka ekstensi dan melihat daftar sesi yang dikelompokkan berdasarkan host domain/port.
2. Pengguna menekan tombol **Load** pada salah satu daftar sesi (misal: "Akun Pekerjaan").
3. Sebuah tab otomatis akan terbuka atau me-*reload* ke halaman spesifik yang berhubungan. Pengguna langsung berstatus masuk (*logged-in*).

**Alur Sistem:**
1. **Popup UI** mengirimkan pesan aksi `LOAD_SESSION` dengan ID sesi target ke *Service Worker*.
2. **Service Worker** mengambil detail *session* menggunakan **Storage Manager**.
3. **Service Worker** memicu eksekusi pembuatan *tab* baru menggunakan URL yang tersimpan secara terperinci (dengan protokol HTTP/HTTPS asli dan port yang presisi). Tab bisa berstatus Normal atau *Incognito* tergantung window.
4. Bersamaan dengan tab dibuat, **Service Worker** memerintahkan **Cookie Manager** untuk:
   - Menghapus selutuh *cookies* lama (bila ada) pada domain tersebut untuk menjamin tidak terjadinya tabrakan otorisasi.
   - Menginjeksikan *cookies* satu per satu ke dalam *cookie-store* tab baru melalui API `chrome.cookies.set`. Modul ini menangani secara khusus cookie yang diamankan oleh aturan *secure* maupun prefix `__Host-` dan `__Secure-`.
5. Tab selesai melengkapi siklus alur pemuatan.

---

## 3. Penghapusan Sesi (Delete Session)

**Tujuan:** Menghapus sesi tertentu dari ruang penyimpanan lokal secara permanen.

**Alur Pengguna:**
1. Pengguna membuka tampilan daftar sesi di ekstensi dan melakukan *hover* (mengarahkan kursor) pada sebuah nama sesi.
2. Pengguna menekan ikon centang/silang "X" warna merah.
3. Daftar otomatis dirender ulang dan item tersebut terhapus selamanya.

**Alur Sistem:**
1. **Popup UI** menangkap aktivitas klik, lalu mengirimkan aksi `DELETE_SESSION` berisi ID yang di-*bind* ke *Service Worker*.
2. **Service Worker** mendelegasikan tugas ke **Storage Manager** untuk menarik objek pangkalan data lama dan memfilter agar sesi ID tersebut tidak masuk kriteria penyimpanan.
3. Modifikasi terbaru disimpan kembali menimpa status database yang lalu.
4. Membalas konfirmasi sukses kepada antarmuka, yang berujung pada penyegaran UI.
