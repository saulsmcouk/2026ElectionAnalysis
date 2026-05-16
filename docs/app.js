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
function councilColor(female, male, conf_low, conf_medium, total) {
  const known = female + male;
  if (total === 0) return toHex(C_NODATA);

  const femalePct = known > 0 ? female / known : 0.5;
  const genderRGB = lerp3(C_MALE, C_FEMALE, femalePct);
  // Saturation driven by confidence, not unknowns.
  // conf_low pulls fully to grey; conf_medium pulls half-way.
  const greyRatio = total > 0 ? (conf_low + conf_medium * 0.5) / total : 0;
  return toHex(lerp3(genderRGB, C_UNKNOWN, greyRatio));
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
const wardDataCache      = new Map();
let selectedCouncilName  = null;  // org_name of selected council, or null
let selectedPartyName    = null;  // party name of selected bar, or null
let councilPartyData     = null;  // aggregated partyMap from current council's ward JSON
const chartRegistry      = {};    // canvasId → Chart.js instance

// ── Boot ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  fetch('data/councils.json?v=' + Date.now())
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

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
    // Confidence not tracked per elected subset — use zero so map stays vivid
    return {
      female:    council.elected_female  || 0,
      male:      council.elected_male    || 0,
      total:     council.elected_total   || 0,
      conf_low:  0,
      conf_medium: 0,
    };
  }
  return {
    female:    council.female,
    male:      council.male,
    total:     council.total,
    conf_low:  council.conf_low  || 0,
    conf_medium: council.conf_medium || 0,
  };
}

function styleFeature(feature) {
  const council = ladLookup[feature.properties.LAD25CD];
  let fillColor;
  if (!council) {
    fillColor = toHex(C_NODATA);
  } else {
    const { female, male, conf_low, conf_medium, total } = getModeCounts(council, currentMapMode);
    fillColor = councilColor(female, male, conf_low, conf_medium, total);
  }
  const isSelected = council && council.org_name === selectedCouncilName;
  const dimmed     = selectedCouncilName && !isSelected;
  return {
    fillColor,
    fillOpacity: dimmed ? 0.3 : 0.85,
    color:  isSelected ? '#1a1a2e' : '#fff',
    weight: isSelected ? 3 : 0.5,
  };
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
    click() { updateInfoBox(feature); handleCouncilSelect(feature); },
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

  const femalePctStr  = council.pct_female         !== null ? council.pct_female + '%'         : '—';
  const electedPctStr = council.pct_female_elected !== null ? council.pct_female_elected + '%' : '—';
  const highConfPct   = council.pct_high_conf      !== null ? council.pct_high_conf + '%'      : '—';
  const unclassified  = council.unknown || 0;

  const unclassRow = unclassified > 0
    ? `<tr><td>Unclassified</td><td style="color:#aaa">${unclassified}</td></tr>`
    : '';

  box.innerHTML = `
    <strong>${council.org_name}</strong>
    <table class="mi-table">
      <tr><td class="mi-section" colspan="2">Candidates (${council.total})</td></tr>
      <tr><td>Female</td><td>${council.female} <span style="color:#c9304f">(${femalePctStr})</span></td></tr>
      <tr><td>Male</td><td>${council.male}</td></tr>
      ${unclassRow}
      <tr><td class="mi-section" colspan="2">Elected (${council.elected_total})</td></tr>
      <tr><td>Female</td><td>${council.elected_female} <span style="color:#c9304f">(${electedPctStr})</span></td></tr>
      <tr><td>Male</td><td>${council.elected_male}</td></tr>
    </table>
    ${council.avg_turnout ? `<div style="margin-top:5px;font-size:.77rem;color:#666">Avg turnout: ${council.avg_turnout}%</div>` : ''}
    <div class="mi-conf">Confidence: High ${council.conf_high||0} &middot; Med ${council.conf_medium||0} &middot; Low ${council.conf_low||0} &nbsp;<span class="mi-conf-pct">${highConfPct} high</span></div>
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
// ── Council map selection ────────────────────────────────────────────────
function handleCouncilSelect(feature) {
  const council = ladLookup[feature.properties.LAD25CD];
  if (!council) return;

  if (selectedCouncilName === council.org_name) {
    clearCouncilSelection();
    return;
  }

  selectedPartyName = null;
  const _pd = document.getElementById('party-detail');
  if (_pd) _pd.hidden = true;

  selectedCouncilName = council.org_name;
  geojsonLayer.setStyle(styleFeature);

  document.getElementById('party-heading').innerHTML =
    `By party — <strong>${council.org_name}</strong>` +
    ` <button class="btn-clear-selection" id="btn-clear-selection">✕ All England</button>`;
  document.getElementById('btn-clear-selection').addEventListener('click', clearCouncilSelection);

  renderPartyChartsForCouncil(council);
}

function clearCouncilSelection() {
  selectedPartyName   = null;
  selectedCouncilName = null;
  councilPartyData    = null;
  const _pd = document.getElementById('party-detail');
  if (_pd) _pd.hidden = true;
  if (geojsonLayer) geojsonLayer.setStyle(styleFeature);
  renderPartyCharts();
}

async function renderPartyChartsForCouncil(council) {
  const slug = council.ward_slug;
  if (!slug) {
    ['scroll-party-cands', 'scroll-party-elected'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<p class="chart-msg">No ward-level data for this council.</p>';
    });
    return;
  }
  try {
    let payload = wardDataCache.get(slug);
    if (!payload) {
      const resp = await fetch(`data/wards/${encodeURIComponent(slug)}.json`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      payload = await resp.json();
      wardDataCache.set(slug, payload);
    }
    if (selectedCouncilName !== council.org_name) return;

    const partyMap = {};
    for (const ward of payload.wards || []) {
      const seenParties = new Set();
      for (const cand of ward.candidates || []) {
        const party = cand.p || 'Unknown';
        if (!partyMap[party]) {
          partyMap[party] = {
            party, total: 0, female: 0, male: 0, unknown: 0,
            elected_total: 0, elected_female: 0, elected_male: 0,
            seats_available: 0, wards_stood: 0,
          };
        }
        if (!seenParties.has(party)) {
          seenParties.add(party);
          partyMap[party].seats_available += ward.seats || 0;
          partyMap[party].wards_stood     += 1;
        }
        partyMap[party].total += 1;
        if (cand.g === 'female') {
          partyMap[party].female++;
          if (cand.e) { partyMap[party].elected_female++; partyMap[party].elected_total++; }
        } else if (cand.g === 'male') {
          partyMap[party].male++;
          if (cand.e) { partyMap[party].elected_male++; partyMap[party].elected_total++; }
        } else {
          partyMap[party].unknown++;
          if (cand.e) partyMap[party].elected_total++;
        }
      }
    }
    councilPartyData = partyMap;
    const parties = Object.values(partyMap)
      .sort((a, b) => (b.female + b.male) - (a.female + a.male));
    const labels = parties.map(p => p.party);
    buildChart('chart-party-cands',   'scroll-party-cands',   labels, toStackedPct(parties, 'female', 'male'),                  handlePartySelect);
    buildChart('chart-party-elected', 'scroll-party-elected', labels, toStackedPct(parties, 'elected_female', 'elected_male'), handlePartySelect);
  } catch (err) {
    if (selectedCouncilName !== council.org_name) return;
    document.getElementById('scroll-party-cands').innerHTML =
      `<p class="chart-msg" style="color:#b00020">Could not load ward data: ${err.message}</p>`;
  }
}

// ── Party bar selection ───────────────────────────────────────────────────
function handlePartySelect(name) {
  if (selectedPartyName === name) { clearPartySelection(); return; }
  selectedPartyName = name;

  const source = (councilPartyData && councilPartyData[name])
    ? councilPartyData[name]
    : appData.by_party.find(p => p.party === name);
  if (!source) return;

  buildChart('chart-party-cands',   'scroll-party-cands',   [name], toStackedPct([source], 'female', 'male'),                  handlePartySelect);
  buildChart('chart-party-elected', 'scroll-party-elected', [name], toStackedPct([source], 'elected_female', 'elected_male'), handlePartySelect);
  renderPartyDetail(name);
}

function clearPartySelection() {
  if (!selectedPartyName) return;
  selectedPartyName = null;
  const panel = document.getElementById('party-detail');
  if (panel) panel.hidden = true;

  if (selectedCouncilName && councilPartyData) {
    const parties = Object.values(councilPartyData)
      .sort((a, b) => (b.female + b.male) - (a.female + a.male));
    const labels  = parties.map(p => p.party);
    buildChart('chart-party-cands',   'scroll-party-cands',   labels, toStackedPct(parties, 'female', 'male'),                  handlePartySelect);
    buildChart('chart-party-elected', 'scroll-party-elected', labels, toStackedPct(parties, 'elected_female', 'elected_male'), handlePartySelect);
  } else {
    renderPartyCharts();
  }
}

function renderPartyDetail(name) {
  const panel = document.getElementById('party-detail');
  const s     = appData.summary;
  const isCouncil = !!selectedCouncilName;

  let dr;  // display row
  let sentenceE = '', sentenceF = '';
  let femaleWinRate, maleWinRate;

  if (isCouncil && councilPartyData && councilPartyData[name]) {
    dr = councilPartyData[name];
    femaleWinRate = dr.female > 0 ? +(dr.elected_female / dr.female * 100).toFixed(1) : null;
    maleWinRate   = dr.male   > 0 ? +(dr.elected_male   / dr.male   * 100).toFixed(1) : null;

    const globalRow  = appData.by_party.find(p => p.party === name);
    const natFWR     = s.national_female_win_rate;
    const otherFWR   = globalRow ? globalRow.other_female_win_rate : null;
    const diffOthers = femaleWinRate !== null && otherFWR  !== null ? +(femaleWinRate - otherFWR ).toFixed(1) : null;
    const diffNat    = femaleWinRate !== null && natFWR    !== null ? +(femaleWinRate - natFWR   ).toFixed(1) : null;

    if (diffOthers !== null) {
      const dir = diffOthers >= 0 ? 'higher' : 'lower';
      sentenceE = `In <strong>${escHtml(selectedCouncilName)}</strong>, female <em>${escHtml(name)}</em> candidates had a <strong>${femaleWinRate}% win rate</strong> &mdash; ${Math.abs(diffOthers)}&thinsp;pp ${dir} than other female candidates nationally (${otherFWR}%).`;
    }
    if (diffNat !== null) {
      const verb = diffNat >= 0 ? 'beat' : 'lagged';
      sentenceF = `<em>${escHtml(name)}</em> female win rate here (<strong>${femaleWinRate}%</strong>) ${verb} the national female rate (${natFWR}%) by <strong>${Math.abs(diffNat)}&thinsp;pp</strong>.`;
    }
  } else {
    const gr = appData.by_party.find(p => p.party === name);
    if (!gr) { panel.hidden = true; return; }
    dr            = gr;
    femaleWinRate = gr.female_win_rate;
    maleWinRate   = gr.male_win_rate;

    if (gr.female_win_rate_diff_vs_others !== null && femaleWinRate !== null) {
      const diff = gr.female_win_rate_diff_vs_others;
      const dir  = diff >= 0 ? 'higher' : 'lower';
      sentenceE  = `Nationally, female <em>${escHtml(name)}</em> candidates had a <strong>${femaleWinRate}% win rate</strong> &mdash; ${Math.abs(diff)}&thinsp;pp ${dir} than other female candidates (${gr.other_female_win_rate}%).`;
    }
    if (gr.female_win_rate_diff_vs_national !== null && femaleWinRate !== null) {
      const diff = gr.female_win_rate_diff_vs_national;
      const verb = diff >= 0 ? 'beat' : 'lagged';
      sentenceF  = `<em>${escHtml(name)}</em> female win rate nationally (<strong>${femaleWinRate}%</strong>) ${verb} the overall female rate (${s.national_female_win_rate}%) by <strong>${Math.abs(diff)}&thinsp;pp</strong>.`;
    }
  }

  const fwrStr   = femaleWinRate !== null ? femaleWinRate + '%' : '&mdash;';
  const mwrStr   = maleWinRate   !== null ? maleWinRate   + '%' : '&mdash;';
  const seatsStr = dr.seats_available !== undefined ? dr.seats_available.toLocaleString() : '&mdash;';
  const wardsStr = dr.wards_stood     !== undefined ? dr.wards_stood.toLocaleString()     : '&mdash;';
  const knownN   = (dr.female || 0) + (dr.male || 0);
  const totalN   = dr.total !== undefined ? dr.total : knownN + (dr.unknown || 0);

  panel.innerHTML = `
    <div class="party-detail-header">
      <span class="party-detail-name">${escHtml(name)}</span>
      <button class="btn-clear-party" id="btn-clear-party">&#10005;&nbsp;All parties</button>
    </div>
    <div class="party-stat-grid">
      <div class="party-stat-tile">
        <div class="pst-value">${totalN.toLocaleString()}</div>
        <div class="pst-label">Total candidates</div>
      </div>
      <div class="party-stat-tile">
        <div class="pst-value female">${(dr.female || 0).toLocaleString()}</div>
        <div class="pst-label">Female candidates<br><span class="pst-sub">${pctStr(dr.female, knownN)} of known gender</span></div>
      </div>
      <div class="party-stat-tile">
        <div class="pst-value">${seatsStr}</div>
        <div class="pst-label">Seat-slots contested<br><span class="pst-sub">${wardsStr} wards</span></div>
      </div>
      <div class="party-stat-tile">
        <div class="pst-value">${(dr.elected_total || 0).toLocaleString()}</div>
        <div class="pst-label">Elected</div>
      </div>
      <div class="party-stat-tile">
        <div class="pst-value female">${(dr.elected_female || 0).toLocaleString()}</div>
        <div class="pst-label">Female elected<br><span class="pst-sub">${fwrStr} win rate</span></div>
      </div>
      <div class="party-stat-tile">
        <div class="pst-value male">${(dr.elected_male || 0).toLocaleString()}</div>
        <div class="pst-label">Male elected<br><span class="pst-sub">${mwrStr} win rate</span></div>
      </div>
    </div>
    ${sentenceE ? `<p class="party-sentence">${sentenceE}</p>` : ''}
    ${sentenceF ? `<p class="party-sentence">${sentenceF}</p>` : ''}
    ${buildCandidateSection(name, isCouncil)}
  `;
  panel.querySelector('#btn-clear-party').addEventListener('click', clearPartySelection);
  panel.hidden = false;
}

function buildCandidateSection(name, isCouncil) {
  if (!isCouncil) {
    return `<p class="party-no-cands">&#9432;&nbsp;Select a council on the map to see individual candidates for <em>${escHtml(name)}</em>.</p>`;
  }
  const council = appData.by_council.find(c => c.org_name === selectedCouncilName);
  const payload  = council && wardDataCache.get(council.ward_slug);
  if (!payload) return '';

  const rows = [];
  for (const ward of payload.wards || []) {
    for (const c of ward.candidates || []) {
      if (c.p === name) rows.push({ ...c, ward: ward.ward });
    }
  }
  if (!rows.length) return `<p class="party-no-cands">No candidates found for ${escHtml(name)} in ${escHtml(selectedCouncilName)}.</p>`;

  rows.sort((a, b) => {
    if (a.ward !== b.ward) return a.ward.localeCompare(b.ward);
    return (a.r || 999) - (b.r || 999);
  });

  const rowsHtml = rows.map(c => {
    const g = formatGenderLabel(c.g);
    return `<tr class="${c.e ? 'elected-row' : ''}">
      <td>${escHtml(c.n || '&mdash;')}</td>
      <td>${escHtml(c.ward)}</td>
      <td class="num">${c.v !== null && c.v !== undefined ? Number(c.v).toLocaleString() : '&mdash;'}</td>
      <td class="num">${c.e ? '<span class="elected-tick">&#10003;</span>' : '<span class="not-elected-cross">&#10007;</span>'}</td>
      <td><span class="${g.cls}">${g.text}</span></td>
      <td>${confCell(c.cf)}</td>
    </tr>`;
  }).join('');

  return `
    <div class="party-cands-header">Candidates in <strong>${escHtml(selectedCouncilName)}</strong> &mdash; ${rows.length.toLocaleString()} total</div>
    <div class="party-cands-scroll">
      <table class="results-table">
        <thead><tr>
          <th>Name</th><th>Ward</th>
          <th class="num">Votes</th><th class="num">Elected</th>
          <th>Gender</th><th>Confidence</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;
}

// ── Charts ────────────────────────────────────────────────────────────────
const COL_FEMALE  = '#d6496f';
const COL_MALE    = '#2171b5';
const COL_UNKNOWN = '#b0bec5';

/**
 * For each item, compute [female%, male%] as stacked percentages (known gender only).
 * Stores raw counts as parallel arrays for tooltip use.
 */
function toStackedPct(items, fKey, mKey) {
  return items.map(item => {
    const f = item[fKey] || 0;
    const m = item[mKey] || 0;
    const t = f + m;
    if (t === 0) return { f: 0, m: 0, nf: 0, nm: 0, t: 0 };
    return {
      f: +(f / t * 100).toFixed(1),
      m: +(m / t * 100).toFixed(1),
      nf: f, nm: m, t,
    };
  });
}

function buildChart(canvasId, scrollId, labels, rows, onBarClick) {
  if (chartRegistry[canvasId]) { chartRegistry[canvasId].destroy(); delete chartRegistry[canvasId]; }
  const BAR_H  = 30;
  const FOOTER = 55;
  const height = Math.max(labels.length === 1 ? 110 : 180, labels.length * BAR_H + FOOTER);
  const scroll = document.getElementById(scrollId);
  if (scroll) { scroll.style.height = height + 'px'; }

  const canvas = document.getElementById(canvasId);

  const makeDataset = (label, key, color, rows) => ({
    label,
    data: rows.map(r => r[key]),
    backgroundColor: color,
    _rawN: rows.map(r => key === 'f' ? r.nf : r.nm),
    _totN: rows.map(r => r.t),
  });

  const _chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        makeDataset('Female', 'f', COL_FEMALE, rows),
        makeDataset('Male',   'm', COL_MALE,   rows),
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      onClick: onBarClick ? (evt, elements) => {
        if (!elements.length) return;
        onBarClick(labels[elements[0].index]);
      } : undefined,
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
          position: labels.length === 1 ? 'top' : 'bottom',
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
  chartRegistry[canvasId] = _chart;
  return _chart;
}

function renderPartyCharts() {
  document.getElementById('party-heading').innerHTML =
    'By party <span class="subtitle-small">— parties with ≥30 candidates, sorted by total. Each bar = 100% of that party’s candidates/elected.</span>';

  const parties = appData.by_party;
  const labels  = parties.map(p => p.party);

  buildChart(
    'chart-party-cands',   'scroll-party-cands',
    labels, toStackedPct(parties, 'female', 'male'), handlePartySelect
  );
  buildChart(
    'chart-party-elected', 'scroll-party-elected',
    labels, toStackedPct(parties, 'elected_female', 'elected_male'), handlePartySelect
  );
}

function renderRegionCharts() {
  const regions = appData.by_region;
  const labels  = regions.map(r => r.region);

  buildChart(
    'chart-region-cands',   'scroll-region-cands',
    labels, toStackedPct(regions, 'female', 'male')
  );
  buildChart(
    'chart-region-elected', 'scroll-region-elected',
    labels, toStackedPct(regions, 'elected_female', 'elected_male')
  );
}

// ── Council table ─────────────────────────────────────────────────────────
function initTable() {
  tableData = appData.by_council;
  renderTable();

  wireModalHandlers();

  document.getElementById('btn-export-table').addEventListener('click', exportCouncilTable);

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

function getSortedFilteredRows(filter) {
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
  return rows;
}

function renderTable(filter = '') {
  const rows = getSortedFilteredRows(filter);

  document.getElementById('table-body').innerHTML = rows.map(c => {
    const pctCls = p => {
      if (p === null || p === undefined) return 'pct-neutral';
      return p >= 50 ? 'pct-high-female' : p < 30 ? 'pct-high-male' : 'pct-neutral';
    };

    const hc = c.pct_high_conf;
    const confBadgeCls = hc === null || hc === undefined ? 'conf-none'
      : hc >= 80 ? 'conf-high' : hc >= 60 ? 'conf-med' : 'conf-low';
    const confCell = hc !== null && hc !== undefined
      ? `${hc}%<span class="conf-badge ${confBadgeCls}"></span>`
      : '—';

    const turnout = c.avg_turnout !== null ? c.avg_turnout + '%' : '—';

    return `<tr data-council-slug="${c.ward_slug || ''}">
      <td>${c.org_name}</td>
      <td>${c.total}</td>
      <td>${c.female}</td>
      <td class="pct-cell ${pctCls(c.pct_female)}">${c.pct_female !== null ? c.pct_female + '%' : '—'}</td>
      <td class="conf-cell">${confCell}</td>
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

  openModal(council.org_name, `
    <div class="modal-export-row">
      <button class="btn-export" id="btn-export-wards">&#8659;&nbsp;Export XLSX</button>
    </div>
    <div class="ward-grid">${cards}</div>
  `);

  const body = document.getElementById('modal-body');
  body.querySelector('#btn-export-wards').addEventListener('click', () => exportWardList(council, wards));
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

function confCell(level) {
  const cls = level === 'high' ? 'conf-high' : level === 'medium' ? 'conf-med' : level === 'low' ? 'conf-low' : 'conf-none';
  const lbl = level === 'high' ? 'High' : level === 'medium' ? 'Med' : level === 'low' ? 'Low' : '—';
  return `<span class="conf-cell">${lbl}<span class="conf-badge ${cls}"></span></span>`;
}

function openWardDetail(council, payload, ward) {
  const candidates = (ward.candidates || []).slice().sort((a, b) => {
    const ar = a.r || 9999;
    const br = b.r || 9999;
    if (ar !== br) return ar - br;
    return (a.n || '').localeCompare(b.n || '');
  });

  const totalVotes = candidates.reduce((sum, c) => sum + (Number(c.v) || 0), 0);

  const rows = candidates.map(cd => {
    const pct = totalVotes > 0 ? ((Number(cd.v) || 0) / totalVotes * 100).toFixed(1) + '%' : '—';
    const g = formatGenderLabel(cd.g);
    const electedCell = cd.e
      ? '<span class="elected-tick">&#10003;</span>'
      : '<span class="not-elected-cross">&#10007;</span>';

    return `
      <tr class="${cd.e ? 'elected-row' : ''}">
        <td>${cd.n || '—'}</td>
        <td>${cd.p || '—'}</td>
        <td class="num">${cd.v !== null && cd.v !== undefined ? Number(cd.v).toLocaleString() : '—'}</td>
        <td class="num">${pct}</td>
        <td class="num">${electedCell}</td>
        <td><span class="${g.cls}">${g.text}</span></td>
        <td>${formatMethodLabel(cd.m)}</td>
        <td>${confCell(cd.cf)}</td>
      </tr>
    `;
  }).join('');

  const turnout = ward.turnout_pct !== null && ward.turnout_pct !== undefined
    ? `${ward.turnout_pct}%`
    : '—';

  const html = `
    <div class="ward-detail-bar">
      <button class="modal-back" id="modal-back">&#8592; Back to wards</button>
      <button class="btn-export" id="btn-export-ward-detail">&#8659;&nbsp;Export XLSX</button>
    </div>
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
          <th>Confidence</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  openModal(`${council.org_name} - ${ward.ward}`, html);
  document.getElementById('modal-back').addEventListener('click', () => {
    renderWardList(council, payload);
  });
  document.getElementById('btn-export-ward-detail').addEventListener('click', () => {
    exportWardDetail(council, ward, candidates);
  });
}

// ── XLSX Export ────────────────────────────────────────────────────────────
function buildMethodologySheet(contextLabel) {
  const rows = [
    ['2026 England Local Elections — Gender Analysis'],
    [''],
    ['Gender Assignment Methodology'],
    [''],
    ['Most candidates (~77%) had no gender recorded in the source data.'],
    ['Gender was predicted in three stages:'],
    [''],
    ['Stage 1 — gender_guesser (open-source name database) and the ONS historical baby names dataset (1904–2024),'],
    ['          using birth year where available to account for names whose gender balance has shifted over time'],
    ['          (e.g. "Ashley", "Kim").'],
    ['Stage 2 — Claude Sonnet 4.6 classified names that remained unresolved after stage 1.'],
    ['Stage 3 — ~5% of candidates remain Unclassified (primarily uncommon or non-Western names).'],
    [''],
    ['Percentages are calculated only among candidates with a known gender.'],
    ['Gender is treated as binary (male/female) for prediction purposes.'],
    [''],
    ['Data Sources'],
    ['Election data: Democracy Club (democracyclub.org.uk)'],
    ['ONS data: Office for National Statistics, licensed under the Open Government Licence v.3.0'],
    ['  Licence: https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/'],
    ['Contains OS data \u00a9 Crown copyright and database right [2026]'],
    ['Election data: Democracy Club (democracyclub.org.uk), licensed under CC BY 4.0'],
    ['  Licence: https://creativecommons.org/licenses/by/4.0/'],
    [''],
    ['Exported view:', contextLabel],
    ['Generated:', new Date().toLocaleString('en-GB')],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 90 }, { wch: 40 }];
  return ws;
}

function exportToXlsx(filename, headers, dataRows, contextLabel) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildMethodologySheet(contextLabel), 'Methodology');

  const ws2 = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
  ws2['!cols'] = headers.map(h => ({ wch: Math.max(String(h).length + 4, 12) }));
  ws2['!autofilter'] = { ref: ws2['!ref'] };
  XLSX.utils.book_append_sheet(wb, ws2, 'Data');

  XLSX.writeFile(wb, filename);
}

function exportCouncilTable() {
  const filter = document.getElementById('table-search').value.trim().toLowerCase();
  const rows = getSortedFilteredRows(filter);
  const headers = [
    'Council', 'Candidates', 'Female Cands', '% Female Cands',
    'Confidence %', 'Elected', 'Female Elected', '% Female Elected', 'Avg Turnout %',
  ];
  const dataRows = rows.map(c => [
    c.org_name, c.total, c.female, c.pct_female, c.pct_high_conf,
    c.elected_total, c.elected_female, c.pct_female_elected, c.avg_turnout,
  ]);
  const label = filter ? `Councils filtered by "${filter}"` : 'All 156 councils';
  exportToXlsx('council-gender-breakdown.xlsx', headers, dataRows, label);
}

function exportWardList(council, wards) {
  const headers = ['Ward', 'Seats', 'Total Candidates', 'Female', 'Male', 'Unclassified', 'Turnout %'];
  const dataRows = wards.map(ward => {
    const counts = ward.candidates.reduce((acc, c) => {
      if (c.g === 'female') acc.f++;
      else if (c.g === 'male') acc.m++;
      else acc.u++;
      return acc;
    }, { f: 0, m: 0, u: 0 });
    return [ward.ward, ward.seats ?? null, ward.candidates.length, counts.f, counts.m, counts.u, ward.turnout_pct ?? null];
  });
  exportToXlsx(
    `${council.org_name.replace(/[^\w-]/g, '_')}-wards.xlsx`,
    headers, dataRows,
    `${council.org_name} — Ward summary`,
  );
}

function exportWardDetail(council, ward, candidates) {
  const totalVotes = candidates.reduce((sum, c) => sum + (Number(c.v) || 0), 0);
  const methodText = { existing: 'Recorded', gender_guesser: 'gender_guesser', ons: 'ONS names', claude: 'Claude AI', unknown: 'Unclassified' };
  const headers = ['Name', 'Party', 'Votes', '% Votes', 'Elected', 'Gender', 'Assignment Method', 'Confidence'];
  const dataRows = candidates.map(c => {
    const pct = totalVotes > 0 ? +((Number(c.v) || 0) / totalVotes * 100).toFixed(1) : null;
    const confLabel = c.cf === 'high' ? 'High' : c.cf === 'medium' ? 'Medium' : c.cf === 'low' ? 'Low' : 'Unknown';
    return [
      c.n || '', c.p || '', c.v ?? null, pct,
      c.e ? 'Yes' : 'No',
      c.g || 'unclassified',
      methodText[c.m] || c.m || 'Unclassified',
      confLabel,
    ];
  });
  const slug = `${council.org_name}-${ward.ward}`.replace(/[^\w-]/g, '_');
  exportToXlsx(`${slug}.xlsx`, headers, dataRows, `${council.org_name} — ${ward.ward}`);
}
