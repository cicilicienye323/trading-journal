# Deploy Pertama — Langkah per Langkah

Panduan rinci buat sekali jalan: dari repo di laptop sampai URL live yang bisa
dibuka orang. Sekitar **45 menit** kalau lancar.

Kamu sudah punya GitHub dan Vercel. Yang belum: **Neon**. Itu langkah 1.

**Aturan yang bikin ini worth it:** lakukan ini **sekarang**, waktu app-nya masih
halaman kosong. Bukan nanti setelah fiturnya jadi. Kalau dibalik, kamu bakal
debug sepuluh masalah sekaligus di hari deadline — dan itu penyebab paling umum
portfolio nggak pernah selesai.

Tiap langkah ada **cara ngecek berhasil**. Jangan lanjut kalau cek-nya gagal —
error di langkah 2 jauh lebih gampang dibaca daripada gejalanya di langkah 5.

---

## Jalur cepat (opsional) — `npm run deploy:bootstrap`

Kalau kamu nggak mau ngeklik-klik di tiga dashboard, langkah 1–5 bisa dijalanin
satu perintah. Yang kamu kerjain cuma bikin **tiga token** (~5 menit):

| Token          | Ambil di                                    | Scope          |
| -------------- | ------------------------------------------- | -------------- |
| `NEON_API_KEY` | console.neon.tech → Settings → **API keys** | default        |
| `GITHUB_TOKEN` | github.com/settings/tokens → **classic**    | centang `repo` |
| `VERCEL_TOKEN` | vercel.com/account/tokens                   | default        |

### Kalau nggak mau token nempel di mana-mana

Token itu kredensial hidup. Jangan pernah nempelin ke chat, komen issue, atau
apa pun yang nyimpen log permanen — sekali ke-log, dia ada di situ selamanya dan
siapa pun yang bisa baca log itu bisa pakai.

Cara paling aman: **`.github/workflows/deploy-bootstrap.yml`**. Deploy-nya jalan
sebagai GitHub Action, token disimpan sebagai **repository secret** — terenkripsi,
otomatis kesensor di output job, dan bisa dicabut dari satu layar.

1. Bikin repo GitHub kosong dan push (langkah 2 di bawah). Ini nggak butuh bagi
   token ke siapa pun — pakai kredensial git kamu sendiri.
2. Settings → Secrets and variables → Actions, tambahin dua secret:
   `NEON_API_KEY` dan `VERCEL_TOKEN`.
3. Actions → **Deploy bootstrap** → Run workflow. Biarin `dry_run` **centang**
   dulu buat preflight. Kalau bersih, jalanin lagi dengan `dry_run` dilepas.

`GITHUB_TOKEN` **nggak usah** dibikin sama sekali — Actions nyuntikin sendiri
tiap run, dan repo-nya udah ada, jadi PAT nggak ada gunanya lagi di sini.

Cabut `NEON_API_KEY` sama `VERCEL_TOKEN` begitu URL-nya hidup. Ini langkah
provisioning sekali jalan, bukan kredensial yang perlu nempel.

### Atau jalanin lokal

Kalau mau jalanin dari laptop sendiri, token cukup ada di shell kamu dan nggak
ke mana-mana. Cek dulu ketiganya kepakai apa nggak — ini read-only, nggak bikin
apa pun:

```bash
NEON_API_KEY=... GITHUB_TOKEN=... VERCEL_TOKEN=... \
  npm run deploy:bootstrap -- --dry-run
```

Kalau bersih, baru jalanin beneran:

```bash
NEON_API_KEY=... GITHUB_TOKEN=... VERCEL_TOKEN=... \
  npm run deploy:bootstrap -- --name trading-journal
```

Scriptnya bikin project Neon (Postgres 16, Singapore), bikin repo GitHub dan
push, jalanin migrasi, bikin project Vercel + isi ketiga environment variable di
**ketiga** target, deploy, seed, terus nge-poll `/api/health` sampai hijau.

**Aman diulang.** Tiap langkah ngecek dulu resource-nya sudah ada atau belum, dan
nggak pernah ngehapus apa pun. Kalau mati di tengah — misalnya GitHub belum
kesambung ke Vercel — betulin penyebabnya terus jalanin perintah yang sama lagi;
yang sudah jadi dilewatin. Mau ngerjain sebagian manual juga bisa:

```bash
npm run deploy:bootstrap -- --skip neon,github    # udah dikerjain manual
```

Langkah yang bisa di-`--skip`: `neon`, `github`, `push`, `migrate`, `vercel`,
`seed`, `verify`.

Connection string dan secret yang kegenerate disimpan di `.deploy-state.json`
(sudah masuk `.gitignore` — perlakuin kayak `.env.local`).

> **Dua hal yang tetap harus lewat browser**, karena nggak ada API-nya: daftar
> akun Neon, dan nyambungin GitHub ke Vercel sekali di
> vercel.com/account/login-connections. Sisanya diurus script.

Kalau kamu mau ngerti tiap langkahnya — dan itu yang bakal ditanya waktu
interview — kerjain manual di bawah ini. Baca minimal sekali walaupun pakai
jalur cepat.

---

## Langkah 1 — Neon (~5 menit)

1. Buka [neon.tech](https://neon.tech) → **Sign up** (bisa pakai akun GitHub).
2. **Create project.** Isi:
   - Name: `trading-journal`
   - Postgres version: **16** (samain sama `docker-compose.yml`)
   - Region: **Singapore (ap-southeast-1)** kalau kamu di Indonesia — latency ke
     Jakarta ~20ms, versus ~200ms kalau ambil US East.
3. Habis project kebikin, Neon nampilin **connection string**. Ada dropdown
   buat milih **Pooled connection** — **pilih itu.**

**Cara ngecek benar:** host-nya ada `-pooler`, contohnya:

```
postgresql://user:pass@ep-cool-name-123456-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
                                            ^^^^^^^
```

**Kenapa harus pooled:** tiap serverless function di Vercel buka koneksi baru.
Pakai string direct, kamu kena `too many connections` begitu ada traffic
sedikit — dan itu munculnya nanti waktu ada yang beneran buka portfolio kamu,
bukan waktu kamu ngetes sendiri.

Simpan string itu. Kita pakai di langkah 3 dan 5.

---

## Langkah 2 — Push ke GitHub (~10 menit)

### 2a. Bikin repo kosong

Di [github.com/new](https://github.com/new):

- Repository name: `trading-journal`
- Public (biar recruiter bisa lihat)
- **Jangan** centang "Add a README", "Add .gitignore", atau "Choose a license"

Repo harus **benar-benar kosong**. Kalau ada file-nya, push pertama kamu bakal
ditolak dengan `rejected — fetch first`, dan bereskannya lebih ribet daripada
mulai dari kosong.

### 2b. Push

```bash
cd trading-journal
git remote add origin https://github.com/<username>/trading-journal.git
git branch -M main
git push -u origin main
```

Ganti `<username>` sama username GitHub kamu.

**Cara ngecek berhasil:** refresh halaman repo — file-nya kelihatan, dan tab
**Actions** nunjukin workflow lagi jalan (atau sudah selesai).

### 2c. Tunggu CI hijau

Buka tab **Actions**. Ada tiga job: `verify`, `docker`, `migrations`.

Semua harus hijau. Kalau merah, buka job-nya, baca step yang gagal, dan cocokin
ke tabel troubleshooting di bawah.

> **Kenapa CI dipasang dari commit pertama:** CI yang dipasang belakangan selalu
> merah, dan kamu bakal betulin 20 error sekaligus. CI yang hijau dari awal cuma
> pernah merah gara-gara satu commit terakhir — jadi kamu selalu tahu penyebabnya.

---

## Langkah 3 — Terapkan migrasi ke Neon (~5 menit)

Ini yang paling sering kelewat. Migrasi **tidak** jalan otomatis waktu deploy —
itu disengaja (migrasi yang jalan sendiri di tengah deploy bisa setengah jadi).

Dari laptop, tembak langsung ke Neon:

```bash
DATABASE_URL="<connection-string-pooled-dari-langkah-1>" npx drizzle-kit migrate
```

**Cara ngecek berhasil:** outputnya `migrations applied successfully`. Atau buka
**Tables** di dashboard Neon — tabelnya kelihatan.

Kalau langkah ini kelewat, deploy-nya tetap sukses tapi `/api/health` balas 503,
dan kamu bakal ngira masalahnya di Vercel padahal database-nya yang masih kosong.

---

## Langkah 4 — Import ke Vercel (~10 menit)

1. [vercel.com/new](https://vercel.com/new) → **Import Git Repository** → pilih
   `trading-journal`.
2. Vercel otomatis mendeteksi Next.js. **Biarkan semua default.**
3. Buka **Environment Variables** sebelum klik Deploy. Tambahkan:

   | Name                 | Value                                         |
   | -------------------- | --------------------------------------------- |
   | `DATABASE_URL`       | connection string pooled dari langkah 1       |
   | `BETTER_AUTH_SECRET` | hasil `openssl rand -base64 32` (lihat bawah) |
   | `DEMO_EMAIL`         | `demo@example.com`                            |

   Centang **ketiga environment** (Production, Preview, Development) buat
   masing-masing.

   Generate secret-nya:

   ```bash
   openssl rand -base64 32
   ```

   **Jangan** pakai nilai yang ada di `.env.example` — itu placeholder, dan
   siapa pun yang lihat repo kamu bisa baca.

   > **`BETTER_AUTH_URL` sengaja nggak ada di tabel.** Kamu nggak mungkin tahu
   > URL Vercel-mu sebelum deploy pertama. App-nya nurunin sendiri dari variable
   > bawaan Vercel — production pakai domain stabil, preview pakai URL preview-nya
   > masing-masing. Isi manual **cuma** kalau nanti pakai custom domain.

4. **Deploy.**

**Cara ngecek berhasil:** buka `https://<app>.vercel.app/api/health`. Harus:

```json
{ "status": "ok", "database": "reachable" }
```

Kalau `503` / `"database": "unreachable"` — app-nya hidup tapi nggak bisa baca
database. Lihat troubleshooting.

---

## Langkah 5 — Seed data demo (~5 menit)

Recruiter **nggak akan** daftar akun buat lihat portfolio kamu. Kalau lihat isinya
butuh signup, kebanyakan orang nutup tab.

```bash
DATABASE_URL="<connection-string-pooled>" npm run seed
```

**Cara ngecek berhasil:** buka URL production, datanya kelihatan tanpa login.

---

## Langkah 6 — Preview per PR (opsional, ~10 menit)

Vercel otomatis bikin URL preview tiap PR. Yang perlu diatur satu hal: **preview
jangan nembak database production.**

Pasang [Neon Vercel Integration](https://neon.tech/docs/guides/vercel): tiap PR
dapat database branch sendiri, `DATABASE_URL`-nya di-inject otomatis, dan
branch-nya kehapus waktu PR di-merge. Gratis di free tier.

Tanpa itu, semua preview nembak database yang sama dengan production — dan
migrasi yang salah di PR bakal ngerusak data live.

---

## Troubleshooting

Diurutkan dari yang paling sering.

### `/api/health` balas 503, `"database": "unreachable"`

App-nya jalan; database-nya yang nggak kebaca. Urut dari atas:

1. **Migrasi belum dijalankan** (langkah 3). Paling sering. Cek Tables di Neon —
   kalau kosong, itu penyebabnya.
2. **Pakai connection string yang direct, bukan pooled.** Cek ada `-pooler` di
   host-nya.
3. **`DATABASE_URL` nggak dicentang buat environment yang bener.** Di Vercel,
   Settings → Environment Variables, pastikan kecentang buat Production.
4. **Habis ganti env var tapi belum redeploy.** Vercel nggak nerapin env var
   baru ke deployment lama. Deployments → titik tiga → **Redeploy**.

### Build gagal di Vercel: `Invalid environment variables`

Ada variable yang kurang atau salah bentuk. Pesan error-nya nyebutin **semua**
yang bermasalah sekaligus, bukan satu-satu — baca daftarnya, betulin semuanya,
redeploy.

Kalau yang disebut `BETTER_AUTH_URL` padahal kamu di Vercel: nyalain **"Enable
access to System Environment Variables"** di Settings → Environment Variables.
Tanpa itu `VERCEL_URL` nggak ada dan nggak ada yang bisa diturunin.

### Login keliatan sukses tapi habis itu balik logout

Cookie session-nya kepasang di domain yang salah. Berarti `BETTER_AUTH_URL`
kamu isi manual dengan nilai yang nggak cocok sama URL yang beneran dipakai.
**Hapus** variable itu dari Vercel dan biarkan diturunin otomatis.

### CI merah di `verify`, padahal di laptop hijau

- **`typecheck` gagal soal `LayoutProps`** — `.next/types` belum kegenerate.
  Harusnya nggak kejadian (`npm run typecheck` sudah manggil `next typegen`
  duluan), tapi kalau kamu bikin script baru yang manggil `tsc` langsung,
  tambahin `next typegen &&` di depannya.
- **`format:check` gagal** — jalanin `npm run format`, commit hasilnya.
- **Fixture stale** — jalanin `npm run fixtures`, commit hasilnya.

Sebelum push, jalanin `npm run verify`. Isinya sama persis dengan CI.

### CI merah di `docker`

Biasanya file yang ada di laptop tapi nggak ke-commit. Cek `git status`.
Git **nggak nyimpen folder kosong** — kalau ada folder yang isinya kamu hapus
semua, foldernya ilang dari repo walaupun masih ada di laptopmu.

### `git push` ditolak: `rejected — fetch first`

Repo GitHub-nya nggak kosong (kemungkinan kecentang "Add a README"). Paling
gampang: hapus repo-nya di GitHub, bikin ulang tanpa file apa pun, push lagi.

### Request pertama setelah lama nganggur lambat ~1 detik

Normal. Neon free tier nge-suspend database yang idle; request pertama
ngebangunin. **Tulis ini di README** — reviewer yang ngerti bakal nganggep itu
poin plus, bukan minus.

---

## Checklist "beneran live"

Portfolio dengan link mati lebih merugikan daripada nggak ada link. Sebelum
ditulis di CV:

- [ ] URL production kebuka di **incognito** (bukan cuma di browser kamu)
- [ ] `/api/health` balas 200
- [ ] Ada seed data — bisa diklik-klik tanpa daftar
- [ ] Badge CI di README hijau
- [ ] README ada screenshot
