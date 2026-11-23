# Baca dulu

Paket ini untuk dikirim ke Claude Code supaya Podium bisa dibangun dan di-deploy.

## Isi paket

| File | Untuk apa |
|---|---|
| `PROMPT.md` | Lima prompt siap tempel ke Claude Code, dipakai berurutan |
| `CLAUDE.md` | Aturan proyek yang dibaca Claude Code otomatis di tiap sesi |
| `HANDOFF.md` | Spesifikasi lengkap: halaman, 13 game, angka ekonomi, API, tahapan, cara deploy |
| `prototype/podium-v9.html` | Prototype yang sudah disetujui, acuan tampilan dan aturan game |
| `docs/schema.prisma` | Rancangan awal database |
| `deploy/nginx.conf` | Contoh konfigurasi Nginx untuk VPS |
| `deploy/ecosystem.config.js` | Contoh konfigurasi PM2 |

## Cara pakai

1. Taruh seluruh folder ini di direktori proyek kosong.
2. Buka Claude Code di direktori itu.
3. Buka `PROMPT.md`, tempel Prompt 1, tunggu selesai, lanjut ke Prompt 2, dan seterusnya.
4. Di Prompt 2, isi dulu domain dan alamat VPS.

## Yang perlu disiapkan

- Nama domain dan akses DNS.
- Akses SSH ke VPS Hostinger.
- Keputusan nama: tetap "Podium" atau ganti.
- Kredensial Google OAuth dan akun SMTP untuk kode login (baru dibutuhkan di tahap 1).

## Tahapan

- **Tahap 0:** prototype dipasang sebagai situs statis. Bisa live di hari yang sama, tapi skornya masih tersimpan di browser masing-masing.
- **Tahap 1:** akun, server, leaderboard dan duel antar pemain sungguhan. Semua masih memakai tChips tanpa nilai.
- **Tahap 2:** validasi skor di server dan pencegahan curang.
- **Tahap 3:** token asli. Sengaja dikunci di dokumen sampai ada pendapat hukum tertulis, karena kontes berbayar dan duel bertaruh diatur berbeda di tiap negara.
