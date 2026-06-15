/* ============================================================
   Charts — Chart.js v4 builders + custom AWD zone plugin
   ============================================================ */
window.Charts = (function () {
  const C = {
    ink: '#15212E', muted: '#5E6B7E', grid: '#E6ECF4',
    green: '#1A6BC4', greenSoft: 'rgba(26,107,196,.10)',
    eco: '#1B9E77', ecoSoft: 'rgba(27,158,119,.10)',
    water: '#2E7CD6', waterFill: 'rgba(46,124,214,.085)',
    dry: '#C77D2E', dryFill: 'rgba(199,125,46,.085)',
    danger: '#C0392B', clay: '#C77D2E',
    paper: '#FFFFFF',
  };

  if (window.Chart) {
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = C.muted;
  }

  // Plugin: shade y>0 (flooded/anaerobic) & y<0 (dry/aerobic) + threshold lines
  const zonePlugin = {
    id: 'awdZones',
    beforeDatasetsDraw(chart, args, opts) {
      if (!opts || !opts.enabled) return;
      const { ctx, chartArea: a, scales } = chart;
      const y = scales.y; if (!y) return;
      const yZero = y.getPixelForValue(0);
      const yFlood = y.getPixelForValue(opts.flood);
      const yIrr = y.getPixelForValue(opts.irrigation);
      ctx.save();
      // flooded band (above 0)
      ctx.fillStyle = C.waterFill;
      ctx.fillRect(a.left, a.top, a.width, Math.min(yZero, a.bottom) - a.top);
      // dry band (below 0)
      ctx.fillStyle = C.dryFill;
      ctx.fillRect(a.left, Math.max(yZero, a.top), a.width, a.bottom - Math.max(yZero, a.top));
      // threshold lines
      const line = (yp, color, dash, label) => {
        if (yp < a.top || yp > a.bottom) return;
        ctx.beginPath(); ctx.setLineDash(dash); ctx.lineWidth = 1.5;
        ctx.strokeStyle = color; ctx.moveTo(a.left, yp); ctx.lineTo(a.right, yp); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = "600 10.5px 'JetBrains Mono', monospace";
        ctx.fillStyle = color; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
        ctx.fillText(label, a.right - 6, yp - 3);
      };
      line(yFlood, C.water, [5, 4], `+${opts.flood} cm · genangan`);
      line(yZero, '#9A9C8B', [2, 3], '0 cm · permukaan tanah');
      line(yIrr, C.danger, [5, 4], `${opts.irrigation} cm · irigasi`);
      ctx.restore();
    },
  };
  if (window.Chart) Chart.register(zonePlugin);

  const baseScales = (xTicks) => ({
    x: {
      grid: { display: false }, border: { color: C.grid },
      ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: xTicks || 8, color: C.muted, font: { size: 11 } },
    },
    y: {
      grid: { color: C.grid, drawTicks: false },
      border: { display: false },
      ticks: { color: C.muted, font: { family: "'JetBrains Mono', monospace", size: 11 }, padding: 8 },
    },
  });

  const tooltipCfg = (titleFn, labelFn) => ({
    enabled: true, backgroundColor: '#1F261B', titleColor: '#fff', bodyColor: '#D5E5CE',
    padding: 11, cornerRadius: 9, boxPadding: 5, titleFont: { size: 12, weight: '600' },
    bodyFont: { family: "'JetBrains Mono', monospace", size: 12 }, displayColors: true, usePointStyle: true,
    callbacks: { title: titleFn, label: labelFn },
  });

  const A = window.AWD;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Water level (reading-resolution, dashboard) ──
  function waterLevel(canvas, readings) {
    const labels = readings.map(r => `${r.ts.getDate()} ${A.BULAN[r.ts.getMonth()]} ${A.fmtTime(r.ts)}`);
    const data = readings.map(r => r.level);
    return new Chart(canvas, {
      type: 'line',
      data: { labels, datasets: [{
        data, borderColor: C.green, borderWidth: 2, tension: 0.32,
        pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: C.green,
        pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2,
        fill: false,
        segment: { borderColor: ctx => ctx.p1.parsed.y < 0 ? C.clay : C.green },
      }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: reduceMotion ? false : { duration: 700 },
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 6, right: 4 } },
        scales: { ...baseScales(7), y: { ...baseScales().y, suggestedMin: -20, suggestedMax: 8,
          ticks: { ...baseScales().y.ticks, callback: v => (v > 0 ? '+' : '') + v } } },
        plugins: {
          legend: { display: false },
          awdZones: { enabled: true, flood: A.SETTINGS.threshold_flooding_cm, irrigation: A.SETTINGS.threshold_irrigation_cm },
          tooltip: tooltipCfg(
            items => items[0].label,
            ctx => `  Tinggi muka air: ${ctx.parsed.y > 0 ? '+' : ''}${ctx.parsed.y.toFixed(1)} cm  ·  ${ctx.parsed.y < 0 ? 'AEROBIK' : 'tergenang'}`
          ),
        },
      },
    });
  }

  // ── Cumulative CO2-eq avoided (dashboard) ──
  function cumulative(canvas, days) {
    const labels = days.map(d => A.fmtDateShort(d.date));
    const data = days.map(d => +(d.cumulativeCo2eqG / 1000).toFixed(3)); // kg
    return new Chart(canvas, {
      type: 'line',
      data: { labels, datasets: [{
        data, borderColor: C.eco, borderWidth: 2.5, tension: 0.25,
        pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: C.eco, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2,
        fill: true,
        backgroundColor: (ctx) => {
          const { chartArea, ctx: c } = ctx.chart; if (!chartArea) return C.ecoSoft;
          const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          g.addColorStop(0, 'rgba(27,158,119,.22)'); g.addColorStop(1, 'rgba(27,158,119,0)'); return g;
        },
      }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: reduceMotion ? false : { duration: 800 },
        interaction: { mode: 'index', intersect: false },
        scales: { ...baseScales(8), y: { ...baseScales().y, beginAtZero: true,
          ticks: { ...baseScales().y.ticks, callback: v => v.toLocaleString('id-ID') } } },
        plugins: {
          legend: { display: false }, awdZones: { enabled: false },
          tooltip: tooltipCfg(
            items => 'Hari ' + items[0].label,
            ctx => `  Kumulatif CO₂-eq: ${ctx.parsed.y.toLocaleString('id-ID', {minimumFractionDigits:2, maximumFractionDigits:2})} kg`
          ),
        },
      },
    });
  }

  // ── Season water level (daily mean, history) ──
  function seasonLevel(canvas, days) {
    const labels = days.map(d => A.fmtDateShort(d.date));
    return new Chart(canvas, {
      type: 'line',
      data: { labels, datasets: [
        { label: 'Rata-rata harian', data: days.map(d => +d.meanLevel.toFixed(2)),
          borderColor: C.green, borderWidth: 2, tension: 0.3, pointRadius: 0, pointHoverRadius: 5,
          pointHoverBackgroundColor: C.green, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2,
          segment: { borderColor: ctx => ctx.p1.parsed.y < 0 ? C.clay : C.green } },
      ] },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: reduceMotion ? false : { duration: 700 },
        interaction: { mode: 'index', intersect: false },
        scales: { ...baseScales(10), y: { ...baseScales().y, suggestedMin: -20, suggestedMax: 8,
          ticks: { ...baseScales().y.ticks, callback: v => (v > 0 ? '+' : '') + v } } },
        plugins: {
          legend: { display: false },
          awdZones: { enabled: true, flood: A.SETTINGS.threshold_flooding_cm, irrigation: A.SETTINGS.threshold_irrigation_cm },
          tooltip: tooltipCfg(
            items => A.fmtDate(days[items[0].dataIndex].date),
            ctx => `  Rata-rata: ${ctx.parsed.y > 0 ? '+' : ''}${ctx.parsed.y.toFixed(1)} cm`
          ),
        },
      },
    });
  }

  // ── Daily CO2-eq bars (history) ──
  function dailyEmission(canvas, days) {
    const labels = days.map(d => A.fmtDateShort(d.date));
    return new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets: [{
        data: days.map(d => +d.co2eqReducedG.toFixed(2)),
        backgroundColor: days.map(d => d.aerobicFraction >= 0.5 ? 'rgba(27,158,119,.85)' : 'rgba(199,125,46,.7)'),
        borderRadius: 3, maxBarThickness: 14,
      }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: reduceMotion ? false : { duration: 600 },
        scales: { ...baseScales(10), y: { ...baseScales().y, beginAtZero: true,
          ticks: { ...baseScales().y.ticks } } },
        plugins: {
          legend: { display: false }, awdZones: { enabled: false },
          tooltip: tooltipCfg(
            items => A.fmtDate(days[items[0].dataIndex].date),
            ctx => {
              const d = days[ctx.dataIndex];
              return [`  CO₂-eq: ${d.co2eqReducedG.toFixed(2)} g`, `  CH₄: ${d.ch4ReducedG.toFixed(2)} g`, `  Aerobik: ${d.nAerobic}/${d.nTotal} baca`];
            }
          ),
        },
      },
    });
  }

  return { waterLevel, cumulative, seasonLevel, dailyEmission, COLORS: C };
})();
