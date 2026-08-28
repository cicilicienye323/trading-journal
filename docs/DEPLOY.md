# Deploy

> **Status akunmu (per jawaban di board):**
>
> | Akun     | Status       | Perlu diapain                                    |
> | -------- | ------------ | ------------------------------------------------ |
> | GitHub   | ✅ sudah ada | tinggal push                                     |
> | Vercel   | ✅ sudah ada | import repo-nya                                  |
> | **Neon** | ❌ **belum** | **daftar dulu — ini satu-satunya yang nyangkut** |
>
> Neon free tier, nggak minta kartu kredit, ~5 menit. Tanpa itu `DATABASE_URL`
> produksi nggak ada dan `/api/health` bakal balas 503 di Vercel.

Aturan utama: **deploy duluan, sebelum ada fitur.** Bikin pipeline-nya jalan
sampai ada URL live yang nampilin halaman kosong, baru mulai ngoding. Kalau
dibalik — ngoding dua minggu baru deploy — kamu bakal debug sepuluh masalah
sekaligus di minggu terakhir, dan itu penyebab paling umum portfolio mangkrak.

---

## 1. Neon (database)

1. Bikin project di [neon.tech](https://neon.tech) — free tier cukup.
2. Region: pilih **Singapore (ap-southeast-1)** kalau kamu di Indonesia. Latency
   ke Jakarta ~20ms, versus ~200ms kalau ambil US East.
3. Salin connection string yang **pooled** — host-nya ada `-pooler`.

   Ini penting. Serverless function buka koneksi baru tiap invocation. Pakai
   string yang direct, kamu kena `too many connections` begitu ada traffic
   sedikit saja. String pooled dilayani PgBouncer di sisi Neon.

4. Neon punya fitur **branching**: tiap branch database itu copy-on-write dari
   production. Nanti dipakai buat preview deployment (langkah 3).

## 2. Vercel (aplikasi)

1. Import repo GitHub-nya di [vercel.com](https://vercel.com). Vercel otomatis
   mendeteksi Next.js — biarkan default-nya.
2. Environment Variables, tambahkan untuk ketiga environment:

   | Name           | Value                         | Environment                      |
   | -------------- | ----------------------------- | -------------------------------- |
   | `DATABASE_URL` | connection string Neon pooled | Production, Preview, Development |

3. Deploy. Cek `https://<app>.vercel.app/api/health` — harus balas
   `{"status":"ok","database":"reachable"}`.

   Kalau balasannya 503, aplikasinya hidup tapi database-nya nggak kebaca:
   hampir selalu `DATABASE_URL` salah atau kepakai yang non-pooled.

## 3. Preview deployment per PR

Vercel otomatis bikin URL preview tiap PR — nggak perlu dikonfigurasi. Yang
perlu diatur satu hal: **preview jangan nunjuk ke database production.**

Cara paling rapi adalah [Neon Vercel
Integration](https://neon.tech/docs/guides/vercel): tiap PR dibikinkan database
branch sendiri, `DATABASE_URL`-nya di-inject otomatis, dan branch-nya dihapus
waktu PR di-merge. Gratis di free tier.

Tanpa integration itu, semua preview nembak database yang sama dengan
production — dan migrasi yang salah di PR bakal ngerusak data live.

## 4. Migrasi

Migrasi **tidak** dijalankan otomatis waktu deploy. Ini disengaja: migrasi yang
jalan sendiri di tengah deploy bisa setengah jadi waktu build gagal, dan itu
kondisi yang paling susah dibersihin.

Alurnya manual dan urutannya penting:

```bash
npm run db:generate      # bikin file SQL dari perubahan schema.ts
# baca file SQL-nya. selalu. drizzle bisa salah nebak rename kolom.
git add src/db/migrations && git commit
npm run db:migrate       # terapkan ke lokal
# setelah PR di-merge, terapkan ke production:
DATABASE_URL="<neon-production-url>" npx drizzle-kit migrate
```

Aturan yang bikin kamu nggak kehilangan data: **jangan pernah edit file migrasi
yang sudah pernah dijalankan.** Bikin migrasi baru.

## 5. Jalur Go (Proyek 2)

Proyek 2 nambah service Go buat price poller dan alert worker. Frontend-nya
tetap di Vercel; service Go-nya nggak bisa — Vercel nggak jalanin proses yang
hidup terus.

**Fly.io** pilihannya, karena:

- Proses yang jalan terus-menerus (WebSocket, background worker) memang model
  bawaannya — di Railway bisa, tapi Fly lebih murah buat yang selalu hidup.
- Bisa deploy dekat sumber harga buat nurunin latency.
- Free allowance-nya cukup buat satu service kecil.

Kerangkanya sudah ada di `services/price-worker/`. Isi kodenya nanti waktu
Proyek 2 — sekarang cukup tahu jalurnya sudah disiapin.

## Checklist "beneran live"

Portfolio dengan link mati lebih merugikan daripada nggak ada link sama sekali.
Sebelum ditulis di CV:

- [ ] URL production kebuka di browser incognito (bukan cuma di browser kamu)
- [ ] `/api/health` balas 200
- [ ] Ada seed data — recruiter bisa klik-klik tanpa daftar akun
- [ ] Badge CI di README warnanya hijau
- [ ] README ada screenshot, biar kelihatan isinya tanpa harus buka app-nya
