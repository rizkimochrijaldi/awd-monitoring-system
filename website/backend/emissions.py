"""
emissions.py — Engine perhitungan AWD (PRD §4).

Port langsung dari `website/assets/data.js` agar bentuk & nilai konsisten:
  - deltaEF / ch4FullDay         -> PRD §4.3
  - ch4_reduced_g / co2eq        -> PRD §4.4
  - akumulasi presisi penuh      -> PRD §4.6
  - phase_of (Fase I/II/III)     -> phaseOf() di data.js
  - water_level (recompute)      -> PRD §4.1

Seluruh konstanta MASUK lewat argumen `settings` (dict) — TIDAK di-hardcode.
Pembulatan hanya untuk tampilan; akumulasi selalu memakai float presisi penuh.
"""

from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP

CORRECTION_FACTOR = 1.028  # SmartWT (PRD §4.1), juga konstan di firmware


# ── Pembulatan tampilan (round half up, bukan banker's rounding) ──────
def round_half_up(value, ndigits=2):
    """Bulatkan ke `ndigits` desimal dengan ROUND_HALF_UP agar cocok dengan
    Tabel Verifikasi §4.5 (mis. 2.925 -> 2.93, yang gagal di round() bawaan)."""
    if value is None:
        return None
    q = Decimal(1).scaleb(-ndigits)  # 10^-ndigits
    return float(Decimal(str(value)).quantize(q, rounding=ROUND_HALF_UP))


# ── Konversi tinggi muka air (PRD §4.1) ───────────────────────────────
def h_corrected(distance_raw_cm):
    return CORRECTION_FACTOR * distance_raw_cm


def water_level(distance_raw_cm, pipe_height_above_ground_cm):
    """water_level = pipe_height_above_ground - H_corrected (PRD §4.1)."""
    return pipe_height_above_ground_cm - h_corrected(distance_raw_cm)


# ── Konstanta emisi turunan (PRD §4.3) ────────────────────────────────
def delta_ef(s):
    """delta_EF = ef_baseline * (sfw_cf - sfw_awd)  -> 0.585 default."""
    return s["ef_baseline"] * (s["sfw_cf"] - s["sfw_awd"])


def ch4_full_day(s):
    """ch4_full_day = delta_EF * (plot_area_m2 / 10000) * 1000  -> 5.85 g/hari @100m².

    plot_area_m2/10000: m² -> ha ; *1000: kg -> g. Urutan & faktor TETAP (PRD §4.3).
    """
    return delta_ef(s) * (s["plot_area_m2"] / 10000.0) * 1000.0


# ── Pengurangan emisi harian proporsional (PRD §4.4) ──────────────────
def ch4_reduced_g(n_aerobic, s):
    """(n_aerobic / readings_per_day) * ch4_full_day — presisi penuh."""
    return (n_aerobic / s["readings_per_day"]) * ch4_full_day(s)


def co2eq_g(ch4g, s):
    """co2eq = ch4_reduced_g * gwp_ch4."""
    return ch4g * s["gwp_ch4"]


def aerobic_fraction(n_aerobic, s):
    return n_aerobic / s["readings_per_day"]


# ── Fase AWD dinamis dari planting_date (phaseOf di data.js) ──────────
def days_after_planting(planting_date, when=None):
    """DAP = selisih hari antara planting_date dan `when` (default: hari ini)."""
    if isinstance(planting_date, str):
        planting_date = datetime.strptime(planting_date[:10], "%Y-%m-%d").date()
    if when is None:
        when = date.today()
    elif isinstance(when, datetime):
        when = when.date()
    elif isinstance(when, str):
        when = datetime.strptime(when[:10], "%Y-%m-%d").date()
    return (when - planting_date).days


def phase_of(dap):
    """Fase I: DAP <= 18 ; Fase II: 19–60 ; Fase III: > 60 (data.js phaseOf)."""
    if dap <= 18:
        return {"n": 1, "key": "p1", "label": "Fase I — Penggenangan Awal"}
    if dap <= 60:
        return {"n": 2, "key": "p2", "label": "Fase II — AWD Aktif"}
    return {"n": 3, "key": "p3", "label": "Fase III — Pematangan"}


# ── Status pompa dengan histeresis (PRD §4.8) ─────────────────────────
def pump_status(level, prev_status, s):
    """Dua ambang TERPISAH (PRD §4.7): -15 cm pompa ON, +5 cm pompa OFF,
    di antaranya pertahankan status sebelumnya (histeresis)."""
    if level <= s["threshold_irrigation_cm"]:
        return "ON"
    if level >= s["threshold_flooding_cm"]:
        return "OFF"
    return prev_status or "OFF"


# ── Tabel Verifikasi §4.5 (dihitung, bukan hardcode) ──────────────────
def verify_table(s):
    rows = []
    for n in (0, 1, 3, 6, 9, 12):
        ch4 = ch4_reduced_g(n, s)
        co2 = co2eq_g(ch4, s)
        rows.append({
            "n_aerobic": n,
            "hours": n * 2,
            "aerobic_fraction": round_half_up(aerobic_fraction(n, s), 3),
            "ch4_reduced_g": round_half_up(ch4, 2),
            "co2eq_reduced_g": round_half_up(co2, 2),
        })
    return rows
