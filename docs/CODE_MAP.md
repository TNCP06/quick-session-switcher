# Peta Kode (Code Map)

Struktur direktori serta penjelasan fungsionalitas dan peran dari setiap fail di dalam basis kode proyek.

```text
quick-session-switcher/
├── manifest.json          ← Deklarasi pengaturan ekstensi
├── background.js          ← Skrip utama Service Worker
│
├── popup/
│   ├── popup.html         ← Struktur DOM/Kerangka dasar UI
│   ├── popup.css          ← Pemformatan perwajahan (Styles)
│   └── popup.js           ← Skrip pengontrol antar-muka UI
│
├── utils/
│   ├── cookieManager.js   ← Logika ekstraksi & penanganan Cookies
│   └── storageManager.js  ← Logika sinkronisasi/baca-tulis Storage API
│
└── docs/
    ├── BUSINESS_FLOW.md   ← Alur bisnis pengguna vs sistem
    ├── ARCHITECTURE.md    ← Prinsip arsitektural Manifest V3
    └── CODE_MAP.md        ← Pemetaan peranan fail (file ini)
```

## Penjelasan Detil Tiap-Tiap Berkas (*Files*)

### Direktori Utama (Root)
- **`manifest.json`**
  Berkas kunci (*manifest*) sebagai pengenal bagi Google Chrome bahwa berkas ini adalah sebuah ekstensi. Ia memberitahukan deskripsi dan versi rilis, mendefinisikan *permissions* izin keleluasaan apa saja yang diminta ekstensi (contoh: `cookies`, `storage`, `tabs`), menautkan titik temu file eksekusi *Service Worker* kepada `background.js`, dan menancapkan konfigurasi opsional seperti parameter `"incognito": "spanning"` yang membolehkan fitur menjangkau *private-window/Incognito*.

- **`background.js`**
  Penengah dan motor utama proyek. Berisikan satu-satunya perantara untuk mendengarkan panggilan aksi (*event listener switch/case*) yang dilemparkan oleh `popup.js` via payload pesan (`SAVE_SESSION`, `LOAD_SESSION`, `DELETE_SESSION`, `CLEAR_COOKIES`). Ia tidak mengatur antarmuka, melainkan mengorkestrasi alur antara Tab yang sedang aktif dengan pengambilan data menggunakan `cookieManager` lalu mendorong konversinya menjadi data pasif pada `storageManager`.

### Folder `popup/`
- **`popup.html`**
  Berkas HTML sederhana yang merepresentasikan halaman dasar (kontainer *layout* dan perwajahan utama *box-sizing*) untuk layar panel *popup*. Mencakup segmen elemen untuk bagian Header input penyimpanan sesi, bagian List Box untuk tampilan kartu domain, dan layar detil tampilan per nama domain.

- **`popup.css`**
  File perwajahan komponen *styling*. Ekstensi mengadopsi tema kelam elegan yang ditata dengan teknik modern *CSS Variables*, *Flexbox Layouts*, hingga mikroskopik *transition hovers* guna memberikan rasa desain UI yang premium tanpa harus bergantung pada *framework* kelas berat eksternal layaknya *Tailwind* ataupun *Bootstrap*.

- **`popup.js`**
  File penggerak UI eksklusif (*Frontend logic*). Tugasnya adalah memanipulasi *DOM* (*Document Object Model*) pada `.html` di atas agar tampil responsif menyesuaikan isian *database* aslinya. Beberapa logikanya:
  - Mengambil data dengan menyebar pesan *broadcast* ke `background.js` (dengan *async Promise Helper*).
  - Mengkalkulasikan dan *mengelompokkan (grouping)* tiap sesi yang disimpan apabila sesinya memiliki URL (*host/port*) sasaran yang sama agar tak nampak tumpang-tindih.
  - Menghapus pesan ralat dan menetapkan porsi status memuat (*loading state/disabled buttons*).
  - Merender iterasi dari koleksi susunan kartu komponen dinamis dengan menggunakan API peramban asli (`document.createElement()`).

### Folder `utils/`
- **`cookieManager.js`**
  Rangkuman pembantu (sebuah *Helper Library*) utilitas yang mengisolasi dan mendetailkan setiap trik ekstraksi, restorasi, maupun injeksi API *cookies* bawaan dari Chrome.
  Berfungsi mengumpulkan kepingan-kepingan parameter, mengabaikan filter nama khusus (*e.g.* reCAPTCHA, CloudFlare rules), menghapus format yang tabrakan (mengatasi protokol SSL maupun awalan/prefix keamanan unik dari `__Host-` dan `__Secure-`), hingga pembersihan pemotongan *port-number* tatkala sedang membungkus permintaan kepada sistem inti pelacak cookies-storage browser. Modul inilah tulang-punggung kelancaran dari pengambilan informasi login Anda.

- **`storageManager.js`**
  Pembantu sekunder pendamping `chrome.storage.local`. 
  Lantaran API basis data bawaan `storage` milik Chromium berskala asinkronous mutlak yang dapat mengacaukan hasil saat proses penulisan bersamaan berulang kali diakses secara sewenang-wenang (layaknya tipe eksekusi *racing conditions* pada objek besar), modul ini memperhalus metodologinya menjadi pola terarah (*Read-modify-write pattern*): yaitu dengan memanggil semua objek utuh terlebih dahulu -> Menyortir/memodifikasi baris nilai yang spesifik -> Menulis ulang keseluruhannya ke database secara terisolasi tanpa menggangu elemen milik sesi domain orang lain.
