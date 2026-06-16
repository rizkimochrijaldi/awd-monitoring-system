"""
db.py — Lapisan akses SQLite untuk AWD Monitoring.

Tugas utama:
  - Buka koneksi (row -> dict).
  - Inisialisasi skema + seed settings/device.
  - Sisipkan reading (server menghitung ulang water_level, PRD §4.1).
  - Bangun ulang agregasi emission_daily dari readings (presisi penuh, PRD §4.6).
  - Query untuk endpoint dashboard, readings, emissions, alerts, settings.
"""

import os
import sqlite3
from datetime import datetime

import emissions as em

_DB_PATH = None


# ── Koneksi ───────────────────────────────────────────────────────────
def set_db_path(path):
    global _DB_PATH
    _DB_PATH = path


def get_db_path():
    return _DB_PATH or os.path.join(os.path.dirname(__file__), "awd.db")


def connect():
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


# ── Inisialisasi ──────────────────────────────────────────────────────
def init_db():
    schema = os.path.join(os.path.dirname(__file__), "schema.sql")
    with open(schema, "r", encoding="utf-8") as f:
        sql = f.read()
    with connect() as conn:
        conn.executescript(sql)


def settings_exist():
    with connect() as conn:
        row = conn.execute("SELECT 1 FROM settings WHERE id = 1").fetchone()
        return row is not None


# ── Settings (PRD §4.2 — satu baris id=1) ─────────────────────────────
_SETTINGS_FIELDS = [
    "device_id", "device_name", "planting_date", "plot_area_m2",
    "pipe_height_above_ground_cm", "threshold_irrigation_cm",
    "threshold_flooding_cm", "ef_baseline", "sfw_cf", "sfw_awd",
    "gwp_ch4", "readings_per_day", "low_battery_v", "telegram_enabled",
]


def get_settings():
    with connect() as conn:
        row = conn.execute("SELECT * FROM settings WHERE id = 1").fetchone()
    if row is None:
        raise RuntimeError("settings belum di-seed; jalankan seed.py")
    s = dict(row)
    s["telegram_enabled"] = bool(s["telegram_enabled"])
    return s


def upsert_settings(values):
    """Insert/replace baris settings id=1 dari dict `values`."""
    cols = ", ".join(_SETTINGS_FIELDS)
    placeholders = ", ".join("?" for _ in _SETTINGS_FIELDS)
    data = [values.get(f) for f in _SETTINGS_FIELDS]
    with connect() as conn:
        conn.execute(
            f"INSERT OR REPLACE INTO settings (id, {cols}) VALUES (1, {placeholders})",
            data,
        )


def update_settings(patch):
    """Update sebagian field settings, lalu hitung ulang agregasi turunan."""
    current = get_settings()
    current.update({k: v for k, v in patch.items() if k in _SETTINGS_FIELDS})
    upsert_settings(current)
    # Ambang / luas petak berubah -> agregasi & is_aerobic ikut menyesuaikan
    recompute_all()
    return get_settings()


# ── Devices ───────────────────────────────────────────────────────────
def get_or_create_device(device_id, name=None, pipe_height=20.0):
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM devices WHERE device_id = ?", (device_id,)
        ).fetchone()
        if row:
            return dict(row)
        conn.execute(
            "INSERT INTO devices (device_id, name, pipe_height_above_ground_cm) "
            "VALUES (?, ?, ?)",
            (device_id, name or device_id, pipe_height),
        )
        row = conn.execute(
            "SELECT * FROM devices WHERE device_id = ?", (device_id,)
        ).fetchone()
        return dict(row)


def device_known(device_id):
    with connect() as conn:
        return conn.execute(
            "SELECT 1 FROM devices WHERE device_id = ?", (device_id,)
        ).fetchone() is not None


# ── Readings ──────────────────────────────────────────────────────────
def last_pump_status():
    # Histeresis pakai reading yang terakhir TIBA (id terbesar), bukan recorded_at,
    # agar status sebelumnya konsisten meski ada selisih jam.
    with connect() as conn:
        row = conn.execute(
            "SELECT pump_status FROM readings ORDER BY id DESC LIMIT 1"
        ).fetchone()
    return row["pump_status"] if row else "OFF"


def insert_reading(device_pk, distance_raw_cm, h_corr, level, battery_voltage,
                   battery_percent, is_aerobic, pump, power_source, recorded_at):
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO readings (device_id, distance_raw_cm, h_corrected_cm, "
            "water_level_cm, battery_voltage, battery_percent, is_aerobic, "
            "pump_status, power_source, recorded_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (device_pk, distance_raw_cm, h_corr, level, battery_voltage,
             battery_percent, 1 if is_aerobic else 0, pump, power_source, recorded_at),
        )
        return cur.lastrowid


def get_readings(date_from=None, date_to=None, days=None):
    sql = "SELECT * FROM readings"
    params = []
    clauses = []
    if days is not None:
        sql_min = ("SELECT date(MAX(recorded_at), '-' || ? || ' days') "
                   "FROM readings")
        with connect() as conn:
            cutoff = conn.execute(sql_min, (days - 1,)).fetchone()[0]
        if cutoff:
            clauses.append("date(recorded_at) >= ?")
            params.append(cutoff)
    if date_from:
        clauses.append("date(recorded_at) >= ?")
        params.append(date_from)
    if date_to:
        clauses.append("date(recorded_at) <= ?")
        params.append(date_to)
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY recorded_at ASC, id ASC"
    with connect() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def latest_reading():
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM readings ORDER BY recorded_at DESC, id DESC LIMIT 1"
        ).fetchone()
    return dict(row) if row else None


# ── Agregasi emission_daily (PRD §4.4–4.6) ────────────────────────────
def recompute_all():
    """Bangun ulang seluruh tabel emission_daily dari readings.

    Akumulasi memakai presisi penuh (PRD §4.6): nilai disimpan tanpa
    pembulatan, pembulatan hanya dilakukan saat ditampilkan.
    """
    s = get_settings()
    with connect() as conn:
        rows = conn.execute(
            "SELECT date(recorded_at) AS d, "
            "SUM(is_aerobic) AS n_aer, COUNT(*) AS n_tot "
            "FROM readings GROUP BY date(recorded_at) ORDER BY d ASC"
        ).fetchall()

        conn.execute("DELETE FROM emission_daily")
        cum = 0.0
        for r in rows:
            n_aer = r["n_aer"] or 0
            n_tot = r["n_tot"] or 0
            frac = em.aerobic_fraction(n_aer, s)
            ch4 = em.ch4_reduced_g(n_aer, s)        # presisi penuh
            co2 = em.co2eq_g(ch4, s)
            cum += co2                               # akumulasi presisi penuh
            conn.execute(
                "INSERT INTO emission_daily (emission_date, n_aerobic_readings, "
                "n_total_readings, aerobic_fraction, ch4_reduced_g, "
                "co2eq_reduced_g, cumulative_co2eq_g) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (r["d"], n_aer, n_tot, frac, ch4, co2, cum),
            )


def get_emission_daily():
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM emission_daily ORDER BY emission_date ASC"
        ).fetchall()
    return [dict(r) for r in rows]


def emission_for_date(d):
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM emission_daily WHERE emission_date = ?", (d,)
        ).fetchone()
    return dict(row) if row else None


def cumulative_co2eq():
    with connect() as conn:
        row = conn.execute(
            "SELECT cumulative_co2eq_g FROM emission_daily "
            "ORDER BY emission_date DESC LIMIT 1"
        ).fetchone()
    return row["cumulative_co2eq_g"] if row else 0.0


# ── Alerts ────────────────────────────────────────────────────────────
def insert_alert(device_pk, alert_type, severity, title, message, sent_at=None):
    sent_at = sent_at or datetime.now().isoformat(timespec="seconds")
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO alerts (device_id, alert_type, severity, title, message, sent_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (device_pk, alert_type, severity, title, message, sent_at),
        )
        return cur.lastrowid


def get_alerts(limit=100):
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM alerts ORDER BY sent_at DESC, id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


def unread_alert_count():
    with connect() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS c FROM alerts WHERE is_read = 0"
        ).fetchone()
    return row["c"]


def mark_alerts_read():
    with connect() as conn:
        conn.execute("UPDATE alerts SET is_read = 1 WHERE is_read = 0")


def last_battery_alert_open():
    """True jika alert baterai terakhir belum 'di-reset' oleh pemulihan tegangan.

    Dipakai untuk dedup/histeresis baterai (pola buildAlerts di data.js).
    """
    with connect() as conn:
        row = conn.execute(
            "SELECT alert_type FROM alerts "
            "WHERE alert_type IN ('battery', 'battery_ok') "
            "ORDER BY sent_at DESC, id DESC LIMIT 1"
        ).fetchone()
    return bool(row) and row["alert_type"] == "battery"


# ── Reports ───────────────────────────────────────────────────────────
def insert_report(period_start, period_end, file_path):
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO reports (period_start, period_end, file_path) "
            "VALUES (?, ?, ?)",
            (period_start, period_end, file_path),
        )
        return cur.lastrowid
