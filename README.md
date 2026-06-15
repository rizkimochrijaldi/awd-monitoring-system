# AWD Monitoring System

Sistem pemantauan tinggi muka air berbasis Internet of Things (IoT) untuk implementasi metode *Alternate Wetting and Drying* (AWD) sebagai strategi pengurangan emisi gas rumah kaca pada budidaya padi sawah.

[![Status](https://img.shields.io/badge/status-prototype-yellow)]()
[![Platform](https://img.shields.io/badge/platform-ESP32-blue)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()
[![IPB](https://img.shields.io/badge/IPB-Teknik%20Pertanian%20%26%20Biosistem-darkgreen)]()

---

## Latar Belakang

Budidaya padi sawah secara konvensional dengan sistem penggenangan terus-menerus (*continuous flooding*) menghasilkan emisi metana (CH₄) yang signifikan dan menjadi salah satu penyumbang gas rumah kaca dari sektor pertanian. Metode *Alternate Wetting and Drying* (AWD) terbukti mampu menurunkan emisi metana hingga 33–49% serta menghemat air irigasi hingga 23–42% tanpa menurunkan hasil panen.

Namun penerapan AWD terhambat oleh beban pemantauan manual tinggi muka air setiap hari sepanjang fase pengeringan. Sistem ini menyelesaikan masalah tersebut dengan menyediakan pemantauan otomatis berbasis IoT yang dilengkapi estimasi pengurangan emisi gas rumah kaca secara kuantitatif.

## Fitur Utama

- **Pemantauan otomatis** tinggi muka air pada pipa pengamatan sawah dengan interval 2 jam
- **Dashboard real-time** menampilkan dinamika muka air, fase AWD, dan status indikator pompa
- **Estimasi pengurangan emisi** CH₄ dan CO₂-ekuivalen berbasis metode IPCC (2019), dihitung proporsional terhadap durasi kondisi aerobik aktual
- **Notifikasi Telegram** otomatis ketika tinggi muka air mencapai ambang batas irigasi
- **Laporan PDF** ringkasan kinerja sistem sepanjang musim tanam
- **Self-hosted** — seluruh sistem berjalan lokal tanpa biaya berlangganan layanan cloud

## Arsitektur Sistem

```
┌─────────────────┐     WiFi      ┌──────────────┐     ┌──────────┐
│   Node sensor   │  ──────────►  │   Backend    │ ──► │ Frontend │
│  ESP32 + sensor │   (HTTP POST) │ Flask + DB   │     │  React   │
└─────────────────┘               └──────────────┘     └──────────┘
       │                                  │
       │                                  └──► Telegram Bot
       │                                  └──► Laporan PDF
       │
       └── JSN-SR04M ultrasonic
       └── Tinggi muka air pada
           pipa pengamatan AWD
```

Sistem mengadaptasi arsitektur SmartWT (Mascherpa et al., 2026) dengan substitusi komponen lokal Indonesia.

## Struktur Repository

```
awd-monitoring-system/
├── firmware/        Kode ESP32 untuk node sensor lapangan
│   ├── platformio.ini
│   ├── include/config.h
│   └── src/main.cpp
├── website/         Dashboard berbasis web (frontend + backend)
│   ├── frontend/    React + Chart.js
│   └── backend/     Flask + SQLite (akan ditambah)
├── docs/            Dokumentasi proyek
│   ├── laporan/     Laporan akademik (PPKI IPB)
│   ├── PRD.md       Project Requirements Document
│   └── wiring/      Diagram wiring & skema
└── README.md        File ini
```

## Spesifikasi Teknis

### Komponen Perangkat Keras

| Komponen | Tipe | Fungsi |
|---|---|---|
| Mikrokontroler | ESP32 DevKit-C V4 (WROOM-32D) | Pengolah dan pengirim data |
| Sensor | JSN-SR04M ultrasonic waterproof | Pengukur jarak permukaan air |
| Relay | 5V single-channel (active-LOW) | Indikator status pompa |
| Step-up | MT3608 boost converter | Konversi 3,7V → 5V (mode baterai) |
| Sumber daya | 2× Panasonic NCR18650B paralel | Mode lapangan |
| Pipa pengamatan | PVC 4 inci, panjang 50 cm | Water tube AWD |

### Stack Perangkat Lunak

- **Firmware**: C++ (Arduino framework) via PlatformIO
- **Backend**: Python Flask + SQLite
- **Frontend**: React + Chart.js
- **PDF generation**: ReportLab
- **Notifikasi**: Telegram Bot API

### Parameter Sistem

| Parameter | Nilai default | Sumber |
|---|---|---|
| Interval pengiriman data | 2 jam | SmartWT (Mascherpa et al., 2026) |
| Faktor koreksi sensor | 1,028 | SmartWT |
| Faktor emisi dasar (EFc) | 1,30 kg CH₄ ha⁻¹ hari⁻¹ | IPCC (2019) |
| Faktor skala AWD (SFw) | 0,55 | IPCC (2019) |
| GWP CH₄ (horizon 100 tahun) | 28 | IPCC (2019) |
| Ambang irigasi (safe AWD) | −15 cm | IRRI |

## Logika Perhitungan Emisi

Pengurangan emisi dihitung secara **proporsional** terhadap durasi kondisi aerobik aktual, bukan secara biner per hari:

```
ΔEF = EFc × (SFw,CF − SFw,AWD)
     = 1,30 × (1,00 − 0,55) = 0,585 kg CH₄ ha⁻¹ hari⁻¹

ch4_reduced = (n_aerobic / 12) × 5,85 gram        (untuk petak 100 m²)
co2eq_reduced = ch4_reduced × 28
```

dengan `n_aerobic` = jumlah pembacaan dengan tinggi muka air di bawah 0 cm dalam satu hari, dan 12 = jumlah pembacaan per hari (interval 2 jam).

Detail lengkap dan tabel verifikasi tersedia di [`docs/PRD.md`](docs/PRD.md).

## Cara Memulai

### Prasyarat

- VS Code dengan ekstensi PlatformIO IDE
- Python 3.10+
- Node.js 18+ (untuk frontend)
- Akun Telegram Bot (opsional, untuk notifikasi)

### Setup Firmware

```bash
cd firmware/
# Edit include/config.h sesuai pengaturan jaringan dan parameter lapangan
# Hubungkan ESP32 via USB, lalu di VS Code: PlatformIO → Upload
```

Panduan lengkap perakitan dan upload tersedia di [`firmware/README.md`](firmware/README.md).

### Setup Backend (akan ditambah)

```bash
cd website/backend/
pip install -r requirements.txt
python app.py
```

### Setup Frontend

```bash
cd website/frontend/
# Saat ini menggunakan data simulasi.
# Buka file HTML utama langsung di browser.
```

## Status Pengembangan

- [x] Pemilihan komponen dan perancangan sistem
- [x] Perakitan prototipe perangkat keras
- [x] Pengembangan firmware ESP32 (pembacaan sensor, koneksi WiFi)
- [x] Pengembangan frontend dashboard (mode simulasi)
- [x] Penyusunan PRD dan laporan akademik
- [ ] Pengembangan backend Flask
- [ ] Integrasi end-to-end firmware ↔ backend ↔ frontend
- [ ] Pengujian lapangan di sawah
- [ ] Kalibrasi sensor dan validasi akurasi
- [ ] Implementasi notifikasi Telegram
- [ ] Modul ekspor laporan PDF

## Keterbatasan

Sebagai prototipe riset, sistem ini memiliki beberapa keterbatasan:

- **Estimasi emisi**, bukan pengukuran langsung — perhitungan menggunakan faktor emisi IPCC, bukan fluks gas aktual
- **Single-node** — pemantauan terbatas pada satu petak sawah
- **Status pompa virtual** — relay berfungsi sebagai indikator logika, bukan kontrol aktuator fisik
- **Ketergantungan WiFi** — sistem membutuhkan konektivitas jaringan (saat ini via mobile hotspot)

## Referensi Utama

1. Mascherpa P, Rienzner M, Tkachenko D, Garza R, Brandalese F, Naldi E, Gandolfi C, Facchi A. 2026. SmartWT: an open IoT sensor, datalogger and GPRS data transmission device for monitoring water levels in rice fields, with application to AWD irrigation. *Computers and Electronics in Agriculture*. 241:111324.
2. [IPCC] Intergovernmental Panel on Climate Change. 2019. *2019 Refinement to the 2006 IPCC Guidelines for National Greenhouse Gas Inventories*. Volume 4, Chapter 5: Cropland.
3. Pramono A, Jumari, Adriany TA. 2018. Penghematan air dan penurunan emisi gas rumah kaca pada perlakuan alternate wetting and drying di lahan sawah. *Ecolab*. 12(1):20–31.
4. Chidthaisong A, Cha-un N, Rossopa B, et al. 2018. Evaluating the effects of alternate wetting and drying on methane and nitrous oxide emissions from a paddy field in Thailand. *Soil Science and Plant Nutrition*. 64(1):31–38.

## Tim Pengembang

Proyek tugas mata kuliah **Internet of Things untuk Pertanian dan Biosistem**, Program Studi Teknik Pertanian dan Biosistem, Fakultas Teknik dan Teknologi, Institut Pertanian Bogor.

| Nama | NIM |
|---|---|
| Rizki Moch Rijaldi | F0501251004 |
| Lina Siti Kholifah | F0501251007 |
| Muhammad Alvin Maulana | F0501251010 |

**Dosen Pengampu:**
- Dr. Slamet Widodo, S.TP, M.Sc
- Dr. Ir. I Dewa Made Subrata, M.Agr
- Dr. Ir. Radite Praeko Agus Setiawan, M.Agr

## Lisensi

Proyek ini dirilis di bawah lisensi MIT. Lihat berkas [LICENSE](LICENSE) untuk detail.

Sebagai proyek akademik, sitiran terhadap repository ini sangat diapresiasi jika digunakan sebagai referensi.

---

*Repository ini merupakan bagian dari penelitian pengembangan teknologi IoT untuk pertanian presisi yang mendukung implementasi praktik pertanian berkelanjutan di Indonesia.*
