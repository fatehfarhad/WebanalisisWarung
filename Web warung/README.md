# ForecastBiz AI — Versi Multi-File + Supabase

Struktur proyek ini sudah dipisah per bahasa pemrograman:

```
forecastbiz/
├── index.html                 → HTML murni (struktur halaman & modal)
├── css/
│   └── style.css              → CSS kustom (scrollbar)
├── js/
│   ├── config.js              → Isi URL & Anon Key Supabase Anda di sini
│   ├── supabaseClient.js      → Inisialisasi client Supabase
│   ├── db.js                  → Semua query ke Supabase (CRUD)
│   ├── state.js               → Cache data di browser (disinkron dari Supabase)
│   ├── utils.js                → Fungsi bantu (format Rupiah, tanggal, dll)
│   ├── main.js                 → Titik masuk aplikasi (init, navigasi tab)
│   └── ui/
│       ├── menu.js             → Katalog Menu & resep
│       ├── materials.js         → Bahan Baku & grafik harga
│       ├── cashier.js           → Struk kasir & pengurangan stok otomatis
│       ├── fefo.js              → Manajemen FEFO (expiry warning)
│       ├── smartTools.js        → Kalkulator ROP & EOQ
│       ├── dashboard.js         → Kartu ringkasan & grafik tren
│       ├── forecasting.js       → AI Advisor promo/profit
│       └── modals.js            → Modal umum & verifikasi 2 langkah
└── supabase/
    ├── schema.sql              → Skema tabel + data contoh untuk Supabase
    ├── migration_sales_events.sql
                                → Tabel catatan kejadian penjualan
    ├── migration_promotions.sql
                                → Tabel promo dan kolom pengaitan struk
    └── migrations/
        ├── 20261101_daily_sales_forecasts.sql
                                → Penyimpanan prediksi harian untuk evaluasi historis
        ├── 20261019_material_batch_expiry_corrections.sql
                                → Audit dan koreksi tanggal EXP batch
        └── 20261019_material_batch_disposals.sql
                                → Pembuangan stok expired dan audit kerugian
```

## 1. Buat Proyek Supabase

1. Daftar/masuk ke https://supabase.com dan buat **New Project**.
2. Setelah proyek aktif, buka **SQL Editor** → **New query**.
3. Salin seluruh isi file `supabase/schema.sql`, tempel, lalu **Run**.
   Ini akan membuat 10 tabel (`menu_catalog`, `menu_recipes`, `raw_materials`,
   `material_batches`, `material_price_history`, `receipts`, `receipt_items`,
   `dashboard_daily_snapshots`, `daily_sales_forecasts`, `sales_events`)
   beserta data contoh.
4. Buka query baru, jalankan `supabase/migration_sales_events.sql`.
   Migrasi ini harus dijalankan sebelum migrasi promo.
5. Jalankan seluruh isi `supabase/migration_promotions.sql` pada query baru.
   Migrasi ini wajib agar tombol **Mulai Promo** dapat menyimpan promo dan
   jadwal hari tertentu. Aman dijalankan ulang untuk menambahkan kolom promo
   yang mungkin belum ada pada tabel lama.
6. Buka query baru, jalankan seluruh isi
   `supabase/migrations/20261019_material_batch_expiry_corrections.sql`.
   Migrasi ini menambahkan pencatatan audit dan fungsi koreksi tanggal EXP
   secara transaksional. Untuk database yang sudah ada, jalankan migrasi ini
   saja; jangan jalankan ulang seluruh `schema.sql` agar data contoh tidak
   dimasukkan kembali.
7. Setelah migrasi koreksi tanggal berhasil, jalankan seluruh isi
   `supabase/migrations/20261019_material_batch_disposals.sql`. Migrasi ini
   menambahkan riwayat pembuangan, validasi stok kedaluwarsa di database, dan
   perhitungan kerugian.
   Jika migrasi koreksi tanggal sudah pernah dijalankan, cukup jalankan
   migrasi pembuangan yang baru ini.
8. Jalankan `supabase/migrations/20261101_daily_sales_forecasts.sql` untuk
   menyimpan prediksi per tanggal dan menu. Database baru yang dibuat dari
   `schema.sql` sudah memiliki tabel ini.

### Aktifkan sinkronisasi real-time

Di Supabase, buka **Database → Publications → supabase_realtime** dan aktifkan
tabel `receipts`, `receipt_items`, `raw_materials`, serta `material_batches`.
Dashboard akan menampilkan status koneksi; perubahan transaksi dan stok dari
perangkat lain akan dimuat otomatis. Jika tabel tidak masuk publication, aplikasi
tetap berfungsi tetapi indikator akan memberi tahu bahwa real-time tidak aktif.

### Interaksi kasir

- Kasir dapat memakai **F2** untuk mencari menu, **F9** atau **Spasi** untuk
  membuka pembayaran, dan **Esc** untuk menutup modal.
- Pembayaran tunai menyediakan tombol uang pas dan nominal cepat; nilai
  kembalian dihitung otomatis sebelum transaksi dikonfirmasi.
- Setelah transaksi tersimpan, tombol **Cetak struk** membuka dialog cetak
  browser untuk kertas thermal 58 mm atau 80 mm.
- Suara konfirmasi kasir dapat bergantung pada izin audio browser/perangkat.

Grafik prediksi menampilkan backtest untuk tanggal yang telah lewat; setiap
prediksi backtest hanya memakai data yang tersedia sebelum tanggal tersebut.
Prediksi untuk dua hari ke depan disimpan satu kali agar nilai pembandingnya
tidak berubah setelah penjualan aktual tercatat. Pengukuran selisih historis
mengabaikan hari ini karena penjualannya belum selesai.

`material_batches` menyimpan setiap stok masuk secara terpisah, termasuk jumlah,
harga beli, tanggal masuk, dan tanggal kedaluwarsa. Stok baru harus ditambahkan
melalui tombol tambah batch pada halaman Bahan Baku, bukan dengan mengedit stok
total bahan.

Tanggal EXP batch dapat dikoreksi melalui tabel Manajemen FEFO. Setiap koreksi
wajib disertai nama operator dan alasan, meminta konfirmasi, serta menyimpan
tanggal lama/baru dan waktu perubahan dalam `material_batch_expiry_history`.
Karena aplikasi belum memakai login, nama operator merupakan isian manual dan
bukan identitas yang diverifikasi. Koreksi tidak mengubah jumlah stok.
Peringatan ditampilkan untuk tanggal EXP yang sudah lewat atau
lebih awal daripada tanggal masuk batch; pemilik tetap dapat melanjutkan setelah
memastikan tanggal pada label kemasan.

Di tabel Manajemen FEFO, setiap batch menampilkan tanggal EXP lengkap.
Batch yang EXP-nya sudah tiba atau lewat dapat dibuang sebagian atau seluruhnya
dengan nama operator dan catatan opsional. Sistem mengurangi stok dan mencatat
kerugian dalam transaksi yang sama; riwayat 100 pembuangan terbaru terlihat di
Manajemen FEFO. Rekomendasi belanja dan indikator stok rendah menghitung stok
yang masih layak pakai, bukan stok kedaluwarsa. Kasir juga menolak menggunakan
batch kedaluwarsa. Kartu kerugian menghitung stok kedaluwarsa yang menunggu
dibuang ditambah total nilai pembuangan yang sudah tercatat.

## 2. Ambil Kredensial API

Buka **Project Settings → API**, lalu salin:

- **Project URL**
- **anon public key**

Tempelkan ke file `js/config.js`:

```js
export const SUPABASE_URL = "https://xxxxxxxx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOi...";
```

## 3. Jalankan Aplikasi

Karena `index.html` memakai ES Module (`<script type="module">`), file
**tidak bisa** dibuka langsung dengan cara klik dua kali (`file://`) —
browser akan memblokir modul dari origin `file://`. Jalankan lewat server
lokal, misalnya salah satu dari:

```bash
# Python (biasanya sudah terpasang)
cd forecastbiz
python3 -m http.server 8080
# lalu buka http://localhost:8080

# atau Node.js
npx serve .
```

Untuk publikasi sungguhan, unggah folder ini ke hosting statis apa pun
(Vercel, Netlify, Cloudflare Pages, atau hosting UMKM Anda) — tidak perlu
build step karena semuanya berupa file statis.

## Catatan Keamanan

Kebijakan Row Level Security (RLS) di `schema.sql` dibuat **permisif**
(siapa pun yang membawa anon key boleh baca/tulis semua data). Ini wajar
untuk 1 toko dengan 1 halaman internal, tapi:

- **Jangan** sebarkan Anon Key + URL secara publik di internet tanpa proteksi
  tambahan (mis. taruh di belakang login staf) jika data ini sensitif.
- Jika nanti aplikasi dipakai multi-cabang/multi-toko, tambahkan kolom
  `store_id` di setiap tabel dan ganti kebijakan RLS agar tiap toko hanya
  bisa mengakses datanya sendiri (`auth.uid()` + tabel `store_users`).

## Catatan soal Fitur "Prediksi" & "WhatsApp Alert"

- Grafik "Hasil Prediksi Time Series" sekarang dihitung dari **rata-rata +
  tren sederhana** atas data struk asli di Supabase (bukan lagi angka
  hardcode), tapi ini masih proyeksi sederhana, bukan model machine
  learning. Untuk forecasting yang lebih akurat, pertimbangkan memasang
  model (mis. Prophet/ARIMA) di **Supabase Edge Function** dan memanggilnya
  dari `js/ui/dashboard.js`.
- Modal "Uji WA Bot Alert" masih pratinjau statis. Untuk pengiriman WhatsApp
  sungguhan, sambungkan ke provider seperti WhatsApp Cloud API / Twilio lewat
  Supabase Edge Function yang dipicu saat stok di bawah ROP.
