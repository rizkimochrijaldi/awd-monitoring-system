// ============================================================
// config.h — Pengaturan Sistem Monitoring AWD
// Ubah nilai di file ini sesuai kebutuhan lapangan.
//
// MODE SAAT INI: USB (tanpa baterai)
//   - Daya dari kabel USB laptop ke ESP32.
//   - ESP32 meneruskan 5V ke rail breadboard (sensor & relay).
//   - Monitoring baterai DINONAKTIFKAN (lihat ENABLE_BATTERY_MONITOR).
//     Kode baterai tetap ada, hanya dimatikan via flag.
// ============================================================
#ifndef CONFIG_H
#define CONFIG_H

// ---------- KONEKSI WIFI (mobile hotspot) ----------
// Ganti dengan SSID dan password hotspot HP kamu
#define WIFI_SSID       "Galaxy S25 Ultra CA21"
#define WIFI_PASSWORD   "rijaldi18_"

// ---------- SERVER TUJUAN ----------
// Alamat endpoint backend (saat integrasi nanti).
// Untuk sekarang boleh diarahkan ke server uji / RequestBin.
// Contoh: "http://192.168.43.100:5000/api/readings"
#define SERVER_URL      "http://192.168.43.100:5000/api/readings"

// ID perangkat (jika nanti pakai banyak node)
#define DEVICE_ID       "AWD-NODE-01"

// ---------- SAKLAR FITUR ----------
// Monitoring baterai: false karena saat ini pakai daya USB (tanpa baterai).
// Set true HANYA jika nanti memasang baterai + voltage divider ke GPIO34.
#define ENABLE_BATTERY_MONITOR   false

// ---------- PARAMETER FISIK PIPA ----------
// Tinggi bagian pipa yang berada DI ATAS permukaan tanah (cm).
// Sesuai PRD: pipa total 50 cm, tertanam 30 cm -> 20 cm di atas tanah.
#define PIPE_HEIGHT_ABOVE_GROUND_CM   20.0

// Faktor koreksi sensor (dari SmartWT, Mascherpa et al. 2026).
// H_corrected = CORRECTION_FACTOR * jarak_mentah
#define CORRECTION_FACTOR             1.028

// ---------- INTERVAL PENGIRIMAN ----------
// Interval normal lapangan = 2 jam (sesuai PRD).
// Saat pengujian/kalibrasi, ubah ke nilai kecil (mis. 30 detik).
#define SLEEP_MINUTES                 120     // 120 menit = 2 jam

// Mode pengujian: jika true, ESP32 TIDAK deep sleep, tapi loop terus
// dengan jeda TEST_INTERVAL_SEC. Memudahkan debugging di meja.
// Saat pakai USB di meja, biarkan true.
#define TEST_MODE                     true
#define TEST_INTERVAL_SEC             10      // jeda antar baca saat TEST_MODE

// ---------- PIN (sesuai panduan wiring terakhir) ----------
#define PIN_TRIG        5       // GPIO5  -> TRIG sensor (langsung)
#define PIN_ECHO        18      // GPIO18 -> ECHO sensor (via divider 10k+10k!)
#define PIN_RELAY       23      // GPIO23 -> sinyal relay (indikator pompa)
#define PIN_LED         2       // GPIO2  -> LED status bawaan
#define PIN_BATT_ADC    34      // GPIO34 -> ADC baterai (dipakai jika ENABLE_BATTERY_MONITOR)

// ---------- KALIBRASI BATERAI (dipakai jika ENABLE_BATTERY_MONITOR true) ----------
// Voltage divider baterai memakai R1 = R2 = 10k -> tegangan dibagi 2.
// Rasio tetap 2.0 karena R1 = R2 (sama seperti versi 100k).
#define BATT_DIVIDER_RATIO   2.0
// Faktor koreksi ADC ESP32 (kalibrasi halus; sesuaikan dgn multimeter).
#define ADC_REF_VOLTAGE      3.30
#define ADC_MAX              4095.0
// Ambang baterai lemah (V)
#define BATT_LOW_VOLTAGE     3.40

// ---------- AMBANG AWD (untuk indikator pompa lokal) ----------
// Catatan: keputusan emisi & notifikasi final ada di server.
// Nilai ini hanya untuk indikator relay/LED lokal di lapangan.
#define THRESHOLD_IRRIGATION_CM   -15.0   // pompa ON
#define THRESHOLD_FLOODING_CM      5.0    // pompa OFF

// ---------- LOGIKA RELAY ----------
// Mayoritas modul relay 5V (1 channel) yang dijual di Indonesia
// bersifat ACTIVE-LOW: pin IN diberi sinyal LOW -> relay AKTIF.
// Set true jika relay-mu bekerja terbalik (default modul Shopee/Tokopedia).
// Set false untuk modul relay active-HIGH.
#define RELAY_ACTIVE_LOW   true

// ---------- SENSOR ----------
// Timeout pembacaan echo (mikrodetik). 30000us ~ 5 meter.
#define ECHO_TIMEOUT_US      30000
// Jumlah sampel per pengukuran (diambil median-nya)
#define SENSOR_SAMPLES       10

#endif