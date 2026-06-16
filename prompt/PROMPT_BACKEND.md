# Prompt Vibe Coding — Backend AWD Monitoring System

> Copy seluruh blok di bawah ini ke kotak prompt Claude Code (VSCode), dengan folder
> repo `awd-monitoring-system` terbuka sebagai workspace. Boleh dipecah jadi beberapa
> giliran kalau panjang, tapi paling efektif dikirim utuh sebagai satu brief.

---

Kamu bekerja di repo `awd-monitoring-system` yang sudah ada. **Frontend** (dashboard
vanilla JS di `website/`) dan **firmware** (ESP32 PlatformIO di `firmware/`) sudah selesai.
Tugasmu: **membangun BACKEND yang belum ada**, tanpa mengubah firmware dan seminimal
mungkin menyentuh frontend.

## Langkah 0 — Baca dulu, jangan langsung menulis kode

Baca dan pahami file berikut, jadikan sumber kebenaran:

- `docs/PRD_AWD_Monitoring.md` — spesifikasi lengkap. **§4 (Logika Perhitungan), §7
  (Skema DB), §3 (Fitur), §8 (Constraint).** Patuhi §4 **persis** — konstanta & rumus
  sudah diverifikasi, jangan diubah.
- `website/assets/data.js` — engine perhitungan + **bentuk data yang diharapkan
  frontend**. Backend HARUS menghasilkan struktur data yang setara (`window.AWD` —
  cek objek `SETTINGS`, fungsi `simulate`, `aggregate`, `buildAlerts`, `verifyTable`,
  dan objek yang di-`return`). Cocokkan nama field, satuan, dan aturan pembulatan, supaya
  frontend nanti cukup mengganti sumber mock → `fetch`.
- `firmware/src/main.cpp` (fungsi `kirimData`) & `firmware/include/config.h` — kontrak
  payload yang dikirim ESP32 dan parameter lapangan.
- `README.md` — gambaran umum & status pengembangan.

Catatan: frontend BUKAN React (PRD menyebut React, tapi implementasinya vanilla JS +
Chart.js). Jangan buat build pipeline frontend.

## Kontrak payload dari firmware → `POST /api/readings`

ESP32 mengirim JSON seperti ini:

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

Aturan:
- **Timestamp dibuat di server** saat data diterima (PRD §3.1). Firmware tidak mengirim waktu.
- `battery_voltage`/`battery_percent` bisa `null` (mode USB) — tangani dengan benar.
- Server **wajib menghitung ulang** `water_level` dari `distance_raw_cm` memakai nilai di
  tabel `settings` (PRD §4.1: `H_corrected = 1.028 × distance_raw`;
  `water_level = pipe_height_above_ground − H_corrected`) demi integritas, lalu simpan
  `distance_raw_cm`, `h_corrected_cm`, `water_level_cm`, dan `is_aerobic = (water_level < 0)`.
- Validasi: tolak `400` jika `device_id` tidak dikenal atau angka tidak wajar.

## Stack & struktur

- Python 3.10+, **Flask**, **SQLite** (file tunggal), **ReportLab** (PDF), **requests**
  (Telegram). Semua di folder baru `website/backend/`.
- Struktur modular yang disarankan: `app.py`, `db.py`, `emissions.py`, `telegram_notify.py`,
  `report.py`, `schema.sql`, `seed.py`, `requirements.txt`, `.env.example`, `README.md`,
  dan folder `tests/`.
- Backend **juga melayani file statis frontend**: route `/` menyajikan
  `website/AWD Monitoring Dashboard.html` + folder `website/assets/`, supaya seluruh
  sistem berjalan di satu `http://localhost:5000` (self-hosted, PRD §8.5).

## Skema database (PRD §7) — implementasikan tepat

Tabel: `devices`, `readings`, `settings`, `emission_daily`, `alerts`, `reports` (kolom
sesuai ERD di PRD §7). Catatan kunci:
- `settings` menyimpan **semua** konstanta perhitungan (jangan hardcode di kode). Seed
  nilai default dari PRD §4.2 dan `SETTINGS` di `data.js`: `planting_date = 2026-04-29`,
  `plot_area_m2 = 100`, `pipe_height_above_ground_cm = 20`, `threshold_irrigation_cm = -15`,
  `threshold_flooding_cm = 5`, `ef_baseline = 1.30`, `sfw_cf = 1.00`, `sfw_awd = 0.55`,
  `gwp_ch4 = 28`, `readings_per_day = 12`, `low_battery_v = 3.40`.
- `is_aerobic` di `readings` = `true` jika `water_level_cm < 0`; kolom inilah yang
  diagregasi menjadi `n_aerobic_readings` di `emission_daily`.

## Logika perhitungan (PRD §4) — WAJIB

- §4.1 konversi level (hitung ulang di server).
- §4.3 `delta_EF = ef_baseline × (sfw_cf − sfw_awd)` dan
  `ch4_full_day = delta_EF × (plot_area_m2 / 10000) × 1000`.
- §4.4 proporsional: `aerobic_fraction = n_aerobic / readings_per_day`;
  `ch4_reduced_g = aerobic_fraction × ch4_full_day`; `co2eq_reduced_g = ch4_reduced_g × gwp_ch4`.
- §4.6 akumulasi memakai **presisi penuh** — jangan menjumlahkan nilai yang sudah dibulatkan.
  Pembulatan hanya untuk tampilan.
- §4.7/§4.8 dua ambang **terpisah**: `0 cm` hanya untuk penghitung aerobik (emisi),
  `−15 cm` hanya untuk irigasi/pompa & notifikasi, `+5 cm` untuk target genangan. Status
  pompa pakai **histeresis** (pertahankan status di antara dua ambang). Jangan dicampur.
- **Buat unit test** yang mencocokkan **Tabel Verifikasi §4.5** untuk petak 100 m²:

  | n_aerobic | ch4_reduced_g | co2eq_reduced_g |
  |-----------|---------------|-----------------|
  | 0  | 0.00 | 0.00   |
  | 1  | 0.49 | 13.65  |
  | 3  | 1.46 | 40.95  |
  | 6  | 2.93 | 81.90  |
  | 9  | 4.39 | 122.85 |
  | 12 | 5.85 | 163.80 |

  Test ini **harus lulus**.

- Fase AWD dihitung dinamis dari `planting_date` (lihat `phaseOf()` di `data.js`:
  Fase I `DAP ≤ 18`, Fase II `19–60`, Fase III `> 60`).

## Endpoint API (samakan output dengan yang dipakai `window.AWD` di `data.js`)

1. `POST /api/readings` — ingestion (kontrak di atas). Simpan reading, update agregasi
   `emission_daily` hari berjalan, cek ambang → buat `alert` + kirim Telegram bila perlu.
   Balas `200` JSON.
2. `GET /api/dashboard` — ringkasan terkini: reading terakhir (level, DAP, fase AWD,
   battery %), emisi hari ini, `cumulative_co2eq_g`, `pump_status`. (mirror `AWD.latest`,
   `AWD.today`, `AWD.SETTINGS`)
3. `GET /api/readings?days=N` atau `?from=&to=` — deret waktu reading untuk grafik.
4. `GET /api/emissions/daily` — agregasi harian (mirror `AWD.days`).
5. `GET /api/alerts` — log alert + `unreadCount` (mirror `AWD.alerts`).
6. `GET /api/settings` & `PUT /api/settings` — baca/ubah parameter; saat `plot_area_m2`
   atau ambang berubah, nilai turunan ikut menyesuaikan.
7. `GET /api/report.pdf?from=&to=` — ReportLab: grafik tinggi muka air, tabel statistik
   harian, total CH₄ & CO₂-eq tersisihkan, dan narasi ringkasan **Bahasa Indonesia gaya
   formal**. Catat metadata ke tabel `reports`.
8. (opsional) `GET /api/verify` — kembalikan Tabel Verifikasi §4.5 yang dihitung.

## Notifikasi Telegram (PRD §3.6, §6)

- Kirim saat `water_level ≤ threshold_irrigation_cm` (−15): pesan "saatnya irigasi".
  Kirim saat `battery_voltage ≤ low_battery_v`.
- Token & chat id dari `.env` (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`).
- **Dedup/histeresis** agar tidak spam tiap 2 jam: kirim irigasi hanya pada transisi
  `OFF → ON`; reset alert baterai hanya setelah tegangan pulih `+0.18 V` (ikuti pola
  `buildAlerts` di `data.js`).

## Keamanan & kebersihan repo

- Semua secret ke `.env`; sediakan `.env.example` (tanpa nilai asli).
- Tambahkan `.env` dan file `*.db`/`*.sqlite` ke `.gitignore`.

## Acceptance criteria

- `pip install -r requirements.txt && python app.py` berjalan; buka `http://localhost:5000`
  menampilkan dashboard.
- Unit test Tabel Verifikasi §4.5 **lulus**.
- Contoh `POST` payload via `curl` tersimpan dan dashboard ter-update.
- Bentuk JSON endpoint cocok dengan `data.js` sehingga frontend bisa diintegrasikan
  dengan mengganti sumber mock → `fetch`.
- Sertakan `website/backend/README.md` berisi cara setup + contoh `curl`.

## Out of scope (PRD §9) — jangan dikerjakan

Multi-node, autentikasi, kontrol pompa fisik, prediksi cuaca/API eksternal, akses internet publik.

---

Setelah selesai, beri ringkasan: file yang dibuat, cara menjalankan, dan **langkah
integrasi frontend** (mengganti `window.AWD` mock dengan `fetch` ke endpoint) sebagai
fase lanjutan.
