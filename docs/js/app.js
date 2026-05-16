'use strict';

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
let selectedRegionName   = null;  // region (NUTS1) of selected bar, or null
let councilPartyData     = null;  // aggregated partyMap from current council's ward JSON
let _candClickList       = [];    // candidate objects for the latest rendered candidate rows

// ── Boot ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  fetch('data/councils.json?v=' + Date.now())
    .then(r => r.json())
    .then(data => {
      appData = data;
      buildLadLookup();
      renderSummaryCards();
      renderSeatChanges(appData.summary, 'England');
      initMap();
      renderPartyCharts();
      renderRegionCharts();
      initTable();
      wireMapToggle();
      wireMethModal();
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

// ── App-state helpers ─────────────────────────────────────────────────────
function buildLadLookup() {
  for (const c of appData.by_council) {
    if (c.lad_code) ladLookup[c.lad_code] = c;
  }
}

// ── Shared UI helpers ─────────────────────────────────────────────────────
function hidePanel(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = true;
}

function calcWinRate(elected, total) {
  return total > 0 ? +(elected / total * 100).toFixed(1) : null;
}

// ── Summary cards ─────────────────────────────────────────────────────────
function renderSummaryCards() {
  const s = appData.summary;
  const knownCands   = s.female_candidates + s.male_candidates;
  const knownElected = s.elected_female    + s.elected_male;

  const retPct = s.inc_retention_pct != null ? s.inc_retention_pct + '%' : '\u2014';

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

  document.getElementById('summary-cards').innerHTML = tmplSummaryCards(cards);
}

// ── Seat changes panel ────────────────────────────────────────────────────
function renderSeatChanges(data, contextLabel) {
  const el = document.getElementById('seat-changes-content');
  if (el) el.innerHTML = tmplSeatChanges(data, contextLabel);
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
  const inRegion   = !isSelected && council && selectedRegionName && council.nuts1 === selectedRegionName;
  const dimmed     = !isSelected && !inRegion && (selectedCouncilName || selectedRegionName);
  return {
    fillColor,
    fillOpacity: dimmed ? 0.3 : 0.85,
    color:  isSelected ? '#1a1a2e' : inRegion ? '#2c5f99' : '#fff',
    weight: isSelected ? 3 : inRegion ? 2 : 0.5,
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

  box.innerHTML = tmplInfoBox(council, femalePctStr, electedPctStr, highConfPct);
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
function renderCouncilStats(council) {
  const panel = document.getElementById('council-stats');
  if (!panel) return;
  const c = council;  // by_council entry (pre-computed fields)
  const kn   = (c.female || 0) + (c.male || 0);
  const fwr  = c.female_win_rate !== null && c.female_win_rate !== undefined ? c.female_win_rate + '%' : '&mdash;';
  const mwr  = c.male_win_rate   !== null && c.male_win_rate   !== undefined ? c.male_win_rate   + '%' : '&mdash;';

  let sentenceHtml = '';
  if (c.female_win_rate !== null && c.male_win_rate !== null &&
      c.female_win_rate !== undefined && c.male_win_rate !== undefined) {
    const diff = +(c.female_win_rate - c.male_win_rate).toFixed(1);
    const s    = appData.summary;
    const natFWR = s.national_female_win_rate;
    const natMWR = s.national_male_win_rate;
    if (Math.abs(diff) < 0.1) {
      sentenceHtml = `<p class="party-sentence">In <strong>${escHtml(c.org_name)}</strong>, female and male candidates had the same win rate (${c.female_win_rate}%).</p>`;
    } else {
      sentenceHtml = `<p class="party-sentence">In <strong>${escHtml(c.org_name)}</strong>, female candidates had a ${Math.abs(diff)}&thinsp;pp ${diff > 0 ? 'higher' : 'lower'} win rate than male candidates (${c.female_win_rate}% vs ${c.male_win_rate}%).</p>`;
    }
    if (natFWR !== null && natFWR !== undefined) {
      const diffNat = +(c.female_win_rate - natFWR).toFixed(1);
      sentenceHtml += `<p class="party-sentence">The female win rate here (${c.female_win_rate}%) ${diffNat >= 0 ? 'was above' : 'was below'} the national female win rate (${natFWR}%) by <strong>${Math.abs(diffNat)}&thinsp;pp</strong>.</p>`;
    }
  }

  panel.innerHTML = tmplCouncilStats(c, kn, fwr, mwr, sentenceHtml);
  panel.hidden = false;
}

function handleCouncilSelect(feature) {
  const council = ladLookup[feature.properties.LAD25CD];
  if (!council) return;

  if (selectedCouncilName === council.org_name) {
    clearCouncilSelection();
    return;
  }

  selectedPartyName = null;
  hidePanel('party-detail');

  selectedCouncilName = council.org_name;
  geojsonLayer.setStyle(styleFeature);

  document.getElementById('party-heading').innerHTML =
    `By party — <strong>${council.org_name}</strong>` +
    ` <button class="btn-clear-selection" id="btn-clear-selection">✕ All England</button>`;
  document.getElementById('btn-clear-selection').addEventListener('click', clearCouncilSelection);

  renderPartyChartsForCouncil(council);
  renderCouncilStats(council);
  renderSeatChanges(council, council.org_name);
  updateBreadcrumb();
}

function clearCouncilSelection() {
  selectedPartyName   = null;
  selectedCouncilName = null;
  councilPartyData    = null;
  hidePanel('party-detail');
  hidePanel('council-stats');
  if (geojsonLayer) geojsonLayer.setStyle(styleFeature);
  // Restore region-scoped party charts if a region is still selected
  if (selectedRegionName) {
    const r = appData.by_region.find(x => x.region === selectedRegionName);
    renderPartyCharts(selectedRegionName);
    if (r) renderSeatChanges(r, selectedRegionName);
  } else {
    renderPartyCharts();
    renderSeatChanges(appData.summary, 'England');
  }
  updateBreadcrumb();
}

// ── Region bar selection ──────────────────────────────────────────────────
function handleRegionSelect(name) {
  if (selectedRegionName === name) { clearRegionSelection(); return; }
  selectedRegionName = name;

  // Clear any council/party selection so region drives the context
  if (selectedCouncilName) {
    selectedPartyName   = null;
    selectedCouncilName = null;
    councilPartyData    = null;
    hidePanel('party-detail');
    hidePanel('council-stats');
    if (geojsonLayer) geojsonLayer.setStyle(styleFeature);
  }

  renderRegionCharts();
  if (geojsonLayer) geojsonLayer.setStyle(styleFeature);
  renderPartyCharts(name);
  renderRegionDetail(name);
  renderSeatChanges(appData.by_region.find(x => x.region === name) || {}, name);
  renderTable(document.getElementById('table-search').value.trim().toLowerCase());
  updateBreadcrumb();
}

function clearRegionSelection() {
  if (!selectedRegionName) return;
  selectedRegionName = null;
  hidePanel('region-detail');
  document.getElementById('region-heading').textContent = 'By region';
  renderRegionCharts();
  if (geojsonLayer) geojsonLayer.setStyle(styleFeature);
  renderPartyCharts();
  renderSeatChanges(appData.summary, 'England');
  renderTable(document.getElementById('table-search').value.trim().toLowerCase());
  updateBreadcrumb();
}

function renderRegionDetail(name) {
  const panel = document.getElementById('region-detail');
  if (!panel) return;

  const r = appData.by_region.find(x => x.region === name);
  if (!r) { panel.hidden = true; return; }

  const s            = appData.summary;
  const natFWR       = s.national_female_win_rate;
  const natMWR       = s.national_male_win_rate;
  const fwrStr       = r.female_win_rate !== null ? r.female_win_rate + '%' : '&mdash;';
  const mwrStr       = r.male_win_rate   !== null ? r.male_win_rate   + '%' : '&mdash;';
  const knownN       = r.female + r.male;

  let sentenceF = '';
  if (r.female_win_rate !== null && natFWR !== null) {
    const diff = +(r.female_win_rate - natFWR).toFixed(1);
    const dir  = diff >= 0 ? 'above' : 'below';
    sentenceF  = `Female candidates in <strong>${escHtml(name)}</strong> had a <strong>${r.female_win_rate}% win rate</strong> &mdash; ${Math.abs(diff)}&thinsp;pp ${dir} the national female average (${natFWR}%).`;
  }
  let sentenceM = '';
  if (r.male_win_rate !== null && natMWR !== null) {
    const diff = +(r.male_win_rate - natMWR).toFixed(1);
    const dir  = diff >= 0 ? 'above' : 'below';
    sentenceM  = `Male candidates in <strong>${escHtml(name)}</strong> had a <strong>${r.male_win_rate}% win rate</strong> &mdash; ${Math.abs(diff)}&thinsp;pp ${dir} the national male average (${natMWR}%).`;
  }
  let sentenceG = '';
  if (r.female_win_rate !== null && r.male_win_rate !== null) {
    const diff = +(r.female_win_rate - r.male_win_rate).toFixed(1);
    if (Math.abs(diff) < 0.1) {
      sentenceG = `Female and male candidates in <strong>${escHtml(name)}</strong> had the same win rate (${r.female_win_rate}%).`;
    } else {
      const higher = diff > 0 ? 'female' : 'male';
      sentenceG = `In <strong>${escHtml(name)}</strong>, ${higher} candidates had a ${Math.abs(diff)}&thinsp;pp ${diff > 0 ? 'higher' : 'lower'} win rate than ${diff > 0 ? 'male' : 'female'} candidates (${r.female_win_rate}% vs ${r.male_win_rate}%).`;
    }
  }

  panel.innerHTML = tmplRegionDetail(r, name, fwrStr, mwrStr, knownN, sentenceF, sentenceM, sentenceG);
  panel.querySelector('#btn-clear-region').addEventListener('click', clearRegionSelection);
  document.getElementById('region-heading').innerHTML =
    `By region &mdash; <strong>${escHtml(name)}</strong>`;
  panel.hidden = false;
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
    : (selectedRegionName && appData.by_region_by_party && appData.by_region_by_party[selectedRegionName])
      ? appData.by_region_by_party[selectedRegionName].find(p => p.party === name)
      : appData.by_party.find(p => p.party === name);
  if (!source) return;

  buildChart('chart-party-cands',   'scroll-party-cands',   [name], toStackedPct([source], 'female', 'male'),                  handlePartySelect);
  buildChart('chart-party-elected', 'scroll-party-elected', [name], toStackedPct([source], 'elected_female', 'elected_male'), handlePartySelect);
  renderPartyDetail(name);
  updateBreadcrumb();
}

function clearPartySelection() {
  if (!selectedPartyName) return;
  selectedPartyName = null;
  hidePanel('party-detail');

  if (selectedCouncilName && councilPartyData) {
    const parties = Object.values(councilPartyData)
      .sort((a, b) => (b.female + b.male) - (a.female + a.male));
    const labels  = parties.map(p => p.party);
    buildChart('chart-party-cands',   'scroll-party-cands',   labels, toStackedPct(parties, 'female', 'male'),                  handlePartySelect);
    buildChart('chart-party-elected', 'scroll-party-elected', labels, toStackedPct(parties, 'elected_female', 'elected_male'), handlePartySelect);
  } else {
    renderPartyCharts(selectedRegionName || undefined);
  }
  updateBreadcrumb();
}

function renderPartyDetail(name) {
  const panel = document.getElementById('party-detail');
  if (!panel) return;
  const s     = appData.summary;
  const isCouncil = !!selectedCouncilName;

  let dr;  // display row
  let sentenceE = '', sentenceF = '', sentenceG = '';
  let femaleWinRate, maleWinRate;

  if (isCouncil && councilPartyData && councilPartyData[name]) {
    dr = councilPartyData[name];
    femaleWinRate = calcWinRate(dr.elected_female, dr.female);
    maleWinRate   = calcWinRate(dr.elected_male,   dr.male);

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
    if (femaleWinRate !== null && maleWinRate !== null) {
      const diff = +(femaleWinRate - maleWinRate).toFixed(1);
      const scope = `In <strong>${escHtml(selectedCouncilName)}</strong>`;
      if (Math.abs(diff) < 0.1) {
        sentenceG = `${scope}, female and male <em>${escHtml(name)}</em> candidates had the same win rate (${femaleWinRate}%).`;
      } else {
        const higher = diff > 0 ? 'female' : 'male';
        const lower  = diff > 0 ? 'male' : 'female';
        sentenceG = `${scope}, female <em>${escHtml(name)}</em> candidates had a ${Math.abs(diff)}&thinsp;pp ${diff > 0 ? 'higher' : 'lower'} win rate than male candidates (${femaleWinRate}% vs ${maleWinRate}%).`;
      }
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
    if (femaleWinRate !== null && maleWinRate !== null) {
      const diff = +(femaleWinRate - maleWinRate).toFixed(1);
      if (Math.abs(diff) < 0.1) {
        sentenceG = `Nationally, female and male <em>${escHtml(name)}</em> candidates had the same win rate (${femaleWinRate}%).`;
      } else {
        sentenceG = `Nationally, female <em>${escHtml(name)}</em> candidates had a ${Math.abs(diff)}&thinsp;pp ${diff > 0 ? 'higher' : 'lower'} win rate than male candidates (${femaleWinRate}% vs ${maleWinRate}%).`;
      }
    }
  }

  const fwrStr   = femaleWinRate !== null ? femaleWinRate + '%' : '&mdash;';
  const mwrStr   = maleWinRate   !== null ? maleWinRate   + '%' : '&mdash;';
  const seatsStr = dr.seats_available !== undefined ? dr.seats_available.toLocaleString() : '&mdash;';
  const wardsStr = dr.wards_stood     !== undefined ? dr.wards_stood.toLocaleString()     : '&mdash;';
  const knownN   = (dr.female || 0) + (dr.male || 0);
  const totalN   = dr.total !== undefined ? dr.total : knownN + (dr.unknown || 0);

  panel.innerHTML = tmplPartyDetail(name, dr, fwrStr, mwrStr, seatsStr, wardsStr, knownN, totalN, sentenceE, sentenceF, sentenceG, buildCandidateSection(name, isCouncil));
  panel.querySelector('#btn-clear-party').addEventListener('click', clearPartySelection);

  // Wire candidate row clicks → candidate modal
  panel.querySelectorAll('tr[data-cand-idx]').forEach(tr => {
    tr.addEventListener('click', () => {
      const c = _candClickList[Number(tr.dataset.candIdx)];
      if (c) openCandidateModal(c, selectedCouncilName, c.ward || null);
    });
  });

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
      if (c.p === name) rows.push({ ...c, ward: ward.ward, rs: ward.results_url || null });
    }
  }
  if (!rows.length) return `<p class="party-no-cands">No candidates found for ${escHtml(name)} in ${escHtml(selectedCouncilName)}.</p>`;

  rows.sort((a, b) => {
    if (a.ward !== b.ward) return a.ward.localeCompare(b.ward);
    return (a.r || 999) - (b.r || 999);
  });

  _candClickList = rows;

  return tmplCandidateSection(selectedCouncilName, rows);
}

// ── Breadcrumb strip ──────────────────────────────────────────────────────
function updateBreadcrumb() {
  const bar = document.getElementById('breadcrumb-bar');
  if (!bar) return;

  const hasSelection = selectedRegionName || selectedCouncilName || selectedPartyName;
  if (!hasSelection) { bar.hidden = true; return; }

  const parts = [];

  // England root — always clickable when something is selected
  parts.push({ label: 'England', clickable: true, action: () => {
    if (selectedPartyName)   clearPartySelection();
    if (selectedCouncilName) clearCouncilSelection();
    if (selectedRegionName)  clearRegionSelection();
  }});

  if (selectedRegionName) {
    const isLeaf = !selectedCouncilName && !selectedPartyName;
    parts.push({ label: selectedRegionName, clickable: !isLeaf, action: () => {
      if (selectedPartyName)   clearPartySelection();
      if (selectedCouncilName) clearCouncilSelection();
    }});
  }

  if (selectedCouncilName) {
    const isLeaf = !selectedPartyName;
    parts.push({ label: selectedCouncilName, clickable: !isLeaf, action: () => {
      clearPartySelection();
    }});
  }

  if (selectedPartyName) {
    parts.push({ label: selectedPartyName, clickable: false });
  }

  bar.innerHTML = tmplBreadcrumb(parts);
  bar.hidden = false;

  bar.querySelectorAll('.bc-link').forEach(el => {
    const idx = Number(el.dataset.idx);
    el.addEventListener('click', parts[idx].action);
  });
}

function renderPartyCharts(regionName) {
  let parties, subLabel;
  if (regionName && appData.by_region_by_party && appData.by_region_by_party[regionName]) {
    parties  = appData.by_region_by_party[regionName];
    subLabel = `<span class="subtitle-small">— ${escHtml(regionName)}, parties with ≥10 candidates, sorted by total.</span>`;
  } else {
    parties  = appData.by_party;
    subLabel = '<span class="subtitle-small">— parties with ≥30 candidates, sorted by total. Each bar = 100% of that party’s candidates/elected.</span>';
  }

  document.getElementById('party-heading').innerHTML = `By party ${subLabel}`;

  const labels = parties.map(p => p.party);
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
  const active  = selectedRegionName || null;

  buildChart(
    'chart-region-cands',   'scroll-region-cands',
    labels, toStackedPct(regions, 'female', 'male'), handleRegionSelect, active
  );
  buildChart(
    'chart-region-elected', 'scroll-region-elected',
    labels, toStackedPct(regions, 'elected_female', 'elected_male'), handleRegionSelect, active
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
  let rows = tableData.slice();
  if (selectedRegionName) {
    rows = rows.filter(c => c.nuts1 === selectedRegionName);
  }
  if (filter) {
    rows = rows.filter(c => c.org_name.toLowerCase().includes(filter));
  }

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

  // Update heading with context-aware count
  const tableH2 = document.querySelector('#table-section .panel-header h2');
  if (tableH2) {
    if (selectedRegionName && filter) {
      tableH2.textContent = `By council \u2014 ${rows.length} in ${selectedRegionName} matching filter`;
    } else if (selectedRegionName) {
      tableH2.textContent = `By council \u2014 ${rows.length} in ${selectedRegionName}`;
    } else if (filter) {
      tableH2.textContent = `By council \u2014 ${rows.length} match${rows.length !== 1 ? 'es' : ''}`;
    } else {
      tableH2.textContent = 'By council';
    }
  }

  document.getElementById('table-body').innerHTML = tmplTableRows(rows);
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
    if (e.key === 'Escape') closeCandidateModal();
  });

  // Candidate modal close
  document.getElementById('cand-modal-close').addEventListener('click', closeCandidateModal);
  document.getElementById('candidate-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeCandidateModal();
  });
}

// ── Candidate detail modal ────────────────────────────────────────────────
function closeCandidateModal() {
  document.getElementById('candidate-modal').hidden = true;
}

function openCandidateModal(cand, councilName, wardName) {
  const overlay = document.getElementById('candidate-modal');
  const body    = document.getElementById('cand-modal-body');

  body.innerHTML = tmplCandidateModal(cand, councilName, wardName);
  overlay.hidden = false;
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

  openModal(council.org_name, `
    <div class="modal-export-row">
      <button class="btn-export" id="btn-export-wards">&#8659;&nbsp;Export XLSX</button>
    </div>
    <div class="ward-grid">${tmplWardCards(wards)}</div>
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

function openWardDetail(council, payload, ward) {
  const candidates = (ward.candidates || []).slice().sort((a, b) => {
    const ar = a.r || 9999;
    const br = b.r || 9999;
    if (ar !== br) return ar - br;
    return (a.n || '').localeCompare(b.n || '');
  });

  const totalVotes = candidates.reduce((sum, c) => sum + (Number(c.v) || 0), 0);

  const html = tmplWardDetail(ward, candidates, totalVotes);

  openModal(`${council.org_name} - ${ward.ward}`, html);
  document.getElementById('modal-back').addEventListener('click', () => {
    renderWardList(council, payload);
  });
  document.getElementById('btn-export-ward-detail').addEventListener('click', () => {
    exportWardDetail(council, ward, candidates);
  });
  // Wire candidate row clicks → candidate modal
  document.getElementById('modal-body').querySelectorAll('tr[data-cand-idx]').forEach(tr => {
    tr.addEventListener('click', () => {
      const c = candidates[Number(tr.dataset.candIdx)];
      if (c) openCandidateModal({ ...c, rs: ward.results_url || null }, council.org_name, ward.ward);
    });
  });
}

// ── Methodology modal ─────────────────────────────────────────────────────
function wireMethModal() {
  const modal   = document.getElementById('meth-modal');
  const closeBtn = document.getElementById('meth-modal-close');

  function openMeth(e) { if (e) e.preventDefault(); modal.hidden = false; document.body.style.overflow = 'hidden'; }
  function closeMeth() { modal.hidden = true; document.body.style.overflow = ''; }

  const tileLink   = document.getElementById('btn-open-meth-modal');
  const footerLink = document.getElementById('footer-meth-link');
  if (tileLink)   tileLink.addEventListener('click', openMeth);
  if (footerLink) footerLink.addEventListener('click', openMeth);
  if (closeBtn)   closeBtn.addEventListener('click', closeMeth);
  modal.addEventListener('click', e => { if (e.target === modal) closeMeth(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closeMeth(); });
}

// ── XLSX Export ────────────────────────────────────────────────────────────
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
