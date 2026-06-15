/* ============================================================
   AWD Monitoring — Computation Engine + Mock Data
   All emission constants live in SETTINGS (never hard-coded in views),
   per PRD §4.2 / §8.2. Formulas follow PRD §4 exactly.
   ============================================================ */
window.AWD = (function () {
  'use strict';

  // — System settings (calibratable; mirror of DB `settings` table) —
  const SETTINGS = {
    device_id: 'AWD-NODE-01',
    device_name: 'Petak Uji A — Sawah Cikabayan',
    planting_date: '2026-04-29',          // hari tanam
    plot_area_m2: 100,                    // luas petak
    pipe_height_above_ground_cm: 20,      // tinggi pipa di atas tanah
    threshold_irrigation_cm: -15,         // ambang irigasi (pompa ON)
    threshold_flooding_cm: 5,             // ambang genangan (pompa OFF)
    ef_baseline: 1.30,                    // EFc — kg CH4 / ha / hari
    sfw_cf: 1.00,                         // faktor skala air, flooding
    sfw_awd: 0.55,                        // faktor skala air, AWD
    gwp_ch4: 28,                          // GWP CH4
    readings_per_day: 12,                 // pembacaan / hari (tiap 2 jam)
    telegram_enabled: true,
    low_battery_v: 3.40,
  };

  const NOW = new Date('2026-06-13T08:12:00');

  // — Derived emission constants (PRD §4.3) —
  function deltaEF(s)     { return s.ef_baseline * (s.sfw_cf - s.sfw_awd); }      // 0.585
  function ch4FullDay(s)  { return deltaEF(s) * (s.plot_area_m2 / 10000) * 1000; } // 5.85 g/day @100m²

  // per-day reduction from aerobic readings (PRD §4.4)
  function ch4ReducedG(nAerobic, s) {
    return (nAerobic / s.readings_per_day) * ch4FullDay(s);
  }
  function co2eqG(ch4g, s) { return ch4g * s.gwp_ch4; }

  // — Seeded RNG (deterministic mock) —
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function daysBetween(aISO, b) {
    const a = new Date(aISO + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  }
  function phaseOf(dap) {
    if (dap <= 18) return { n: 1, key: 'p1', label: 'Fase I — Penggenangan Awal' };
    if (dap <= 60) return { n: 2, key: 'p2', label: 'Fase II — AWD Aktif' };
    return { n: 3, key: 'p3', label: 'Fase III — Pematangan' };
  }

  // ── Simulate the whole season at reading resolution ──────────
  function simulate(s) {
    const DAP_NOW = daysBetween(s.planting_date, NOW);
    const rpd = s.readings_per_day;
    const rnd = mulberry32(20260429);
    const plant = new Date(s.planting_date + 'T00:00:00');

    let level = 4.2;                 // start: flooded
    let pump = 'OFF';
    const readings = [];            // every reading across season
    let batt = 4.12;

    for (let dap = 0; dap <= DAP_NOW; dap++) {
      const ph = phaseOf(dap);
      for (let k = 0; k < rpd; k++) {
        // stop at "now" for the final partial day
        if (dap === DAP_NOW && k > 4) break;

        // diurnal evapotranspiration: stronger midday (k≈5-7)
        const hour = k * 2;
        const diurnal = 0.10 + 0.16 * Math.max(0, Math.sin((hour - 6) / 24 * Math.PI * 2));
        const noise = (rnd() - 0.5) * 0.34;

        if (ph.n === 1) {
          // Continuous flooding: top up whenever it drains near soil line
          if (level <= 1.2) level += 1.4 + rnd() * 0.8;       // manual re-flood
          else level -= diurnal * 0.7 + noise * 0.5;
          pump = 'OFF';
        } else {
          // AWD controller with hysteresis (PRD §4.8)
          if (pump === 'ON') {
            level += 2.4 + rnd() * 0.7;                       // irrigating
            if (level >= s.threshold_flooding_cm) pump = 'OFF';
          } else {
            level -= (0.34 + diurnal * 0.55) + noise;          // drain / ET
          }
          if (level <= s.threshold_irrigation_cm) pump = 'ON'; // trigger irrigation
        }
        level = Math.max(-22, Math.min(7.5, level));

        // battery: solar-charged, balanced; a multi-day rainy spell drains it
        const sun = Math.max(0, Math.sin((hour - 6) / 24 * Math.PI * 2));
        const cloud = (dap >= 31 && dap <= 37) ? 0.18 : 1;   // rainy spell mid-season
        batt += sun * 0.075 * cloud - 0.014 + (rnd() - 0.5) * 0.004;
        batt = Math.max(3.30, Math.min(4.15, batt));

        const ts = new Date(plant.getTime() + dap * 86400000 + hour * 3600000);
        const distRaw = (s.pipe_height_above_ground_cm - level) / 1.028; // inverse of §4.1
        readings.push({
          dap, k, ts,
          level: +level.toFixed(2),
          distRaw: +distRaw.toFixed(1),
          hCorr: +(1.028 * distRaw).toFixed(2),
          aerobic: level < 0,                                 // ambang 0 cm (emisi)
          pump,
          batt: +batt.toFixed(3),
        });
      }
    }
    return { readings, DAP_NOW };
  }

  // ── Aggregate to daily emission records (PRD §4.4–4.6) ───────
  function aggregate(readings, s) {
    const byDay = new Map();
    for (const r of readings) {
      if (!byDay.has(r.dap)) byDay.set(r.dap, []);
      byDay.get(r.dap).push(r);
    }
    const days = [];
    let cumCo2 = 0;
    const plant = new Date(s.planting_date + 'T00:00:00');
    for (const [dap, list] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
      const nAer = list.filter(r => r.aerobic).length;
      const nTot = list.length;
      const frac = nAer / s.readings_per_day;
      const ch4 = ch4ReducedG(nAer, s);          // full precision
      const co2 = co2eqG(ch4, s);
      cumCo2 += co2;                              // accumulate full precision
      const levels = list.map(r => r.level);
      days.push({
        dap,
        date: new Date(plant.getTime() + dap * 86400000),
        phase: phaseOf(dap),
        nAerobic: nAer,
        nTotal: nTot,
        aerobicFraction: frac,
        ch4ReducedG: ch4,
        co2eqReducedG: co2,
        cumulativeCo2eqG: cumCo2,
        meanLevel: levels.reduce((a, b) => a + b, 0) / levels.length,
        minLevel: Math.min(...levels),
        maxLevel: Math.max(...levels),
      });
    }
    return days;
  }

  // ── Verification table from PRD §4.5 (computed, not hard-coded) ──
  function verifyTable(s) {
    return [0, 1, 3, 6, 9, 12].map(n => {
      const ch4 = ch4ReducedG(n, s);
      return {
        n,
        hours: n * 2,
        fraction: n / s.readings_per_day,
        ch4: ch4,
        co2: co2eqG(ch4, s),
      };
    });
  }

  // ── Build the full dataset ───────────────────────────────────
  const { readings, DAP_NOW } = simulate(SETTINGS);
  const days = aggregate(readings, SETTINGS);
  const latest = readings[readings.length - 1];
  const today = days[days.length - 1];

  // battery % mapping (3.3V→0, 4.2V→100)
  function battPct(v) { return Math.round(Math.max(0, Math.min(100, (v - 3.3) / 0.9 * 100))); }

  // recent reading window (for dashboard live chart): last N days
  function recentReadings(nDays) {
    const cutoff = DAP_NOW - nDays + 1;
    return readings.filter(r => r.dap >= cutoff);
  }

  // count days needing irrigation, alerts
  const irrigationDays = days.filter(d => d.minLevel <= SETTINGS.threshold_irrigation_cm).length;

  // ── Build alert log (PRD §6 + ERD `alerts` table) ────────────
  function buildAlerts(readings, days, s) {
    const alerts = [];
    let prevPump = 'OFF', battLow = false, id = 1;
    for (const r of readings) {
      if (r.pump === 'ON' && prevPump === 'OFF') {
        alerts.push({
          id: id++, type: 'irrigation', severity: 'danger', title: 'Saatnya irigasi',
          msg: `Tinggi muka air turun ke ${r.level.toFixed(1)} cm — mencapai ambang irigasi ${s.threshold_irrigation_cm} cm. Petak perlu segera dialiri air.`,
          ts: new Date(r.ts), level: r.level, dap: r.dap,
        });
      }
      prevPump = r.pump;
      if (!battLow && r.batt <= s.low_battery_v) {
        battLow = true;
        alerts.push({
          id: id++, type: 'battery', severity: 'warn', title: 'Baterai node lemah',
          msg: `Tegangan baterai ${r.batt.toFixed(2)} V berada di bawah ambang aman ${s.low_battery_v.toFixed(2)} V. Cuaca mendung mengurangi pengisian panel surya.`,
          ts: new Date(r.ts), batt: r.batt, dap: r.dap,
        });
      }
      if (battLow && r.batt >= s.low_battery_v + 0.18) battLow = false; // hysteresis reset
    }
    // info — AWD active phase begins
    const p2 = days.find(d => d.phase.n === 2);
    if (p2) alerts.push({ id: id++, type: 'phase', severity: 'info', title: 'Fase II — AWD aktif dimulai',
      msg: `Petak memasuki fase AWD aktif (DAP ${p2.dap}). Siklus pembasahan–pengeringan mulai diterapkan dan emisi metana mulai disisihkan.`,
      ts: new Date(p2.date.getTime() + 7 * 3600000), dap: p2.dap });
    // info — node first came online
    alerts.push({ id: id++, type: 'system', severity: 'info', title: 'Node sensor daring',
      msg: `Perangkat ${s.device_id} mulai mengirim data tinggi muka air dari ${s.device_name}.`,
      ts: new Date(days[0].date.getTime() + 6 * 3600000), dap: 0 });
    alerts.sort((a, b) => b.ts - a.ts);
    return alerts;
  }
  const alerts = buildAlerts(readings, days, SETTINGS);
  // mark the two most recent alerts as unread (newest-first after sort)
  alerts.forEach((a, i) => { a.unread = i < 2; });
  const unreadCount = alerts.filter(a => a.unread).length;

  // ── Indonesian formatting helpers ────────────────────────────
  const BULAN = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  const BULAN_FULL = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  function fmtDate(d, full) { return `${d.getDate()} ${(full?BULAN_FULL:BULAN)[d.getMonth()]} ${d.getFullYear()}`; }
  function fmtDateShort(d) { return `${d.getDate()} ${BULAN[d.getMonth()]}`; }
  function fmtTime(d) { return `${String(d.getHours()).padStart(2,'0')}.${String(d.getMinutes()).padStart(2,'0')}`; }
  function fmtNum(n, dec = 0) {
    return Number(n).toLocaleString('id-ID', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  return {
    SETTINGS, NOW, DAP_NOW,
    readings, days, latest, today, alerts, unreadCount,
    recentReadings, verifyTable, phaseOf,
    deltaEF: deltaEF(SETTINGS),
    ch4FullDay: ch4FullDay(SETTINGS),
    battPct, irrigationDays,
    fmtDate, fmtDateShort, fmtTime, fmtNum, BULAN,
    // recompute helpers (used by Settings live preview)
    _ch4FullDay: ch4FullDay, _deltaEF: deltaEF, _ch4ReducedG: ch4ReducedG, _co2eqG: co2eqG,
  };
})();
