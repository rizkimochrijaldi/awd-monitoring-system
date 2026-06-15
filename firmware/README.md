# Firmware ESP32 — Sistem Monitoring AWD

Firmware node sensor pemantauan tinggi muka air pada sawah AWD.
Dirancang untuk **VS Code + PlatformIO** agar mendukung *vibe coding*.

**Mode saat ini: USB (tanpa baterai).** Daya dari kabel USB laptop.
Kode monitoring baterai tetap ada tetapi dinonaktifkan via flag
`ENABLE_BATTERY_MONITOR` di `config.h`.

---

## 1. Persiapan VS Code (sekali saja)

1. Install **VS Code**: https://code.visualstudio.com
2. Buka tab **Extensions** (ikon kotak di kiri).
3. Cari dan install **PlatformIO IDE**. Tunggu sampai selesai.
4. Restart VS Code.

> Untuk vibe coding, install juga GitHub Copilot atau ekstensi AI lain.
> Dengan PlatformIO, AI bisa membaca seluruh struktur project.

---

## 2. Buka Project Ini

1. **File -> Open Folder** -> pilih folder `firmware_awd`.
2. PlatformIO otomatis mendeteksi `platformio.ini`.
3. Tunggu unduhan dependensi (ESP32 platform + ArduinoJson), sekali saja.

---

## 3. Konfigurasi yang Perlu Diubah (di `include/config.h`)

### a. WiFi (mobile hotspot HP)
```cpp
#define WIFI_SSID       "Hotspot_Rijal"
#define WIFI_PASSWORD   "password123"
```

### b. Alamat server (saat integrasi nanti)
```cpp
#define SERVER_URL  "http://192.168.43.100:5000/api/readings"
```
> Untuk tahap firmware-saja, biarkan. Pembacaan tetap muncul di
> Serial Monitor walau pengiriman "gagal" karena server belum ada.

### c. Mode pengujian
```cpp
#define TEST_MODE   true   // true = baca tiap 10 detik (debug di meja)
                           // false = mode lapangan (deep sleep 2 jam)
```

### d. Monitoring baterai (saat ini OFF)
```cpp
#define ENABLE_BATTERY_MONITOR   false   // USB: nonaktif
                                         // set true jika pasang baterai
```

---

## 4. Mode Daya USB — Yang Perlu Diperhatikan

- **JANGAN sambungkan baterai/MT3608** ke rail saat pakai USB.
  Dua sumber daya bertabrakan bisa merusak komponen.
- Daya 5V untuk sensor & relay diambil dari **pin 5V/VIN ESP32**
  (ESP32 meneruskan daya USB), bukan dari MT3608.
- Karena tidak ada baterai, voltage divider baterai (GPIO34)
  tidak perlu dipasang. Field baterai pada data dikirim sebagai null.

---

## 5. Peta Pin (sesuai wiring terakhir)

| Pin ESP32 | Sambungan | Catatan |
|-----------|-----------|---------|
| 5V / VIN  | Rail merah breadboard | Output 5V dari USB |
| GND       | Rail biru breadboard | Ground bersama |
| GPIO5     | TRIG sensor | Langsung (3.3V cukup) |
| GPIO18    | ECHO sensor via divider 10k+10k | WAJIB divider (5V->2.5V) |
| GPIO23    | IN relay | Sinyal kontrol |
| GPIO2     | LED status bawaan | Indikator kerja |
| GPIO34    | (tidak dipakai saat USB) | Untuk baterai jika diaktifkan |

---

## 6. Upload ke ESP32

1. Sambungkan ESP32 ke laptop via kabel micro USB (kabel data!).
2. Klik ikon **PlatformIO** (kepala semut) di sidebar.
3. Pilih **Upload** (atau ikon panah di status bar bawah).
4. Tunggu sampai `SUCCESS`.

> Gagal "port not found"? Cek kabel USB harus kabel data. Driver
> CP2102 biasanya otomatis; jika tidak, install "CP210x USB to UART".

---

## 7. Lihat Hasil (Serial Monitor)

1. Klik ikon **colokan** (Serial Monitor) di status bar PlatformIO.
2. Baud rate **115200**.
3. Contoh output (mode USB):

```
=== Sistem Monitoring AWD — ESP32 ===
Mode daya: USB (monitor baterai nonaktif)
====================================
Jarak mentah : 35.2 cm
Jarak koreksi: 36.19 cm
Muka air     : -16.19 cm (KERING/aerobik)
Baterai      : - (mode USB, monitor nonaktif)
Status pompa : ON
====================================
Menghubungkan ke WiFi... terhubung!
Mengirim payload:
{"device_id":"AWD-NODE-01","distance_raw_cm":35.2,...,"power_source":"USB"}
```

---

## 8. Mengaktifkan Kembali Baterai (nanti)

Saat ingin pakai baterai di lapangan:
1. Pasang baterai + MT3608 (atur output 5V dulu dengan multimeter).
2. Pasang voltage divider baterai (10k+10k) ke GPIO34.
3. Di `config.h`: ubah `ENABLE_BATTERY_MONITOR` menjadi `true`.
4. Lepaskan USB. Sistem kini berjalan dari baterai.

> Tidak perlu menulis ulang kode — semua sudah ada, tinggal aktifkan flag.

---

## 9. Struktur Project

```
firmware_awd/
├── platformio.ini       -> konfigurasi board & library
├── include/
│   └── config.h         -> SEMUA pengaturan (ubah di sini)
├── src/
│   └── main.cpp         -> kode utama firmware
└── README.md            -> panduan ini
```
