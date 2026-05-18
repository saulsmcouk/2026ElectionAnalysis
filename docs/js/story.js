/* story.js — Labour gender narrative, May 2026 English local elections */
'use strict';

// ── Constants ────────────────────────────────────────────────────────────────
const LABOUR_KEYS = new Set(['Labour Party', 'Labour and Co-operative Party']);

const PARTY_DISPLAY = [
  { key: 'Labour',       matchFn: k => LABOUR_KEYS.has(k) },
  { key: 'Conservative', matchFn: k => k === 'Conservative and Unionist Party' },
  { key: 'Lib Dems',     matchFn: k => k === 'Liberal Democrats' },
  { key: 'Green',        matchFn: k => k === 'Green Party' },
  { key: 'Reform UK',    matchFn: k => k === 'Reform UK' },
];

// Fields to sum when merging two party entries (e.g. Labour + Lab Co-op)
const SUM_FIELDS = [
  'total','female','male','unknown',
  'elected_total','elected_female','elected_male','elected_unknown',
  'inc_total','inc_elected','inc_defeated','new_elected',
  'inc_female_elected','inc_male_elected',
  'inc_female_defeated','inc_male_defeated',
  'new_female_elected','new_male_elected',
];

const COL_FEMALE = '#d6496f';
const COL_MALE   = '#2171b5';
const COL_LAB    = '#b5003e';

let _charts = {};

// ── Pure helpers ─────────────────────────────────────────────────────────────
function r1(n)       { return Math.round(n * 10) / 10; }
function pct(n, d)   { return d ? r1(n / d * 100) : null; }
function fmt(n)      { return n == null ? '\u2014' : n.toLocaleString(); }
function fmtP(n)     { return n == null ? '\u2014' : n + '%'; }
function sign(n)     { return n > 0 ? '+' : ''; }
function esc(s)      { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function gapStr(f,m) {
  if (f == null || m == null) return '\u2014';
  const g = r1(f - m);
  const cls = g > 0 ? 'gap-pos' : g < 0 ? 'gap-neg' : 'gap-neutral';
  return `<span class="${cls}">${sign(g)}${g}pp</span>`;
}

// ── Party merge ───────────────────────────────────────────────────────────────
// Merges two party-stat objects (e.g. Labour Party + Labour Co-op) by
// summing raw counts and recomputing all derived pct/rate fields.
function mergePartyEntries(partyList, matchFn) {
  const rows = partyList.filter(p => matchFn(p.party));
  if (!rows.length) return null;
  if (rows.length === 1) return Object.assign({}, rows[0]);
  const m = Object.assign({}, rows[0]);
  for (const f of SUM_FIELDS) m[f] = rows.reduce((s, r) => s + (r[f] || 0), 0);
  const kn  = m.female + m.male;
  const ekn = m.elected_female + m.elected_male;
  m.pct_female           = pct(m.female, kn);
  m.pct_female_elected   = pct(m.elected_female, ekn);
  m.female_win_rate      = pct(m.elected_female, m.female);
  m.male_win_rate        = pct(m.elected_male, m.male);
  m.inc_retention_pct    = pct(m.inc_elected, m.inc_total);
  const iFt = m.inc_female_elected + m.inc_female_defeated;
  const iMt = m.inc_male_elected + m.inc_male_defeated;
  m.inc_female_retention_pct = pct(m.inc_female_elected, iFt);
  m.inc_male_retention_pct   = pct(m.inc_male_elected, iMt);
  m.inc_female_pct           = pct(iFt, iFt + iMt);
  const nKn = m.new_female_elected + m.new_male_elected;
  m.new_female_elected_pct   = pct(m.new_female_elected, nKn);
  return m;
}

function buildPartyMap(partyList) {
  const map = {};
  for (const pd of PARTY_DISPLAY) map[pd.key] = mergePartyEntries(partyList, pd.matchFn);
  return map;
}

// ── HTML helpers ──────────────────────────────────────────────────────────────
function statCard(val, lbl, sub) {
  return `<div class="stat-card">
    <div class="stat-val">${val}</div>
    <div class="stat-lbl">${esc(lbl)}</div>
    ${sub ? `<div class="stat-sub">${esc(sub)}</div>` : ''}
  </div>`;
}

function buildTable(headers, rows) {
  const head = headers.map(h => `<th>${h}</th>`).join('');
  const body = rows.map(r => {
    const cells = r.cells.map((c, i) => `<td${i > 0 ? ' class="num"' : ''}>${c}</td>`).join('');
    return `<tr${r.cls ? ` class="${r.cls}"` : ''}>${cells}</tr>`;
  }).join('');
  return `<table class="story-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function makeChart(id, config) {
  if (_charts[id]) _charts[id].destroy();
  _charts[id] = new Chart(document.getElementById(id), config);
}

// ── Section: Hero ─────────────────────────────────────────────────────────────
function renderHero(lab, summary) {
  const gap = r1(lab.pct_female - summary.pct_female);
  document.getElementById('hero-pct').textContent = lab.pct_female + '%';
  document.getElementById('hero-sub').innerHTML =
    `<strong>${fmt(lab.female)}</strong> Labour women stood out of <strong>${fmt(lab.total)}</strong> ` +
    `Labour candidates &mdash; ${gap}pp above the national average of ${summary.pct_female}%.`;
}

// ── Section: Candidates ───────────────────────────────────────────────────────
function renderCandidates(lab, summary, partyMap) {
  const con = partyMap['Conservative'];
  const ref = partyMap['Reform UK'];

  document.getElementById('p1-intro').innerHTML =
    `In the May 2026 English local elections, Labour fielded <strong>${fmt(lab.female)} women</strong> ` +
    `out of <strong>${fmt(lab.total)} total candidates</strong> &mdash; a higher proportion than any other ` +
    `major party. At <strong>${lab.pct_female}%</strong>, Labour&rsquo;s female candidacy rate is ` +
    `${r1(lab.pct_female - summary.pct_female)}pp above the England-wide figure of ${summary.pct_female}%.`;

  document.getElementById('p1-stats').innerHTML =
    statCard(lab.pct_female + '%', 'Labour candidates who are women', `${fmt(lab.female)} of ${fmt(lab.total)}`) +
    statCard(summary.pct_female + '%', 'National average', `${fmt(summary.female_candidates)} of ${fmt(summary.total_candidates)}`) +
    statCard(con ? con.pct_female + '%' : '\u2014', 'Conservative', '') +
    statCard(ref ? ref.pct_female + '%' : '\u2014', 'Reform UK', 'lowest major party');

  const labels = PARTY_DISPLAY.map(pd => pd.key);
  const vals   = PARTY_DISPLAY.map(pd => partyMap[pd.key] ? partyMap[pd.key].pct_female : 0);
  const colors = PARTY_DISPLAY.map(pd => pd.key === 'Labour' ? COL_LAB : '#aaa');

  makeChart('chart-cands', {
    type: 'bar',
    data: { labels, datasets: [{ data: vals, backgroundColor: colors, borderRadius: 3 }] },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ' ' + ctx.raw + '%' } },
      },
      scales: {
        x: {
          beginAtZero: true, max: 55,
          ticks: { callback: v => v + '%' },
          title: { display: true, text: '% female candidates' },
        },
      },
    },
  });

  const grn = partyMap['Green'];
  document.getElementById('p1-note').textContent =
    `Green Party also fields high proportions of women (${grn ? grn.pct_female : '\u2014'}%). ` +
    `Reform UK fields the lowest proportion among the five main parties.`;
}

// ── Section: Winning ──────────────────────────────────────────────────────────
function renderWinning(lab, partyMap) {
  const gap   = r1(lab.female_win_rate - lab.male_win_rate);
  const ref   = partyMap['Reform UK'];
  const refGap = ref ? r1(ref.female_win_rate - ref.male_win_rate) : null;

  document.getElementById('p2-intro').innerHTML =
    `Labour women won at <strong>${lab.female_win_rate}%</strong> &mdash; compared to ` +
    `<strong>${lab.male_win_rate}%</strong> for Labour men. That <strong>${sign(gap)}${gap}pp gap</strong> ` +
    `is the largest positive gender win-rate advantage of any major party. Labour women were ` +
    `<strong>${lab.pct_female}%</strong> of Labour candidates but <strong>${lab.pct_female_elected}%</strong> ` +
    `of Labour&rsquo;s elected councillors.`;

  document.getElementById('p2-stats').innerHTML =
    statCard(lab.female_win_rate + '%', 'Labour women win rate', `vs ${lab.male_win_rate}% for Labour men`) +
    statCard((gap > 0 ? '+' : '') + gap + 'pp', 'Labour gender win gap', 'women outperform men') +
    statCard(lab.pct_female_elected + '%', 'Labour elected who are women', `vs ${lab.pct_female}% of candidates`) +
    statCard(fmt(lab.new_female_elected), 'newly elected Labour women', `${lab.new_female_elected_pct}% of new Labour wins`);

  const labels = PARTY_DISPLAY.map(pd => pd.key);
  const fRates = PARTY_DISPLAY.map(pd => partyMap[pd.key] ? partyMap[pd.key].female_win_rate : 0);
  const mRates = PARTY_DISPLAY.map(pd => partyMap[pd.key] ? partyMap[pd.key].male_win_rate : 0);

  makeChart('chart-winrates', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Women', data: fRates, backgroundColor: COL_FEMALE, borderRadius: 3 },
        { label: 'Men',   data: mRates, backgroundColor: COL_MALE,   borderRadius: 3 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: { label: ctx => ' ' + ctx.dataset.label + ': ' + ctx.raw + '%' } },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: v => v + '%' },
          title: { display: true, text: 'Win rate (%)' },
        },
      },
    },
  });

  document.getElementById('p2-finding').innerHTML =
    `<strong>Labour women outperform Labour men by ${sign(gap)}${gap}pp</strong> &mdash; the largest positive ` +
    `gender gap among the five main parties. ` +
    (refGap !== null
      ? `Reform UK is the only major party where men win at a higher rate than women (${sign(refGap)}${refGap}pp for women vs men). `
      : '') +
    `Notably, Labour women were ${lab.pct_female}% of Labour candidates but ${lab.pct_female_elected}% of ` +
    `Labour&rsquo;s elected councillors &mdash; women punching above their candidacy weight.`;
}

// ── Section: Incumbents ───────────────────────────────────────────────────────
function renderIncumbents(lab, summary) {
  const labFRet = lab.inc_female_retention_pct;
  const labMRet = lab.inc_male_retention_pct;
  const labDiff = r1(labFRet - labMRet);
  const natFRet = summary.inc_female_retention_pct;
  const natMRet = summary.inc_male_retention_pct;
  const natDiff = r1(natFRet - natMRet);
  const labFInc = lab.inc_female_elected + lab.inc_female_defeated;
  const labMInc = lab.inc_male_elected   + lab.inc_male_defeated;
  const natFInc = summary.inc_female_elected + summary.inc_female_defeated;
  const natMInc = summary.inc_male_elected   + summary.inc_male_defeated;

  document.getElementById('p3-intro').innerHTML =
    `Of the <strong>${fmt(lab.inc_total)} Labour incumbents</strong> who stood for re-election, ` +
    `<strong>${lab.inc_female_pct}% were women</strong>. Labour&rsquo;s overall incumbent retention rate ` +
    `was just <strong>${lab.inc_retention_pct}%</strong> &mdash; well below the national average of ` +
    `<strong>${summary.inc_retention_pct}%</strong>, reflecting Labour&rsquo;s difficult picture in ` +
    `defending seats in 2026. ` +
    `Among Labour incumbents who stood, women were re-elected at <strong>${labFRet}%</strong> ` +
    `compared to <strong>${labMRet}%</strong> for men &mdash; a difference of ` +
    `<strong>${sign(labDiff)}${labDiff}pp</strong>.`;

  document.getElementById('p3-stats').innerHTML =
    statCard(lab.inc_retention_pct + '%', 'Labour incumbent retention', `${fmt(lab.inc_elected)} re-elected of ${fmt(lab.inc_total)}`) +
    statCard(labFRet + '%', 'Labour women incumbents retained', `${fmt(lab.inc_female_elected)} of ${fmt(labFInc)}`) +
    statCard(labMRet + '%', 'Labour men incumbents retained', `${fmt(lab.inc_male_elected)} of ${fmt(labMInc)}`) +
    statCard(summary.inc_retention_pct + '%', 'National all-party retention', `${fmt(summary.inc_elected)} of ${fmt(summary.inc_total)}`);

  const rows = [
    { cells: ['Labour women (incumbents)', fmt(labFInc), fmt(lab.inc_female_elected), fmt(lab.inc_female_defeated), fmtP(labFRet)] },
    { cells: ['Labour men (incumbents)',   fmt(labMInc), fmt(lab.inc_male_elected),   fmt(lab.inc_male_defeated),   fmtP(labMRet)] },
    { cells: ['All parties &mdash; women', fmt(natFInc), fmt(summary.inc_female_elected), fmt(summary.inc_female_defeated), fmtP(natFRet)] },
    { cells: ['All parties &mdash; men',   fmt(natMInc), fmt(summary.inc_male_elected),   fmt(summary.inc_male_defeated),   fmtP(natMRet)] },
  ];
  document.getElementById('p3-table-wrap').innerHTML = buildTable(
    ['Group', 'Stood', 'Re-elected', 'Defeated', 'Retention rate'],
    rows
  );

  document.getElementById('p3-finding').innerHTML =
    `<strong>Female incumbents do not hold on at higher rates than male incumbents.</strong> ` +
    `For Labour, women incumbents were retained at ${labFRet}% vs ${labMRet}% for men ` +
    `(${sign(labDiff)}${labDiff}pp). Nationally the pattern is the same: ${natFRet}% for women vs ` +
    `${natMRet}% for men (${sign(natDiff)}${natDiff}pp). The gap is very small and consistent. ` +
    `<br><br>Labour women&rsquo;s overall win-rate advantage (Part&nbsp;2) comes not from incumbents ` +
    `doing better, but from <strong>newly elected Labour women winning at higher rates than newly ` +
    `elected Labour men</strong>: ${fmt(lab.new_female_elected)} new Labour women won seats ` +
    `&mdash; ${lab.new_female_elected_pct}% of all new Labour wins, well above their ${lab.pct_female}% ` +
    `share of candidacies.`;
}

// ── Section: Regions ─────────────────────────────────────────────────────────
function renderRegions(regionLabour, stats) {
  // Exclude East Midlands (only 14 Labour candidates — unreliable)
  const data = stats.by_region_outperformance.filter(r => r.region !== 'East Midlands (England)');
  const londonRow = data.find(r => r.region === 'London');

  document.getElementById('p4-intro').innerHTML =
    `In <strong>${stats.narrative_flags.regions_women_outperform.filter(r => r !== 'East Midlands (England)').length} ` +
    `of 8 regions</strong> Labour women win at a higher rate than Labour men. ` +
    `<strong>London</strong> shows the largest gap &mdash; Labour women win at ` +
    `<strong>${regionLabour['London'] ? regionLabour['London'].female_win_rate : '\u2014'}%</strong>, ` +
    `compared to ${regionLabour['London'] ? regionLabour['London'].male_win_rate : '\u2014'}% for men ` +
    `(+${londonRow ? londonRow.f_minus_m : '\u2014'}pp). ` +
    `East Midlands is excluded from this analysis: only 14 Labour candidates stood in that region, ` +
    `insufficient for reliable conclusions.`;

  // Region dropdown options
  const sel = document.getElementById('region-select');
  data.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.region;
    opt.textContent = r.region.replace(' (England)', '');
    sel.appendChild(opt);
  });

  // Render table and chart
  renderRegionTable(data, regionLabour, '');

  const labels = data.map(r => r.region.replace(' (England)', ''));
  const gaps   = data.map(r => r.f_minus_m);
  const colors = gaps.map(g => g >= 0 ? '#1a6e3a' : '#b5003e');

  makeChart('chart-regions', {
    type: 'bar',
    data: { labels, datasets: [{ data: gaps, backgroundColor: colors, borderRadius: 3 }] },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ' ' + (ctx.raw > 0 ? '+' : '') + ctx.raw + 'pp' } },
      },
      scales: {
        x: {
          title: { display: true, text: 'Win rate gap (pp): Labour women minus Labour men' },
          ticks: { callback: v => (v > 0 ? '+' : '') + v + 'pp' },
        },
      },
    },
  });
}

function renderRegionTable(data, regionLabour, highlightRegion) {
  const rows = data.map(r => {
    const rl  = regionLabour[r.region] || {};
    return {
      cells: [
        r.region.replace(' (England)', ''),
        fmt(rl.total   || 0),
        fmtP(rl.pct_female),
        fmtP(r.f_win_rate),
        fmtP(r.m_win_rate),
        gapStr(r.f_win_rate, r.m_win_rate),
      ],
      cls: r.region === highlightRegion ? 'highlight' : '',
    };
  });
  document.getElementById('p4-table-wrap').innerHTML = buildTable(
    ['Region', 'Labour candidates', '% female cands', 'Women win%', 'Men win%', 'F&minus;M gap'],
    rows
  );
}

// ── Section: Election type ────────────────────────────────────────────────────
function renderElectionType(etPartyMap) {
  const full    = etPartyMap['full']    && etPartyMap['full']['Labour'];
  const partial = etPartyMap['partial'] && etPartyMap['partial']['Labour'];

  if (!full || !partial) {
    document.getElementById('p5-intro').textContent = 'Election type data unavailable.';
    return;
  }

  const fullGap    = r1(full.female_win_rate    - full.male_win_rate);
  const partialGap = r1(partial.female_win_rate - partial.male_win_rate);

  document.getElementById('p5-intro').innerHTML =
    `England&rsquo;s councils use two main election patterns: <strong>all-out elections</strong> ` +
    `(all seats at once, every four years) and <strong>partial elections</strong> ` +
    `(a third or half of seats per year). The gender gap differs sharply between them. ` +
    `In full elections, Labour women outperform Labour men by ` +
    `<strong>${sign(fullGap)}${fullGap}pp</strong>; in partial elections the gap is ` +
    `<strong>${sign(partialGap)}${partialGap}pp</strong>.`;

  document.getElementById('p5-cards').innerHTML =
    etypeCard('All-out elections', full,    fullGap) +
    etypeCard('By-thirds / By-halves',  partial, partialGap);

  // Party comparison table
  const rows = PARTY_DISPLAY.map(pd => {
    const f = etPartyMap['full']    && etPartyMap['full'][pd.key];
    const p = etPartyMap['partial'] && etPartyMap['partial'][pd.key];
    return { cells: [
      pd.key,
      f ? fmtP(f.female_win_rate) : '\u2014',
      f ? fmtP(f.male_win_rate)   : '\u2014',
      f ? gapStr(f.female_win_rate, f.male_win_rate) : '\u2014',
      p ? fmtP(p.female_win_rate) : '\u2014',
      p ? fmtP(p.male_win_rate)   : '\u2014',
      p ? gapStr(p.female_win_rate, p.male_win_rate) : '\u2014',
    ]};
  });
  document.getElementById('p5-table-wrap').innerHTML = buildTable(
    ['Party', 'F win% (full)', 'M win% (full)', 'Gap (full)', 'F win% (partial)', 'M win% (partial)', 'Gap (partial)'],
    rows
  );
}

function etypeCard(title, d, gap) {
  const gCls = gap >= 0 ? 'gap-pos' : 'gap-neg';
  return `<div class="etype-card">
    <h3>${title}</h3>
    <ul class="etype-stat-list">
      <li><span class="etype-stat-key">Labour candidates</span>
          <span class="etype-stat-val">${fmt(d.total)}</span></li>
      <li><span class="etype-stat-key">Women win rate</span>
          <span class="etype-stat-val">${fmtP(d.female_win_rate)}</span></li>
      <li><span class="etype-stat-key">Men win rate</span>
          <span class="etype-stat-val">${fmtP(d.male_win_rate)}</span></li>
      <li><span class="etype-stat-key">Gender gap</span>
          <span class="etype-stat-val ${gCls}">${sign(gap)}${gap}pp</span></li>
      <li><span class="etype-stat-key">% female candidates</span>
          <span class="etype-stat-val">${fmtP(d.pct_female)}</span></li>
    </ul>
  </div>`;
}

// ── Section: Statistical analysis ────────────────────────────────────────────
function renderStats(stats) {
  const c = stats.correlations;

  document.getElementById('p6-intro').innerHTML =
    `What factors correlate with Labour women winning? Using Pearson correlation at ward level, ` +
    `we tested three variables against Labour women&rsquo;s win rate across ` +
    `<strong>${fmt(stats.ward_count_both_genders)} wards</strong> where Labour fielded both male ` +
    `and female candidates.`;

  const corrDefs = [
    {
      vars: 'Turnout vs Labour women&rsquo;s win rate',
      r: c.turnout_vs_f_win_rate.r,
      n: c.turnout_vs_f_win_rate.n,
      dir: c.turnout_vs_f_win_rate.direction,
      interp: 'In lower-turnout wards, Labour women tend to win more often. Higher turnout may reflect more competitive contests where all candidates face greater challenges.',
    },
    {
      vars: '% female Labour candidates vs women&rsquo;s win rate',
      r: c.pct_female_vs_f_win_rate.r,
      n: c.pct_female_vs_f_win_rate.n,
      dir: c.pct_female_vs_f_win_rate.direction,
      interp: 'Where Labour fields <em>fewer</em> women, those women tend to win more often &mdash; a selection effect. Councils fielding more women inevitably place some in less winnable wards.',
    },
    {
      vars: 'Council size vs Labour women&rsquo;s win rate',
      r: c.council_size_vs_f_win_rate.r,
      n: c.council_size_vs_f_win_rate.n,
      dir: c.council_size_vs_f_win_rate.direction,
      interp: 'No meaningful relationship between the size of a council and Labour women&rsquo;s win rate.',
    },
  ];

  document.getElementById('p6-corr').innerHTML = corrDefs.map(cc => {
    const abs = Math.abs(cc.r);
    const strength = abs < 0.1 ? 'Negligible' : abs < 0.3 ? 'Weak' : abs < 0.5 ? 'Moderate' : 'Strong';
    const dirCls  = cc.dir === 'positive' ? 'pos' : cc.dir === 'negative' ? 'neg' : 'neut';
    return `<div class="corr-card">
      <div class="corr-vars">${cc.vars}</div>
      <div class="corr-r ${dirCls}">${cc.r > 0 ? '+' : ''}${cc.r.toFixed(4)}</div>
      <div class="corr-n">${strength} &middot; n&thinsp;=&thinsp;${fmt(cc.n)}</div>
      <div class="corr-interp">${cc.interp}</div>
    </div>`;
  }).join('');

  const selR = c.pct_female_vs_f_win_rate.r.toFixed(2);
  document.getElementById('p6-finding').innerHTML =
    `<strong>The selection effect (r&thinsp;=&thinsp;${selR})</strong> is the most practically significant finding. ` +
    `Labour fields more women in councils where it is stronger, but in those councils some women are ` +
    `placed in harder-to-win wards, reducing the headline female win rate. ` +
    `This is <em>not</em> evidence that women are less electable &mdash; rather, it reflects a deliberate ` +
    `effort to increase female candidacy that inevitably places some women in long-shot contests. ` +
    `Where Labour women are fielded selectively, they win.`;
}

// ── Region dropdown wiring ────────────────────────────────────────────────────
function wireRegionDropdown(regionLabour, stats) {
  const data = stats.by_region_outperformance.filter(r => r.region !== 'East Midlands (England)');
  document.getElementById('region-select').addEventListener('change', function () {
    renderRegionTable(data, regionLabour, this.value);
  });
}

// ── XLSX Export ───────────────────────────────────────────────────────────────
function wireExport(partyMap, regionLabour) {
  document.getElementById('btn-story-export').addEventListener('click', () =>
    doExport(partyMap, regionLabour)
  );
}

async function doExport(partyMap, regionLabour) {
  const btn = document.getElementById('btn-story-export');
  btn.disabled = true;
  btn.textContent = '\u231b Loading\u2026';
  try {
    const cands = await fetch('data/all_candidates.json').then(r => r.json());
    const wb = XLSX.utils.book_new();

    // Sheet 1: All candidates
    const candRows = cands.map(c => ({
      'Council':   c.council,
      'Ward':      c.ward,
      'Name':      c.n,
      'Party':     c.p,
      'Gender':    c.g,
      'Incumbent': c.inc ? 'Yes' : 'No',
      'Votes':     c.v,
      'Elected':   c.e ? 'Yes' : 'No',
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(candRows), 'All Candidates');

    // Sheet 2: By party
    const partyRows = PARTY_DISPLAY.map(pd => {
      const p = partyMap[pd.key];
      if (!p) return null;
      return {
        'Party':                    pd.key,
        'Candidates':               p.total,
        'Female Candidates':        p.female,
        '% Female Candidates':      p.pct_female,
        'Elected Total':            p.elected_total,
        'Female Elected':           p.elected_female,
        '% Female Elected':         p.pct_female_elected,
        'Female Win Rate %':        p.female_win_rate,
        'Male Win Rate %':          p.male_win_rate,
        'F-M Win Gap pp':           p.female_win_rate != null && p.male_win_rate != null
                                      ? r1(p.female_win_rate - p.male_win_rate) : null,
        'Incumbents Stood':         p.inc_total,
        'Inc Re-elected':           p.inc_elected,
        'Inc Retention %':          p.inc_retention_pct,
        'Female Inc Retention %':   p.inc_female_retention_pct,
        'Male Inc Retention %':     p.inc_male_retention_pct,
        'New Elected Female %':     p.new_female_elected_pct,
      };
    }).filter(Boolean);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(partyRows), 'By Party');

    // Sheet 3: Labour by region
    const regionRows = Object.entries(regionLabour).map(([rname, rl]) => ({
      'Region':               rname,
      'Labour Candidates':    rl.total,
      'Female Candidates':    rl.female,
      '% Female Candidates':  rl.pct_female,
      'Female Elected':       rl.elected_female,
      '% Female Elected':     rl.pct_female_elected,
      'Female Win Rate %':    rl.female_win_rate,
      'Male Win Rate %':      rl.male_win_rate,
      'F-M Win Gap pp':       rl.female_win_rate != null && rl.male_win_rate != null
                                ? r1(rl.female_win_rate - rl.male_win_rate) : null,
      'Inc Female Retain %':  rl.inc_female_retention_pct,
      'Inc Male Retain %':    rl.inc_male_retention_pct,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(regionRows), 'Labour By Region');

    // Sheet 4: Methodology
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Data Source', 'Description', 'Licence'],
      ['Democracy Club', 'Candidate and election results data (May 2026)', 'CC BY 4.0'],
      ['opencouncildata.co.uk', '2025 sitting councillor data — used for incumbency matching', 'See website'],
      ['ONS Baby Names 1904-2024', 'Used for name-based gender prediction', 'Open Government Licence v3.0'],
      ['OS LAD Boundaries (May 2025)', 'Council boundary map data', 'Open Government Licence v3.0'],
      [],
      ['Gender methodology'],
      ['Gender is predicted algorithmically from candidate first names in three stages:'],
      ['1. gender_guesser library (open-source name database)'],
      ['2. ONS historical baby names dataset (year-aware, 1904-2024)'],
      ['3. Claude Sonnet 4.6 (AI) for remaining unresolved names'],
      ['63 candidates (<0.3%) remain unclassified and are excluded from percentages.'],
      ['Gender is treated as binary for analysis purposes and is not self-reported.'],
      [],
      ['Notes'],
      ['Labour figures combine "Labour Party" and "Labour and Co-operative Party" candidates.'],
      ['Welsh councils (Newport City Council, Powys County Council) are excluded.'],
      ['Incumbency: candidates matched against 2025 sitting councillors by council + ward + name.'],
    ]), 'Methodology');

    XLSX.writeFile(wb, 'labour-gender-2026-england.xlsx');
  } catch (err) {
    alert('Export failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '\u2659 Export\u00a0(.xlsx)';
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const [councils, stats] = await Promise.all([
      fetch('data/councils.json').then(r => r.json()),
      fetch('data/story_stats.json').then(r => r.json()),
    ]);

    const partyMap = buildPartyMap(councils.by_party);
    const lab      = partyMap['Labour'];
    const summary  = councils.summary;

    // Merged Labour lookup by region
    const regionLabour = {};
    for (const [rname, rp] of Object.entries(councils.by_region_by_party)) {
      const merged = mergePartyEntries(rp, k => LABOUR_KEYS.has(k));
      if (merged) regionLabour[rname] = merged;
    }

    // Party map per election type
    const etPartyMap = {};
    for (const [et, plist] of Object.entries(councils.by_election_type_by_party || {})) {
      etPartyMap[et] = buildPartyMap(plist);
    }

    renderHero(lab, summary);
    renderCandidates(lab, summary, partyMap);
    renderWinning(lab, partyMap);
    renderIncumbents(lab, summary);
    renderRegions(regionLabour, stats);
    renderElectionType(etPartyMap);
    renderStats(stats);
    wireRegionDropdown(regionLabour, stats);
    wireExport(partyMap, regionLabour);

  } catch (err) {
    document.querySelector('.story-main').innerHTML =
      `<div style="padding:3rem 1.5rem;color:#b5003e;max-width:600px;margin:0 auto">` +
      `<strong>Error loading data:</strong> ${esc(err.message)}</div>`;
    throw err;
  }
}

window.addEventListener('DOMContentLoaded', init);
