"""
seed.py — Inisialisasi DB + seed nilai default settings & device.

Nilai default diambil dari PRD §4.2 dan objek SETTINGS di website/assets/data.js.
Jalankan langsung untuk membuat DB kosong + 1 device + 1 baris settings:

    python seed.py

Tambahkan --demo untuk menyuntik beberapa reading contoh (memudahkan cek dashboard):

    python seed.py --demo
"""

import sys
from datetime import datetime, timedelta

import db
import emissions as em

# Default settings — mirror SETTINGS di data.js (PRD §4.2)
DEFAULT_SETTINGS = {
    "device_id": "AWD-NODE-01",
    "device_name": "Petak Uji A — Sawah Cikabayan",
    "planting_date": "2026-04-29",
    "plot_area_m2": 100,
    "pipe_height_above_ground_cm": 20,
    "threshold_irrigation_cm": -15,
    "threshold_flooding_cm": 5,
    "ef_baseline": 1.30,
    "sfw_cf": 1.00,
    "sfw_awd": 0.55,
    "gwp_ch4": 28,
    "readings_per_day": 12,
    "low_battery_v": 3.40,
    "telegram_enabled": 0,
}


def seed(with_demo=False):
    db.init_db()
    if not db.settings_exist():
        db.upsert_settings(DEFAULT_SETTINGS)
        print("[ok] settings di-seed dengan nilai default PRD 4.2")
    else:
        print("[..] settings sudah ada - dilewati")

    db.get_or_create_device(
        DEFAULT_SETTINGS["device_id"],
        DEFAULT_SETTINGS["device_name"],
        DEFAULT_SETTINGS["pipe_height_above_ground_cm"],
    )
    print(f"[ok] device {DEFAULT_SETTINGS['device_id']} siap")

    if with_demo:
        _seed_demo_readings()
        db.recompute_all()
        print("[ok] reading demo + agregasi emisi dibuat")


def _seed_demo_readings():
    """Suntik ~3 hari reading (12/hari) dengan pola AWD sederhana untuk demo."""
    s = db.get_settings()
    device = db.get_or_create_device(s["device_id"])
    pipe_h = s["pipe_height_above_ground_cm"]
    start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0) \
        - timedelta(days=2)

    level = 4.0
    pump = "OFF"
    for day in range(3):
        for k in range(12):
            ts = start + timedelta(days=day, hours=k * 2)
            # drain / re-flood sederhana
            if pump == "ON":
                level += 2.4
                if level >= s["threshold_flooding_cm"]:
                    pump = "OFF"
            else:
                level -= 1.6
            if level <= s["threshold_irrigation_cm"]:
                pump = "ON"
            level = max(-22, min(7.5, level))

            dist_raw = (pipe_h - level) / em.CORRECTION_FACTOR
            h_corr = em.h_corrected(dist_raw)
            lvl = em.water_level(dist_raw, pipe_h)
            db.insert_reading(
                device["id"], round(dist_raw, 1), round(h_corr, 2), round(lvl, 2),
                None, None, lvl < 0, pump, "USB", ts.isoformat(timespec="seconds"),
            )


if __name__ == "__main__":
    seed(with_demo="--demo" in sys.argv)
