"""
test_emissions.py — Verifikasi logika perhitungan PRD §4.

Test utama (WAJIB lulus): Tabel Verifikasi §4.5 untuk petak 100 m².
Jalankan dari folder backend:

    python -m pytest tests/ -v
    # atau tanpa pytest:
    python tests/test_emissions.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import emissions as em

# Settings default (PRD §4.2) untuk petak 100 m²
S = {
    "plot_area_m2": 100,
    "pipe_height_above_ground_cm": 20,
    "threshold_irrigation_cm": -15,
    "threshold_flooding_cm": 5,
    "ef_baseline": 1.30,
    "sfw_cf": 1.00,
    "sfw_awd": 0.55,
    "gwp_ch4": 28,
    "readings_per_day": 12,
}

# PRD §4.5 — (n_aerobic, ch4_reduced_g, co2eq_reduced_g)
VERIFY_TABLE = [
    (0, 0.00, 0.00),
    (1, 0.49, 13.65),
    (3, 1.46, 40.95),
    (6, 2.93, 81.90),
    (9, 4.39, 122.85),
    (12, 5.85, 163.80),
]


def test_delta_ef():
    assert em.round_half_up(em.delta_ef(S), 3) == 0.585


def test_ch4_full_day():
    assert em.round_half_up(em.ch4_full_day(S), 2) == 5.85


def test_verification_table():
    """Setiap baris §4.5 harus cocok persis setelah pembulatan tampilan."""
    for n, exp_ch4, exp_co2 in VERIFY_TABLE:
        ch4 = em.ch4_reduced_g(n, S)
        co2 = em.co2eq_g(ch4, S)
        assert em.round_half_up(ch4, 2) == exp_ch4, \
            f"n={n}: ch4 {em.round_half_up(ch4, 2)} != {exp_ch4}"
        assert em.round_half_up(co2, 2) == exp_co2, \
            f"n={n}: co2 {em.round_half_up(co2, 2)} != {exp_co2}"


def test_verify_table_helper_matches():
    """verify_table() (dipakai /api/verify) konsisten dengan §4.5."""
    rows = em.verify_table(S)
    for row, (n, exp_ch4, exp_co2) in zip(rows, VERIFY_TABLE):
        assert row["n_aerobic"] == n
        assert row["ch4_reduced_g"] == exp_ch4
        assert row["co2eq_reduced_g"] == exp_co2


def test_full_precision_accumulation():
    """Akumulasi harus pakai presisi penuh, bukan menjumlah nilai bulat (§4.6)."""
    ns = [1, 3, 6, 9]
    full = sum(em.co2eq_g(em.ch4_reduced_g(n, S), S) for n in ns)
    rounded = sum(em.round_half_up(em.co2eq_g(em.ch4_reduced_g(n, S), S), 2) for n in ns)
    # 13.65 + 40.95 + 81.90 + 122.85 = 259.35 (kebetulan sama di sini),
    # tapi nilai presisi penuh tidak boleh kehilangan digit di balik layar.
    assert abs(full - 259.35) < 1e-9
    assert abs(full - rounded) < 1e-9


def test_water_level_conversion():
    """PRD §4.1: H_corrected = 1.028 * distance_raw; level = pipe_h - H_corrected."""
    # distance_raw 32.5, pipe_h 20 -> H = 33.41 ; level = -13.41
    assert em.round_half_up(em.h_corrected(32.5), 2) == 33.41
    assert em.round_half_up(em.water_level(32.5, 20), 2) == -13.41


def test_phase_boundaries():
    assert em.phase_of(0)["n"] == 1
    assert em.phase_of(18)["n"] == 1
    assert em.phase_of(19)["n"] == 2
    assert em.phase_of(60)["n"] == 2
    assert em.phase_of(61)["n"] == 3


def test_pump_hysteresis():
    """Dua ambang terpisah + histeresis (PRD §4.7/§4.8)."""
    assert em.pump_status(-16, "OFF", S) == "ON"     # <= -15 -> ON
    assert em.pump_status(6, "ON", S) == "OFF"       # >= +5 -> OFF
    assert em.pump_status(-5, "ON", S) == "ON"       # di antara -> tahan ON
    assert em.pump_status(-5, "OFF", S) == "OFF"     # di antara -> tahan OFF


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS  {name}")
            except AssertionError as e:
                failures += 1
                print(f"FAIL  {name}: {e}")
    print(f"\n{'ALL PASS' if failures == 0 else str(failures) + ' FAILED'}")
    sys.exit(1 if failures else 0)
