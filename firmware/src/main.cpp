// ============================================================
//  Sistem Pemantauan Water Level Berbasis IoT untuk AWD
//  Firmware ESP32 DevKit-C V4 (WROOM-32D)
//
//  MODE SAAT INI: USB (tanpa baterai)
//   - Daya dari kabel USB laptop.
//   - Monitoring baterai dinonaktifkan via ENABLE_BATTERY_MONITOR
//     di config.h. Kodenya TIDAK dihapus, hanya dilewati compiler.
//
//  Alur kerja:
//   1. Bangun dari deep sleep (atau loop saat TEST_MODE)
//   2. Baca jarak sensor JSN-SR04M (median beberapa sampel)
//   3. Koreksi jarak: H = 1.028 * jarak_mentah
//   4. Hitung tinggi muka air = tinggi_pipa_atas_tanah - H
//   5. (opsional) Baca tegangan baterai via ADC
//   6. Tentukan indikator pompa lokal (relay/LED)
//   7. Kirim data JSON ke server via WiFi (HTTP POST)
//   8. Tidur kembali (mode lapangan) / ulang (mode tes)
//
//  Konsisten dengan PRD section 4 (Logika Perhitungan).
// ============================================================

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "config.h"

// Konversi menit ke mikrodetik untuk deep sleep
#define uS_PER_MIN 60000000ULL

// ------------------------------------------------------------
// Membaca jarak dari JSN-SR04M (mode trigger-echo, seperti HC-SR04)
// Mengembalikan jarak dalam cm (median beberapa sampel agar stabil).
// Mengembalikan -1 jika semua pembacaan gagal.
// ------------------------------------------------------------
float bacaSensorMentah() {
  float sampel[SENSOR_SAMPLES];
  int valid = 0;

  for (int i = 0; i < SENSOR_SAMPLES; i++) {
    // Picu sensor: pulsa 10us di TRIG
    digitalWrite(PIN_TRIG, LOW);
    delayMicroseconds(2);
    digitalWrite(PIN_TRIG, HIGH);
    delayMicroseconds(10);
    digitalWrite(PIN_TRIG, LOW);

    // Ukur durasi pulsa ECHO (mikrodetik)
    long durasi = pulseIn(PIN_ECHO, HIGH, ECHO_TIMEOUT_US);

    if (durasi > 0) {
      // Jarak (cm) = durasi * kecepatan_suara / 2
      // kecepatan suara ~ 0.0343 cm/us
      float jarak = durasi * 0.0343 / 2.0;
      sampel[valid] = jarak;
      valid++;
    }
    delay(50); // jeda antar sampel
  }

  if (valid == 0) return -1; // semua gagal

  // Urutkan untuk ambil median (bubble sort sederhana, data kecil)
  for (int i = 0; i < valid - 1; i++) {
    for (int j = 0; j < valid - i - 1; j++) {
      if (sampel[j] > sampel[j + 1]) {
        float t = sampel[j]; sampel[j] = sampel[j + 1]; sampel[j + 1] = t;
      }
    }
  }
  return sampel[valid / 2]; // nilai tengah
}

// ============================================================
//  BLOK MONITORING BATERAI
//  Dinonaktifkan saat ENABLE_BATTERY_MONITOR = false (mode USB).
//  Kode tetap ada untuk dipakai lagi saat memasang baterai.
// ============================================================
#if ENABLE_BATTERY_MONITOR

// Membaca tegangan baterai via voltage divider (10k+10k) + ADC
float bacaTeganganBaterai() {
  long total = 0;
  const int N = 20;
  for (int i = 0; i < N; i++) {
    total += analogRead(PIN_BATT_ADC);
    delay(5);
  }
  float adcAvg = (float)total / N;

  // Konversi ADC -> tegangan pin -> tegangan baterai (x rasio divider)
  float vPin = (adcAvg / ADC_MAX) * ADC_REF_VOLTAGE;
  float vBatt = vPin * BATT_DIVIDER_RATIO;
  return vBatt;
}

// Konversi tegangan baterai -> persentase (Li-ion 3.0V=0%, 4.2V=100%)
int teganganKePersen(float v) {
  float pct = (v - 3.0) / (4.2 - 3.0) * 100.0;
  if (pct > 100) pct = 100;
  if (pct < 0) pct = 0;
  return (int)pct;
}

#endif // ENABLE_BATTERY_MONITOR

// ------------------------------------------------------------
// Tentukan status pompa lokal (histeresis), hanya indikator
// relay/LED di lapangan. Keputusan final tetap di server.
// Status disimpan di RTC memory agar bertahan saat deep sleep.
// ------------------------------------------------------------
RTC_DATA_ATTR char pumpStatus[4] = "OFF";

void updateStatusPompa(float level) {
  if (level <= THRESHOLD_IRRIGATION_CM) {
    strcpy(pumpStatus, "ON");
  } else if (level >= THRESHOLD_FLOODING_CM) {
    strcpy(pumpStatus, "OFF");
  }
  // di antara kedua ambang: pertahankan status (histeresis)

  bool on = (strcmp(pumpStatus, "ON") == 0);
#if RELAY_ACTIVE_LOW
  // Active-LOW: kirim LOW untuk menyalakan, HIGH untuk mematikan
  digitalWrite(PIN_RELAY, on ? LOW : HIGH);
#else
  // Active-HIGH: kirim HIGH untuk menyalakan, LOW untuk mematikan
  digitalWrite(PIN_RELAY, on ? HIGH : LOW);
#endif
}

// ------------------------------------------------------------
// Koneksi WiFi (dengan timeout 20 detik)
// ------------------------------------------------------------
bool koneksiWiFi() {
  Serial.print("Menghubungkan ke WiFi");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long mulai = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - mulai > 20000) {
      Serial.println(" GAGAL!");
      return false;
    }
    delay(500);
    Serial.print(".");
  }
  Serial.println(" terhubung!");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
  return true;
}

// ------------------------------------------------------------
// Kirim data ke server via HTTP POST (format JSON)
// Field baterai hanya disertakan jika ENABLE_BATTERY_MONITOR true.
// ------------------------------------------------------------
bool kirimData(float distRaw, float hCorr, float level,
               float vBatt, int battPct) {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");

  // Susun payload JSON sesuai PRD (section 3.1)
  JsonDocument doc;
  doc["device_id"]        = DEVICE_ID;
  doc["distance_raw_cm"]  = round(distRaw * 10) / 10.0;
  doc["h_corrected_cm"]   = round(hCorr * 100) / 100.0;
  doc["water_level_cm"]   = round(level * 100) / 100.0;
  doc["pump_status"]      = pumpStatus;

#if ENABLE_BATTERY_MONITOR
  doc["battery_voltage"]  = round(vBatt * 1000) / 1000.0;
  doc["battery_percent"]  = battPct;
#else
  // Mode USB: tidak ada baterai. Kirim null agar server tahu.
  doc["battery_voltage"]  = nullptr;
  doc["battery_percent"]  = nullptr;
  doc["power_source"]     = "USB";
#endif

  String payload;
  serializeJson(doc, payload);

  Serial.println("Mengirim payload:");
  Serial.println(payload);

  int httpCode = http.POST(payload);
  bool sukses = (httpCode > 0 && httpCode < 400);

  if (sukses) {
    Serial.printf("Server merespons: %d\n", httpCode);
  } else {
    Serial.printf("Gagal kirim, kode: %d\n", httpCode);
  }
  http.end();
  return sukses;
}

// ------------------------------------------------------------
// Satu siklus pengukuran lengkap
// ------------------------------------------------------------
void siklusPengukuran() {
  digitalWrite(PIN_LED, HIGH); // LED nyala = sedang bekerja

  // 1. Baca jarak mentah
  float distRaw = bacaSensorMentah();
  if (distRaw < 0) {
    Serial.println("ERROR: sensor gagal dibaca!");
    digitalWrite(PIN_LED, LOW);
    return;
  }

  // 2. Koreksi jarak (PRD section 4.1)
  float hCorr = CORRECTION_FACTOR * distRaw;

  // 3. Hitung tinggi muka air relatif permukaan tanah
  float level = PIPE_HEIGHT_ABOVE_GROUND_CM - hCorr;

  // 4. Baca baterai (hanya jika fitur diaktifkan)
  float vBatt = 0.0;
  int battPct = 0;
#if ENABLE_BATTERY_MONITOR
  vBatt = bacaTeganganBaterai();
  battPct = teganganKePersen(vBatt);
#endif

  // 5. Update indikator pompa lokal
  updateStatusPompa(level);

  // 6. Tampilkan ringkasan di serial
  Serial.println("====================================");
  Serial.printf("Jarak mentah : %.1f cm\n", distRaw);
  Serial.printf("Jarak koreksi: %.2f cm\n", hCorr);
  Serial.printf("Muka air     : %.2f cm %s\n", level,
                level < 0 ? "(KERING/aerobik)" : "(TERGENANG)");
#if ENABLE_BATTERY_MONITOR
  Serial.printf("Baterai      : %.2f V (%d%%)\n", vBatt, battPct);
#else
  Serial.println("Baterai      : - (mode USB, monitor nonaktif)");
#endif
  Serial.printf("Status pompa : %s\n", pumpStatus);
  Serial.println("====================================");

  // 7. Kirim ke server
  if (koneksiWiFi()) {
    kirimData(distRaw, hCorr, level, vBatt, battPct);
  }

  digitalWrite(PIN_LED, LOW);
}

// ============================================================
// SETUP
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n\n=== Sistem Monitoring AWD — ESP32 ===");
#if ENABLE_BATTERY_MONITOR
  Serial.println("Mode daya: BATERAI (monitor aktif)");
#else
  Serial.println("Mode daya: USB (monitor baterai nonaktif)");
#endif

  // Inisialisasi pin
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_RELAY, OUTPUT);
  pinMode(PIN_LED, OUTPUT);

  // Pastikan relay MATI sejak boot (penting agar tidak nyala "klik"
  // saat ESP32 baru dihidupkan). Nilai default disesuaikan jenis relay.
#if RELAY_ACTIVE_LOW
  digitalWrite(PIN_RELAY, HIGH);   // active-LOW: HIGH = OFF
#else
  digitalWrite(PIN_RELAY, LOW);    // active-HIGH: LOW = OFF
#endif
  digitalWrite(PIN_LED, LOW);

#if ENABLE_BATTERY_MONITOR
  // Konfigurasi ADC untuk baca baterai
  analogReadResolution(12);          // 0-4095
  analogSetAttenuation(ADC_11db);    // rentang ~0-3.3V
#endif

  // Jalankan satu siklus pengukuran
  siklusPengukuran();

  // Jika BUKAN mode tes: matikan WiFi & deep sleep
  if (!TEST_MODE) {
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
    Serial.printf("Tidur selama %d menit...\n", SLEEP_MINUTES);
    Serial.flush();
    esp_sleep_enable_timer_wakeup(SLEEP_MINUTES * uS_PER_MIN);
    esp_deep_sleep_start();
  }
}

// ============================================================
// LOOP (hanya dipakai saat TEST_MODE = true)
// ============================================================
void loop() {
  if (TEST_MODE) {
    delay(TEST_INTERVAL_SEC * 1000);
    Serial.println("\n--- Siklus pengujian berikutnya ---");
    siklusPengukuran();
  }
  // Mode lapangan: loop tidak dijalankan (sudah deep sleep di setup)
}