# Isi Repo Ini, File per File

Aku yang nulis config-nya, tapi kamu yang bakal ditanya soal itu waktu
interview. Jadi ini penjelasan tiap file: fungsinya apa, dan kenapa disetel
begitu. Nggak perlu dihapal — cukup dibaca sekali sebelum mulai Proyek 1, biar
waktu ada yang error kamu tahu harus buka file mana.

---

## Config TypeScript & lint

**`tsconfig.json`** — `"strict": true` itu yang paling penting. Artinya
TypeScript maksa kamu nangani `null` dan `undefined`. Bakal terasa cerewet di
minggu pertama, tapi kelas error yang paling sering bikin aplikasi produksi mati
(`cannot read property of undefined`) jadi nggak mungkin terjadi.

`"paths": { "@/*": ["./src/*"] }` bikin kamu bisa nulis `@/db` dari file mana
pun, nggak perlu `../../../db`.

**`eslint.config.mjs`** — ESLint ngurus _benar/salah_ (variable nggak kepakai,
hook React dipanggil salah). Baris `prettier` harus tetap paling bawah: itu
mematikan semua rule ESLint soal format, supaya nggak berantem sama Prettier.

**`prettier.config.mjs`** — Prettier ngurus _tampilan_. Kenapa dipisah? Karena
debat soal titik koma itu buang waktu. Prettier mutusin, kamu nggak mikir lagi.

`printWidth: 100` — lebih lega dari default 80, masih enak buat review side-by-side.

**`.editorconfig`** — bikin editor kamu (VS Code, dll) pakai aturan indent yang
sama, bahkan sebelum Prettier jalan.

## Environment

**`.env.example`** — daftar variable yang dibutuhkan aplikasi, **tanpa nilai
asli**. File ini di-commit; `.env.local` yang isinya asli tidak.

Perhatikan `.gitignore`: `.env*` mengabaikan semua file env, terus
`!.env.example` mengecualikan yang satu ini. Tanpa baris pengecualian itu, orang
yang clone repo kamu nggak punya petunjuk sama sekali variable apa yang harus
diisi.

**`src/env.ts`** — mem-parse `process.env` pakai Zod waktu aplikasi start.

Kenapa repot? Karena `process.env.DATABASE_URL` tipenya `string | undefined`.
Kalau lupa set, TypeScript diam saja dan aplikasinya baru crash di produksi.
File ini bikin kesalahan itu ketahuan waktu boot, dengan pesan yang jelas.

**Aturannya: jangan pernah sentuh `process.env` langsung.** Selalu
`import { env } from "@/env"`.

## Database

**`docker-compose.yml`** — Postgres 16 di laptop kamu. Versi major-nya sengaja
sama dengan Neon, supaya migrasi yang jalan di lokal pasti jalan di produksi.

- `npm run db:up` — nyalakan (`--wait` bikin perintahnya nunggu sampai database
  beneran siap, bukan cuma containernya nyala)
- `npm run db:down` — matikan, data tetap ada
- `docker compose down -v` — matikan **dan hapus datanya**

**`src/db/schema.ts`** — definisi tabel. **Ini yang kamu isi tiap proyek.**
Sekarang cuma ada tabel `healthcheck` biar pipeline migrasinya kebukti jalan.
Hapus begitu tabel asli sudah ada.

**`src/db/index.ts`** — koneksi database.

Yang mungkin bikin bingung: `globalThis`. Next.js mode dev me-reload modul tiap
kali kamu simpan file. Tanpa nyimpen koneksi di `globalThis`, tiap reload buka
pool baru dan yang lama nggak pernah ditutup — habis koneksi Postgres setelah
beberapa puluh kali save. Cuma masalah di dev; produksi jalan sekali.

**`drizzle.config.ts`** — dibaca drizzle-kit buat tahu di mana schema-nya dan
migrasi ditaruh di mana.

### Alur migrasi

```bash
# 1. edit src/db/schema.ts
# 2. generate SQL-nya
npm run db:generate
# 3. BACA file SQL di src/db/migrations/. selalu.
#    drizzle bisa salah nebak: kolom di-rename kadang dibaca
#    sebagai "drop kolom lama, bikin kolom baru" — dan itu menghapus data.
# 4. terapkan
npm run db:migrate
```

**Jangan pernah edit file migrasi yang sudah pernah dijalankan.** Bikin migrasi
baru. Migrasi itu catatan sejarah; mengubah masa lalu bikin database kamu dan
database produksi nggak sinkron tanpa ketahuan.

## Test

**`vitest.config.mts`** — konfigurasi test.

Ekstensinya `.mts`, bukan `.ts`, karena Vite mau file config-nya ESM eksplisit;
pakai `.ts` memunculkan warning tiap kali test jalan.

Bagian `resolve.alias` menduplikasi `paths` dari `tsconfig.json`. Vitest nggak
baca tsconfig sendiri, jadi **kalau kamu nambah alias baru, ubah di dua tempat**.

**`vitest.setup.ts`** — jalan sebelum tiap file test. Isinya `cleanup()` yang
membongkar komponen antar-test, supaya DOM dari satu test nggak bocor ke test
berikutnya dan bikin test lulus padahal harusnya gagal.

**`src/lib/fx/generate.test.ts`** — contoh test yang bisa kamu tiru. Perhatikan
pola yang dipakai: yang diuji **sifat** (stop loss selalu di sisi rugi; trade
nggak pernah dibuka waktu market tutup), bukan angka hasil yang di-hardcode.
Test model begini nggak pecah tiap kali detail kecil berubah.

## Data demo

**`src/lib/fx/instruments.ts`** — data referensi FX: digit, pip size, contract
size. Kamu bakal langsung ngerti isinya.

Yang perlu diperhatikan: `pipSize` **bukan** `10^-digits`. EURUSD dikutip 5
digit tapi pip-nya tetap 0.0001. Pair JPY 3 digit dengan pip 0.01. Ini penyebab
bug klasik di trading journal pertama orang — pip count JPY jadi 100x lipat.

**`src/lib/fx/random.ts`** — random number generator dengan seed. Pakai ini,
bukan `Math.random()`, buat apa pun yang berhubungan dengan data demo. Seed sama
= hasil sama, selamanya. Kalau pakai `Math.random()`, test jadi flaky dan
screenshot nggak pernah cocok sama datanya.

**`src/lib/fx/generate.ts`** — bikin trade demo dan render jadi CSV format MT5.

Kolom CSV-nya sengaja mengikuti export MT5 asli, jadi fitur import yang kamu
tulis nanti diuji dengan bentuk yang beneran, bukan bentuk yang enak.

Modul ini **berhenti di situ**. Nggak ada perhitungan win rate, R multiple,
profit factor, atau equity curve di sini — itu bagian kamu.

**`npm run fixtures`** menulis `fixtures/mt5-history.csv` (180 trade, ~54% win
rate). File itu di-commit, dan CI ngecek ulang bahwa hasil generate masih sama.

## CI

**`.github/workflows/ci.yml`** — jalan tiap push dan tiap PR.

Urutan langkahnya disengaja: yang paling cepat duluan (format), yang paling
lambat belakangan (build). Kalau formatnya salah, kamu tahu dalam 30 detik,
bukan 5 menit.

Bagian yang layak dipahami:

- **`npm ci`, bukan `npm install`.** `ci` memasang persis isi lockfile dan gagal
  kalau lockfile-nya nggak sinkron dengan `package.json`. `install` diam-diam
  meng-update — dan itu bikin CI hijau di mesin CI tapi merah di laptop kamu.
- **`services: postgres`** — CI punya database sungguhan, jadi migrasinya
  beneran diuji, bukan cuma di-skip.
- **`options: --health-cmd`** — job-nya nunggu Postgres siap. Tanpa ini,
  test kadang gagal dengan "connection refused" secara acak. Ini penyebab CI
  flaky nomor satu.
- **`concurrency: cancel-in-progress`** — push baru membatalkan run lama di PR
  yang sama. Hemat kuota dan feedbacknya lebih cepat.

`npm run verify` di lokal isinya sama persis dengan CI. Jalankan sebelum push.

## Deploy

Lihat **`docs/DEPLOY.md`** buat langkah Vercel + Neon dan jalur Fly.io.

Satu hal yang paling penting dari situ, diulang di sini karena sering dilewatin:
**deploy-lah di hari pertama, waktu aplikasinya masih halaman kosong.** Bikin
URL live dulu, baru nambah fitur. Kalau dibalik, kamu bakal debug sepuluh
masalah deploy sekaligus di minggu terakhir — dan itu penyebab paling umum
portfolio nggak pernah selesai.

## `src/app/api/health/route.ts`

Route kecil yang nge-query `select 1` ke database.

Gunanya: deploy bisa sukses padahal database-nya nggak kebaca — connection
string salah, env var lupa diisi, branch Neon kehapus. Tanpa route ini, kamu
baru tahu waktu ada yang buka halaman yang butuh data. Dengan route ini, satu
kali `curl` sudah menjawab.

Ini juga endpoint yang dipakai monitoring uptime nanti.

---

## Kalau ada yang error

| Gejala                               | Kemungkinan besar                                            |
| ------------------------------------ | ------------------------------------------------------------ |
| `Invalid environment variables`      | `.env.local` belum dibuat — copy dari `.env.example`         |
| `ECONNREFUSED` waktu migrate         | Postgres belum jalan — `npm run db:up`                       |
| `/api/health` balas 503              | `DATABASE_URL` salah, atau pakai string Neon yang non-pooled |
| CI merah tapi lokal hijau            | Lupa commit — cek `git status`; atau lockfile nggak sinkron  |
| `too many connections` di produksi   | Pakai connection string Neon yang **pooled** (ada `-pooler`) |
| Test lulus sendirian, gagal barengan | Ada state bocor antar-test — cek `cleanup()` di setup        |

Kalau mentok lebih dari 30 menit, tanya. Waktu kamu cuma 8–10 jam seminggu;
kelamaan di masalah config itu justru bagian yang mau kita hindari.
