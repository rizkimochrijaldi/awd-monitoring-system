"""
app.py — Backend Flask AWD Monitoring System.

Menyajikan:
  - Ingestion sensor    : POST /api/readings
  - API dashboard       : GET  /api/dashboard, /api/readings, /api/emissions/daily,
                          /api/alerts, /api/settings (GET/PUT), /api/verify
  - Laporan PDF         : GET  /api/report.pdf
  - File statis frontend: /  + /assets/...  (satu origin http://localhost:5000)

Bentuk JSON disamakan dengan `window.AWD` di website/assets/data.js agar frontend
cukup mengganti sumber mock -> fetch (lihat README §Integrasi Frontend).
"""

import os
from datetime import datetime

from dotenv import load_dotenv
from flask import (
    Flask, request, jsonify, send_from_directory, abort, Response,
)

import db
import emissions as em
import telegram_notify as tg
import report as report_mod

load_dotenv()

# ── Path frontend statis ──────────────────────────────────────────────
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
WEBSITE_DIR = os.path.dirname(BACKEND_DIR)                 # .../website
ASSETS_DIR = os.path.join(WEBSITE_DIR, "assets")
INDEX_HTML = "AWD Monitoring Dashboard.html"

db.set_db_path(os.path.join(BACKEND_DIR, os.environ.get("DATABASE_PATH", "awd.db")))

app = Flask(__name__)


# ── Bootstrap DB saat start ───────────────────────────────────────────
def ensure_ready():
    db.init_db()
    if not db.settings_exist():
        import seed
        seed.seed()


# ── Serializer (mirror field-name data.js) ────────────────────────────
def batt_pct(v):
    """3.3V -> 0, 4.2V -> 100 (battPct di data.js)."""
    if v is None:
        return None
    return round(max(0, min(100, (v - 3.3) / 0.9 * 100)))


def serialize_reading(r, s):
    dap = em.days_after_planting(s["planting_date"], r["recorded_at"])
    return {
        "id": r["id"],
        "dap": dap,
        "ts": r["recorded_at"],
        "level": em.round_half_up(r["water_level_cm"], 2),
        "distRaw": em.round_half_up(r["distance_raw_cm"], 1),
        "hCorr": em.round_half_up(r["h_corrected_cm"], 2),
        "aerobic": bool(r["is_aerobic"]),
        "pump": r["pump_status"],
        "batt": r["battery_voltage"],
        "battPct": (r["battery_percent"] if r["battery_percent"] is not None
                    else batt_pct(r["battery_voltage"])),
        "powerSource": r["power_source"],
    }


def serialize_day(d, s):
    dap = em.days_after_planting(s["planting_date"], d["emission_date"])
    return {
        "dap": dap,
        "date": d["emission_date"],
        "phase": em.phase_of(dap),
        "nAerobic": d["n_aerobic_readings"],
        "nTotal": d["n_total_readings"],
        "aerobicFraction": d["aerobic_fraction"],
        "ch4ReducedG": d["ch4_reduced_g"],          # presisi penuh (mentah)
        "co2eqReducedG": d["co2eq_reduced_g"],
        "cumulativeCo2eqG": d["cumulative_co2eq_g"],
    }


def serialize_alert(a):
    return {
        "id": a["id"],
        "type": a["alert_type"],
        "severity": a["severity"],
        "title": a["title"],
        "msg": a["message"],
        "ts": a["sent_at"],
        "unread": not bool(a["is_read"]),
    }


# ── Ingestion: POST /api/readings (kontrak firmware) ──────────────────
@app.post("/api/readings")
def post_reading():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="payload JSON tidak valid"), 400

    device_id = payload.get("device_id")
    if not device_id or not db.device_known(device_id):
        return jsonify(error=f"device_id tidak dikenal: {device_id!r}"), 400

    distance_raw = payload.get("distance_raw_cm")
    if not isinstance(distance_raw, (int, float)) or not (0 <= distance_raw <= 600):
        return jsonify(error="distance_raw_cm tidak wajar"), 400

    s = db.get_settings()
    device = db.get_or_create_device(device_id, s.get("device_name"),
                                     s["pipe_height_above_ground_cm"])

    # Server menghitung ULANG water_level demi integritas (PRD §4.1)
    pipe_h = s["pipe_height_above_ground_cm"]
    h_corr = em.h_corrected(distance_raw)
    level = em.water_level(distance_raw, pipe_h)
    is_aerobic = level < 0                                  # ambang 0 cm (emisi)

    # Status pompa histeresis di server (PRD §4.8), dua ambang terpisah (§4.7)
    prev_pump = db.last_pump_status()
    pump = em.pump_status(level, prev_pump, s)

    battery_voltage = payload.get("battery_voltage")
    battery_percent = payload.get("battery_percent")
    if battery_voltage is not None and not isinstance(battery_voltage, (int, float)):
        return jsonify(error="battery_voltage tidak wajar"), 400
    power_source = payload.get("power_source") or (
        "USB" if battery_voltage is None else "BATTERY")

    recorded_at = datetime.now().isoformat(timespec="seconds")  # timestamp di SERVER

    reading_id = db.insert_reading(
        device["id"], round(distance_raw, 1), round(h_corr, 2), round(level, 2),
        battery_voltage, battery_percent, is_aerobic, pump, power_source, recorded_at,
    )

    # Update agregasi emission_daily hari berjalan (presisi penuh, PRD §4.6)
    db.recompute_all()

    # ── Cek ambang -> alert + Telegram (dedup/histeresis) ──
    notes = _handle_alerts(device, s, level, pump, prev_pump, battery_voltage)

    return jsonify({
        "ok": True,
        "reading_id": reading_id,
        "recorded_at": recorded_at,
        "water_level_cm": round(level, 2),
        "h_corrected_cm": round(h_corr, 2),
        "is_aerobic": is_aerobic,
        "pump_status": pump,
        "alerts": notes,
    }), 200


def _handle_alerts(device, s, level, pump, prev_pump, battery_voltage):
    """Buat alert & kirim Telegram dengan dedup/histeresis (pola data.js)."""
    fired = []

    # Irigasi: hanya pada transisi pompa OFF -> ON (PRD §3.6)
    if pump == "ON" and prev_pump != "ON":
        msg = (f"Tinggi muka air turun ke {level:.1f} cm — mencapai ambang irigasi "
               f"{s['threshold_irrigation_cm']:.0f} cm. Petak perlu segera dialiri air.")
        db.insert_alert(device["id"], "irrigation", "danger", "Saatnya irigasi", msg)
        if s["telegram_enabled"]:
            tg.send_message(tg.irrigation_message(
                level, s["threshold_irrigation_cm"], s.get("device_name") or device["device_id"]))
        fired.append("irrigation")

    # Baterai lemah: kirim sekali; reset hanya setelah pulih +0.18 V
    if battery_voltage is not None:
        low_v = s["low_battery_v"]
        already_open = db.last_battery_alert_open()
        if battery_voltage <= low_v and not already_open:
            msg = (f"Tegangan baterai {battery_voltage:.2f} V di bawah ambang aman "
                   f"{low_v:.2f} V.")
            db.insert_alert(device["id"], "battery", "warn", "Baterai node lemah", msg)
            if s["telegram_enabled"]:
                tg.send_message(tg.battery_message(
                    battery_voltage, low_v, s.get("device_name") or device["device_id"]))
            fired.append("battery")
        elif battery_voltage >= low_v + 0.18 and already_open:
            db.insert_alert(device["id"], "battery_ok", "info", "Baterai pulih",
                            f"Tegangan baterai pulih ke {battery_voltage:.2f} V.")

    return fired


# ── GET /api/dashboard (mirror AWD.latest / AWD.today / AWD.SETTINGS) ──
@app.get("/api/dashboard")
def get_dashboard():
    s = db.get_settings()
    latest = db.latest_reading()
    today = db.emission_for_date(latest["recorded_at"][:10]) if latest else None
    dap_now = (em.days_after_planting(s["planting_date"], latest["recorded_at"])
               if latest else em.days_after_planting(s["planting_date"]))

    return jsonify({
        "settings": s,
        "latest": serialize_reading(latest, s) if latest else None,
        "today": serialize_day(today, s) if today else None,
        "dapNow": dap_now,
        "phase": em.phase_of(dap_now),
        "cumulativeCo2eqG": db.cumulative_co2eq(),
        "pumpStatus": latest["pump_status"] if latest else "OFF",
        "batteryPercent": (serialize_reading(latest, s)["battPct"] if latest else None),
        "deltaEF": em.delta_ef(s),
        "ch4FullDay": em.ch4_full_day(s),
        "unreadCount": db.unread_alert_count(),
    })


# ── GET /api/readings?days=N | ?from=&to= (deret waktu grafik) ────────
@app.get("/api/readings")
def get_readings():
    s = db.get_settings()
    days = request.args.get("days", type=int)
    date_from = request.args.get("from")
    date_to = request.args.get("to")
    rows = db.get_readings(date_from=date_from, date_to=date_to, days=days)
    return jsonify({"readings": [serialize_reading(r, s) for r in rows],
                    "count": len(rows)})


# ── GET /api/emissions/daily (mirror AWD.days) ───────────────────────
@app.get("/api/emissions/daily")
def get_emissions_daily():
    s = db.get_settings()
    days = db.get_emission_daily()
    return jsonify({"days": [serialize_day(d, s) for d in days]})


# ── GET /api/alerts (mirror AWD.alerts + unreadCount) ────────────────
@app.get("/api/alerts")
def get_alerts():
    alerts = db.get_alerts()
    return jsonify({
        "alerts": [serialize_alert(a) for a in alerts],
        "unreadCount": db.unread_alert_count(),
    })


@app.post("/api/alerts/read")
def mark_read():
    db.mark_alerts_read()
    return jsonify(ok=True, unreadCount=0)


# ── GET / PUT /api/settings ──────────────────────────────────────────
@app.get("/api/settings")
def get_settings():
    return jsonify(db.get_settings())


@app.put("/api/settings")
def put_settings():
    patch = request.get_json(silent=True)
    if not isinstance(patch, dict):
        return jsonify(error="payload JSON tidak valid"), 400
    if "telegram_enabled" in patch:
        patch["telegram_enabled"] = 1 if patch["telegram_enabled"] else 0
    updated = db.update_settings(patch)   # nilai turunan menyesuaikan (recompute)
    return jsonify(updated)


# ── GET /api/verify (Tabel Verifikasi §4.5) ──────────────────────────
@app.get("/api/verify")
def get_verify():
    return jsonify({"table": em.verify_table(db.get_settings())})


# ── GET /api/report.pdf?from=&to= ────────────────────────────────────
@app.get("/api/report.pdf")
def get_report():
    s = db.get_settings()
    date_from = request.args.get("from")
    date_to = request.args.get("to")
    readings = db.get_readings(date_from=date_from, date_to=date_to)
    days = db.get_emission_daily()
    if date_from:
        days = [d for d in days if d["emission_date"] >= date_from]
    if date_to:
        days = [d for d in days if d["emission_date"] <= date_to]

    period_start = date_from or (days[0]["emission_date"] if days else
                                 s["planting_date"])
    period_end = date_to or (days[-1]["emission_date"] if days else
                             datetime.now().date().isoformat())

    pdf = report_mod.build_report(readings, days, s, period_start, period_end)
    db.insert_report(period_start, period_end, "(in-memory)")
    fname = f"laporan-awd-{period_start}-{period_end}.pdf"
    return Response(pdf, mimetype="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


# ── File statis frontend (PRD §8.5 — self-hosted satu origin) ─────────
@app.get("/")
def index():
    return send_from_directory(WEBSITE_DIR, INDEX_HTML)


@app.get("/assets/<path:filename>")
def assets(filename):
    return send_from_directory(ASSETS_DIR, filename)


@app.get("/health")
def health():
    return jsonify(status="ok", telegram=tg.is_configured())


if __name__ == "__main__":
    ensure_ready()
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    print(f" * AWD backend -> http://localhost:{port}  (DB: {db.get_db_path()})")
    app.run(host=host, port=port, debug=debug)
