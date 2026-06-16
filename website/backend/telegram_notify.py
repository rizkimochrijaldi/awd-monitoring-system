"""
telegram_notify.py — Notifikasi Telegram (PRD §3.6, §6).

Pemicu:
  - water_level <= threshold_irrigation_cm (-15 cm)  -> "saatnya irigasi"
  - battery_voltage <= low_battery_v                 -> "baterai lemah"

Dedup/histeresis (pola buildAlerts di data.js) ditangani di app.py:
  - Irigasi: kirim hanya pada transisi pompa OFF -> ON.
  - Baterai: kirim sekali; reset hanya setelah tegangan pulih +0.18 V.

Token & chat id berasal dari .env. Bila kosong / TELEGRAM_ENABLED=false,
fungsi tetap aman dipanggil (no-op) sehingga sistem berjalan tanpa Telegram.
"""

import os

import requests

_TIMEOUT = 8


def _config():
    return {
        "token": os.environ.get("TELEGRAM_BOT_TOKEN", "").strip(),
        "chat_id": os.environ.get("TELEGRAM_CHAT_ID", "").strip(),
        "enabled": os.environ.get("TELEGRAM_ENABLED", "false").lower() == "true",
    }


def is_configured():
    c = _config()
    return c["enabled"] and bool(c["token"]) and bool(c["chat_id"])


def send_message(text):
    """Kirim pesan ke Telegram. Return True jika terkirim, False bila
    nonaktif/gagal (tidak melempar exception agar ingestion tidak gagal)."""
    c = _config()
    if not (c["enabled"] and c["token"] and c["chat_id"]):
        return False
    url = f"https://api.telegram.org/bot{c['token']}/sendMessage"
    try:
        resp = requests.post(
            url,
            json={"chat_id": c["chat_id"], "text": text, "parse_mode": "HTML"},
            timeout=_TIMEOUT,
        )
        return resp.status_code == 200
    except requests.RequestException:
        return False


def irrigation_message(level, threshold, device_name):
    return (
        "🚱 <b>Saatnya irigasi</b>\n"
        f"Tinggi muka air turun ke <b>{level:.1f} cm</b> — mencapai ambang "
        f"irigasi {threshold:.0f} cm.\n"
        f"Petak <i>{device_name}</i> perlu segera dialiri air."
    )


def battery_message(voltage, low_v, device_name):
    return (
        "🔋 <b>Baterai node lemah</b>\n"
        f"Tegangan baterai <b>{voltage:.2f} V</b> di bawah ambang aman "
        f"{low_v:.2f} V.\n"
        f"Periksa pengisian panel surya pada node <i>{device_name}</i>."
    )
