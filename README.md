# Mal-Food Nutrition

Aplikasi statis ini dapat di-deploy ke GitHub Pages. Supabase menangani autentikasi, database, laporan bantuan password, dan statistik pengunjung. Jangan menaruh service-role key di frontend atau repository.

## Menyiapkan Supabase
1. Buat project Supabase.
2. Di **SQL Editor**, jalankan `supabase/migrations/20261010000000_initial_schema.sql`.
3. Impor katalog publik dengan menjalankan `supabase/seed.sql`. Berkas seed berisi katalog makanan saja; data akun dan diary lokal tidak ikut diekspor.
4. Di **Authentication → URL Configuration**, masukkan `https://archmr545-cell.github.io/mal-food-nutrtion/` sebagai Site URL dan `https://archmr545-cell.github.io/mal-food-nutrtion/**` sebagai URL redirect yang diizinkan. Tambahkan URL lokal saat pengembangan.
5. Pastikan pengiriman email Supabase aktif supaya konfirmasi pendaftaran dan link reset password dapat dikirim.
6. Daftarkan akun admin pertama melalui aplikasi, lalu jalankan di SQL Editor:
   ```sql
   update public.profiles
   set role = 'admin'
   where lower(email) = lower('EMAIL_ADMIN_KAMU');
   ```
   Jangan menaruh password, service-role key, atau rahasia di SQL publik ataupun kode frontend.

## Menjalankan lokal
1. Install Node.js 20+ dan jalankan `npm install`.
2. Salin `.env.example` menjadi `.env`. Untuk login lokal, isi `JWT_SECRET` minimal 32 karakter, `ADMIN_EMAIL`, dan `ADMIN_PASSWORD` minimal 8 karakter. Server lokal menggunakan akun dan database SQLite yang ada. Opsional: isi `SUPABASE_URL` dan `SUPABASE_ANON_KEY` dari **Project Settings → API** Supabase untuk mencoba backend Supabase. Jangan gunakan secret/service-role key.
3. Jalankan `npm run dev` dan buka `http://localhost:3000`.

Tanpa konfigurasi Supabase, frontend lokal memakai API Express dan database SQLite. Jika URL dan anon key Supabase tersedia, frontend memakai Supabase. GitHub Pages tetap memerlukan project Supabase karena tidak dapat menjalankan Express/SQLite.

## Deploy ke GitHub Pages
1. Push folder proyek ke repository `archmr545-cell/mal-food-nutrtion` pada branch `main`.
2. Di **Settings → Secrets and variables → Actions → Variables**, tambahkan `SUPABASE_URL` dan `SUPABASE_ANON_KEY`. Publishable/anon key memang digunakan oleh frontend; jangan tambahkan service-role/secret key ke GitHub Pages.
3. Di **Settings → Pages → Build and deployment**, pilih **GitHub Actions**.
4. Workflow `.github/workflows/deploy-pages.yml` membangun lalu menerbitkan folder `public`.

Alamat situs: <https://archmr545-cell.github.io/mal-food-nutrtion/>

Alamat admin: <https://archmr545-cell.github.io/mal-food-nutrtion/admin/>

Semua tabel memakai Row Level Security. Admin awal dipromosikan lewat Supabase SQL Editor; pengunjung situs hanya bisa mencatat kunjungan anonim. Penghitungan pengunjung memakai ID acak di browser dan ID sesi tab, tidak menyimpan alamat IP, nama, atau email pengunjung. Angka ini merupakan estimasi browser-perangkat unik, bukan identitas orang yang terverifikasi.

Data akun dan diary SQLite lokal yang lama **tidak otomatis diunggah** ke Supabase. Pengguna perlu mendaftar di layanan baru; jangan mempublikasikan `database.db`.

## Fitur
Menu Makanan menampilkan semua item katalog beserta nilai gizi perkiraan per porsi; 100 bahan sehat ditambahkan di atas makanan bawaan. Item katalog baru ditambahkan otomatis tanpa menggandakan makanan yang sudah ada.
Halaman Resep menyediakan 100 resep sehat dengan bahan, langkah memasak, waktu, serta perkiraan kalori dan protein per porsi.
Kalkulator kalori memperkirakan kebutuhan energi untuk semua usia: estimasi usia 0–2 tahun, rumus kebutuhan anak/remaja usia 3–17 tahun, dan BMR/TDEE dewasa mulai usia 18 tahun. Perhitungan memakai jenis kelamin, berat, tinggi (jika digunakan oleh rumus), serta faktor aktivitas sesuai kelompok usia.
Mode Kalori makanan mencatat makanan harian dari database, menghitung total kalori, protein, karbohidrat, dan lemak berdasarkan porsi, lalu memberi saran gizi umum. Catatan disimpan di perangkat untuk akun dan tanggal tersebut.

## Catatan
- Password selalu disimpan sebagai hash satu arah, sehingga password lama tidak dapat dilihat. Admin dapat mengatur password baru untuk akun lokal dari daftar user atau laporan bantuan; sesi lama user dicabut setelah reset.
- User dapat mengganti password sendiri di halaman Profil dengan mengonfirmasi password saat ini. Setelah diganti, user perlu login kembali.
- Permintaan lupa password berisi email dan pesan bantuan saja, bukan password baru. Di mode Supabase, admin mengirim link reset melalui Supabase Auth.
- Jangan mengaktifkan kebijakan database tanpa Row Level Security.
- `.env`, kunci service-role, dan database SQLite lokal tidak boleh dipublikasikan.
