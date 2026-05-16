'use strict';

// ── Colour constants ──────────────────────────────────────────────────────
// Bivariate encoding:
//   Hue       = % female among candidates with known gender  (blue=male → pink=female)
//   Saturation = confidence = 1 − (unknown / total)          (grey = all unknown)
const C_MALE    = [33,  113, 181];   // #2171b5
const C_FEMALE  = [214,  73, 111];   // #d6496f
const C_UNKNOWN = [173, 181, 189];   // #adb5bd
const C_NODATA  = [220, 220, 222];   // light grey for LADs with no election data

function lerp3(a, b, t) {
  t = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function toHex([r, g, b]) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

/**
 * Given counts of female/male/unknown candidates:
 *  1. Compute hue from % female among *known* (lerp MALE→FEMALE)
 *  2. Blend that hue toward grey in proportion to unknown/total
 *
 * Effect: "0% female, 100% male" = deep blue
 *         "0% female, 50% unknown" = washed blue-grey
 *         "50% female, 50% unknown" = washed purple-grey
 */
function councilColor(female, male, unknown) {
  const known = female + male;
  const total = known + unknown;
  if (total === 0) return toHex(C_NODATA);

  const femalePct    = known > 0 ? female / known : 0.5;
  const genderRGB    = lerp3(C_MALE, C_FEMALE, femalePct);
  const unknownRatio = unknown / total;
  return toHex(lerp3(genderRGB, C_UNKNOWN, unknownRatio));
}

// ── App state ─────────────────────────────────────────────────────────────
let appData        = null;
let ladLookup      = {};   // lad_code → council data object
let leafletMap     = null;
let geojsonLayer   = null;
let currentMapMode = 'candidates';
let tableData      = [];
let tableSortCol   = 'org_name';
let tableSortDir   = 'asc';
const wardDataCache = new Map();

// ── Boot ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  fetch('data/councils.json')
    .then(r => r.json())
    .then(data => {
      appData = data;
      buildLadLookup();
      renderSummaryCards();
      initMap();
      renderPartyCharts();
      renderRegionCharts();
      initTable();
      wireMapToggle();
    })
    .catch(err => {
      document.querySelector('main').innerHTML =
        `<div style="padding:40px;color:#c00">
           <strong>Failed to load data.</strong><br>
           ${err.message}<br><br>
           Serve the <code>docs/</code> folder with a local HTTP server:<br>
           <code>py -m http.server 8080 --directory docs</code>
         </div>`;
    });
});

// ── Helpers ───────────────────────────────────────────────────────────────
function buildLadLookup() {
  for (const c of appData.by_council) {
    if (c.lad_code) ladLookup[c.lad_code] = c;
  }
}

function fmt(n) {
  if (n === null || n === undefined) return '—';
  return typeof n === 'number' ? n.toLocaleString() : n;
}

function pctStr(n, d) {
  if (!d || n === null || n === undefined) return '—';
  return (n / d * 100).toFixed(1) + '%';
}

// ── Summary cards ─────────────────────────────────────────────────────────
function renderSummaryCards() {
  const s = appData.summary;
  const knownCands   = s.female_candidates + s.male_candidates;
  const knownElected = s.elected_female    + s.elected_male;

  const cards = [
    {
      value: s.total_candidates.toLocaleString(),
      cls: '',
      label: 'Total candidates',
      sub: s.elected_total.toLocaleString() + ' elected',
    },
    {
      value: s.pct_female + '%',
      cls: 'female',
      label: '% Female candidates',
      sub: `${s.female_candidates.toLocaleString()} of ${knownCands.toLocaleString()} with known gender`,
    },
    {
      value: s.pct_female_elected + '%',
      cls: 'female',
      label: '% Female elected',
      sub: `${s.elected_female.toLocaleString()} of ${knownElected.toLocaleString()} with known gender`,
    },
    {
      value: s.unknown_candidates.toLocaleString(),
      cls: 'unknown',
      label: 'Uncategorised gender',
      sub: pctStr(s.unknown_candidates, s.total_candidates) + ' of all candidates',
    },
  ];

  document.getElementById('summary-cards').innerHTML = cards.map(c => `
    <div class="card">
      <div class="card-value ${c.cls}">${c.value}</div>
      <div class="card-label">${c.label}</div>
      <div class="card-sub">${c.sub}</div>
    </div>
  `).join('');
}

// ── Map ───────────────────────────────────────────────────────────────────
function initMap() {
  leafletMap = L.map('map', { zoomSnap: 0.5 }).setView([52.9, -1.6], 6);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 14,
  }).addTo(leafletMap);

  // Label layer on top so it renders above the choropleth fill
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
    attribution: '',
    subdomains: 'abcd',
    maxZoom: 14,
    pane: 'shadowPane',
  }).addTo(leafletMap);

  fetch('data/LAD_boundaries.geojson')
    .then(r => r.json())
    .then(gj => {
      geojsonLayer = L.geoJSON(gj, {
        style:          styleFeature,
        onEachFeature:  onEachFeature,
      }).addTo(leafletMap);
    });
}

function getModeCounts(council, mode) {
  if (mode === 'elected') {
    return {
      female:  council.elected_female  || 0,
      male:    council.elected_male    || 0,
      unknown: council.elected_unknown || 0,
      total:   council.elected_total   || 0,
    };
  }
  return {
    female:  council.female,
    male:    council.male,
    unknown: council.unknown,
    total:   council.total,
  };
}

function styleFeature(feature) {
  const council = ladLookup[feature.properties.LAD25CD];
  let fillColor;
  if (!council) {
    fillColor = toHex(C_NODATA);
  } else {
    const { female, male, unknown } = getModeCounts(council, currentMapMode);
    fillColor = councilColor(female, male, unknown);
  }
  return { fillColor, fillOpacity: 0.85, color: '#fff', weight: 0.5 };
}

function onEachFeature(feature, layer) {
  layer.on({
    mouseover() {
      layer.setStyle({ weight: 2, color: '#333', fillOpacity: 1 });
      layer.bringToFront();
      updateInfoBox(feature);
    },
    mouseout() {
      geojsonLayer.resetStyle(layer);
      updateInfoBox(null);
    },
    click() { updateInfoBox(feature); },
  });
}

function updateInfoBox(feature) {
  const box = document.getElementById('map-info');
  if (!feature) {
    box.innerHTML = '<span class="map-info-placeholder">Hover or click a council area</span>';
    return;
  }

  const council = ladLookup[feature.properties.LAD25CD];
  if (!council) {
    box.innerHTML = `<strong>${feature.properties.LAD25NM}</strong>
      <span style="color:#aaa;font-size:.78rem">No election data in this dataset</span>`;
    return;
  }

  const unknownPct = Math.round(council.unknown / council.total * 100);
  const warnHtml   = unknownPct >= 30
    ? `<div class="mi-warn">&#9888; ${unknownPct}% Uncategorised gender — treat percentages with caution</div>`
    : '';
  const femalePctStr   = council.pct_female         !== null ? council.pct_female + '%'         : '—';
  const electedPctStr  = council.pct_female_elected !== null ? council.pct_female_elected + '%' : '—';

  box.innerHTML = `
    <strong>${council.org_name}</strong>
    <table class="mi-table">
      <tr><td class="mi-section" colspan="2">Candidates (${council.total})</td></tr>
      <tr><td>Female</td><td>${council.female} <span style="color:#c9304f">(${femalePctStr})</span></td></tr>
      <tr><td>Male</td><td>${council.male}</td></tr>
      <tr><td>Uncategorised</td><td>${council.unknown} (${unknownPct}%)</td></tr>
      <tr><td class="mi-section" colspan="2">Elected (${council.elected_total})</td></tr>
      <tr><td>Female</td><td>${council.elected_female} <span style="color:#c9304f">(${electedPctStr})</span></td></tr>
      <tr><td>Male</td><td>${council.elected_male}</td></tr>
    </table>
    ${council.avg_turnout ? `<div style="margin-top:5px;font-size:.77rem;color:#666">Avg turnout: ${council.avg_turnout}%</div>` : ''}
    ${warnHtml}
  `;
}

function wireMapToggle() {
  document.getElementById('map-toggle').addEventListener('click', e => {
    const btn = e.target.closest('.toggle');
    if (!btn) return;
    document.querySelectorAll('#map-toggle .toggle').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentMapMode = btn.dataset.mode;
    if (geojsonLayer) geojsonLayer.setStyle(styleFeature);
  });
}

// ── Charts ────────────────────────────────────────────────────────────────
const COL_FEMALE  = '#d6496f';
const COL_MALE    = '#2171b5';
const COL_UNKNOWN = '#b0bec5';

/**
 * For each item, compute [female%, male%, unknown%] as stacked percentages.
 * Stores raw counts as parallel arrays for tooltip use.
 */
function toStackedPct(items, fKey, mKey, uKey) {
  return items.map(item => {
    const f = item[fKey] || 0;
    const m = item[mKey] || 0;
    const u = item[uKey] || 0;
    const t = f + m + u;
    if (t === 0) return { f: 0, m: 0, u: 0, nf: 0, nm: 0, nu: 0, t: 0 };
    return {
      f: +(f / t * 100).toFixed(1),
      m: +(m / t * 100).toFixed(1),
      u: +(u / t * 100).toFixed(1),
      nf: f, nm: m, nu: u, t,
    };
  });
}

function buildChart(canvasId, scrollId, labels, rows) {
  const BAR_H  = 30;
  const FOOTER = 55;
  const height = Math.max(180, labels.length * BAR_H + FOOTER);
  const scroll = document.getElementById(scrollId);
  if (scroll) { scroll.style.height = height + 'px'; }

  const canvas = document.getElementById(canvasId);

  const makeDataset = (label, key, color, rows) => ({
    label,
    data: rows.map(r => r[key]),
    backgroundColor: color,
    // store raw counts and totals as extra arrays for tooltip
    _rawN: rows.map(r => r['n' + key] !== undefined ? r['n' + key] : (key === 'f' ? r.nf : key === 'm' ? r.nm : r.nu)),
    _totN: rows.map(r => r.t),
  });

  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        makeDataset('Female',  'f', COL_FEMALE,  rows),
        makeDataset('Male',    'm', COL_MALE,    rows),
        makeDataset('Uncategorised', 'u', COL_UNKNOWN, rows),
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: {
          stacked: true, min: 0, max: 100,
          ticks: { callback: v => v + '%', maxTicksLimit: 6, font: { size: 11 } },
          grid: { color: '#eaecf0' },
          border: { display: false },
        },
        y: {
          stacked: true,
          ticks: {
            font: { size: 11 },
            callback: (val, i) => {
              const lbl = labels[i];
              return lbl.length > 30 ? lbl.slice(0, 28) + '…' : lbl;
            },
          },
          grid: { display: false },
        },
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 12, font: { size: 11 }, padding: 10 },
        },
        tooltip: {
          callbacks: {
            label(ctx) {
              const i  = ctx.dataIndex;
              const ds = ctx.dataset;
              const n  = ds._rawN ? ds._rawN[i] : '?';
              const t  = ds._totN ? ds._totN[i] : '?';
              return ` ${ds.label}: ${ctx.parsed.x.toFixed(1)}%  (${n.toLocaleString()} of ${t.toLocaleString()})`;
            },
          },
        },
      },
    },
  });
}

function renderPartyCharts() {
  const parties = appData.by_party;
  const labels  = parties.map(p => p.party);

  buildChart(
    'chart-party-cands',   'scroll-party-cands',
    labels, toStackedPct(parties, 'female', 'male', 'unknown')
  );
  buildChart(
    'chart-party-elected', 'scroll-party-elected',
    labels, toStackedPct(parties, 'elected_female', 'elected_male', 'elected_unknown')
  );
}

function renderRegionCharts() {
  const regions = appData.by_region;
  const labels  = regions.map(r => r.region);

  buildChart(
    'chart-region-cands',   'scroll-region-cands',
    labels, toStackedPct(regions, 'female', 'male', 'unknown')
  );
  buildChart(
    'chart-region-elected', 'scroll-region-elected',
    labels, toStackedPct(regions, 'elected_female', 'elected_male', 'elected_unknown')
  );
}

// ── Council table ─────────────────────────────────────────────────────────
function initTable() {
  tableData = appData.by_council;
  renderTable();

  wireModalHandlers();

  document.getElementById('table-body').addEventListener('click', e => {
    const row = e.target.closest('tr[data-council-slug]');
    if (!row) return;
    const slug = row.dataset.councilSlug;
    const council = tableData.find(c => c.ward_slug === slug);
    if (council) openCouncilDrilldown(council);
  });

  document.getElementById('table-search').addEventListener('input', e => {
    renderTable(e.target.value.trim().toLowerCase());
  });

  document.querySelectorAll('#council-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (tableSortCol === col) {
        tableSortDir = tableSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        tableSortCol = col;
        tableSortDir = col === 'org_name' ? 'asc' : 'desc';
      }
      document.querySelectorAll('#council-table th.sortable').forEach(h => {
        h.classList.remove('sorted-asc', 'sorted-desc');
      });
      th.classList.add(tableSortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
      renderTable(document.getElementById('table-search').value.trim().toLowerCase());
    });
  });

  // Set initial sort indicator
  const defaultTh = document.querySelector('#council-table th[data-col="org_name"]');
  if (defaultTh) defaultTh.classList.add('sorted-asc');
}

function renderTable(filter = '') {
  let rows = filter
    ? tableData.filter(c => c.org_name.toLowerCase().includes(filter))
    : tableData.slice();

  rows.sort((a, b) => {
    let va = a[tableSortCol];
    let vb = b[tableSortCol];
    const nullVal = tableSortDir === 'asc' ? Infinity : -Infinity;
    if (va === null || va === undefined) va = nullVal;
    if (vb === null || vb === undefined) vb = nullVal;
    if (typeof va === 'string') {
      return tableSortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    }
    return tableSortDir === 'asc' ? va - vb : vb - va;
  });

  document.getElementById('table-body').innerHTML = rows.map(c => {
    const unknownPct = c.total > 0 ? Math.round(c.unknown / c.total * 100) : 0;

    const pctCls = p => {
      if (p === null || p === undefined) return 'pct-neutral';
      return p >= 50 ? 'pct-high-female' : p < 30 ? 'pct-high-male' : 'pct-neutral';
    };

    const unknownCell = unknownPct >= 30
      ? `<span class="unknown-cell">${c.unknown}</span><span class="unknown-badge">&#9888;&nbsp;${unknownPct}%</span>`
      : `${c.unknown}`;

    const turnout = c.avg_turnout !== null ? c.avg_turnout + '%' : '—';

    return `<tr data-council-slug="${c.ward_slug || ''}">
      <td>${c.org_name}</td>
      <td>${c.total}</td>
      <td>${c.female}</td>
      <td class="pct-cell ${pctCls(c.pct_female)}">${c.pct_female !== null ? c.pct_female + '%' : '—'}</td>
      <td>${unknownCell}</td>
      <td>${c.elected_total}</td>
      <td>${c.elected_female}</td>
      <td class="pct-cell ${pctCls(c.pct_female_elected)}">${c.pct_female_elected !== null ? c.pct_female_elected + '%' : '—'}</td>
      <td>${turnout}</td>
    </tr>`;
  }).join('');
}

// ── Ward drilldown modal ─────────────────────────────────────────────────
function wireModalHandlers() {
  const overlay = document.getElementById('modal-overlay');
  const closeBtn = document.getElementById('modal-close');

  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !overlay.hidden) closeModal();
  });
}

function openModal(title, html) {
  const overlay = document.getElementById('modal-overlay');
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = html;
  overlay.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modal-overlay').hidden = true;
  document.body.style.overflow = '';
}

async function openCouncilDrilldown(council) {
  if (!council.ward_slug) {
    openModal(council.org_name, '<p>No ward-level file is available for this council.</p>');
    return;
  }

  openModal(council.org_name, '<p>Loading ward data...</p>');

  try {
    let payload = wardDataCache.get(council.ward_slug);
    if (!payload) {
      const response = await fetch(`data/wards/${encodeURIComponent(council.ward_slug)}.json`);
      if (!response.ok) throw new Error(`Failed to load ward file (${response.status})`);
      payload = await response.json();
      wardDataCache.set(council.ward_slug, payload);
    }
    renderWardList(council, payload);
  } catch (err) {
    openModal(council.org_name, `<p style="color:#b00020">Could not load ward data: ${err.message}</p>`);
  }
}

function renderWardList(council, payload) {
  const wards = (payload.wards || []).slice().sort((a, b) => a.ward.localeCompare(b.ward));
  if (!wards.length) {
    openModal(council.org_name, '<p>No ward-level rows found for this council.</p>');
    return;
  }

  const cards = wards.map((ward, i) => {
    const counts = ward.candidates.reduce((acc, c) => {
      if (c.g === 'female') acc.f += 1;
      else if (c.g === 'male') acc.m += 1;
      else acc.u += 1;
      return acc;
    }, { f: 0, m: 0, u: 0 });

    const turnout = ward.turnout_pct !== null && ward.turnout_pct !== undefined
      ? `Turnout: ${ward.turnout_pct}%`
      : 'Turnout: —';

    return `
      <button class="ward-btn" data-ward-index="${i}">
        <strong>${ward.ward}</strong>
        <div class="ward-meta">Seats: ${ward.seats || '—'} | Candidates: ${ward.candidates.length}</div>
        <div class="ward-meta">F ${counts.f} | M ${counts.m} | U ${counts.u}</div>
        <div class="ward-meta">${turnout}</div>
      </button>
    `;
  }).join('');

  openModal(council.org_name, `<div class="ward-grid">${cards}</div>`);

  const body = document.getElementById('modal-body');
  body.querySelectorAll('.ward-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const ward = wards[Number(btn.dataset.wardIndex)];
      openWardDetail(council, payload, ward);
    });
  });
}

function formatGenderLabel(g) {
  if (g === 'female') return { text: 'Female', cls: 'gender-f' };
  if (g === 'male') return { text: 'Male', cls: 'gender-m' };
  return { text: 'Uncategorised', cls: 'gender-u' };
}

function formatMethodLabel(method) {
  const methodText = {
    existing: 'Recorded',
    gender_guesser: 'gender_guesser',
    ons: 'ONS names',
    claude: 'Claude AI',
    unknown: 'Uncategorised',
  };
  const text = methodText[method] || method || 'Uncategorised';
  return `<span class="method-badge method-${method || 'unknown'}">${text}</span>`;
}

function openWardDetail(council, payload, ward) {
  const candidates = (ward.candidates || []).slice().sort((a, b) => {
    const ar = a.r || 9999;
    const br = b.r || 9999;
    if (ar !== br) return ar - br;
    return (a.n || '').localeCompare(b.n || '');
  });

  const totalVotes = candidates.reduce((sum, c) => sum + (Number(c.v) || 0), 0);

  const rows = candidates.map(c => {
    const pct = totalVotes > 0 ? ((Number(c.v) || 0) / totalVotes * 100).toFixed(1) + '%' : '—';
    const g = formatGenderLabel(c.g);
    const electedCell = c.e
      ? '<span class="elected-tick">&#10003;</span>'
      : '<span class="not-elected-cross">&#10007;</span>';

    return `
      <tr class="${c.e ? 'elected-row' : ''}">
        <td>${c.n || '—'}</td>
        <td>${c.p || '—'}</td>
        <td class="num">${c.v !== null && c.v !== undefined ? Number(c.v).toLocaleString() : '—'}</td>
        <td class="num">${pct}</td>
        <td class="num">${electedCell}</td>
        <td><span class="${g.cls}">${g.text}</span></td>
        <td>${formatMethodLabel(c.m)}</td>
      </tr>
    `;
  }).join('');

  const turnout = ward.turnout_pct !== null && ward.turnout_pct !== undefined
    ? `${ward.turnout_pct}%`
    : '—';

  const html = `
    <button class="modal-back" id="modal-back">&#8592; Back to wards</button>
    <div class="ward-results-title">${ward.ward}</div>
    <div class="ward-results-meta">Seats: ${ward.seats || '—'} | Candidates: ${candidates.length} | Turnout: ${turnout}</div>
    <table class="results-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Party</th>
          <th class="num">Votes</th>
          <th class="num">%</th>
          <th class="num">Elected</th>
          <th>Gender</th>
          <th>Assignment method</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  openModal(`${council.org_name} - ${ward.ward}`, html);
  document.getElementById('modal-back').addEventListener('click', () => {
    renderWardList(council, payload);
  });
}
