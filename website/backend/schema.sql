-- ============================================================
--  AWD Monitoring — Skema Database SQLite (PRD §7)
--  Satu file tunggal, tanpa server terpisah.
-- ============================================================

PRAGMA foreign_keys = ON;

-- Metadata node sensor lapangan ---------------------------------------
CREATE TABLE IF NOT EXISTS devices (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id                   TEXT    NOT NULL UNIQUE,
    name                        TEXT,
    pipe_height_above_ground_cm REAL    NOT NULL DEFAULT 30.0,
    registered_at               TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Data tiap pembacaan (interval 2 jam) --------------------------------
CREATE TABLE IF NOT EXISTS readings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id       INTEGER NOT NULL REFERENCES devices(id),
    distance_raw_cm REAL    NOT NULL,
    h_corrected_cm  REAL    NOT NULL,
    water_level_cm  REAL    NOT NULL,
    battery_voltage REAL,                 -- NULL saat mode USB
    battery_percent REAL,                 -- NULL saat mode USB
    is_aerobic      INTEGER NOT NULL,      -- 1 jika water_level_cm < 0 (ambang 0 cm)
    pump_status     TEXT    NOT NULL,
    power_source    TEXT,                  -- 'USB' / 'BATTERY'
    recorded_at     TEXT    NOT NULL       -- timestamp dibuat di SERVER (PRD §3.1)
);
CREATE INDEX IF NOT EXISTS idx_readings_recorded_at ON readings(recorded_at);

-- Parameter sistem & seluruh konstanta perhitungan (PRD §4.2) ---------
-- Satu baris (id = 1). Konstanta TIDAK di-hardcode di kode.
CREATE TABLE IF NOT EXISTS settings (
    id                       INTEGER PRIMARY KEY CHECK (id = 1),
    device_id                TEXT,
    device_name              TEXT,
    planting_date            TEXT    NOT NULL,
    plot_area_m2             REAL    NOT NULL,
    pipe_height_above_ground_cm REAL NOT NULL,
    threshold_irrigation_cm  REAL    NOT NULL,
    threshold_flooding_cm    REAL    NOT NULL,
    ef_baseline              REAL    NOT NULL,
    sfw_cf                   REAL    NOT NULL,
    sfw_awd                  REAL    NOT NULL,
    gwp_ch4                  REAL    NOT NULL,
    readings_per_day         INTEGER NOT NULL,
    low_battery_v            REAL    NOT NULL,
    telegram_enabled         INTEGER NOT NULL DEFAULT 0
);

-- Agregasi harian (PRD §4.4–4.6) --------------------------------------
CREATE TABLE IF NOT EXISTS emission_daily (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    emission_date      TEXT    NOT NULL UNIQUE,
    n_aerobic_readings INTEGER NOT NULL,
    n_total_readings   INTEGER NOT NULL,
    aerobic_fraction   REAL    NOT NULL,
    ch4_reduced_g      REAL    NOT NULL,   -- presisi penuh (bukan nilai bulat)
    co2eq_reduced_g    REAL    NOT NULL,   -- presisi penuh
    cumulative_co2eq_g REAL    NOT NULL    -- presisi penuh
);

-- Catatan notifikasi (PRD §6) -----------------------------------------
CREATE TABLE IF NOT EXISTS alerts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id  INTEGER REFERENCES devices(id),
    alert_type TEXT    NOT NULL,           -- 'irrigation' | 'battery' | 'phase' | 'system'
    severity   TEXT    NOT NULL DEFAULT 'info',
    title      TEXT,
    message    TEXT    NOT NULL,
    is_read    INTEGER NOT NULL DEFAULT 0,
    sent_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Catatan file PDF yang dihasilkan ------------------------------------
CREATE TABLE IF NOT EXISTS reports (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    period_start TEXT,
    period_end   TEXT,
    file_path    TEXT,
    generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
