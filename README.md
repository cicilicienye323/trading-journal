# fintech-app-template

Template repo untuk tiga proyek portfolio bertema fintech/trading. Dibikin
sekali, dipakai ulang — supaya jam ngoding kamu habis di logika bisnis, bukan di
config.

> **Catatan buat yang baca ini nanti:** ini template, bukan aplikasi. Waktu mulai
> proyek baru, copy repo ini, ganti nama di `package.json`, hapus tabel
> `healthcheck`, dan tulis schema-nya sendiri.

## Isinya

| Bagian    | Pilihan                  | Alasan singkat                                |
| --------- | ------------------------ | --------------------------------------------- |
| Framework | Next.js 16 (App Router)  | Satu repo buat UI + API, deploy paling mulus  |
| Bahasa    | TypeScript, `strict`     | Error ketahuan di editor, bukan di produksi   |
| Styling   | Tailwind CSS v4          | Nggak perlu mikir nama class                  |
| Database  | Postgres (Neon)          | Relasional, dan finance itu relasional        |
| ORM       | Drizzle                  | Migrasinya SQL biasa yang bisa kamu baca      |
| Auth      | Better Auth              | Session di DB, bisa dicabut, tanpa vendor     |
| Chart     | Recharts 3               | Equity curve = satu `<LineChart>`             |
| Timezone  | date-fns-tz              | Jam server broker → UTC, ini logika inti      |
| LLM       | `@anthropic-ai/sdk`      | Opsional — tanpa API key app tetap jalan      |
| Test      | Vitest + Testing Library | Config-nya satu file, jalannya cepat          |
| Lint      | ESLint + Prettier        | Prettier format, ESLint benar/salah           |
| Container | Docker + Compose         | `docker compose up` = app + DB, satu perintah |
| CI        | GitHub Actions           | Gratis, dan badge-nya kelihatan di repo       |
| Deploy    | Vercel + Neon            | Preview per PR tanpa disetel                  |

## Mulai lokal

Butuh Node 20+ dan Docker.

### Cara cepat — semuanya di Docker

```bash
cp .env.example .env.local
docker compose up --build
```

App + Postgres nyala bareng di `http://localhost:3000`. Ini cara paling gampang
buat orang lain nyobain repo kamu tanpa install apa-apa.

### Cara sehari-hari — dev server + DB di Docker

Container nggak punya hot reload, jadi buat ngoding pakai ini:

```bash
npm install
cp .env.example .env.local

npm run db:up          # Postgres lokal doang
npm run db:migrate     # terapkan migrasi
npm run seed           # isi data demo

npm run dev
```

Cek `http://localhost:3000/api/health` — harus balas
`{"status":"ok","database":"reachable"}`. Kalau iya, wiring-nya beres.

## Perintah

| Perintah              | Gunanya                                               |
| --------------------- | ----------------------------------------------------- |
| `npm run dev`         | Server development                                    |
| `npm run verify`      | Format + lint + typecheck + test (sama kayak CI)      |
| `npm run test:watch`  | Test mode watch                                       |
| `npm run up` / `down` | Start/stop seluruh stack (app + DB) di Docker         |
| `npm run db:up/down`  | Start/stop Postgres lokal doang                       |
| `npm run db:generate` | Bikin file migrasi dari perubahan `schema.ts`         |
| `npm run db:migrate`  | Terapkan migrasi                                      |
| `npm run db:push`     | Dorong schema langsung, tanpa file migrasi (dev only) |
| `npm run db:studio`   | GUI buat lihat isi database                           |
| `npm run seed`        | Isi data demo                                         |
| `npm run fixtures`    | Regenerate CSV demo MT5                               |

> **`db:push` vs `db:migrate`.** `db:push` nyamain schema database sama
> `schema.ts` tanpa bikin file migrasi — enak buat iterasi cepat di awal, tapi
> **bisa hapus kolom beserta datanya tanpa nanya.** Pakai `db:push` selama masih
> ngutak-atik bentuk tabel di lokal; begitu ada data yang sayang hilang (apalagi
> produksi), pindah ke `db:generate` + `db:migrate`.

**Sebelum push, jalankan `npm run verify`.** Isinya persis sama dengan CI, jadi
kalau lolos di lokal, lolos juga di GitHub. Lebih cepat daripada nunggu CI merah.

## Struktur

```
src/
  app/              # route (App Router)
    api/health/     # health check — pastikan DB kebaca
  db/
    index.ts        # koneksi Drizzle
    schema.ts       # definisi tabel  ← kamu isi ini per proyek
    migrations/     # SQL hasil generate, di-commit
  lib/
    fx/             # data referensi FX + generator data demo
  env.ts            # validasi environment variable
scripts/            # seed + generator fixture
services/
  price-worker/     # kerangka service Go (Proyek 2)
fixtures/           # contoh export MT5, di-commit
docs/
  SETUP.md          # penjelasan tiap file config
  DEPLOY.md         # langkah Vercel + Neon + Fly.io
```

---

## Keputusan Teknis & Trade-off

Bagian ini yang dibaca engineering manager, dan yang paling sering dilewatin
orang. Tiap pilihan di bawah ada ongkosnya — itu yang ditulis, bukan cuma
kelebihannya.

### Drizzle, bukan Prisma

Prisma lebih matang dan dokumentasinya lebih banyak. Tapi Prisma nambah satu
lapisan bahasa (`schema.prisma`) di antara kamu dan SQL, dan migrasinya
di-generate dari DSL itu.

Kamu System Analyst — SQL dan ERD itu makanan sehari-hari kamu. Drizzle
menghasilkan file `.sql` biasa yang bisa kamu baca, review, dan pertahankan
waktu interview. Skema didefinisikan pakai TypeScript biasa, jadi nggak ada
langkah codegen yang bisa basi.

**Ongkosnya:** komunitasnya lebih kecil, dan kalau nyari solusi error kadang
jawabannya cuma ada di GitHub issue. Ditukar sama transparansi — dan buat repo
yang tujuannya _menunjukkan_ kamu ngerti data modeling, transparansi lebih
berharga.

### `postgres.js`, bukan driver serverless Neon

Neon punya driver HTTP sendiri yang lebih cepat buat query one-shot di edge.
Tapi driver itu ngunci kode ke Neon.

`postgres.js` ngomong protokol Postgres biasa, jadi kode yang sama jalan di
Docker lokal, di Postgres CI, dan di Neon produksi — tanpa cabang kode. Kalau
nanti pindah ke Supabase atau Postgres sendiri, nggak ada yang perlu diubah.

**Ongkosnya:** connection overhead sedikit lebih tinggi di serverless. Diredam
dengan pakai connection string pooled Neon dan `max: 1` di produksi.

### `numeric`, bukan `double precision`, buat harga dan uang

Floating point nggak bisa merepresentasikan 0.1 dengan tepat. Di aplikasi
finance, error pembulatan yang numpuk di kolom P&L bikin angkanya nggak bisa
dipercaya — dan aplikasi trading yang angkanya salah sedikit itu sama nggak
bergunanya dengan yang salah banyak.

**Ongkosnya:** `numeric` lebih lambat dari float dan balik ke JS sebagai string,
jadi harus di-parse eksplisit. Itu justru bagus: maksa kamu mikir soal presisi
tiap kali baca angka.

### Timestamp selalu `with time zone`, disimpan UTC

Sesi trading itu lintas zona waktu, dan DST bikin offset-nya berubah dua kali
setahun. Timestamp tanpa zona waktu itu bom waktu yang meledaknya bulan Maret.

Simpan UTC, render di zona waktu user. Selalu.

### Validasi environment variable di startup

`process.env.FOO` tipenya `string | undefined` di mana-mana. Tanpa validasi,
variable yang lupa diset jadi crash di produksi — biasanya di satu halaman yang
jarang dibuka, dua minggu setelah deploy.

`src/env.ts` mem-parse semuanya sekali pakai Zod waktu boot. Kurang satu
variable, aplikasinya gagal start dengan pesan yang nyebutin nama variable-nya.

**Ongkosnya:** `next build` nggak punya environment sungguhan, jadi ada
`SKIP_ENV_VALIDATION` buat build. Konsekuensinya validasi nggak jalan waktu
build — itu sebabnya `/api/health` ada, buat nangkep di runtime.

### Migrasi dijalankan manual, bukan otomatis waktu deploy

Migrasi otomatis kelihatannya rapi sampai satu deploy gagal di tengah dan
skema-nya ketinggalan setengah jalan. Membersihkan itu di database produksi
adalah pengalaman yang nggak mau kamu alami.

Prosesnya sengaja pelan: generate, **baca SQL-nya**, commit, terapkan.

### Docker ada, tapi Vercel nggak pakai Dockerfile-nya

Deploy produksi tetap lewat build native Vercel. Dockerfile di repo ini gunanya
dua: bikin orang lain bisa jalanin repo kamu dengan satu perintah
(`docker compose up`), dan jadi bukti kamu ngerti container.

**Ongkosnya:** ada dua jalur build yang harus tetap jalan — Vercel dan Docker —
dan bisa lepas sinkron tanpa ketahuan. Makanya `docker build` **wajib** jalan di
CI: Dockerfile busuk yang nggak pernah dites lebih buruk daripada nggak ada.

CI juga nyalain container hasil build-nya dan nembak `/api/health`. Image yang
lolos `docker build` tapi mati waktu start itu kelihatan sukses di CI kalau
cuma di-build doang.

### `ANTHROPIC_API_KEY` opsional, dan itu diuji

Repo harus bisa di-clone dan dijalanin orang yang nggak punya akun Anthropic.
Fitur yang butuh model muncul disabled, bukan bikin app crash.

Yang bikin ini gampang salah: `docker compose` nulis variable kosong sebagai
**string kosong**, bukan "nggak ada". Zod `.optional()` cuma nangani yang kedua.
Tanpa penanganan khusus, `docker compose up` di mesin tanpa API key bakal bikin
app mati waktu boot. Ada test khusus buat kasus ini di `src/env.test.ts`.

### Fixture dicek ulang di CI

`npm run fixtures` deterministik — seed yang sama menghasilkan file yang sama.
CI meregenerasi dan gagal kalau ada diff, jadi fixture yang di-commit dijamin
cocok dengan generator-nya. Tanpa itu, keduanya pelan-pelan berbeda dan test
mulai nguji data yang nggak bisa direproduksi lagi.

## Batas: apa yang ditulis siapa

Repo ini scaffolding — config, pipeline, dan tooling data demo. **Kode fitur
intinya kamu yang tulis:** schema, parsing, perhitungan statistik, UI. Itu inti
belajarnya, dan itu yang harus bisa kamu jelasin baris per baris waktu interview.

Modul `src/lib/fx/` sengaja berhenti di _menghasilkan input mentah ala broker_.
Modul itu nggak menghitung win rate, R multiple, profit factor, atau equity curve
— itu punya aplikasi, dan itu bagian yang bikin kamu belajar.
