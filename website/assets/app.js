/* ============================================================
   App — page rendering, router, interactions
   ============================================================ */
(function () {
  const A = window.AWD, IC = window.IC, CH = window.Charts;
  const $ = (s, r = document) => r.querySelector(s);
  const charts = {};

  /* ---------- Toast ---------- */
  function toast(msg) {
    let wrap = $('.toast-wrap');
    if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; document.body.appendChild(wrap); }
    const t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status');
    t.innerHTML = IC.checkCircle + `<span>${msg}</span>`;
    wrap.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .3s, transform .3s'; t.style.opacity = '0'; t.style.transform = 'translateY(10px)'; setTimeout(() => t.remove(), 320); }, 3200);
  }

  /* ---------- Topbar / device meta ---------- */
  function fillStatic() {
    const lvl = A.latest.level, pct = A.battPct(A.latest.batt);
    $('#dev-id').textContent = A.SETTINGS.device_id;
    $('#dev-status').innerHTML = `<span class="dot live"></span> Daring`;
    $('#sb-batt').textContent = pct + '%';
    $('#sb-update').textContent = A.fmtTime(A.latest.ts) + ' · ' + A.fmtDateShort(A.latest.ts);
    const badge = $('#irr-badge');
    if (A.unreadCount > 0) { badge.textContent = A.unreadCount; badge.style.display = ''; }
    else badge.style.display = 'none';
  }

  /* ---------- Dashboard ---------- */
  function renderDashboard() {
    const s = A.SETTINGS, t = A.today, lvl = A.latest.level;
    const totalG = t.cumulativeCo2eqG;
    const totalKg = totalG / 1000;
    const totalCh4 = A.days.reduce((a, d) => a + d.ch4ReducedG, 0);
    const aerobicDays = A.days.reduce((a, d) => a + d.aerobicFraction, 0);
    const awdActiveDays = A.days.filter(d => d.phase.n >= 2).length;
    const pct = A.battPct(A.latest.batt);
    const zone = lvl < 0 ? 'aerobik' : 'tergenang';
    const pumpOn = A.latest.pump === 'ON';

    const heroVal = totalKg >= 1
      ? `<span class="n">${A.fmtNum(totalKg, 2)}</span><span class="u">kg CO₂-eq</span>`
      : `<span class="n">${A.fmtNum(totalG, 0)}</span><span class="u">g CO₂-eq</span>`;

    $('#page-dashboard').innerHTML = `
      <div class="grid" style="grid-template-columns: repeat(12, 1fr);">

        <!-- HERO -->
        <div class="hero">
          <div>
            <span class="eyebrow">${IC.leaf} Mitigasi Emisi · Sejak Hari Tanam</span>
            <div class="big">${heroVal}</div>
            <p class="cap">Total emisi <b>CO₂-ekuivalen</b> yang berhasil disisihkan oleh penerapan AWD pada petak ini sejak <b>${A.fmtDate(A.days[0].date, true)}</b>, dihitung proporsional terhadap durasi kondisi aerobik tanah (IPCC 2019).</p>
          </div>
          <div class="hero-side">
            <div class="hero-mini">
              <div class="ic">${IC.cloud}</div>
              <div><div class="v">${A.fmtNum(totalCh4, 1)} g</div><div class="l">CH₄ tersisihkan kumulatif</div></div>
            </div>
            <div class="hero-mini">
              <div class="ic">${IC.sprout}</div>
              <div><div class="v">${A.fmtNum(aerobicDays, 1)} hari</div><div class="l">Setara durasi aerobik penuh</div></div>
            </div>
            <div class="hero-mini">
              <div class="ic">${IC.droplet}</div>
              <div><div class="v">${awdActiveDays} hari</div><div class="l">Periode AWD aktif berjalan</div></div>
            </div>
          </div>
        </div>

        <!-- STAT CARDS -->
        ${statCard('water', IC.waves, 'Tinggi Muka Air Terkini',
          `${lvl > 0 ? '+' : ''}${A.fmtNum(lvl, 1)}<span class="u">cm</span>`,
          `<span class="chip ${lvl < 0 ? 'dry' : 'water'}"><span class="dot" style="background:${lvl < 0 ? 'var(--clay-500)' : 'var(--water)'}"></span>${lvl < 0 ? 'Kering / Aerobik' : 'Tergenang / Anaerobik'}</span>`)}

        ${statCard('green', IC.calendar, 'Hari Setelah Tanam (DAP)',
          `${A.DAP_NOW}<span class="u">hari</span>`,
          `Tanam ${A.fmtDate(A.days[0].date)}`)}

        ${statCard('clay', IC.seedling, 'Fase Budidaya',
          `<span style="font-size:23px">${t.phase.n === 1 ? 'Fase I' : t.phase.n === 2 ? 'Fase II' : 'Fase III'}</span>`,
          `<span class="phase-tag ${t.phase.key}">${t.phase.label.split('— ')[1]}</span>`)}

        ${statCard(pct < 25 ? 'dry' : 'green', IC.battery, 'Daya Baterai Node',
          `${pct}<span class="u">%</span>`,
          `<span class="mono" style="font-size:12px;color:var(--muted)">${A.fmtNum(A.latest.batt, 2)} V</span>`)}

        <!-- WATER LEVEL CHART -->
        <div class="card" style="grid-column: span 8;">
          <div class="card-h">
            <div>
              <h3>Dinamika Tinggi Muka Air</h3>
              <div class="sub">Pembacaan sensor tiap 2 jam · relatif terhadap permukaan tanah</div>
            </div>
            <div class="spacer"></div>
            <div class="seg" id="wl-range">
              <button data-d="3">3 hari</button>
              <button data-d="7" class="on">7 hari</button>
              <button data-d="14">14 hari</button>
            </div>
          </div>
          <div class="card-b">
            <div class="chart-wrap h-lg"><canvas id="c-water"></canvas></div>
            <div class="legend" style="margin-top:14px;">
              <span class="it"><span class="sw" style="background:var(--green-500)"></span> Tergenang (anaerobik)</span>
              <span class="it"><span class="sw" style="background:var(--clay-500)"></span> Kering (aerobik · &lt; 0 cm)</span>
              <span class="it"><span class="band" style="background:var(--water-fill);border-color:#C7DEF7"></span> Zona genangan</span>
              <span class="it"><span class="band" style="background:var(--dry-fill);border-color:#ECD3A8"></span> Zona kering</span>
            </div>
          </div>
        </div>

        <!-- PUMP STATUS -->
        <div class="card" style="grid-column: span 4; display:flex; flex-direction:column;">
          <div class="card-h"><h3>Status Pompa Virtual</h3></div>
          <div class="card-b pump" style="flex:1;">
            <div class="pump-state ${pumpOn ? 'on' : 'off'}">
              <div class="pump-ring">${IC.power}</div>
              <div>
                <div class="lbl">Logika kontrol irigasi</div>
                <div class="big">POMPA ${A.latest.pump}</div>
              </div>
            </div>
            <div class="pump-logic">
              ${pumpOn
                ? `Tinggi muka air <code>${A.fmtNum(lvl,1)} cm</code> ≤ ambang irigasi <code>${s.threshold_irrigation_cm} cm</code> → sistem menandai <b>perlu irigasi</b> dan mengirim notifikasi.`
                : `Tinggi muka air <code>${lvl>0?'+':''}${A.fmtNum(lvl,1)} cm</code> berada di antara ambang. Status dipertahankan (histeresis) hingga menyentuh <code>${s.threshold_irrigation_cm} cm</code> atau <code>+${s.threshold_flooding_cm} cm</code>.`}
            </div>
            <div style="display:grid;gap:8px;margin-top:2px;">
              ${thresholdRow('var(--water)', `Genangan tercapai → OFF`, `+${s.threshold_flooding_cm} cm`)}
              ${thresholdRow('var(--muted-2)', `Batas aerobik (emisi)`, `0 cm`)}
              ${thresholdRow('var(--danger)', `Irigasi diperlukan → ON`, `${s.threshold_irrigation_cm} cm`)}
            </div>
            <div class="callout info" style="margin-top:auto;">${IC.info}<div>Histeresis dua-ambang mencegah pompa berkedip ON/OFF saat level berada di antara <code style="background:transparent;border:none;padding:0;">${s.threshold_irrigation_cm}</code> dan <code style="background:transparent;border:none;padding:0;">+${s.threshold_flooding_cm}</code> cm.</div></div>
          </div>
        </div>

        <!-- EMISSION ACCUMULATION -->
        <div class="card" style="grid-column: span 8;">
          <div class="card-h">
            <div>
              <h3>Akumulasi Pengurangan Emisi CO₂-eq</h3>
              <div class="sub">Kumulatif sejak hari tanam · presisi penuh, ditampilkan dalam kg</div>
            </div>
          </div>
          <div class="card-b">
            <div class="chart-wrap h-md"><canvas id="c-cumul"></canvas></div>
          </div>
        </div>

        <!-- EMISSION SUMMARY -->
        <div class="card" style="grid-column: span 4;">
          <div class="card-h"><h3>Ringkasan Emisi</h3></div>
          <div class="card-b" style="display:grid;gap:14px;">
            ${emRow(IC.cloud, 'var(--eco-600)', 'CH₄ tersisihkan (kumulatif)', `${A.fmtNum(totalCh4, 1)} g`)}
            ${emRow(IC.flask, 'var(--water)', 'CO₂-eq tersisihkan (kumulatif)', `${A.fmtNum(totalKg, 2)} kg`)}
            ${emRow(IC.sigma, 'var(--clay-600)', 'Potensi maksimum harian', `${A.fmtNum(A.ch4FullDay, 2)} g CH₄`)}
            ${emRow(IC.target, 'var(--muted)', 'Pengurangan hari ini', `${A.fmtNum(A.today.co2eqReducedG, 1)} g CO₂-eq`)}
            <div class="callout info" style="margin-top:2px;">
              ${IC.info}
              <div>Estimasi berbasis faktor emisi IPCC (2019), bukan pengukuran fluks gas langsung. Δ EF = <b>${A.fmtNum(A.deltaEF, 3)}</b> kg CH₄·ha⁻¹·hari⁻¹.</div>
            </div>
          </div>
        </div>

      </div>`;

    // charts
    charts.water = CH.waterLevel($('#c-water'), A.recentReadings(7));
    charts.cumul = CH.cumulative($('#c-cumul'), A.days);

    // range toggle
    $('#wl-range').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      $('#wl-range').querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      charts.water.destroy();
      charts.water = CH.waterLevel($('#c-water'), A.recentReadings(+b.dataset.d));
    });
  }

  function statCard(ic, icon, label, val, meta) {
    return `<div class="card stat" style="grid-column: span 3;">
      <div class="top"><div class="ic ${ic}">${icon}</div><div class="label">${label}</div></div>
      <div class="val">${val}</div>
      <div class="meta">${meta}</div>
    </div>`;
  }
  function thresholdRow(color, label, val) {
    return `<div class="row between" style="font-size:12.5px;">
      <span class="row" style="gap:8px;"><span class="dot" style="background:${color};width:8px;height:8px;"></span><span class="muted">${label}</span></span>
      <span class="mono" style="color:var(--ink-soft);font-weight:500;">${val}</span></div>`;
  }
  function emRow(icon, color, label, val) {
    return `<div class="row between">
      <span class="row" style="gap:10px;"><span style="color:${color};width:18px;height:18px;display:inline-flex;">${icon}</span><span class="muted" style="font-size:13px;">${label}</span></span>
      <span class="mono" style="font-weight:600;color:var(--ink);">${val}</span></div>`;
  }

  /* ---------- History ---------- */
  let histState = { from: null, to: null, phase: 'all', sortKey: 'dap', sortDir: 'desc', chart: 'level' };

  function renderHistory() {
    const first = A.days[0].date, last = A.days[A.days.length - 1].date;
    histState.from = histState.from || toInput(first);
    histState.to = histState.to || toInput(last);

    $('#page-history').innerHTML = `
      <div class="card" style="margin-bottom:18px;">
        <div class="card-b" style="display:flex;align-items:flex-end;gap:18px;flex-wrap:wrap;">
          <div class="field" style="gap:5px;">
            <label>Dari tanggal</label>
            <input type="date" class="input" id="h-from" value="${histState.from}" min="${toInput(first)}" max="${toInput(last)}" style="width:170px;">
          </div>
          <div class="field" style="gap:5px;">
            <label>Sampai tanggal</label>
            <input type="date" class="input" id="h-to" value="${histState.to}" min="${toInput(first)}" max="${toInput(last)}" style="width:170px;">
          </div>
          <div class="field" style="gap:5px;">
            <label>Fase budidaya</label>
            <div class="seg" id="h-phase">
              <button data-p="all" class="${histState.phase==='all'?'on':''}">Semua</button>
              <button data-p="1" class="${histState.phase==='1'?'on':''}">Fase I</button>
              <button data-p="2" class="${histState.phase==='2'?'on':''}">Fase II</button>
              <button data-p="3" class="${histState.phase==='3'?'on':''}">Fase III</button>
            </div>
          </div>
          <div class="spacer" style="flex:1;"></div>
          <button class="btn ghost sm" id="h-reset">${IC.refresh} Reset</button>
          <button class="btn sm" id="h-csv">${IC.download} Ekspor CSV</button>
        </div>
      </div>

      <div class="card" style="margin-bottom:18px;">
        <div class="card-h">
          <div><h3>Grafik Historis Musim Tanam</h3><div class="sub" id="h-count"></div></div>
          <div class="spacer"></div>
          <div class="seg" id="h-chart">
            <button data-c="level" class="${histState.chart==='level'?'on':''}">Tinggi muka air</button>
            <button data-c="emission" class="${histState.chart==='emission'?'on':''}">Emisi CO₂-eq harian</button>
          </div>
        </div>
        <div class="card-b"><div class="chart-wrap h-md"><canvas id="c-hist"></canvas></div></div>
      </div>

      <div class="card">
        <div class="card-h"><h3>Tabel Data Harian</h3><div class="sub" style="margin-left:2px;">Agregasi per tanggal · klik judul kolom untuk mengurutkan</div></div>
        <div class="card-b" style="padding-top:12px;">
          <div class="table-scroll" id="h-table"></div>
        </div>
      </div>`;

    $('#h-from').addEventListener('change', e => { histState.from = e.target.value; refreshHistory(); });
    $('#h-to').addEventListener('change', e => { histState.to = e.target.value; refreshHistory(); });
    $('#h-phase').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; histState.phase = b.dataset.p; refreshHistory(); });
    $('#h-chart').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; histState.chart = b.dataset.c; refreshHistory(); });
    $('#h-reset').addEventListener('click', () => { histState = { ...histState, from: toInput(first), to: toInput(last), phase: 'all', sortKey: 'dap', sortDir: 'desc' }; renderHistory(); });
    $('#h-csv').addEventListener('click', () => exportCSV(filteredDays()));

    refreshHistory();
  }

  function filteredDays() {
    const from = new Date(histState.from + 'T00:00:00'), to = new Date(histState.to + 'T23:59:59');
    return A.days.filter(d => d.date >= from && d.date <= to && (histState.phase === 'all' || d.phase.n === +histState.phase));
  }

  function refreshHistory() {
    // sync seg active states
    $('#h-phase')?.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.p === histState.phase));
    $('#h-chart')?.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.c === histState.chart));
    const data = filteredDays();
    $('#h-count').textContent = `${data.length} hari · ${histState.from.split('-').reverse().join('/')} – ${histState.to.split('-').reverse().join('/')}`;

    if (charts.hist) charts.hist.destroy();
    charts.hist = histState.chart === 'level' ? CH.seasonLevel($('#c-hist'), data) : CH.dailyEmission($('#c-hist'), data);

    renderHistTable(data);
  }

  function renderHistTable(data) {
    const cols = [
      { k: 'date', t: 'Tanggal' }, { k: 'dap', t: 'DAP' }, { k: 'phaseN', t: 'Fase' },
      { k: 'nAerobic', t: 'Aerobik' }, { k: 'aerobicFraction', t: 'Fraksi' },
      { k: 'ch4ReducedG', t: 'CH₄ (g)' }, { k: 'co2eqReducedG', t: 'CO₂-eq (g)' }, { k: 'cumulativeCo2eqG', t: 'Kumulatif (kg)' },
    ];
    const sorted = [...data].sort((a, b) => {
      const dir = histState.sortDir === 'asc' ? 1 : -1;
      const av = histState.sortKey === 'phaseN' ? a.phase.n : (histState.sortKey === 'date' ? a.dap : a[histState.sortKey]);
      const bv = histState.sortKey === 'phaseN' ? b.phase.n : (histState.sortKey === 'date' ? b.dap : b[histState.sortKey]);
      return (av - bv) * dir;
    });
    const head = cols.map(c => {
      const active = histState.sortKey === c.k;
      const arr = active ? (histState.sortDir === 'asc' ? '▲' : '▼') : '';
      return `<th class="sortable" data-k="${c.k}">${c.t} <span class="arr">${arr}</span></th>`;
    }).join('');
    const rows = sorted.map(d => `<tr>
      <td>${A.fmtDate(d.date)}</td>
      <td>${d.dap}</td>
      <td style="text-align:right;"><span class="phase-tag ${d.phase.key}">${d.phase.n === 1 ? 'I' : d.phase.n === 2 ? 'II' : 'III'}</span></td>
      <td>${d.nAerobic}<span class="muted">/${d.nTotal}</span></td>
      <td><span class="bar-cell"><span class="track"><span class="fill" style="width:${(d.aerobicFraction*100).toFixed(0)}%"></span></span>${d.aerobicFraction.toFixed(3)}</span></td>
      <td>${d.ch4ReducedG.toFixed(2)}</td>
      <td>${d.co2eqReducedG.toFixed(2)}</td>
      <td style="font-weight:600;color:var(--eco-700);">${(d.cumulativeCo2eqG/1000).toFixed(3)}</td>
    </tr>`).join('');

    $('#h-table').innerHTML = `<table class="data"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
    $('#h-table').querySelectorAll('th.sortable').forEach(th => th.addEventListener('click', () => {
      const k = th.dataset.k;
      if (histState.sortKey === k) histState.sortDir = histState.sortDir === 'asc' ? 'desc' : 'asc';
      else { histState.sortKey = k; histState.sortDir = 'desc'; }
      renderHistTable(data);
    }));
  }

  function exportCSV(data) {
    const head = ['tanggal','dap','fase','n_aerobic','n_total','aerobic_fraction','ch4_reduced_g','co2eq_reduced_g','cumulative_co2eq_g'];
    const lines = [head.join(',')].concat(data.map(d => [
      toInput(d.date), d.dap, d.phase.n, d.nAerobic, d.nTotal, d.aerobicFraction.toFixed(4),
      d.ch4ReducedG.toFixed(4), d.co2eqReducedG.toFixed(4), d.cumulativeCo2eqG.toFixed(4)
    ].join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = 'awd_riwayat_emisi.csv'; a.click(); URL.revokeObjectURL(url);
    toast('Data riwayat diekspor sebagai CSV');
  }

  /* ---------- Settings ---------- */
  function renderSettings() {
    const s = A.SETTINGS;
    $('#page-settings').innerHTML = `
      <div style="display:grid;grid-template-columns: 1fr 360px; gap:22px; align-items:start;">
        <div>
          ${setSection(IC.seedling, 'var(--green-50)', 'var(--green-600)', 'Identitas Node & Petak', 'Metadata perangkat sensor dan parameter fisik petak uji.', `
            <div class="form-grid">
              ${field('Nama petak / lokasi', `<input class="input" value="${s.device_name}">`, 'full')}
              ${field('ID perangkat', `<input class="input mono" value="${s.device_id}">`)}
              ${field('Tanggal tanam <span class="req">*</span>', `<input type="date" class="input" value="${s.planting_date}">`, '', 'Acuan perhitungan DAP dan akumulasi emisi.')}
              ${field('Luas petak', affix(`<input class="input mono" id="set-area" value="${s.plot_area_m2}" type="number" step="1">`, 'm²'), '', 'Skala linear terhadap estimasi emisi (default 100 m²).')}
              ${field('Tinggi pipa di atas tanah', affix(`<input class="input mono" value="${s.pipe_height_above_ground_cm}" type="number" step="0.5">`, 'cm'), '', 'Digunakan untuk konversi water_level dari jarak sensor.')}
            </div>`)}

          ${setSection(IC.target, 'var(--danger-50)', 'var(--danger)', 'Ambang Batas', 'Nilai ambang untuk pemicu irigasi dan target genangan.', `
            <div class="form-grid">
              ${field('Ambang irigasi (pompa ON)', affix(`<input class="input mono" value="${s.threshold_irrigation_cm}" type="number" step="0.5">`, 'cm'), '', 'Pemicu notifikasi & status pompa ON.')}
              ${field('Ambang genangan (pompa OFF)', affix(`<input class="input mono" value="${s.threshold_flooding_cm}" type="number" step="0.5">`, 'cm'), '', 'Target genangan; status pompa OFF saat tercapai.')}
            </div>`)}

          ${setSection(IC.flask, 'var(--water-50)', 'var(--water)', 'Konstanta Emisi (IPCC 2019)', 'Faktor emisi dan parameter perhitungan.', `
            <div class="form-grid">
              ${field('EF dasar (EFc)', affix(`<input class="input mono emc" data-k="ef_baseline" value="${s.ef_baseline}" type="number" step="0.01">`, 'kg/ha/hr'))}
              ${field('GWP CH₄', `<input class="input mono emc" data-k="gwp_ch4" value="${s.gwp_ch4}" type="number" step="1">`)}
              ${field('SFw — flooding', `<input class="input mono emc" data-k="sfw_cf" value="${s.sfw_cf}" type="number" step="0.01">`)}
              ${field('SFw — AWD', `<input class="input mono emc" data-k="sfw_awd" value="${s.sfw_awd}" type="number" step="0.01">`)}
              ${field('Pembacaan / hari', `<input class="input mono emc" data-k="readings_per_day" value="${s.readings_per_day}" type="number" step="1">`, '', 'Interval 2 jam → 12 pembacaan.')}
            </div>`)}

          ${setSection(IC.send, 'var(--clay-50)', 'var(--clay-600)', 'Notifikasi Telegram', 'Peringatan otomatis irigasi dan baterai lemah.', `
            <div class="row between" style="padding:4px 0 14px;">
              <div><div style="font-weight:600;font-size:13.5px;">Aktifkan notifikasi</div><div class="help">Kirim alert saat water_level ≤ ambang irigasi.</div></div>
              <label class="switch"><input type="checkbox" ${s.telegram_enabled ? 'checked' : ''}><span class="track"></span><span class="knob"></span></label>
            </div>
            <div class="form-grid">
              ${field('Bot Token', `<input class="input mono" type="password" value="78xxxxxxxx:AAH-xxxxxxxxxxxxxxxxxxxx">`, 'full')}
              ${field('Chat ID', `<input class="input mono" value="-1001xxxxxxxxx">`)}
              ${field('Ambang baterai lemah', affix(`<input class="input mono" value="${s.low_battery_v}" type="number" step="0.05">`, 'V'))}
            </div>`)}

          <div class="row" style="gap:10px;margin-top:24px;justify-content:flex-end;">
            <button class="btn ghost" id="set-reset">Batalkan</button>
            <button class="btn primary" id="set-save">${IC.check} Simpan Pengaturan</button>
          </div>
        </div>

        <!-- LIVE PREVIEW -->
        <div class="card" style="position:sticky;top:88px;">
          <div class="card-h"><h3>Pratinjau Perhitungan</h3></div>
          <div class="card-b">
            <div class="help" style="margin-bottom:14px;">Nilai turunan diperbarui langsung dari konstanta di samping.</div>
            <div style="display:grid;gap:10px;margin-bottom:16px;">
              ${previewRow('Δ EF = EFc·(SFw_cf − SFw_awd)', 'p-deltaef', 'kg/ha/hr')}
              ${previewRow('CH₄ potensi penuh / hari', 'p-full', 'g')}
            </div>
            <div class="section-title" style="margin:6px 2px 10px;font-size:11px;">Tabel Verifikasi · ${s.plot_area_m2} m²</div>
            <table class="mini-table" id="p-verify"></table>
          </div>
        </div>
      </div>`;

    // live recompute
    function recompute() {
      const cfg = { ...A.SETTINGS };
      $('#page-settings').querySelectorAll('.emc').forEach(i => { cfg[i.dataset.k] = parseFloat(i.value) || 0; });
      cfg.plot_area_m2 = parseFloat($('#set-area').value) || 0;
      const dEF = A._deltaEF(cfg), full = A._ch4FullDay(cfg);
      $('#p-deltaef').textContent = dEF.toFixed(3);
      $('#p-full').textContent = full.toFixed(2);
      const rows = [0, 1, 3, 6, 9, 12].map(n => {
        const ch4 = A._ch4ReducedG(n, cfg), co2 = A._co2eqG(ch4, cfg);
        return `<tr><td class="mono">${n}/${cfg.readings_per_day}</td><td class="mono">${(n/cfg.readings_per_day).toFixed(3)}</td><td class="mono">${ch4.toFixed(2)}</td><td class="mono" style="color:var(--eco-700);font-weight:600;">${co2.toFixed(2)}</td></tr>`;
      }).join('');
      $('#p-verify').innerHTML = `<thead><tr><th>n aerobik</th><th>fraksi</th><th>CH₄ g</th><th>CO₂-eq g</th></tr></thead><tbody>${rows}</tbody>`;
    }
    $('#page-settings').querySelectorAll('.emc, #set-area').forEach(i => i.addEventListener('input', recompute));
    $('#set-save').addEventListener('click', () => toast('Pengaturan berhasil disimpan'));
    $('#set-reset').addEventListener('click', () => { renderSettings(); });
    recompute();
  }

  function setSection(icon, bg, color, title, desc, body) {
    return `<div class="set-section card"><div class="card-b">
      <div class="set-head"><div class="ic" style="background:${bg};color:${color};">${icon}</div>
        <div><h3>${title}</h3><p>${desc}</p></div></div>
      <div style="margin-top:16px;">${body}</div></div></div>`;
  }
  function field(label, input, cls = '', help = '') {
    return `<div class="field ${cls}"><label>${label}</label>${input}${help ? `<span class="help">${help}</span>` : ''}</div>`;
  }
  function affix(input, unit) { return `<div class="input-affix">${input}<span class="unit">${unit}</span></div>`; }
  function previewRow(label, id, unit) {
    return `<div class="row between"><span class="muted" style="font-size:12px;max-width:60%;">${label}</span><span><span class="mono" id="${id}" style="font-weight:600;color:var(--ink);"></span> <span class="muted mono" style="font-size:11px;">${unit}</span></span></div>`;
  }

  /* ---------- Notifications ---------- */
  let notifState = { filter: 'all', read: new Set() };
  const NTYPE = {
    irrigation: { sev: 'danger', icon: IC.droplet, label: 'Irigasi' },
    battery:    { sev: 'warn',   icon: IC.battery, label: 'Baterai' },
    phase:      { sev: 'info',   icon: IC.seedling, label: 'Sistem' },
    system:     { sev: 'info',   icon: IC.info,    label: 'Sistem' },
  };
  function relTime(ts) {
    const diff = (A.NOW - ts) / 1000;
    if (diff < 3600) return Math.max(1, Math.round(diff / 60)) + ' menit lalu';
    if (diff < 86400) return Math.round(diff / 3600) + ' jam lalu';
    const d = Math.round(diff / 86400);
    return d + ' hari lalu';
  }
  function dayKey(ts) {
    const nd = new Date(A.NOW.getFullYear(), A.NOW.getMonth(), A.NOW.getDate());
    const td = new Date(ts.getFullYear(), ts.getMonth(), ts.getDate());
    const diff = Math.round((nd - td) / 86400000);
    if (diff === 0) return 'Hari ini';
    if (diff === 1) return 'Kemarin';
    return A.fmtDate(ts);
  }
  function isUnread(a) { return a.unread && !notifState.read.has(a.id); }

  function renderNotifications() {
    const counts = { all: A.alerts.length, irrigation: 0, battery: 0, system: 0 };
    A.alerts.forEach(a => { const t = (a.type === 'phase' || a.type === 'system') ? 'system' : a.type; counts[t]++; });
    const unread = A.alerts.filter(isUnread).length;

    $('#page-notifications').innerHTML = `
      <div style="display:grid;grid-template-columns: 1fr 320px; gap:22px; align-items:start;">
        <div>
          <div class="card" style="margin-bottom:18px;">
            <div class="card-b" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
              <div class="seg" id="n-filter">
                <button data-f="all" class="${notifState.filter==='all'?'on':''}">Semua <span class="muted">${counts.all}</span></button>
                <button data-f="irrigation" class="${notifState.filter==='irrigation'?'on':''}">Irigasi <span class="muted">${counts.irrigation}</span></button>
                <button data-f="battery" class="${notifState.filter==='battery'?'on':''}">Baterai <span class="muted">${counts.battery}</span></button>
                <button data-f="system" class="${notifState.filter==='system'?'on':''}">Sistem <span class="muted">${counts.system}</span></button>
              </div>
              <div class="spacer" style="flex:1"></div>
              <button class="btn ghost sm" id="n-readall" ${unread? '':'disabled style="opacity:.5;cursor:default;"'}>${IC.check} Tandai semua dibaca</button>
            </div>
          </div>
          <div id="n-list"></div>
        </div>

        <div style="display:grid;gap:18px;position:sticky;top:88px;">
          <div class="card">
            <div class="card-h"><h3>Ringkasan Peringatan</h3></div>
            <div class="card-b" style="display:grid;gap:13px;">
              ${nSummaryRow('danger', IC.droplet, 'Permintaan irigasi', counts.irrigation, 'sepanjang musim')}
              ${nSummaryRow('warn', IC.battery, 'Baterai lemah', counts.battery, 'periode mendung')}
              ${nSummaryRow('info', IC.info, 'Peristiwa sistem', counts.system, 'fase & status node')}
              <div class="row between" style="border-top:1px solid var(--border-soft);padding-top:13px;margin-top:1px;">
                <span class="muted" style="font-size:13px;">Belum dibaca</span>
                <span class="chip danger" id="n-unread" style="${unread?'':'display:none'}">${unread} baru</span>
                <span class="chip green" id="n-clear" style="${unread?'display:none':''}">Semua terbaca</span>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="card-h"><h3>Saluran Notifikasi</h3></div>
            <div class="card-b">
              <div class="row" style="gap:12px;">
                <div class="ic" style="width:40px;height:40px;border-radius:11px;background:var(--water-50);color:var(--water);display:grid;place-items:center;flex:none;">${IC.send}</div>
                <div style="min-width:0;">
                  <div style="font-weight:650;font-size:14px;">Telegram Bot</div>
                  <div class="muted" style="font-size:12.5px;">@awd_cikabayan_bot</div>
                </div>
                <span class="chip green" style="margin-left:auto;"><span class="dot live"></span>Aktif</span>
              </div>
              <div class="callout info" style="margin-top:14px;">${IC.info}<div>Alert dikirim otomatis saat <b>tinggi muka air ≤ ${A.SETTINGS.threshold_irrigation_cm} cm</b> atau <b>baterai &lt; ${A.fmtNum(A.SETTINGS.low_battery_v,2)} V</b>.</div></div>
            </div>
          </div>
        </div>
      </div>`;

    renderNotifList();
    $('#n-filter').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; notifState.filter = b.dataset.f; renderNotifications(); });
    $('#n-readall').addEventListener('click', () => { A.alerts.forEach(a => notifState.read.add(a.id)); renderNotifications(); updateBadge(); });
  }

  function nSummaryRow(sev, icon, label, val, sub) {
    const col = sev === 'danger' ? 'var(--danger)' : sev === 'warn' ? 'var(--clay-600)' : 'var(--water)';
    const bg = sev === 'danger' ? 'var(--danger-50)' : sev === 'warn' ? 'var(--clay-50)' : 'var(--water-50)';
    return `<div class="row between">
      <span class="row" style="gap:11px;"><span class="ic" style="width:34px;height:34px;border-radius:9px;background:${bg};color:${col};display:grid;place-items:center;flex:none;">${icon}</span>
        <span><span style="font-weight:600;font-size:13.5px;display:block;">${label}</span><span class="muted" style="font-size:11.5px;">${sub}</span></span></span>
      <span class="serif" style="font-size:22px;font-weight:600;">${val}</span></div>`;
  }

  function renderNotifList() {
    const f = notifState.filter;
    const items = A.alerts.filter(a => f === 'all' ? true : (f === 'system' ? (a.type === 'system' || a.type === 'phase') : a.type === f));
    if (!items.length) { $('#n-list').innerHTML = `<div class="card"><div class="card-b" style="text-align:center;padding:42px;color:var(--muted);">Tidak ada notifikasi pada kategori ini.</div></div>`; return; }
    let html = '', lastKey = null;
    for (const a of items) {
      const key = dayKey(a.ts);
      if (key !== lastKey) { html += `<div class="n-group">${key}</div>`; lastKey = key; }
      const meta = NTYPE[a.type], unread = isUnread(a);
      const sevCls = meta.sev;
      const tag = a.type === 'irrigation' ? `<span class="chip dry" style="font-size:11px;">${A.fmtNum(a.level,1)} cm</span>`
        : a.type === 'battery' ? `<span class="chip" style="font-size:11px;">${A.fmtNum(a.batt,2)} V</span>`
        : `<span class="chip" style="font-size:11px;">DAP ${a.dap}</span>`;
      html += `<div class="n-item sev-${sevCls} ${unread?'unread':''}" data-id="${a.id}">
        <div class="n-ic">${meta.icon}</div>
        <div class="n-body">
          <div class="n-top"><span class="n-title">${a.title}</span>${unread?'<span class="n-dot"></span>':''}<span class="spacer" style="flex:1"></span><span class="n-time" title="${A.fmtDate(a.ts)} ${A.fmtTime(a.ts)}">${relTime(a.ts)}</span></div>
          <div class="n-msg">${a.msg}</div>
          <div class="n-foot">${tag}<span class="n-stamp mono">${A.fmtDate(a.ts)} · ${A.fmtTime(a.ts)} WIB</span></div>
        </div></div>`;
    }
    const wrap = $('#n-list'); wrap.innerHTML = html;
    wrap.querySelectorAll('.n-item').forEach(el => el.addEventListener('click', () => {
      notifState.read.add(+el.dataset.id); el.classList.remove('unread');
      const d = el.querySelector('.n-dot'); if (d) d.remove();
      updateBadge();
      // refresh summary unread chip
      const unread = A.alerts.filter(isUnread).length;
      const uc = $('#n-unread'), cc = $('#n-clear');
      if (uc && cc) { if (unread) { uc.textContent = unread + ' baru'; uc.style.display=''; cc.style.display='none'; } else { uc.style.display='none'; cc.style.display=''; $('#n-readall')?.setAttribute('disabled',''); } }
    }));
  }

  function updateBadge() {
    const badge = $('#irr-badge'); if (!badge) return;
    const unread = A.alerts.filter(isUnread).length;
    if (unread > 0) { badge.textContent = unread; badge.style.display = ''; } else badge.style.display = 'none';
  }

  /* ---------- Report (PDF preview) ---------- */
  function renderReport() {
    const s = A.SETTINGS, t = A.today;
    const totalCh4 = A.days.reduce((a, d) => a + d.ch4ReducedG, 0);
    const totalCo2Kg = t.cumulativeCo2eqG / 1000;
    const aerobicDays = A.days.reduce((a, d) => a + d.aerobicFraction, 0);
    const meanAerFrac = aerobicDays / A.days.length;
    const awdActiveDays = A.days.filter(d => d.phase.n >= 2).length;
    const irrEvents = A.alerts.filter(a => a.type === 'irrigation').length;
    const minLvl = Math.min(...A.days.map(d => d.minLevel));
    const reportNo = `AWD/${s.device_id}/${String(A.NOW.getFullYear())}-${String(A.NOW.getMonth()+1).padStart(2,'0')}`;

    // per-phase aggregation
    const phases = [1, 2, 3].map(n => {
      const ds = A.days.filter(d => d.phase.n === n);
      if (!ds.length) return null;
      return {
        n, label: ds[0].phase.label.split('— ')[1],
        days: ds.length,
        meanLevel: ds.reduce((a, d) => a + d.meanLevel, 0) / ds.length,
        ch4: ds.reduce((a, d) => a + d.ch4ReducedG, 0),
        co2: ds.reduce((a, d) => a + d.co2eqReducedG, 0),
        aer: ds.reduce((a, d) => a + d.aerobicFraction, 0) / ds.length,
      };
    }).filter(Boolean);

    const phaseRows = phases.map(p => `<tr>
      <td>Fase ${p.n === 1 ? 'I' : p.n === 2 ? 'II' : 'III'} — ${p.label}</td>
      <td>${p.days}</td>
      <td>${A.fmtNum(p.meanLevel,1)}</td>
      <td>${(p.aer*100).toFixed(1)}%</td>
      <td>${A.fmtNum(p.ch4,1)}</td>
      <td>${A.fmtNum(p.co2,1)}</td></tr>`).join('');

    $('#page-report').innerHTML = `
      <div class="report-toolbar no-print">
        <button class="btn ghost sm" id="rep-back"><span style="display:inline-flex;transform:rotate(180deg);">${IC.chevR}</span> Kembali</button>
        <div class="muted" style="font-size:12.5px;">Pratinjau laporan · ukuran A4 · ${A.days.length} hari data</div>
        <div class="spacer" style="flex:1"></div>
        <button class="btn sm" id="rep-csv">${IC.download} Data CSV</button>
        <button class="btn primary sm" id="rep-print">${IC.download} Cetak / Simpan PDF</button>
      </div>

      <article class="report-doc" id="rep-doc">
        <!-- HEADER -->
        <header class="rep-head">
          <img src="assets/ipb-logo.png" alt="IPB University" class="rep-logo">
          <div class="rep-headmeta">
            <div class="rep-no">No. ${reportNo}</div>
            <div class="rep-conf">Dokumen Internal Penelitian</div>
          </div>
        </header>
        <div class="rep-titleblock">
          <div class="rep-kicker">Laporan Pemantauan Lapang</div>
          <h1>Pemantauan Tinggi Muka Air & Estimasi Mitigasi Emisi Metana pada Penerapan AWD</h1>
          <p class="rep-sub">Sistem pemantauan berbasis IoT untuk irigasi <em>Alternate Wetting and Drying</em> — ${s.device_name}</p>
        </div>

        <div class="rep-metagrid">
          ${repMeta('Perangkat / Node', s.device_id)}
          ${repMeta('Lokasi petak', s.device_name.split('—')[1] ? s.device_name.split('—')[1].trim() : s.device_name)}
          ${repMeta('Luas petak', s.plot_area_m2 + ' m²')}
          ${repMeta('Tanggal tanam', A.fmtDate(A.days[0].date, true))}
          ${repMeta('Periode laporan', A.fmtDate(A.days[0].date) + ' – ' + A.fmtDate(t.date))}
          ${repMeta('Dibuat pada', A.fmtDate(A.NOW, true) + ', ' + A.fmtTime(A.NOW) + ' WIB')}
        </div>

        <!-- EXEC SUMMARY -->
        <section class="rep-section">
          <h2><span class="rep-num">1</span> Ringkasan Eksekutif</h2>
          <p>Selama <b>${A.DAP_NOW} hari setelah tanam</b>, penerapan irigasi AWD pada ${s.device_name.split('—')[0].trim()} berhasil menyisihkan estimasi <b>${A.fmtNum(totalCo2Kg,2)} kg CO₂-ekuivalen</b> (setara <b>${A.fmtNum(totalCh4,1)} g CH₄</b>) dibandingkan praktik penggenangan terus-menerus. Estimasi dihitung secara proporsional terhadap durasi kondisi aerobik tanah mengikuti faktor emisi IPCC (2019).</p>
          <p>Sistem mencatat <b>${irrEvents} kali permintaan irigasi</b> otomatis ketika tinggi muka air menyentuh ambang ${s.threshold_irrigation_cm} cm, dengan rata-rata fraksi aerobik harian <b>${(meanAerFrac*100).toFixed(1)}%</b> sepanjang periode AWD aktif (${awdActiveDays} hari). Tinggi muka air terendah yang tercatat adalah <b>${A.fmtNum(minLvl,1)} cm</b>, masih berada dalam rentang <em>safe-AWD</em> yang tidak menimbulkan cekaman air berlebih pada tanaman.</p>
        </section>

        <!-- KPI -->
        <section class="rep-section">
          <h2><span class="rep-num">2</span> Indikator Kinerja Utama</h2>
          <div class="rep-kpis">
            ${repKpi(A.fmtNum(totalCo2Kg,2), 'kg CO₂-eq', 'Total emisi tersisihkan', true)}
            ${repKpi(A.fmtNum(totalCh4,1), 'g CH₄', 'Metana tersisihkan')}
            ${repKpi(A.DAP_NOW, 'hari', 'Umur tanaman (DAP)')}
            ${repKpi(awdActiveDays, 'hari', 'Periode AWD aktif')}
            ${repKpi(irrEvents, 'kali', 'Kejadian irigasi')}
            ${repKpi((meanAerFrac*100).toFixed(1) + '%', '', 'Rata-rata fraksi aerobik')}
          </div>
        </section>

        <!-- CHARTS -->
        <section class="rep-section rep-avoid">
          <h2><span class="rep-num">3</span> Dinamika Tinggi Muka Air</h2>
          <p class="rep-cap">Rata-rata harian tinggi muka air relatif terhadap permukaan tanah. Zona biru menandakan kondisi tergenang (anaerobik), zona oranye menandakan kondisi kering (aerobik, &lt; 0 cm) tempat emisi metana ditekan.</p>
          <div class="rep-chart"><canvas id="r-water"></canvas></div>
        </section>

        <section class="rep-section rep-avoid">
          <h2><span class="rep-num">4</span> Akumulasi Pengurangan Emisi</h2>
          <p class="rep-cap">Akumulasi CO₂-ekuivalen yang disisihkan sejak hari tanam, dihitung dengan presisi penuh dan ditampilkan dalam kilogram.</p>
          <div class="rep-chart"><canvas id="r-cumul"></canvas></div>
        </section>

        <!-- TABLE -->
        <section class="rep-section rep-avoid">
          <h2><span class="rep-num">5</span> Statistik per Fase Budidaya</h2>
          <table class="rep-table">
            <thead><tr><th style="text-align:left">Fase budidaya</th><th>Hari</th><th>Muka air rata‑rata (cm)</th><th>Fraksi aerobik</th><th>CH₄ (g)</th><th>CO₂-eq (g)</th></tr></thead>
            <tbody>${phaseRows}</tbody>
            <tfoot><tr><td style="text-align:left">Total / rata‑rata musim</td><td>${A.days.length}</td><td>${A.fmtNum(A.days.reduce((a,d)=>a+d.meanLevel,0)/A.days.length,1)}</td><td>${(meanAerFrac*100).toFixed(1)}%</td><td>${A.fmtNum(totalCh4,1)}</td><td>${A.fmtNum(t.cumulativeCo2eqG,1)}</td></tr></tfoot>
          </table>
        </section>

        <!-- METHOD -->
        <section class="rep-section">
          <h2><span class="rep-num">6</span> Metodologi Perhitungan</h2>
          <p>Estimasi emisi mengikuti pendekatan faktor emisi terskala (IPCC 2019). Faktor emisi dasar penggenangan EFᴄ = <b>${A.fmtNum(s.ef_baseline,2)} kg CH₄·ha⁻¹·hari⁻¹</b> dikalikan selisih faktor skala air antara penggenangan kontinu (SFw = ${A.fmtNum(s.sfw_cf,2)}) dan AWD (SFw = ${A.fmtNum(s.sfw_awd,2)}), menghasilkan ΔEF = <b>${A.fmtNum(A.deltaEF,3)} kg CH₄·ha⁻¹·hari⁻¹</b>. Untuk petak ${s.plot_area_m2} m², potensi metana tersisihkan maksimum adalah <b>${A.fmtNum(A.ch4FullDay,2)} g CH₄/hari</b>.</p>
          <p>Pengurangan harian dihitung proporsional terhadap fraksi pembacaan aerobik: (n_aerobik / ${s.readings_per_day}) × potensi penuh, lalu dikonversi ke CO₂-ekuivalen dengan GWP CH₄ = <b>${s.gwp_ch4}</b>. Sensor melakukan ${s.readings_per_day} pembacaan per hari (interval 2 jam); kondisi aerobik dihitung saat tinggi muka air &lt; 0 cm. Seluruh konstanta tersimpan pada basis data sistem dan dapat dikalibrasi tanpa mengubah kode program.</p>
        </section>

        <!-- CONCLUSION -->
        <section class="rep-section">
          <h2><span class="rep-num">7</span> Kesimpulan & Rekomendasi</h2>
          <ul class="rep-list">
            <li>Penerapan AWD pada petak ini menunjukkan kinerja mitigasi yang konsisten dengan <b>${A.fmtNum(totalCo2Kg,2)} kg CO₂-eq</b> tersisihkan selama ${A.DAP_NOW} hari.</li>
            <li>Siklus pembasahan–pengeringan berjalan stabil; ambang <em>safe-AWD</em> ${s.threshold_irrigation_cm} cm efektif mencegah cekaman air tanpa mengorbankan penekanan emisi.</li>
            <li>Direkomendasikan pemantauan baterai node saat periode mendung berkepanjangan, serta verifikasi lapang berkala terhadap pembacaan sensor.</li>
          </ul>
        </section>

        <!-- SIGNATURE -->
        <div class="rep-foot">Laporan dihasilkan otomatis oleh AWD Monitor · ${A.fmtDate(A.NOW, true)} · Estimasi berbasis IPCC (2019), bukan pengukuran fluks gas langsung.</div>
      </article>`;

    // charts
    if (charts.rwater) charts.rwater.destroy();
    if (charts.rcumul) charts.rcumul.destroy();
    charts.rwater = CH.seasonLevel($('#r-water'), A.days);
    charts.rcumul = CH.cumulative($('#r-cumul'), A.days);

    $('#rep-back').addEventListener('click', () => go('dashboard'));
    $('#rep-print').addEventListener('click', () => window.print());
    $('#rep-csv').addEventListener('click', () => exportCSV(A.days));
  }

  function repMeta(label, val) {
    return `<div class="rep-meta"><span class="rep-meta-l">${label}</span><span class="rep-meta-v">${val}</span></div>`;
  }
  function repKpi(val, unit, label, hero) {
    return `<div class="rep-kpi ${hero?'hero':''}"><div class="rep-kpi-v">${val}${unit?`<span>${unit}</span>`:''}</div><div class="rep-kpi-l">${label}</div></div>`;
  }

  /* ---------- Router ---------- */
  const titles = {
    dashboard: ['Dashboard Pemantauan', 'Tinggi muka air real-time & estimasi mitigasi emisi'],
    history: ['Riwayat Data', 'Rekam jejak harian sepanjang musim tanam'],
    notifications: ['Notifikasi', 'Riwayat peringatan irigasi, baterai & sistem'],
    settings: ['Pengaturan Sistem', 'Kalibrasi parameter, ambang batas & konstanta emisi'],
    report: ['Laporan PDF', 'Pratinjau laporan formal siap cetak'],
  };
  const PAGES = ['dashboard', 'history', 'notifications', 'settings', 'report'];
  const renderers = { dashboard: renderDashboard, history: renderHistory, notifications: renderNotifications, settings: renderSettings, report: renderReport };
  const rendered = {};
  function go(page) {
    PAGES.forEach(p => {
      $('#page-' + p).hidden = p !== page;
      const nav = $('#nav-' + p);
      if (nav) nav.classList.toggle('active', p === page);
    });
    // report is a chrome-light view
    document.body.classList.toggle('report-mode', page === 'report');
    $('#tt-title').textContent = titles[page][0];
    $('#tt-sub').textContent = titles[page][1];
    if (!rendered[page]) { renderers[page](); rendered[page] = true; }
    if (location.hash !== '#' + page) history.replaceState(null, '', '#' + page);
    document.querySelector('.main').scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }

  function init() {
    fillStatic();
    document.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => go(b.dataset.nav)));
    $('#btn-pdf').addEventListener('click', () => go('report'));
    const start = (location.hash || '#dashboard').slice(1);
    go(PAGES.includes(start) ? start : 'dashboard');
  }

  function toInput(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
