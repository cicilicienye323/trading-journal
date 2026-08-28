# Mulai Proyek Baru dari Template Ini

Tiap proyek dapat repo GitHub sendiri (`trading-journal`, `fx-dashboard`,
`broker-backoffice`), semuanya di-fork dari template ini.

**Kenapa dipisah, bukan monorepo:** recruiter buka profil GitHub kamu dan lihat
tiga repo rapi dengan README masing-masing. Itu sinyal yang jauh lebih kuat
daripada satu repo besar yang harus dijelajahi dulu. Ongkosnya: kalau ada
perbaikan di template, kamu terapkan manual ke repo yang sudah jalan — dan itu
memang ongkos yang kita terima sadar.

Sekali per proyek, ~10 menit.

---

## 1. Copy repo-nya

```bash
# Copy isinya, JANGAN fork di GitHub — riwayat commit-nya harus punya kamu
# sendiri, bukan nyambung ke template.
cp -r fintech-app-template trading-journal
cd trading-journal
rm -rf .git node_modules .next
git init && git add -A && git commit -m "Initial commit from template"
```

Kenapa `rm -rf .git`: kalau riwayatnya kebawa, commit pertama proyekmu bukan
punyamu. Yang mau ditunjukin ke recruiter adalah repo yang kamu bangun dari nol.

## 2. Ganti identitas proyek

| File                 | Ubah                                                                               |
| -------------------- | ---------------------------------------------------------------------------------- |
| `package.json`       | `"name"` → nama proyek                                                             |
| `src/app/layout.tsx` | `metadata.title` + `description` — ini yang muncul di tab browser dan preview link |
| `README.md`          | Judul, deskripsi, dan bagian Keputusan Teknis buat proyek itu                      |
| `docker-compose.yml` | `container_name` (biar nggak bentrok kalau dua proyek jalan bareng)                |

Yang **jangan** diubah: `docs/SETUP.md` — itu penjelasan config yang tetap
berlaku.

## 3. Kosongkan schema-nya

Template punya satu tabel `healthcheck` yang gunanya cuma buktiin pipeline
migrasi jalan. Hapus, ganti tabel aslimu:

```bash
# 1. tulis tabelmu di src/db/schema.ts, hapus healthcheck
# 2. hapus migrasi bawaan template — proyekmu mulai dari nol
rm -rf src/db/migrations
# 3. generate migrasi pertama proyekmu
npm run db:generate
# 4. BACA file SQL-nya, baru terapkan
npm run db:migrate
```

`scripts/seed.ts` juga masih nyisipin baris `healthcheck` — ganti isinya jadi
seed proyekmu.

## 4. Cek semuanya masih hijau

```bash
npm install
cp .env.example .env.local
npm run db:up
npm run verify        # format + lint + typecheck + test
docker compose up --build   # app + Postgres, cek http://localhost:3000/api/health
```

Kalau `/api/health` balas `{"status":"ok","database":"reachable"}`, fondasinya
beres dan kamu bisa mulai nulis fitur.

## 5. Push + deploy — lakukan SEKARANG, bukan nanti

Ini aturan paling penting di seluruh dokumen. Deploy waktu aplikasinya masih
halaman kosong.

- Pertama kali: [`FIRST-DEPLOY.md`](FIRST-DEPLOY.md) — langkah per langkah + troubleshooting
- Sudah pernah: [`DEPLOY.md`](DEPLOY.md) — referensi ringkas

Kalau dibalik — ngoding dua minggu baru deploy — kamu bakal debug sepuluh
masalah deploy sekaligus di hari deadline. Itu penyebab paling umum portfolio
nggak pernah selesai.

---

## Yang masih placeholder di template

Belum bisa diisi sampai kamu kasih username GitHub:

- `services/price-worker/README.md` — module path Go (`github.com/<username>/...`)
- Badge CI di README, kalau mau dipasang:
  `![CI](https://github.com/<username>/<repo>/actions/workflows/ci.yml/badge.svg)`

Ganti `<username>` waktu push pertama.
