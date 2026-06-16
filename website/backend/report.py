"""
report.py — Laporan PDF (PRD §3.5) memakai ReportLab.

Isi laporan:
  - Grafik tinggi muka air (dengan garis acuan +5 cm & -15 cm).
  - Tabel statistik harian (level rata-rata/min/maks, n_aerobik, emisi).
  - Total CH4 & CO2-eq tersisihkan.
  - Narasi ringkasan kinerja AWD dalam Bahasa Indonesia gaya formal.

Tidak bergantung matplotlib — grafik digambar dengan reportlab.graphics.
"""

from datetime import datetime
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.graphics.shapes import Drawing, Line, String, PolyLine
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether,
)

import emissions as em

_BULAN = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli",
          "Agustus", "September", "Oktober", "November", "Desember"]


def _fmt_date(iso):
    try:
        d = datetime.strptime(iso[:10], "%Y-%m-%d")
        return f"{d.day} {_BULAN[d.month]} {d.year}"
    except (ValueError, TypeError):
        return iso or "-"


def _water_level_chart(readings, settings, width=460, height=200):
    """Grafik garis tinggi muka air + dua garis acuan ambang."""
    d = Drawing(width, height)
    pad_l, pad_b, pad_t, pad_r = 38, 26, 14, 12
    plot_w = width - pad_l - pad_r
    plot_h = height - pad_b - pad_t

    levels = [r["water_level_cm"] for r in readings] or [0]
    lo = min(min(levels), settings["threshold_irrigation_cm"]) - 2
    hi = max(max(levels), settings["threshold_flooding_cm"]) + 2
    span = (hi - lo) or 1
    n = max(len(readings) - 1, 1)

    def x(i):
        return pad_l + plot_w * (i / n)

    def y(v):
        return pad_b + plot_h * ((v - lo) / span)

    # Sumbu
    d.add(Line(pad_l, pad_b, pad_l, pad_b + plot_h, strokeColor=colors.grey))
    d.add(Line(pad_l, pad_b, pad_l + plot_w, pad_b, strokeColor=colors.grey))

    # Garis acuan: 0 cm, ambang irigasi, ambang genangan
    for val, col, lbl in (
        (0, colors.HexColor("#94a3b8"), "0"),
        (settings["threshold_flooding_cm"], colors.HexColor("#2563eb"), "+5"),
        (settings["threshold_irrigation_cm"], colors.HexColor("#dc2626"), "-15"),
    ):
        if lo <= val <= hi:
            yy = y(val)
            d.add(Line(pad_l, yy, pad_l + plot_w, yy,
                       strokeColor=col, strokeDashArray=[3, 3]))
            d.add(String(2, yy - 3, lbl, fontSize=7, fillColor=col))

    # Garis data
    if len(readings) >= 2:
        pts = []
        for i, r in enumerate(readings):
            pts += [x(i), y(r["water_level_cm"])]
        d.add(PolyLine(pts, strokeColor=colors.HexColor("#0f766e"), strokeWidth=1.2))

    d.add(String(pad_l, height - 10, "Tinggi Muka Air (cm)", fontSize=8,
                 fillColor=colors.HexColor("#334155")))
    return d


def build_report(readings, days, settings, period_start, period_end):
    """Render PDF -> bytes. `days` = list dict emission_daily; `readings` = list dict."""
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=2 * cm, rightMargin=2 * cm,
        topMargin=1.8 * cm, bottomMargin=1.8 * cm,
        title="Laporan Pemantauan AWD",
    )
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=styles["Title"], fontSize=16, spaceAfter=4)
    sub = ParagraphStyle("sub", parent=styles["Normal"], fontSize=9,
                         textColor=colors.HexColor("#64748b"), spaceAfter=12)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontSize=12, spaceBefore=14)
    body = ParagraphStyle("body", parent=styles["Normal"], fontSize=10, leading=15,
                          alignment=4)

    elems = []
    elems.append(Paragraph("Laporan Pemantauan Sistem AWD", h1))
    elems.append(Paragraph(
        f"Sistem Pemantauan Tinggi Muka Air Berbasis IoT &mdash; "
        f"{settings.get('device_name') or settings.get('device_id') or 'Node'}<br/>"
        f"Periode: {_fmt_date(period_start)} s.d. {_fmt_date(period_end)}<br/>"
        f"Dihasilkan: {_fmt_date(datetime.now().isoformat())}", sub))

    # ── Ringkasan emisi ──
    total_ch4 = sum(d["ch4_reduced_g"] for d in days)
    total_co2 = sum(d["co2eq_reduced_g"] for d in days)
    total_aer = sum(d["n_aerobic_readings"] for d in days)
    total_read = sum(d["n_total_readings"] for d in days)

    elems.append(Paragraph("Ringkasan Kinerja", h2))
    summary = [
        ["Total hari termonitor", f"{len(days)} hari"],
        ["Total pembacaan", f"{total_read} pembacaan"],
        ["Total pembacaan aerobik", f"{total_aer} pembacaan"],
        ["CH4 tersisihkan (total)", f"{em.round_half_up(total_ch4, 2):.2f} g"],
        ["CO2-eq tersisihkan (total)", f"{em.round_half_up(total_co2, 2):.2f} g"],
        ["Luas petak", f"{settings['plot_area_m2']:.0f} m²"],
    ]
    t = Table(summary, colWidths=[7 * cm, 7 * cm])
    t.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#475569")),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica-Bold"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor("#e2e8f0")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    elems.append(t)

    # ── Grafik ──
    elems.append(Paragraph("Dinamika Tinggi Muka Air", h2))
    elems.append(_water_level_chart(readings, settings))

    # ── Tabel statistik harian ──
    elems.append(Paragraph("Statistik Harian", h2))
    header = ["Tanggal", "Level rata‑rata (cm)", "Min", "Maks",
              "n aerobik", "CH4 (g)", "CO2-eq (g)"]
    table_data = [header]
    # mean/min/max level per hari dari readings
    by_day = {}
    for r in readings:
        d = r["recorded_at"][:10]
        by_day.setdefault(d, []).append(r["water_level_cm"])
    for day in days:
        d = day["emission_date"]
        lv = by_day.get(d, [])
        mean = sum(lv) / len(lv) if lv else 0
        table_data.append([
            _fmt_date(d),
            f"{mean:.1f}",
            f"{min(lv):.1f}" if lv else "-",
            f"{max(lv):.1f}" if lv else "-",
            f"{day['n_aerobic_readings']}/{day['n_total_readings']}",
            f"{em.round_half_up(day['ch4_reduced_g'], 2):.2f}",
            f"{em.round_half_up(day['co2eq_reduced_g'], 2):.2f}",
        ])
    st = Table(table_data, repeatRows=1)
    st.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f766e")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 7.5),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ALIGN", (1, 0), (-1, -1), "CENTER"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1),
         [colors.white, colors.HexColor("#f1f5f9")]),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#cbd5e1")),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    elems.append(st)

    # ── Narasi ──
    dap_end = em.days_after_planting(settings["planting_date"], period_end)
    phase = em.phase_of(dap_end)
    aerobic_pct = (total_aer / total_read * 100) if total_read else 0
    narasi = (
        f"Selama periode pemantauan, sistem mencatat {total_read} pembacaan tinggi "
        f"muka air dengan {total_aer} di antaranya ({aerobic_pct:.0f}%) berada pada "
        f"kondisi aerobik (di bawah permukaan tanah). Penerapan teknik "
        f"<i>Alternate Wetting and Drying</i> pada petak seluas "
        f"{settings['plot_area_m2']:.0f} m² diestimasikan menyisihkan "
        f"{em.round_half_up(total_ch4, 2):.2f} gram CH4, setara "
        f"{em.round_half_up(total_co2, 2):.2f} gram CO2-ekuivalen "
        f"(GWP CH4 = {settings['gwp_ch4']:.0f}), dihitung secara proporsional "
        f"terhadap durasi kondisi aerobik aktual sesuai metode IPCC (2019). "
        f"Pada akhir periode, petak berada pada hari ke-{dap_end} setelah tanam "
        f"({phase['label']}). Estimasi ini menunjukkan kontribusi nyata praktik AWD "
        f"dalam mengurangi emisi gas rumah kaca tanpa mengorbankan kebutuhan air "
        f"tanaman padi."
    )
    elems.append(Paragraph("Narasi Ringkasan", h2))
    elems.append(Paragraph(narasi, body))

    doc.build(elems)
    return buf.getvalue()
