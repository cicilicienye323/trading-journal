# price-worker (Go) — kerangka Proyek 2

Belum diisi. Ini jalur deploy yang sudah disiapkan supaya waktu Proyek 2 mulai,
kamu langsung nulis logika price poller / alert engine — bukan berkelahi sama
Dockerfile dan config Fly.

**Kamu yang nulis kode Go-nya.** Itu skill baru yang mau kamu buktikan di CV,
dan itu bagian yang bakal ditanya waktu interview.

## Kenapa Go dipisah dari Next.js

Vercel jalanin serverless function: hidup sebentar buat satu request, terus
mati. Price poller yang harus megang koneksi WebSocket ke feed harga dan alert
worker yang jalan tiap detik nggak cocok sama model itu. Makanya service-nya
berdiri sendiri di Fly.io, dan Next.js manggil lewat HTTP.

Pemisahan ini juga yang bikin CV kamu beda: "polyglot, tahu kapan harus keluar
dari serverless" itu jawaban interview yang jauh lebih kuat daripada "saya pakai
Next.js".

## Mulai nanti

```bash
cd services/price-worker
go mod init github.com/<username>/fx-dashboard/price-worker
go mod tidy
go run ./cmd/worker
```

Struktur yang disarankan (idiomatik Go, bukan struktur Java):

```
cmd/worker/main.go     # entrypoint, wiring, graceful shutdown
internal/feed/         # klien WebSocket ke penyedia harga
internal/alert/        # evaluasi rule + pengiriman notifikasi
internal/store/        # akses Postgres (database/sql, tanpa ORM)
```

`internal/` bikin Go menolak import dari luar modul ini — batas modul yang
dipaksakan compiler, bukan cuma konvensi.

## Deploy

`fly.toml` dan `Dockerfile` sudah ada dan tinggal dipakai:

```bash
fly launch --no-deploy   # sekali di awal, buat bikin app-nya
fly secrets set DATABASE_URL="<neon-pooled-url>"
fly deploy
```
