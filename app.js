/* ─────────────────────────────────────────────────────────
   Nexus Analytics — app.js
   Industrial Analytics Platform
   Handles: CSV parsing, stats, charts, correlation, reports
───────────────────────────────────────────────────────── */

'use strict';

// ── GLOBAL STATE ──────────────────────────────────────────
const DS = {
  raw:         [],   // parsed rows (array of objects)
  headers:     [],   // column names
  types:       {},   // col → 'numeric' | 'categorical' | 'date'
  stats:       {},   // col → {min, max, mean, median, std, q1, q3, outliers[]}
  filtered:    [],   // search-filtered rows for explorer
  activeAnalCol: null,
  charts:      {},   // Chart.js instances
  sortCol:     null,
  sortDir:     1,
};

// ── CHART.JS GLOBAL DEFAULTS ──────────────────────────────
Chart.defaults.color           = '#8B949E';
Chart.defaults.borderColor     = '#2A3347';
Chart.defaults.font.family     = "'SF Mono', 'Fira Code', 'Consolas', monospace";
Chart.defaults.font.size       = 11;
Chart.defaults.plugins.legend.display = false;

// ── CSV LOADING ───────────────────────────────────────────
function loadCSV(event) {
  const file = event.target.files[0];
  if (!file) return;
  showToast('Parsing ' + file.name + '…');
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
    complete: (result) => {
      if (!result.data.length) { showToast('File appears empty.', 'error'); return; }
      processDataset(result.data, result.meta.fields, file.name);
    },
    error: (err) => showToast('Parse error: ' + err.message, 'error'),
  });
}

function loadSampleData() {
  const data = generateSampleData();
  processDataset(data.rows, data.headers, 'demo_dataset.csv');
}

// ── SAMPLE DATA GENERATOR ─────────────────────────────────
function generateSampleData() {
  const regions   = ['North', 'South', 'East', 'West', 'Central'];
  const products  = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];
  const channels  = ['Online', 'Retail', 'Wholesale', 'Direct'];
  const rows = [];
  const n = 600;
  const rng = (a, b) => Math.random() * (b - a) + a;
  const rngInt = (a, b) => Math.round(rng(a, b));

  for (let i = 0; i < n; i++) {
    const region   = regions[rngInt(0, 4)];
    const product  = products[rngInt(0, 4)];
    const channel  = channels[rngInt(0, 3)];
    const units    = rngInt(10, 500);
    const price    = parseFloat(rng(12, 280).toFixed(2));
    const discount = parseFloat(rng(0, 0.35).toFixed(3));
    const revenue  = parseFloat((units * price * (1 - discount)).toFixed(2));
    const cost     = parseFloat((revenue * rng(0.38, 0.68)).toFixed(2));
    const profit   = parseFloat((revenue - cost).toFixed(2));
    const csat     = parseFloat(rng(1, 5).toFixed(1));
    const month    = rngInt(1, 12);
    const year     = [2022, 2023, 2024][rngInt(0, 2)];
    const date     = `${year}-${String(month).padStart(2,'0')}-01`;
    // Inject a few outliers
    const adjRevenue = (Math.random() < 0.03) ? revenue * rng(5, 10) : revenue;
    rows.push({ Date: date, Region: region, Product: product, Channel: channel,
      Units: units, UnitPrice: price, Discount: discount,
      Revenue: adjRevenue, Cost: cost, Profit: profit, CSAT: csat });
  }
  const headers = ['Date','Region','Product','Channel','Units','UnitPrice','Discount','Revenue','Cost','Profit','CSAT'];
  return { rows, headers };
}

// ── PROCESS DATASET ───────────────────────────────────────
function processDataset(rows, headers, filename) {
  DS.raw     = rows;
  DS.headers = headers;
  DS.filtered = rows;
  DS.types   = {};
  DS.stats   = {};
  DS.sortCol = null;
  DS.sortDir = 1;

  // Detect types
  headers.forEach(col => {
    const vals = rows.map(r => r[col]).filter(v => v !== null && v !== undefined && v !== '');
    const numericCount = vals.filter(v => typeof v === 'number' && !isNaN(v)).length;
    const dateCount = vals.filter(v => isDateString(String(v))).length;
    if (numericCount / vals.length > 0.7)        DS.types[col] = 'numeric';
    else if (dateCount / vals.length > 0.7)      DS.types[col] = 'date';
    else                                         DS.types[col] = 'categorical';
  });

  // Compute stats for numeric cols
  numericCols().forEach(col => {
    const vals = numericVals(col);
    DS.stats[col] = computeStats(vals);
  });

  // Update UI
  updateDatasetPill(filename, rows.length);
  updateKPIs();
  populateSelects();
  buildProfileTable();
  renderDistribution();
  renderCategoryBreakdown();
  renderTrend();
  buildExplorerTable();
  buildAnalyticsView();
  renderCorrelation();
  generateReport();
  buildSQLTable();
  buildForecastView();

  showToast(`Loaded ${rows.length.toLocaleString()} rows × ${headers.length} cols`, 'success');
}

// ── HELPERS ───────────────────────────────────────────────
function numericCols() { return DS.headers.filter(c => DS.types[c] === 'numeric'); }
function categoricalCols() { return DS.headers.filter(c => DS.types[c] === 'categorical'); }

function numericVals(col) {
  return DS.raw.map(r => r[col]).filter(v => typeof v === 'number' && !isNaN(v));
}

function isDateString(s) {
  if (!s || typeof s !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{2}[\/\-]\d{2}[\/\-]\d{4}/.test(s);
}

function computeStats(vals) {
  if (!vals.length) return {};
  const sorted = [...vals].sort((a, b) => a - b);
  const n   = sorted.length;
  const sum = vals.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const q1  = percentile(sorted, 25);
  const q3  = percentile(sorted, 75);
  const iqr = q3 - q1;
  const median = percentile(sorted, 50);
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  const outliers = vals.filter(v => v < lo || v > hi);
  return { n, sum, mean, median, std, min: sorted[0], max: sorted[n-1], q1, q3, iqr, lo, hi, outliers };
}

function percentile(sorted, p) {
  const idx = (p / 100) * (sorted.length - 1);
  const lo  = Math.floor(idx);
  const hi  = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function fmt(n, dec = 2) {
  if (n === undefined || n === null || isNaN(n)) return '—';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Number(n).toFixed(dec);
}

function fmtFull(n, dec = 2) {
  if (n === undefined || n === null || isNaN(n)) return '—';
  return Number(n).toFixed(dec);
}

function completeness() {
  if (!DS.raw.length || !DS.headers.length) return 0;
  const total = DS.raw.length * DS.headers.length;
  const filled = DS.raw.reduce((acc, row) =>
    acc + DS.headers.filter(h => row[h] !== null && row[h] !== undefined && row[h] !== '').length, 0);
  return (filled / total * 100).toFixed(1);
}

function totalOutliers() {
  return numericCols().reduce((acc, col) => acc + (DS.stats[col]?.outliers?.length || 0), 0);
}

// ── KPI UPDATE ────────────────────────────────────────────
function updateKPIs() {
  el('kpiRows').textContent    = DS.raw.length.toLocaleString();
  el('kpiCols').textContent    = DS.headers.length;
  el('kpiNumeric').textContent = numericCols().length;
  const comp = parseFloat(completeness());
  el('kpiComplete').textContent = comp + '%';
  const compDelta = el('kpiComplete').closest('.kpi-card').querySelector('.kpi-delta');
  compDelta.className = 'kpi-delta ' + (comp >= 95 ? 'up' : comp >= 80 ? 'warn' : 'down');
  compDelta.textContent = comp >= 95 ? '✓ Excellent quality' : comp >= 80 ? '⚠ Some missing values' : '✗ Quality issues found';
  const out = totalOutliers();
  el('kpiOutliers').textContent = out.toLocaleString();
  const outDelta = el('kpiOutliers').closest('.kpi-card').querySelector('.kpi-delta');
  outDelta.className = 'kpi-delta ' + (out === 0 ? 'up' : out < 10 ? 'warn' : 'down');
  outDelta.textContent = out === 0 ? '✓ No outliers' : `${out} anomalous values`;
  el('dashSubtitle').textContent = `Analyzing ${DS.raw.length.toLocaleString()} records across ${DS.headers.length} fields — dataset ready.`;
}

// ── DATASET PILL ──────────────────────────────────────────
function updateDatasetPill(filename, rows) {
  const pill = document.querySelector('.dataset-pill');
  pill.textContent = `${filename} · ${rows.toLocaleString()} rows`;
  pill.classList.add('loaded');
}

// ── POPULATE SELECTS ──────────────────────────────────────
function populateSelects() {
  const numCols = numericCols();
  const catCols = categoricalCols();
  const allCols = DS.headers;

  fillSelect('distColSelect', numCols, numCols[0]);
  fillSelect('catColSelect', catCols, catCols[0]);
  fillSelect('trendXSelect', allCols, allCols[0]);
  fillSelect('trendYSelect', numCols, numCols[0]);
}

function fillSelect(id, options, selected) {
  const sel = el(id);
  if (!sel) return;
  sel.innerHTML = '';
  options.forEach(opt => {
    const o = document.createElement('option');
    o.value = opt; o.textContent = opt;
    if (opt === selected) o.selected = true;
    sel.appendChild(o);
  });
}

// ── PROFILE TABLE ─────────────────────────────────────────
function buildProfileTable() {
  const wrap = el('profileTableWrap');
  if (!DS.raw.length) { wrap.innerHTML = '<div class="empty-state">No dataset loaded</div>'; return; }

  const rows = DS.headers.map(col => {
    const vals     = DS.raw.map(r => r[col]);
    const total    = vals.length;
    const missing  = vals.filter(v => v === null || v === undefined || v === '').length;
    const unique   = new Set(vals.filter(v => v !== null && v !== undefined && v !== '')).size;
    const missPct  = (missing / total * 100).toFixed(1);
    const type     = DS.types[col] || 'unknown';
    const typeBadge = type === 'numeric' ? 'num' : type === 'date' ? 'date' : 'cat';
    const typeLabel = type === 'numeric' ? 'NUM' : type === 'date' ? 'DATE' : 'CAT';
    const barW     = Math.max(2, Math.round(parseFloat(missPct)));
    return `<tr>
      <td style="color:var(--text-primary);font-weight:600">${col}</td>
      <td><span class="type-badge ${typeBadge}">${typeLabel}</span></td>
      <td>${unique.toLocaleString()}</td>
      <td>
        <span class="miss-bar" style="width:${barW}px"></span>
        <span style="margin-left:6px">${missPct}%</span>
      </td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `<table class="profile-table">
    <thead><tr><th>Column</th><th>Type</th><th>Unique</th><th>Missing</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ── DISTRIBUTION CHART ────────────────────────────────────
function renderDistribution() {
  const col = el('distColSelect')?.value;
  if (!col || !DS.raw.length) return;
  const vals = numericVals(col);
  if (!vals.length) return;

  destroyChart('chartDist');
  const { buckets, counts } = histogram(vals, 20);
  const st = DS.stats[col];
  el('distMeta').textContent = `n=${vals.length} · μ=${fmtFull(st?.mean)} · σ=${fmtFull(st?.std)} · outliers=${st?.outliers?.length || 0}`;

  DS.charts['chartDist'] = new Chart(el('chartDist'), {
    type: 'bar',
    data: {
      labels: buckets.map(b => fmtFull(b, 1)),
      datasets: [{
        data: counts,
        backgroundColor: counts.map((_, i) => {
          const isQ = buckets[i] >= (st?.q1 || 0) && buckets[i] <= (st?.q3 || Infinity);
          return isQ ? 'rgba(232,255,71,0.7)' : 'rgba(232,255,71,0.2)';
        }),
        borderColor: 'rgba(232,255,71,0.9)',
        borderWidth: 1,
        borderRadius: 2,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: {
        tooltip: {
          callbacks: { title: ctx => `≥ ${ctx[0].label}`, label: ctx => `${ctx.raw} records` },
          backgroundColor: '#1C2333', borderColor: '#2A3347', borderWidth: 1,
        }
      },
      scales: {
        x: { grid: { color: 'rgba(42,51,71,0.5)', drawTicks: false }, ticks: { maxTicksLimit: 8, maxRotation: 0 } },
        y: { grid: { color: 'rgba(42,51,71,0.5)' }, beginAtZero: true },
      }
    }
  });
}

function histogram(vals, bins) {
  const min = Math.min(...vals), max = Math.max(...vals);
  const step = (max - min) / bins;
  const buckets = Array.from({ length: bins }, (_, i) => min + i * step);
  const counts  = new Array(bins).fill(0);
  vals.forEach(v => {
    let i = Math.floor((v - min) / step);
    if (i >= bins) i = bins - 1;
    counts[i]++;
  });
  return { buckets, counts };
}

// ── CATEGORY BREAKDOWN ────────────────────────────────────
function renderCategoryBreakdown() {
  const col = el('catColSelect')?.value;
  if (!col || !DS.raw.length) return;

  destroyChart('chartCat');
  const freq = {};
  DS.raw.forEach(row => {
    const v = String(row[col] ?? 'N/A');
    freq[v] = (freq[v] || 0) + 1;
  });
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10);
  el('catMeta').textContent = `${Object.keys(freq).length} unique values · top 10 shown`;

  const palette = ['#E8FF47','#58A6FF','#3DDC84','#BC8CFF','#F78166','#FF6B6B','#FFA726','#26C6DA','#AB47BC','#66BB6A'];
  DS.charts['chartCat'] = new Chart(el('chartCat'), {
    type: 'doughnut',
    data: {
      labels: sorted.map(([k]) => k),
      datasets: [{
        data: sorted.map(([, v]) => v),
        backgroundColor: palette.map(c => c + 'CC'),
        borderColor: palette,
        borderWidth: 1.5,
        hoverOffset: 6,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: {
        legend: {
          display: true, position: 'right',
          labels: { boxWidth: 10, font: { size: 11 }, padding: 8, color: '#8B949E' }
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const pct = (ctx.raw / DS.raw.length * 100).toFixed(1);
              return ` ${ctx.label}: ${ctx.raw} (${pct}%)`;
            }
          },
          backgroundColor: '#1C2333', borderColor: '#2A3347', borderWidth: 1,
        }
      }
    }
  });
}

// ── TREND CHART ───────────────────────────────────────────
function renderTrend() {
  const xCol = el('trendXSelect')?.value;
  const yCol = el('trendYSelect')?.value;
  if (!xCol || !yCol || !DS.raw.length) return;

  destroyChart('chartTrend');
  const rows = [...DS.raw].sort((a, b) => {
    const av = a[xCol], bv = b[xCol];
    if (typeof av === 'number' && typeof bv === 'number') return av - bv;
    return String(av).localeCompare(String(bv));
  });

  const isGrouped = DS.types[xCol] !== 'numeric';
  let labels, data;

  if (isGrouped) {
    const grouped = {};
    rows.forEach(r => {
      const key = String(r[xCol] ?? 'N/A');
      if (!grouped[key]) grouped[key] = [];
      const v = r[yCol];
      if (typeof v === 'number') grouped[key].push(v);
    });
    const sorted = Object.entries(grouped).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    labels = sorted.map(([k]) => k);
    data   = sorted.map(([, vs]) => vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : 0);
    el('trendMeta').textContent = `avg ${yCol} by ${xCol} · ${labels.length} groups`;
  } else {
    const limit = 300;
    const step  = Math.max(1, Math.floor(rows.length / limit));
    const sample = rows.filter((_, i) => i % step === 0);
    labels = sample.map(r => r[xCol]);
    data   = sample.map(r => r[yCol]);
    el('trendMeta').textContent = `${yCol} vs ${xCol} · ${sample.length} points`;
  }

  DS.charts['chartTrend'] = new Chart(el('chartTrend'), {
    type: isGrouped ? 'bar' : 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: '#E8FF47',
        backgroundColor: isGrouped ? 'rgba(232,255,71,0.5)' : 'rgba(232,255,71,0.08)',
        borderWidth: isGrouped ? 1 : 2,
        pointRadius: isGrouped ? 0 : 2,
        pointHoverRadius: 5,
        fill: !isGrouped,
        tension: 0.3,
        borderRadius: isGrouped ? 3 : 0,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        tooltip: {
          callbacks: { label: ctx => ` ${yCol}: ${fmt(ctx.raw)}` },
          backgroundColor: '#1C2333', borderColor: '#2A3347', borderWidth: 1,
        }
      },
      scales: {
        x: { grid: { color: 'rgba(42,51,71,0.5)' }, ticks: { maxTicksLimit: 12, maxRotation: 45 } },
        y: { grid: { color: 'rgba(42,51,71,0.5)' } },
      }
    }
  });
}

function destroyChart(id) {
  if (DS.charts[id]) { DS.charts[id].destroy(); delete DS.charts[id]; }
}

// ── DATA EXPLORER TABLE ───────────────────────────────────
function buildExplorerTable(rows) {
  rows = rows || DS.raw;
  if (!rows.length) { el('tableWrap').innerHTML = '<div class="empty-state">Load a dataset to explore records.</div>'; return; }

  DS.filtered = rows;
  el('rowCounter').textContent = rows.length.toLocaleString() + ' rows';

  const limit = 500;
  const display = rows.slice(0, limit);
  const head = DS.headers.map(h => `<th onclick="sortTable('${h}')">${h}</th>`).join('');
  const body = display.map((row, i) =>
    `<tr><td class="row-num">${i + 1}</td>${DS.headers.map(h =>
      `<td title="${row[h]}">${row[h] !== null && row[h] !== undefined ? row[h] : '<span style="color:var(--text-muted)">null</span>'}</td>`
    ).join('')}</tr>`
  ).join('');
  const footer = rows.length > limit ? `<tr><td colspan="${DS.headers.length + 1}" style="text-align:center;color:var(--text-muted);padding:10px;font-size:12px">Showing first ${limit.toLocaleString()} of ${rows.length.toLocaleString()} rows</td></tr>` : '';

  el('tableWrap').innerHTML = `<table class="data-table">
    <thead><tr><th>#</th>${head}</tr></thead>
    <tbody>${body}${footer}</tbody>
  </table>`;
}

function filterTable() {
  const q = el('tableSearch').value.trim().toLowerCase();
  if (!q) { buildExplorerTable(DS.raw); return; }
  const filtered = DS.raw.filter(row =>
    DS.headers.some(h => String(row[h] ?? '').toLowerCase().includes(q))
  );
  buildExplorerTable(filtered);
}

function sortTable(col) {
  if (DS.sortCol === col) DS.sortDir *= -1;
  else { DS.sortCol = col; DS.sortDir = 1; }
  const sorted = [...DS.filtered].sort((a, b) => {
    const av = a[col], bv = b[col];
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * DS.sortDir;
    return String(av).localeCompare(String(bv)) * DS.sortDir;
  });
  buildExplorerTable(sorted);
}

function exportFilteredCSV() {
  if (!DS.filtered.length) { showToast('Nothing to export.', 'error'); return; }
  const csv = Papa.unparse(DS.filtered);
  downloadFile('filtered_data.csv', csv, 'text/csv');
  showToast('Exported ' + DS.filtered.length.toLocaleString() + ' rows.', 'success');
}

// ── ANALYTICS VIEW ────────────────────────────────────────
function buildAnalyticsView() {
  const cols = numericCols();
  const picker = el('analyticsColPicker');
  if (!cols.length) { picker.innerHTML = '<div class="empty-state">No numeric columns found.</div>'; return; }

  picker.innerHTML = cols.map(col =>
    `<button class="col-pill ${col === cols[0] ? 'active' : ''}" onclick="selectAnalyticsCol('${col}', this)">${col}</button>`
  ).join('');

  DS.activeAnalCol = cols[0];
  renderAnalyticsForCol(cols[0]);
}

function selectAnalyticsCol(col, btn) {
  document.querySelectorAll('.col-pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  DS.activeAnalCol = col;
  renderAnalyticsForCol(col);
}

function renderAnalyticsForCol(col) {
  const grid = el('analyticsGrid');
  const st = DS.stats[col];
  if (!st) { grid.innerHTML = '<div class="empty-state">No stats available.</div>'; return; }

  const statsHtml = `
    <div class="stat-card">
      <div class="stat-card-title">Descriptive Statistics — ${col}</div>
      <div class="stat-grid">
        ${[['Count', st.n?.toLocaleString()], ['Sum', fmt(st.sum)], ['Mean', fmtFull(st.mean)],
           ['Median', fmtFull(st.median)], ['Std Dev', fmtFull(st.std)], ['Min', fmtFull(st.min)],
           ['Max', fmtFull(st.max)], ['Q1', fmtFull(st.q1)], ['Q3', fmtFull(st.q3)], ['IQR', fmtFull(st.iqr)]
          ].map(([l, v]) => `<div class="stat-item">
            <div class="stat-item-label">${l}</div>
            <div class="stat-item-value">${v}</div>
          </div>`).join('')}
      </div>
    </div>`;

  const boxHtml = buildBoxPlotHTML(col, st);
  const histHtml = `<div class="stat-card wide" style="grid-column:1/-1">
    <div class="stat-card-title">Frequency Distribution — ${col}</div>
    <div style="height:180px"><canvas id="analyticsHistCanvas"></canvas></div>
  </div>`;

  grid.innerHTML = statsHtml + boxHtml + histHtml;

  // render inline histogram
  const vals = numericVals(col);
  const { buckets, counts } = histogram(vals, 25);
  destroyChart('analyticsHistCanvas');
  DS.charts['analyticsHistCanvas'] = new Chart(el('analyticsHistCanvas'), {
    type: 'bar',
    data: {
      labels: buckets.map(b => fmtFull(b, 1)),
      datasets: [{
        data: counts,
        backgroundColor: 'rgba(88,166,255,0.55)',
        borderColor: 'rgba(88,166,255,0.9)',
        borderWidth: 1,
        borderRadius: 2,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 200 },
      plugins: { tooltip: { callbacks: { label: ctx => `${ctx.raw} records` }, backgroundColor: '#1C2333', borderColor: '#2A3347', borderWidth: 1 } },
      scales: {
        x: { grid: { color: 'rgba(42,51,71,0.5)' }, ticks: { maxTicksLimit: 10, maxRotation: 0 } },
        y: { grid: { color: 'rgba(42,51,71,0.5)' }, beginAtZero: true }
      }
    }
  });
}

function buildBoxPlotHTML(col, st) {
  const range = st.max - st.min;
  if (!range) return '';
  const pct = v => Math.max(0, Math.min(100, ((v - st.min) / range * 100)));
  const loW   = pct(Math.max(st.min, st.lo));
  const q1W   = pct(st.q1);
  const medW  = pct(st.median);
  const q3W   = pct(st.q3);
  const hiW   = pct(Math.min(st.max, st.hi));

  const outBadge = st.outliers.length
    ? `<div class="outlier-badge">⚠ ${st.outliers.length} outliers detected (IQR method)</div>`
    : `<div class="no-outlier-badge">✓ No outliers detected</div>`;

  return `<div class="stat-card">
    <div class="stat-card-title">Box Plot — ${col}</div>
    <div class="box-plot-wrap">
      <div class="box-plot-container">
        <div class="box-plot-line" style="left:${loW}%;right:${100-hiW}%"></div>
        <div class="box-plot-rect" style="left:${q1W}%;width:${q3W-q1W}%"></div>
        <div class="box-plot-median" style="left:${medW}%"></div>
        <div class="box-plot-whisker" style="left:${loW}%"></div>
        <div class="box-plot-whisker" style="left:${hiW}%"></div>
      </div>
      <div class="box-plot-labels">
        <span>${fmtFull(st.min)}</span>
        <span>Q1: ${fmtFull(st.q1)}</span>
        <span>Med: ${fmtFull(st.median)}</span>
        <span>Q3: ${fmtFull(st.q3)}</span>
        <span>${fmtFull(st.max)}</span>
      </div>
      ${outBadge}
    </div>
  </div>`;
}

// ── CORRELATION MATRIX ────────────────────────────────────
function renderCorrelation() {
  const wrap = el('corrMatrixWrap');
  const cols = numericCols();
  if (cols.length < 2) { wrap.innerHTML = '<div class="empty-state">Need at least 2 numeric columns.</div>'; return; }

  const threshold = parseFloat(el('corrThreshold').value);
  el('corrThreshVal').textContent = threshold.toFixed(2);
  const showAbs = el('corrAbs').checked;

  // Pearson correlation
  const matrix = {};
  cols.forEach(a => {
    matrix[a] = {};
    const av = numericVals(a);
    cols.forEach(b => {
      if (a === b) { matrix[a][b] = 1; return; }
      const bv = numericVals(b);
      matrix[a][b] = pearson(av, bv);
    });
  });

  const head = `<tr><th></th>${cols.map(c => `<th title="${c}">${c.length > 10 ? c.slice(0,10)+'…' : c}</th>`).join('')}</tr>`;
  const body = cols.map(a =>
    `<tr><th title="${a}">${a.length > 10 ? a.slice(0,10)+'…' : a}</th>${cols.map(b => {
      const r = matrix[a][b];
      const display = showAbs ? Math.abs(r) : r;
      const hide = a !== b && Math.abs(r) < threshold;
      const bg = corrColor(r);
      const textColor = Math.abs(r) > 0.5 ? '#0D1117' : '#E6EDF3';
      return `<td style="background:${bg};color:${textColor};opacity:${hide ? 0.15 : 1}">${display.toFixed(2)}</td>`;
    }).join('')}</tr>`
  ).join('');

  wrap.innerHTML = `<table class="corr-matrix"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function pearson(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const xs = x.slice(0, n), ys = y.slice(0, n);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  if (dx === 0 || dy === 0) return 0;
  return num / Math.sqrt(dx * dy);
}

function corrColor(r) {
  // -1 → blue, 0 → dark, +1 → accent yellow
  const abs = Math.abs(r);
  if (r > 0) {
    const g = Math.round(abs * 232); const gb = Math.round(abs * 71);
    return `rgba(${g}, ${Math.round(abs*255)}, ${gb}, ${0.15 + abs * 0.7})`;
  } else {
    const rb = Math.round(abs * 255);
    return `rgba(${rb}, ${Math.round(abs * 107)}, ${Math.round(abs * 107)}, ${0.15 + abs * 0.7})`;
  }
}

// ── REPORTS ───────────────────────────────────────────────
function generateReport() {
  const container = el('reportContainer');
  if (!DS.raw.length) { container.innerHTML = '<div class="empty-state">Load a dataset to generate a report.</div>'; return; }

  const now = new Date().toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' });
  const comp = completeness();
  const numCols = numericCols();
  const catCols = categoricalCols();
  const outlierTotal = totalOutliers();

  // Top insights
  const insights = [];
  if (parseFloat(comp) < 90) insights.push({ icon: '⚠', text: `Data completeness is ${comp}% — ${DS.raw.length * DS.headers.length - Math.round(parseFloat(comp)/100 * DS.raw.length * DS.headers.length)} missing values detected across ${DS.headers.length} columns.` });
  if (outlierTotal > 0) insights.push({ icon: '🔴', text: `${outlierTotal} statistical outliers found using the IQR method. Review the Analytics tab for per-column detail.` });

  // Find most correlated pair
  let bestPair = null, bestR = 0;
  numCols.forEach(a => numCols.forEach(b => {
    if (a >= b) return;
    const r = Math.abs(pearson(numericVals(a), numericVals(b)));
    if (r > bestR) { bestR = r; bestPair = [a, b]; }
  }));
  if (bestPair && bestR > 0.3) insights.push({ icon: '📊', text: `Strongest correlation: ${bestPair[0]} ↔ ${bestPair[1]} (r = ${bestR.toFixed(3)}). Consider this relationship in your model.` });

  const maxVar = numCols.reduce((best, col) => {
    const cv = (DS.stats[col]?.std || 0) / Math.abs(DS.stats[col]?.mean || 1);
    return (!best || cv > best.cv) ? { col, cv } : best;
  }, null);
  if (maxVar) insights.push({ icon: '📈', text: `Highest coefficient of variation: ${maxVar.col} (CV = ${(maxVar.cv * 100).toFixed(1)}%) — this column has the most relative spread.` });

  // Per-col stats table
  const numStatRows = numCols.map(col => {
    const st = DS.stats[col];
    return `<tr>
      <td style="color:var(--text-primary);font-weight:600;font-family:var(--mono)">${col}</td>
      <td>${fmtFull(st?.mean)}</td><td>${fmtFull(st?.median)}</td><td>${fmtFull(st?.std)}</td>
      <td>${fmtFull(st?.min)}</td><td>${fmtFull(st?.max)}</td>
      <td style="color:${(st?.outliers?.length || 0) > 0 ? 'var(--red)' : 'var(--green)'}">${st?.outliers?.length || 0}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="report-section">
      <div class="report-section-title">Dataset Summary</div>
      <div class="report-row"><span class="report-row-label">Generated</span><span class="report-row-value">${now}</span></div>
      <div class="report-row"><span class="report-row-label">Total Records</span><span class="report-row-value">${DS.raw.length.toLocaleString()}</span></div>
      <div class="report-row"><span class="report-row-label">Total Columns</span><span class="report-row-value">${DS.headers.length}</span></div>
      <div class="report-row"><span class="report-row-label">Numeric Columns</span><span class="report-row-value">${numCols.length}</span></div>
      <div class="report-row"><span class="report-row-label">Categorical Columns</span><span class="report-row-value">${catCols.length}</span></div>
      <div class="report-row"><span class="report-row-label">Completeness</span><span class="report-row-value" style="color:${parseFloat(comp) >= 95 ? 'var(--green)' : 'var(--orange)'}">${comp}%</span></div>
      <div class="report-row"><span class="report-row-label">Total Outliers</span><span class="report-row-value" style="color:${outlierTotal > 0 ? 'var(--red)' : 'var(--green)'}">${outlierTotal}</span></div>
    </div>

    <div class="report-section">
      <div class="report-section-title">Automated Insights</div>
      ${insights.length ? insights.map(ins => `<div class="report-insight"><span class="insight-icon">${ins.icon}</span><span>${ins.text}</span></div>`).join('') : '<div class="report-insight"><span class="insight-icon">✓</span><span>No critical issues detected. Dataset appears clean and ready for analysis.</span></div>'}
    </div>

    ${numCols.length ? `<div class="report-section">
      <div class="report-section-title">Numeric Column Statistics</div>
      <div style="overflow-x:auto">
      <table class="profile-table">
        <thead><tr><th>Column</th><th>Mean</th><th>Median</th><th>Std Dev</th><th>Min</th><th>Max</th><th>Outliers</th></tr></thead>
        <tbody>${numStatRows}</tbody>
      </table>
      </div>
    </div>` : ''}

    <div class="report-section">
      <div class="report-section-title">Column Directory</div>
      ${DS.headers.map(col => {
        const type = DS.types[col];
        const vals = DS.raw.map(r => r[col]).filter(v => v !== null && v !== undefined && v !== '');
        const uniq = new Set(vals).size;
        const miss = DS.raw.length - vals.length;
        const typeBadge = type === 'numeric' ? 'num' : type === 'date' ? 'date' : 'cat';
        const typeLabel = type === 'numeric' ? 'NUM' : type === 'date' ? 'DATE' : 'CAT';
        return `<div class="report-row">
          <span class="report-row-label"><span class="type-badge ${typeBadge}">${typeLabel}</span>&nbsp;&nbsp;${col}</span>
          <span class="report-row-value" style="color:var(--text-muted)">${uniq.toLocaleString()} unique · ${miss} missing</span>
        </div>`;
      }).join('')}
    </div>`;

  el('reportActions').style.display = 'flex';
}

function exportReport() {
  const content = el('reportContainer').innerHTML;
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Nexus Analytics Report</title>
<style>
  body{font-family:-apple-system,sans-serif;background:#0D1117;color:#E6EDF3;padding:40px;max-width:900px;margin:0 auto}
  :root{--accent:#E8FF47;--bg-2:#161B22;--bg-3:#1C2333;--border:#2A3347;--text-primary:#E6EDF3;
  --text-secondary:#8B949E;--text-muted:#4D5869;--red:#FF6B6B;--green:#3DDC84;--blue:#58A6FF;
  --purple:#BC8CFF;--orange:#F78166;--mono:'Courier New',monospace;--radius:6px;--radius-lg:10px}
  .report-section{background:var(--bg-2);border:1px solid var(--border);border-radius:10px;padding:20px 24px;margin-bottom:16px}
  .report-section-title{font-size:12px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border)}
  .report-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(42,51,71,0.4);font-size:13px}
  .report-row-label{color:var(--text-secondary)}.report-row-value{font-family:var(--mono);font-weight:600}
  .report-insight{display:flex;gap:12px;padding:10px 14px;background:var(--bg-3);border-radius:6px;margin-top:8px;font-size:13px;color:var(--text-secondary);line-height:1.5}
  .insight-icon{font-size:16px;flex-shrink:0}.type-badge{display:inline-block;padding:1px 7px;border-radius:10px;font-size:10px;font-weight:600}
  .type-badge.num{background:rgba(88,166,255,0.15);color:#58A6FF}.type-badge.cat{background:rgba(188,140,255,0.15);color:#BC8CFF}.type-badge.date{background:rgba(61,220,132,0.15);color:#3DDC84}
  .profile-table{width:100%;border-collapse:collapse;font-size:12px}
  .profile-table th{background:var(--bg-3);color:var(--text-muted);text-align:left;padding:6px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.7px;font-weight:600;border-bottom:1px solid var(--border)}
  .profile-table td{padding:7px 10px;border-bottom:1px solid rgba(42,51,71,0.5);color:var(--text-secondary);font-family:var(--mono)}
  h1{font-size:28px;font-weight:800;margin-bottom:4px}p{color:var(--text-secondary);margin-bottom:32px}
</style></head><body>
<h1>Nexus Analytics Report</h1>
<p>Exported from Nexus Analytics Industrial Analytics Platform</p>
${content}
</body></html>`;
  downloadFile('nexus_analytics_report.html', html, 'text/html');
  showToast('Report exported.', 'success');
}

// ── NAV / VIEW SWITCHING ──────────────────────────────────
function switchView(view, anchor) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  el('view-' + view).classList.add('active');
  anchor.classList.add('active');
  const labels = { dashboard: 'Overview', explorer: 'Data Explorer', analytics: 'Analytics', correlation: 'Correlation', reports: 'Reports', sql: 'SQL Console', forecast: 'Forecast' };
  el('breadcrumb').textContent = labels[view] || view;
}

function toggleSidebar() {
  el('sidebar').classList.toggle('open');
}

// ── UTILITIES ─────────────────────────────────────────────
function el(id) { return document.getElementById(id); }

function showToast(msg, type = '') {
  const t = el('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  setTimeout(() => { t.className = 'toast'; }, 3200);
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── INIT ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initSQLJS();
});

// ── SQL CONSOLE ───────────────────────────────────────────
let _SQL = null;
let sqlDB = null;

async function initSQLJS() {
  if (_SQL) return;
  try {
    _SQL = await initSqlJs({
      locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/${file}`
    });
  } catch (e) {
    console.warn('SQL.js failed to load:', e);
  }
}

function buildSQLTable() {
  if (!_SQL) { initSQLJS().then(buildSQLTable); return; }
  if (!DS.raw.length) return;

  if (sqlDB) { sqlDB.close(); sqlDB = null; }
  sqlDB = new _SQL.Database();

  // Quote column names to handle spaces / special chars
  const qCols = DS.headers.map(h => `"${h.replace(/"/g, '_')}"`);
  const types  = DS.headers.map(h => DS.types[h] === 'numeric' ? 'REAL' : 'TEXT');
  sqlDB.run(`CREATE TABLE data (${qCols.map((c, i) => `${c} ${types[i]}`).join(', ')})`);

  const placeholders = DS.headers.map(() => '?').join(', ');
  const stmt = sqlDB.prepare(`INSERT INTO data VALUES (${placeholders})`);
  DS.raw.forEach(row => stmt.run(DS.headers.map(h => row[h] ?? null)));
  stmt.free();

  updateSQLBadge();
}

function updateSQLBadge() {
  const badge = el('sqlDbBadge');
  if (badge) {
    badge.textContent = `⬡ table: data  (${DS.raw.length.toLocaleString()} rows × ${DS.headers.length} cols)`;
    badge.style.color = 'var(--green)';
  }

  const bar = el('sqlChipsBar');
  if (!bar) return;

  const numCol = numericCols()[0];
  const catCol = categoricalCols()[0];
  const chips = [
    `SELECT * FROM data LIMIT 10`,
    `SELECT COUNT(*) AS total FROM data`,
    numCol ? `SELECT AVG("${numCol}"), MIN("${numCol}"), MAX("${numCol}") FROM data` : null,
    catCol ? `SELECT "${catCol}", COUNT(*) AS cnt FROM data GROUP BY "${catCol}" ORDER BY cnt DESC LIMIT 8` : null,
    numCol ? `SELECT * FROM data ORDER BY "${numCol}" DESC LIMIT 5` : null,
    DS.headers.length >= 2 ? `SELECT "${DS.headers[0]}", "${DS.headers[1]}" FROM data LIMIT 20` : null,
  ].filter(Boolean);

  bar.innerHTML =
    `<span style="color:var(--text-muted);font-size:11px;flex-shrink:0">Quick:</span>` +
    chips.map(q => `<button class="sql-chip" onclick="loadSQLChip(this)">${q}</button>`).join('');
}

function loadSQLChip(btn) {
  el('sqlEditor').value = btn.textContent;
  runSQL();
}

function runSQL() {
  if (!sqlDB) {
    setSQLResult(`<div class="sql-error"><span class="sql-err-icon">⚠</span>No dataset loaded. Import a CSV first.</div>`);
    return;
  }
  const query = (el('sqlEditor').value || '').trim();
  if (!query) return;

  const t0 = performance.now();
  try {
    const results = sqlDB.exec(query);
    const ms = (performance.now() - t0).toFixed(1);

    if (!results.length) {
      setSQLResult(`<div class="sql-result-meta success">✓ Query executed — no rows returned (${ms} ms)</div>`);
      return;
    }

    const { columns, values } = results[0];
    const head = `<tr>${columns.map(c => `<th>${c}</th>`).join('')}</tr>`;
    const body = values.map(row =>
      `<tr>${row.map(v => `<td>${v === null ? '<span class="null-val">NULL</span>' : v}</td>`).join('')}</tr>`
    ).join('');

    setSQLResult(`
      <div class="sql-result-meta">${values.length.toLocaleString()} row${values.length !== 1 ? 's' : ''} &nbsp;·&nbsp; ${ms} ms</div>
      <div class="table-wrap" style="max-height:420px;overflow:auto">
        <table class="data-table"><thead>${head}</thead><tbody>${body}</tbody></table>
      </div>`);
  } catch (e) {
    setSQLResult(`<div class="sql-error"><span class="sql-err-icon">⚠</span>${e.message}</div>`);
  }
}

function setSQLResult(html) {
  const panel = el('sqlResultsPanel');
  if (panel) panel.innerHTML = html;
}

function clearSQLEditor() {
  el('sqlEditor').value = '';
  setSQLResult('<div class="empty-state">Run a query to see results.</div>');
}

// Ctrl+Enter / Cmd+Enter to run from editor
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && document.activeElement === el('sqlEditor')) {
    e.preventDefault();
    runSQL();
  }
});

// ── FORECAST (LINEAR REGRESSION) ─────────────────────────
function buildForecastView() {
  const numCols = numericCols();
  const controls = el('forecastControls');
  const layout   = el('forecastLayout');
  if (!controls) return;

  if (numCols.length < 2) {
    controls.innerHTML = '<div class="empty-state">Load a dataset with at least 2 numeric columns to begin.</div>';
    if (layout) layout.style.display = 'none';
    return;
  }

  // Build column selector row
  const makeOptions = (selected) =>
    numCols.map(c => `<option${c === selected ? ' selected' : ''}>${c}</option>`).join('');

  controls.innerHTML = `
    <div class="forecast-col-row">
      <label class="forecast-col-label">
        <span class="forecast-col-badge x-badge">X</span>
        Predictor (independent)
        <select class="ctrl-select" id="forecastXSel" onchange="renderForecast()">${makeOptions(numCols[0])}</select>
      </label>
      <div class="forecast-arrow-sep">→</div>
      <label class="forecast-col-label">
        <span class="forecast-col-badge y-badge">Y</span>
        Response (dependent)
        <select class="ctrl-select" id="forecastYSel" onchange="renderForecast()">${makeOptions(numCols[1] || numCols[0])}</select>
      </label>
    </div>`;

  if (layout) layout.style.display = 'grid';
  renderForecast();
}

function renderForecast() {
  const xCol = el('forecastXSel')?.value;
  const yCol = el('forecastYSel')?.value;
  if (!xCol || !yCol || !DS.raw.length) return;

  // Build aligned numeric pairs
  const pairs = DS.raw
    .map(r => [r[xCol], r[yCol]])
    .filter(([x, y]) => typeof x === 'number' && !isNaN(x) && typeof y === 'number' && !isNaN(y));

  if (pairs.length < 3) {
    el('forecastChartMeta').textContent = 'Not enough numeric data pairs for regression.';
    return;
  }

  const xVals = pairs.map(p => p[0]);
  const yVals = pairs.map(p => p[1]);
  const reg   = computeLinearRegression(xVals, yVals);

  const sign = reg.intercept >= 0 ? '+' : '';
  el('forecastChartMeta').textContent =
    `${pairs.length.toLocaleString()} data points  ·  ŷ = ${reg.slope.toFixed(4)}x ${sign}${reg.intercept.toFixed(4)}  ·  R² = ${reg.r2.toFixed(4)}`;
  el('predictXLabel').textContent  = `${xCol} value`;
  el('predictYLabel').textContent  = `Predicted ${yCol}`;
  el('forecastPredWrap').style.display = 'none';
  el('forecastXInput').value = '';

  renderRegressionChart(xVals, yVals, reg, xCol, yCol);
  updateRegressionStats(reg, xCol, yCol);
}

function computeLinearRegression(xVals, yVals) {
  const n     = xVals.length;
  const xMean = xVals.reduce((a, b) => a + b, 0) / n;
  const yMean = yVals.reduce((a, b) => a + b, 0) / n;
  let ssXX = 0, ssXY = 0, ssYY = 0;
  for (let i = 0; i < n; i++) {
    ssXX += (xVals[i] - xMean) ** 2;
    ssXY += (xVals[i] - xMean) * (yVals[i] - yMean);
    ssYY += (yVals[i] - yMean) ** 2;
  }
  const slope     = ssXX ? ssXY / ssXX : 0;
  const intercept = yMean - slope * xMean;
  const r         = (ssXX && ssYY) ? ssXY / Math.sqrt(ssXX * ssYY) : 0;
  const r2        = r * r;
  // Root-mean-squared error
  const mse  = xVals.reduce((acc, x, i) => acc + (yVals[i] - (slope * x + intercept)) ** 2, 0) / n;
  const rmse = Math.sqrt(mse);
  return { slope, intercept, r, r2, rmse, n, xMean, yMean };
}

function renderRegressionChart(xVals, yVals, reg, xCol, yCol) {
  destroyChart('chartForecast');

  // Sample for performance — max 400 scatter points
  const step    = xVals.length > 400 ? Math.ceil(xVals.length / 400) : 1;
  const scatter = xVals
    .filter((_, i) => i % step === 0)
    .map((x, si) => ({ x, y: yVals[si * step] }));

  const xMin = Math.min(...xVals), xMax = Math.max(...xVals);
  const lineData = [
    { x: xMin, y: reg.slope * xMin + reg.intercept },
    { x: xMax, y: reg.slope * xMax + reg.intercept },
  ];

  const sign = reg.intercept >= 0 ? '+' : '';
  DS.charts['chartForecast'] = new Chart(el('chartForecast'), {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: `Data (${xCol} vs ${yCol})`,
          data: scatter,
          backgroundColor: 'rgba(88,166,255,0.28)',
          borderColor:     'rgba(88,166,255,0.55)',
          pointRadius: 3.5,
          pointHoverRadius: 6,
        },
        {
          label: `ŷ = ${reg.slope.toFixed(3)}x ${sign}${reg.intercept.toFixed(3)}`,
          data: lineData,
          type: 'line',
          borderColor: '#E8FF47',
          borderWidth: 2.5,
          pointRadius: 0,
          fill: false,
          tension: 0,
        },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 250 },
      plugins: {
        legend: { display: true, labels: { color: '#8B949E', font: { size: 11 }, boxWidth: 14 } },
        tooltip: {
          callbacks: {
            label: ctx => {
              if (ctx.raw.y !== undefined && ctx.raw.x !== undefined)
                return ` (${fmt(ctx.raw.x, 2)}, ${fmt(ctx.raw.y, 2)})`;
              return '';
            }
          },
          backgroundColor: '#1C2333', borderColor: '#2A3347', borderWidth: 1,
        }
      },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: xCol, color: '#8B949E', font: { size: 11 } },
          grid: { color: '#2A3347' }, ticks: { color: '#4D5869' },
        },
        y: {
          title: { display: true, text: yCol, color: '#8B949E', font: { size: 11 } },
          grid: { color: '#2A3347' }, ticks: { color: '#4D5869' },
        }
      }
    }
  });
}

function updateRegressionStats(reg, xCol, yCol) {
  const sign = reg.intercept >= 0 ? ' +' : ' ';
  el('regEquation').textContent  = `ŷ = ${reg.slope.toFixed(4)} · x${sign}${reg.intercept.toFixed(4)}`;
  el('regR2').textContent        = reg.r2.toFixed(4);
  el('regR').textContent         = reg.r.toFixed(4);
  el('regSlope').textContent     = reg.slope.toFixed(4);
  el('regIntercept').textContent = reg.intercept.toFixed(4);
  el('regRMSE').textContent      = fmt(reg.rmse, 3);
  el('regN').textContent         = reg.n.toLocaleString();

  const [label, cls] =
    reg.r2 >= 0.9 ? ['Excellent fit', 'up']  :
    reg.r2 >= 0.7 ? ['Good fit',      'up']  :
    reg.r2 >= 0.4 ? ['Moderate fit',  'warn'] :
                    ['Weak fit — try different columns', 'down'];

  const q = el('regQuality');
  q.textContent = `R² = ${reg.r2.toFixed(3)}  ·  ${label}`;
  q.className   = `kpi-delta ${cls}`;

  DS._reg = { ...reg, xCol, yCol };
}

function predictForecast() {
  if (!DS._reg) return;
  const xInput = parseFloat(el('forecastXInput').value);
  if (isNaN(xInput)) { el('forecastPredWrap').style.display = 'none'; return; }
  const predicted = DS._reg.slope * xInput + DS._reg.intercept;
  el('forecastPredResult').textContent = fmtFull(predicted, 4);
  el('forecastPredWrap').style.display = 'block';
}
