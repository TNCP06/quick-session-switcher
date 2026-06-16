# Arsitektur Aplikasi

Ekstensi **Quick Session Switcher** dibangun menggunakan ekosistem dan spesifikasi **Chrome Extension Manifest V3**. 

Mengingat arsitektur Manifest V3 memiliki model keamanan dan manajemen memori yang ketat, aplikasi memisahkan eksekusi tanggung jawab (separation of concerns) ke dalam tiga lapisan atau konteks utama yang diisolasi:

## 1. Konteks Antarmuka Pengguna / UI (`popup/`)

- Merupakan antarmuka *front-end* yang dilihat oleh pengguna saat mengklik ikon ekstensi.
- Bertugas untuk menangani seluruh *DOM manipulation*, mengikat pendengar peristiwa (*event listeners*) untuk tombol maupun input teks, serta menggambarkan elemen UI pada halaman (daftar *session*, state *loading*, pesan peringatan, dll).
- Dibatasi di area *sandboxed* khusus ekstensi. Konteks *script* dan elemen ini akan **dihancurkan dan dimatikan total** oleh *browser* setiap kali pengguna mengklik di luar jedela *popup* (menutup *popup*). Oleh karena itu, modul ini tidak boleh menyimpan *state* yang krusial yang bersifat asinkron panjang secara mandiri.
- **Batasan Akses:** Konteks Popup *tidak diizinkan* memanggil API esensial Chrome seperti `chrome.cookies` secara langsung demi mempertahankan kestabilan logika. Modul ini diwajibkan menjembatani permohonan ke Service Worker lewat pesan menggunakan API `chrome.runtime.sendMessage`.

## 2. Konteks Pekerja Latar Belakang / Service Worker (`background.js`)

- Mengambil peran sebagai "otak" (*core logic controller*) dari ekstensi yang hidup di belakang layar.
- Mengadopsi prinsip *Event-Driven*: *Service worker* ini otomatis terlelap (sleep) apabila sedang tidak ada aktivitas, dan hanya akan terbangun secara pasif (*wake-up*) bilamana dipicu oleh pemicu kejadian seperti *chrome.runtime.onMessage*.
- Menjadi **satu-satunya tempat** di mana panggilan menuju dan dari browser *engine API* (`chrome.cookies`, `chrome.storage`, manipulasi `chrome.tabs`) beroperasi. Hal ini memusatkan pengawasan aliran data (*data flow centralization*).
- Menangani alur proses sistem yang rumit, seperti pembukaan tab ke profil (*normal/incognito*), lalu mendistribusikan injeksi *cookies* ke masing-masing *CookieStore* secara aman tanpa membeku (*non-blocking/async*).

## 3. Konteks Modul Abstraksi / Utility (`utils/`)

Ekstensi memecah tugas-tugas *background* spesifik ke beberapa modul skrip utilitas. Tujuannya adalah mereduksi kompleksitas (spaghetti code) pada `background.js` agar hanya terfokus sebagai "Pengendali Aksi" (Controller).

- **Cookie Manager (`cookieManager.js`):** Pustaka pendukung khusus manipulasi `chrome.cookies`. Ia merangkum seluruh kompleksitas, seperti ekstraksi, penyingkiran atribut *host/secure prefix*, pengabaian filter-filter domain *host-only*, dan juga secara dinamis mengubah konfigurasi keamanan jika disuntikkan antara HTTP vs HTTPS. Modul ini mencegah ketidaksempurnaan `chrome.cookies` API yang terkadang sering kali gagal/menolak pemasangan atribut akibat restriksi *cookie RFC strict constraints*.
- **Storage Manager (`storageManager.js`):** Lapisan pelindung yang beroperasi di depan API native `chrome.storage.local`. Modul ini mengonversikan interaksi asinkron murni agar sejalan dengan pola baca-ubah-tulis (*read-modify-write pattern*). Menggunakan model abstraksi ini memastikan konsistensi agar modifikasi sebagian variabel dalam skema lokal ekstensi tidak secara brutal menimpa/terhapus (*overwritten*) secara tidak disengaja.
