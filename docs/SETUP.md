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

**`npm run fixtures`** menulis **dua** file dari 180 trade yang sama:

| File                  | Server timezone | Gunanya                                          |
| --------------------- | --------------- | ------------------------------------------------ |
| `mt5-history.csv`     | UTC             | Kasus gampang — jam di file = instant sebenarnya |
| `mt5-history-eet.csv` | `Europe/Athens` | Kasus nyata — offset berubah di tengah file      |

Dua-duanya di-commit, dan CI ngecek ulang hasil generate-nya masih sama persis.

### Kenapa ada versi EET, dan kenapa itu penting

Export MT5 nulis jam pakai **waktu lokal server broker**, dan **nggak nyantumin
offset atau nama timezone sama sekali** di file. Itu inti masalahnya: string jam
yang sama berarti instant yang beda tergantung broker mana yang ngeluarin, dan
nggak ada apa pun di file yang ngasih tahu yang mana.

Mayoritas broker retail jalan di EET/EEST. Artinya file yang sama punya offset
`+02:00` di Februari dan `+03:00` di April — **berubah di tengah file**, tanpa
penanda. Contoh baris nyata dari dua fixture di atas (ticket sama):

```
50000075   UTC=2026.03.15 22:18:10   EET=2026.03.16 00:18:10   (+2, tanggal geser!)
50000090   UTC=2026.04.03 13:12:45   EET=2026.04.03 16:12:45   (+3)
```

Perhatikan baris pertama: tanggalnya **pindah hari**. Itu persis bug yang bikin
"trade Jumat malam kecatat hari Sabtu" dan statistik per-hari ambyar.

Parser yang baca satu offset buat seluruh file bakal salah satu jam di semua
baris setelah akhir Maret — **tanpa satu pun error**. Dua fixture ini bikin
jalur itu keuji beneran, bukan cuma di unit test dengan input buatan.

**Invarian yang harus dipegang:** dua file itu digenerate dari array trade yang
sama. Jadi kalau kamu import masing-masing ke account dengan `server_timezone`
yang cocok, **instant yang tersimpan di database harus identik**. Kalau beda,
konversi timezone-mu salah. Itu assertion paling berguna yang bisa kamu tulis
buat fitur import.

### Angka referensi fixture

Diverifikasi terpisah oleh Tech Lead (saldo awal 10.000, account UTC):

| Metrik              | Nilai          |
| ------------------- | -------------- |
| Trades / win / loss | 180 / 98 / 82  |
| Win rate            | 54,44%         |
| Profit factor       | 2,2324         |
| Net P&L             | 8.095,46       |
| Avg R               | +0,4552        |
| Max drawdown        | 578,61 (3,98%) |

Angka-angka ini **sengaja nggak dihitung ulang di test** — ngitungnya itu justru
bagian yang kamu pelajari (§5.3 di spec). Yang jagain angka-angka ini tetap sama
adalah gate determinisme fixture di CI: kalau byte file-nya nggak berubah,
metriknya juga nggak mungkin berubah. Pakai tabel ini buat ngecek hasil
kalkulatormu sendiri waktu sudah nulis.

**Yang nggak ada di fixture ini:** nggak ada satu pun baris dengan SL = 0, jadi
jalur "trade tanpa stop loss → R = NULL" nggak keuji dari sini. Edge case itu
sengaja ditulis tangan di `fixtures/edge-cases.csv` — mikirin kasusnya sendiri
itu bagian dari belajarnya.

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

### Kenapa `typecheck` manggil `next typegen` dulu

Next 16 nge-generate tipe buat route, page, dan layout ke `.next/types/` — termasuk
`LayoutProps` yang dipakai di `src/app/layout.tsx`. Tipe itu **nggak di-commit**
(`.next/` ada di `.gitignore`), jadi di checkout yang masih bersih tipe itu belum
ada dan `tsc --noEmit` gagal dengan `Cannot find name 'LayoutProps'`.

Di laptop kamu error ini nggak keliatan, karena `.next/` sudah kebentuk dari
`npm run dev` atau `npm run build` sebelumnya. Artinya `typecheck` bisa **hijau
palsu di lokal tapi merah di CI** — persis jenis kegagalan yang paling bikin
bingung, karena "di komputerku jalan kok".

Makanya script-nya `next typegen && tsc --noEmit`, bukan `tsc --noEmit` doang.
`next typegen` cuma bikin file tipe, nggak nge-build apa-apa, jadi cepat.

> Kalau kamu nambah script yang manggil `tsc` langsung, inget nambahin
> `next typegen` di depannya.

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

## `npm audit` bakal ngeluh — dan itu wajar

`npm audit` nunjukin 4 temuan **moderate** di `esbuild`, ketarik lewat
`@esbuild-kit/*` yang dipakai `drizzle-kit`.

**Jangan jalanin `npm audit fix --force`.** Perintah itu bakal nurunin
`drizzle-kit` dari 0.31 ke **0.18** — mundur belasan versi major — dan bikin
semua perintah `db:*` di repo ini rusak. npm nyebut itu "fix" karena dia cuma
nyari versi mana pun yang nggak kena advisory, tanpa peduli itu maju atau mundur.

Kenapa temuan ini aman diabaikan:

- `drizzle-kit` itu **devDependency**. Nggak pernah ikut ke bundle produksi.
- Advisory-nya soal **dev server bawaan esbuild** yang ngelayani request lintas
  origin. `drizzle-kit` pakai esbuild buat nge-bundle file config, bukan buat
  ngejalanin server. Jalur yang rentan itu nggak pernah kepanggil.

Yang **tidak** boleh diabaikan: temuan `high`/`critical` di `dependencies`
(bukan `devDependencies`), apalagi yang kena runtime. Itu ditangani.

Cara lihat bedanya:

```bash
npm audit --omit=dev     # cuma yang beneran ikut ke produksi
```

Sekarang perintah itu harus bersih. Kalau nanti nggak bersih, itu baru urusan.

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
