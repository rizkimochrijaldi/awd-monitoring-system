# Backend — AWD Monitoring System

Backend Flask + SQLite untuk sistem pemantauan tinggi muka air AWD. Menerima data
sensor dari ESP32, menghitung emisi CH4/CO2-eq (PRD §4), menyimpan time-series,
mengirim notifikasi Telegram, menghasilkan laporan PDF, **dan** menyajikan dashboard
frontend pada origin yang sama (`http://localhost:5000`).

> Seluruh logika perhitungan mengikuti `docs/PRD_AWD_Monitoring.md` §4 secara persis dan
> diuji terhadap Tabel Verifikasi §4.5. Bentuk JSON endpoint dicocokkan dengan
> `window.AWD` di `website/assets/data.js` agar frontend bisa diintegrasikan dengan
> mengganti sumber mock → `fetch`.

## Struktur

```
website/backend/
├── app.py               # Aplikasi Flask: route API + penyajian frontend statis
├── db.py                # Lapisan akses SQLite (readings, agregasi, alerts, settings)
├── emissions.py         # Engine perhitungan PRD §4 (port dari data.js)
├── telegram_notify.py   # Notifikasi Telegram (dedup/histeresis)
├── report.py            # Laporan PDF (ReportLab)
├── schema.sql           # Skema database (PRD §7)
├── seed.py              # Inisialisasi DB + seed settings/device default (+ --demo)
├── requirements.txt
├── .env.example         # Template environment (salin → .env)
└── tests/
    └── test_emissions.py  # Uji Tabel Verifikasi §4.5 (WAJIB lulus)
```

## Setup & menjalankan

```bash
cd website/backend

# 1. (opsional) buat virtualenv
python -m venv .venv && .venv\Scripts\activate     # Windows
# source .venv/bin/activate                          # Linux/macOS

# 2. install dependency
pip install -r requirements.txt

# 3. (opsional) konfigurasi Telegram
cp .env.example .env        # lalu isi TELEGRAM_BOT_TOKEN & TELEGRAM_CHAT_ID

# 4. inisialisasi database (membuat awd.db + settings + device default)
python seed.py              # tambahkan --demo untuk menyuntik reading contoh

# 5. jalankan server
python app.py
```

Buka **http://localhost:5000** → dashboard tampil. API berada di bawah `/api/...`.

> Saat pertama dijalankan, `app.py` otomatis membuat tabel & seed bila DB belum ada.
> `python seed.py` berguna untuk menyiapkan/ulang DB secara eksplisit.

### Menjalankan test (Tabel Verifikasi §4.5)

```bash
python -m pytest tests/ -v      # bila pytest terpasang
python tests/test_emissions.py  # tanpa pytest
```

## Endpoint API

| Method | Path | Fungsi |
|--------|------|--------|
| `POST` | `/api/readings` | Ingestion sensor (kontrak firmware). Server membuat timestamp, menghitung ulang `water_level` (§4.1), menentukan `is_aerobic`/pompa (§4.7–4.8), update agregasi, cek ambang → alert + Telegram. |
| `GET`  | `/api/dashboard` | Ringkasan terkini: reading terakhir, fase AWD, emisi hari ini, `cumulativeCo2eqG`, status pompa, baterai. Mirror `AWD.latest`/`AWD.today`/`AWD.SETTINGS`. |
| `GET`  | `/api/readings?days=N` atau `?from=&to=` | Deret waktu reading untuk grafik. |
| `GET`  | `/api/emissions/daily` | Agregasi harian (mirror `AWD.days`). |
| `GET`  | `/api/alerts` | Log alert + `unreadCount` (mirror `AWD.alerts`). |
| `POST` | `/api/alerts/read` | Tandai semua alert terbaca. |
| `GET`/`PUT` | `/api/settings` | Baca/ubah parameter; nilai turunan menyesuaikan otomatis. |
| `GET`  | `/api/report.pdf?from=&to=` | Unduh laporan PDF (grafik + tabel + narasi). |
| `GET`  | `/api/verify` | Tabel Verifikasi §4.5 yang dihitung. |
| `GET`  | `/health` | Status server + apakah Telegram aktif. |

### Kontrak `POST /api/readings`

```json
{
  "device_id": "AWD-NODE-01",
  "distance_raw_cm": 32.5,
  "h_corrected_cm": 33.41,
  "water_level_cm": -13.41,
  "pump_status": "ON",
  "battery_voltage": null,
  "battery_percent": null,
  "power_source": "USB"
}
```

- **Timestamp dibuat di server** (firmware tidak mengirim waktu).
- Server **menghitung ulang** `h_corrected` & `water_level` dari `distance_raw_cm`
  memakai nilai di tabel `settings` (integritas, §4.1) — nilai dari firmware tidak
  dipercaya begitu saja.
- `battery_voltage`/`battery_percent` boleh `null` (mode USB).
- Status pompa ditentukan ulang di server dengan histeresis (§4.8).
- Tolak `400` bila `device_id` tidak dikenal atau angka tidak wajar.

## Contoh `curl`

```bash
# Kirim reading (mode USB, tanpa baterai)
curl -X POST http://localhost:5000/api/readings \
  -H "Content-Type: application/json" \
  -d '{"device_id":"AWD-NODE-01","distance_raw_cm":35.0,
       "battery_voltage":null,"battery_percent":null,"power_source":"USB"}'

# Reading dengan baterai lemah (memicu alert baterai)
curl -X POST http://localhost:5000/api/readings \
  -H "Content-Type: application/json" \
  -d '{"device_id":"AWD-NODE-01","distance_raw_cm":34.0,"battery_voltage":3.30,"battery_percent":3}'

# Ringkasan dashboard
curl http://localhost:5000/api/dashboard

# Deret waktu 7 hari terakhir
curl "http://localhost:5000/api/readings?days=7"

# Agregasi emisi harian
curl http://localhost:5000/api/emissions/daily

# Ubah luas petak → nilai emisi turunan ikut menyesuaikan
curl -X PUT http://localhost:5000/api/settings \
  -H "Content-Type: application/json" -d '{"plot_area_m2":200}'

# Tabel verifikasi §4.5
curl http://localhost:5000/api/verify

# Unduh laporan PDF
curl "http://localhost:5000/api/report.pdf?from=2026-04-29&to=2026-06-16" -o laporan.pdf
```

## Notifikasi Telegram

Diaktifkan via `.env` (`TELEGRAM_ENABLED=true`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`).
Bila kosong/nonaktif, sistem tetap berjalan tanpa Telegram.

- **Irigasi** (`water_level ≤ -15`): dikirim hanya pada transisi pompa **OFF → ON**
  (anti-spam tiap 2 jam).
- **Baterai lemah** (`battery_voltage ≤ low_battery_v`): dikirim sekali; di-reset hanya
  setelah tegangan pulih **+0.18 V** (histeresis, mengikuti pola `buildAlerts` di
  `data.js`).

## Keamanan

- Secret hanya di `.env` (sudah di-`.gitignore`). `.env.example` tanpa nilai asli.
- File `*.db`/`*.sqlite` di-`.gitignore`.

## Integrasi frontend — mode uji coba (data dummy + pengukuran asli)

Frontend **sudah terintegrasi** dengan backend dalam mode hibrida untuk uji coba:

- `assets/data.js` tetap menghasilkan **season dummy** yang kaya (agar dashboard penuh).
- Saat halaman disajikan oleh backend, `data.js` memanggil `window.AWD.refresh()` yang
  mengambil reading nyata dari `GET /api/readings`, lalu **menggabungkannya** dengan data
  dummy dan menjalankan ulang seluruh pipeline (agregasi, alert). Jadi dashboard
  menampilkan **data dummy + data pengukuran asli** yang masuk via `POST /api/readings`.
- `assets/app.js` memanggil `refresh()` saat muat dan otomatis tiap **30 detik**
  (terasa real-time).
- Bila halaman dibuka langsung via `file://` (tanpa backend), `refresh()` gagal diam-diam
  dan dashboard tetap memakai data dummy → cocok untuk demo offline.

### Cara menjalankan mode uji coba

```bash
cd website/backend
python seed.py        # TANPA --demo: DB mulai kosong agar hanya data asli yang ditambah
python app.py
# buka http://localhost:5000 → dashboard tampil dengan data dummy
# kirim pengukuran (atau dari ESP32) → muncul menumpuk di atas data dummy
curl -X POST http://localhost:5000/api/readings -H "Content-Type: application/json" \
  -d '{"device_id":"AWD-NODE-01","distance_raw_cm":35.2,
       "battery_voltage":null,"battery_percent":null,"power_source":"USB"}'
# tunggu maks. 30 detik atau refresh browser → titik data baru muncul
```

> Catatan: untuk mode ini gunakan `python seed.py` **tanpa** `--demo`, supaya hanya
> pengukuran sungguhan yang menumpuk di atas data dummy frontend (bukan demo backend).

### Endpoint yang sudah dipakai / siap dipakai frontend

- `GET /api/readings` → digabung sebagai reading live oleh `AWD.refresh()` (mode saat ini).
- `GET /api/dashboard`, `/api/emissions/daily`, `/api/alerts`, `/api/settings`,
  `/api/verify`, `/api/report.pdf` → tersedia bila ingin mengganti sumber dummy
  sepenuhnya (mode produksi). Nama field, satuan, dan aturan pembulatan sudah dicocokkan
  dengan `data.js` (`level`, `dap`, `pump`, `nAerobic`, `ch4ReducedG`, `co2eqReducedG`,
  `cumulativeCo2eqG`). Nilai emisi dikirim **presisi penuh**; pembulatan di sisi tampilan.
```
