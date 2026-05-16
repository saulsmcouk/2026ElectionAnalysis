'use strict';

// ── HTML label helpers (moved from utils.js) ─────────────────────────────
// These return HTML strings, so they belong here rather than in the pure
// data-utility module (utils.js).

function formatGenderLabel(g) {
  if (g === 'female') return { text: 'Female', cls: 'gender-f' };
  if (g === 'male')   return { text: 'Male',   cls: 'gender-m' };
  return { text: 'Uncategorised', cls: 'gender-u' };
}

function formatMethodLabel(method) {
  const methodText = {
    existing:       'Recorded',
    gender_guesser: 'gender_guesser',
    ons:            'ONS names',
    claude:         'Claude AI',
    unknown:        'Uncategorised',
  };
  const text = methodText[method] || method || 'Uncategorised';
  return `<span class="method-badge method-${method || 'unknown'}">${text}</span>`;
}

function confCell(level) {
  const cls = level === 'high' ? 'conf-high' : level === 'medium' ? 'conf-med' : level === 'low' ? 'conf-low' : 'conf-none';
  const lbl = level === 'high' ? 'High' : level === 'medium' ? 'Med' : level === 'low' ? 'Low' : '\u2014';
  return `<span class="conf-cell">${lbl}<span class="conf-badge ${cls}"></span></span>`;
}

// ── Summary cards ─────────────────────────────────────────────────────────

function tmplSummaryCards(cards) {
  return cards.map(c => `
    <div class="card">
      <div class="card-value ${c.cls}">${c.value}</div>
      <div class="card-label">${c.label}</div>
      <div class="card-sub">${c.sub}</div>
    </div>
  `).join('');
}

// ── Seat changes panel ────────────────────────────────────────────────────

function tmplSeatChanges(d, contextLabel) {
  const fmt = n => (n || 0).toLocaleString();
  const retPct  = d.inc_retention_pct != null ? d.inc_retention_pct + '%' : '\u2014';
  const incFPct = d.inc_female_pct    != null ? d.inc_female_pct    + '% female' : '';
  const newFPct = d.new_female_elected_pct != null ? d.new_female_elected_pct + '% female' : '';
  return `
    <div class="seat-changes-header">
      <h2>Seat changes <span class="seat-changes-context">&mdash; ${escHtml(contextLabel)}</span></h2>
    </div>
    <div class="seat-changes-tiles">
      <div class="council-stat-tile">
        <div class="pst-value">${fmt(d.inc_total)}</div>
        <div class="pst-label">Incumbents stood${incFPct ? '<br><span class="pst-sub">' + escHtml(incFPct) + '</span>' : ''}</div>
      </div>
      <div class="council-stat-tile sc-held">
        <div class="pst-value">${fmt(d.inc_elected)}</div>
        <div class="pst-label">Re-elected<br><span class="pst-sub">${escHtml(retPct)} retention rate</span></div>
      </div>
      <div class="council-stat-tile sc-lost">
        <div class="pst-value">${fmt(d.inc_defeated)}</div>
        <div class="pst-label">Incumbents defeated</div>
      </div>
      <div class="council-stat-tile sc-new">
        <div class="pst-value">${fmt(d.new_elected)}</div>
        <div class="pst-label">New councillors elected${newFPct ? '<br><span class="pst-sub">' + escHtml(newFPct) + '</span>' : ''}</div>
      </div>
    </div>
    <p class="chart-hint">Defeated = stood and lost. Incumbents who chose not to re-stand are not counted.</p>
  `;
}

// ── Map info box ──────────────────────────────────────────────────────────

function tmplInfoBox(council, femalePctStr, electedPctStr, highConfPct) {
  const unclassified = council.unknown || 0;
  const unclassRow = unclassified > 0
    ? `<tr><td>Unclassified</td><td style="color:#aaa">${unclassified}</td></tr>`
    : '';
  return `
    <strong>${escHtml(council.org_name)}</strong>
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

// ── Council stats panel ───────────────────────────────────────────────────

function tmplCouncilStats(c, kn, fwr, mwr, sentenceHtml) {
  const elecLabel = c.election_type === 'full'    ? 'Full council'
                  : c.election_type === 'partial'  ? (c.election_model === 'THIRDS' ? 'Partial \u2013 by thirds' : c.election_model === 'HALVES' ? 'Partial \u2013 by halves' : 'Partial')
                  : 'Unknown';
  const elecSub   = c.council_size ? `${(c.elected_total||0)} of ${c.council_size} seats` : '';
  return `
    <div class="council-stats-header">
      <span class="council-stats-name">${escHtml(c.org_name)} &mdash; all parties</span>
    </div>
    <div class="council-stats-grid">
      <div class="council-stat-tile">
        <div class="pst-value">${(c.total || 0).toLocaleString()}</div>
        <div class="pst-label">Total candidates</div>
      </div>
      <div class="council-stat-tile">
        <div class="pst-value female">${(c.female || 0).toLocaleString()}</div>
        <div class="pst-label">Female candidates<br><span class="pst-sub">${pctStr(c.female, kn)} of known gender</span></div>
      </div>
      <div class="council-stat-tile">
        <div class="pst-value male">${(c.male || 0).toLocaleString()}</div>
        <div class="pst-label">Male candidates<br><span class="pst-sub">${pctStr(c.male, kn)} of known gender</span></div>
      </div>
      <div class="council-stat-tile">
        <div class="pst-value">${(c.elected_total || 0).toLocaleString()}</div>
        <div class="pst-label">Elected</div>
      </div>
      <div class="council-stat-tile">
        <div class="pst-value female">${(c.elected_female || 0).toLocaleString()}</div>
        <div class="pst-label">Female elected<br><span class="pst-sub">${fwr} win rate</span></div>
      </div>
      <div class="council-stat-tile">
        <div class="pst-value male">${(c.elected_male || 0).toLocaleString()}</div>
        <div class="pst-label">Male elected<br><span class="pst-sub">${mwr} win rate</span></div>
      </div>
      <div class="council-stat-tile">
        <div class="pst-value" style="font-size:1rem">${escHtml(elecLabel)}</div>
        <div class="pst-label">Election type${elecSub ? '<br><span class="pst-sub">' + escHtml(elecSub) + '</span>' : ''}</div>
      </div>
    </div>
    ${sentenceHtml}
  `;
}

// ── Region detail panel ───────────────────────────────────────────────────

function tmplRegionDetail(r, name, fwrStr, mwrStr, knownN, sentenceF, sentenceM, sentenceG) {
  return `
    <div class="party-detail-header">
      <span class="party-detail-name">${escHtml(name)}</span>
      <button class="btn-clear-party" id="btn-clear-region">&#10005;&nbsp;All regions</button>
    </div>
    <div class="party-stat-grid">
      <div class="party-stat-tile">
        <div class="pst-value">${r.total.toLocaleString()}</div>
        <div class="pst-label">Total candidates</div>
      </div>
      <div class="party-stat-tile">
        <div class="pst-value female">${r.female.toLocaleString()}</div>
        <div class="pst-label">Female candidates<br><span class="pst-sub">${pctStr(r.female, knownN)} of known gender</span></div>
      </div>
      <div class="party-stat-tile">
        <div class="pst-value">${r.elected_total.toLocaleString()}</div>
        <div class="pst-label">Elected</div>
      </div>
      <div class="party-stat-tile">
        <div class="pst-value female">${r.elected_female.toLocaleString()}</div>
        <div class="pst-label">Female elected<br><span class="pst-sub">${fwrStr} win rate</span></div>
      </div>
      <div class="party-stat-tile">
        <div class="pst-value male">${r.elected_male.toLocaleString()}</div>
        <div class="pst-label">Male elected<br><span class="pst-sub">${mwrStr} win rate</span></div>
      </div>
    </div>
    ${sentenceF ? `<p class="party-sentence">${sentenceF}</p>` : ''}
    ${sentenceM ? `<p class="party-sentence">${sentenceM}</p>` : ''}
    ${sentenceG ? `<p class="party-sentence">${sentenceG}</p>` : ''}
  `;
}

// ── Party detail panel ────────────────────────────────────────────────────

function tmplPartyDetail(name, dr, fwrStr, mwrStr, seatsStr, wardsStr, knownN, totalN, sentenceE, sentenceF, sentenceG, candidateSectionHtml) {
  return `
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
    ${sentenceG ? `<p class="party-sentence">${sentenceG}</p>` : ''}
    ${candidateSectionHtml}
  `;
}

// ── Candidate section (party detail drilldown) ────────────────────────────

function tmplCandidateSection(councilName, rows) {
  const rowsHtml = rows.map((c, i) => {
    const g = formatGenderLabel(c.g);
    return `<tr class="cand-row ${c.e ? 'elected-row' : ''}" data-cand-idx="${i}">
      <td>${escHtml(c.n || '\u2014')}</td>
      <td>${escHtml(c.ward)}</td>
      <td class="num">${c.v !== null && c.v !== undefined ? Number(c.v).toLocaleString() : '\u2014'}</td>
      <td class="num">${c.e ? '<span class="elected-tick">&#10003;</span>' : '<span class="not-elected-cross">&#10007;</span>'}</td>
      <td><span class="${g.cls}">${g.text}</span></td>
      <td>${confCell(c.cf)}</td>
    </tr>`;
  }).join('');

  return `
    <div class="party-cands-header">Candidates in <strong>${escHtml(councilName)}</strong> &mdash; ${rows.length.toLocaleString()} total</div>
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

// ── Council table rows ────────────────────────────────────────────────────

function tmplTableRows(rows) {
  return rows.map(c => {
    const pctCls = p => {
      if (p === null || p === undefined) return 'pct-neutral';
      return p >= 50 ? 'pct-high-female' : p < 30 ? 'pct-high-male' : 'pct-neutral';
    };
    const hc = c.pct_high_conf;
    const confBadgeCls = hc === null || hc === undefined ? 'conf-none'
      : hc >= 80 ? 'conf-high' : hc >= 60 ? 'conf-med' : 'conf-low';
    const confPctCell = hc !== null && hc !== undefined
      ? `${hc}%<span class="conf-badge ${confBadgeCls}"></span>`
      : '\u2014';
    const turnout = c.avg_turnout !== null ? c.avg_turnout + '%' : '\u2014';
    const elecBadge = c.election_type === 'full'
      ? '<span class="election-badge election-badge--full">Full</span>'
      : c.election_type === 'partial'
        ? (c.election_model === 'THIRDS' ? '<span class="election-badge election-badge--partial">By thirds</span>'
           : c.election_model === 'HALVES' ? '<span class="election-badge election-badge--partial">By halves</span>'
           : '<span class="election-badge election-badge--partial">Partial</span>')
        : '\u2014';
    return `<tr data-council-slug="${c.ward_slug || ''}">
      <td>${c.org_name}</td>
      <td>${c.total}</td>
      <td>${c.female}</td>
      <td class="pct-cell ${pctCls(c.pct_female)}">${c.pct_female !== null ? c.pct_female + '%' : '\u2014'}</td>
      <td class="conf-cell">${confPctCell}</td>
      <td>${c.elected_total}</td>
      <td>${c.elected_female}</td>
      <td class="pct-cell ${pctCls(c.pct_female_elected)}">${c.pct_female_elected !== null ? c.pct_female_elected + '%' : '\u2014'}</td>
      <td>${turnout}</td>
      <td>${elecBadge}</td>
    </tr>`;
  }).join('');
}

// ── Candidate detail modal ────────────────────────────────────────────────

function tmplCandidateModal(cand, councilName, wardName) {
  const g = formatGenderLabel(cand.g);

  const imgHtml = cand.img
    ? `<img class="cand-photo" src="${escHtml(cand.img)}" alt="Photo of ${escHtml(cand.n || '')}" loading="lazy" onerror="this.parentNode.classList.add('no-photo');this.remove()">`
    : '';

  const links = [];
  if (cand.pid) links.push(`<a href="https://candidates.democracyclub.org.uk/person/${encodeURIComponent(cand.pid)}/" target="_blank" rel="noopener" class="cand-link dc-link">Democracy Club profile</a>`);
  if (cand.tw)  links.push(`<a href="https://x.com/${encodeURIComponent(cand.tw)}" target="_blank" rel="noopener" class="cand-link">&#120143; @${escHtml(cand.tw)}</a>`);
  if (cand.url) links.push(`<a href="${escHtml(cand.url)}" target="_blank" rel="noopener" class="cand-link">&#127760; Website</a>`);
  if (cand.li)  links.push(`<a href="${escHtml(cand.li)}" target="_blank" rel="noopener" class="cand-link">LinkedIn</a>`);
  if (cand.bs)  links.push(`<a href="${escHtml(cand.bs)}" target="_blank" rel="noopener" class="cand-link">Bluesky</a>`);
  if (cand.rs)  links.push(`<a href="${escHtml(cand.rs)}" target="_blank" rel="noopener" class="cand-link results-link">Results source</a>`);
  const linksHtml = links.length ? `<div class="cand-links">${links.join('')}</div>` : '';

  const stmtHtml = cand.stmt
    ? `<div class="cand-stmt"><h4>Statement to voters</h4><p>${escHtml(cand.stmt).replace(/\n/g, '<br>')}</p></div>`
    : '';

  const bdHtml = cand.bd
    ? `<div class="cand-stat"><div class="cs-val">${escHtml(cand.bd)}</div><div class="cs-lbl">Birth date</div></div>`
    : '';

  const methodLabels = {
    existing:       'Recorded in source data',
    gender_guesser: 'Name database (gender_guesser)',
    ons:            'ONS baby names dataset',
    claude:         'Claude Sonnet 4.6 (AI)',
    unknown:        'Unclassified',
  };

  const wardStr = wardName
    ? `<span class="cand-ward">&#8250; ${escHtml(wardName)}</span>`
    : (cand.ward ? `<span class="cand-ward">&#8250; ${escHtml(cand.ward)}</span>` : '');

  return `
    <div class="cand-header${cand.img ? '' : ' no-photo'}">
      ${imgHtml}
      <div class="cand-header-info">
        <div class="cand-name">${escHtml(cand.n || '\u2014')}</div>
        <div class="cand-party-badge">${escHtml(cand.p || '\u2014')}</div>
        <div class="cand-council-line">${escHtml(councilName || '')} ${wardStr}</div>
      </div>
    </div>
    <div class="cand-stats-row">
      <div class="cand-stat">
        <div class="cs-val">${cand.v !== null && cand.v !== undefined ? Number(cand.v).toLocaleString() : '\u2014'}</div>
        <div class="cs-lbl">Votes</div>
      </div>
      <div class="cand-stat ${cand.e ? 'cs-elected' : 'cs-not-elected'}">
        <div class="cs-val">${cand.e ? '&#10003; Elected' : '&#10007; Not elected'}</div>
        <div class="cs-lbl">Result</div>
      </div>
      ${bdHtml}
    </div>
    ${linksHtml}
    ${stmtHtml}
    <div class="cand-gender-block">
      <h4>Gender assignment</h4>
      <div class="cand-gender-row">
        <span class="${g.cls}">${g.text}</span>
        <span class="method-sm">${methodLabels[cand.m] || cand.m || 'Unknown'}</span>
        ${confCell(cand.cf)}
      </div>
      <p class="cand-disclaimer">Gender is predicted algorithmically from name data and should not be treated as the candidate&rsquo;s self-identified gender.</p>
      <p class="cand-disclaimer">All candidate data (votes, election results, contact details, photos, statements) is sourced from <a href="https://democracyclub.org.uk" target="_blank" rel="noopener">Democracy Club</a> and is reproduced here as-is. No guarantees are made as to its accuracy or completeness. For authoritative results please refer to the relevant local council.</p>
    </div>
  `;
}

// ── Ward card grid ────────────────────────────────────────────────────────

function tmplWardCards(wards) {
  return wards.map((ward, i) => {
    const counts = ward.candidates.reduce((acc, c) => {
      if (c.g === 'female') acc.f += 1;
      else if (c.g === 'male') acc.m += 1;
      else acc.u += 1;
      return acc;
    }, { f: 0, m: 0, u: 0 });
    const turnout = ward.turnout_pct !== null && ward.turnout_pct !== undefined
      ? `Turnout: ${ward.turnout_pct}%`
      : 'Turnout: \u2014';
    return `
      <button class="ward-btn" data-ward-index="${i}">
        <strong>${ward.ward}</strong>
        <div class="ward-meta">Seats: ${ward.seats || '\u2014'} | Candidates: ${ward.candidates.length}</div>
        <div class="ward-meta">F ${counts.f} | M ${counts.m} | U ${counts.u}</div>
        <div class="ward-meta">${turnout}</div>
      </button>
    `;
  }).join('');
}

// ── Ward detail results table ─────────────────────────────────────────────

function _incBadge(cd) {
  if (cd.inc) {
    return cd.e
      ? '<span class="inc-badge inc-badge--held">HELD</span>'
      : '<span class="inc-badge inc-badge--lost">LOST</span>';
  }
  return cd.e ? '<span class="inc-badge inc-badge--new">NEW</span>' : '';
}

function tmplWardDetail(ward, candidates, totalVotes) {
  const turnout = ward.turnout_pct !== null && ward.turnout_pct !== undefined
    ? `${ward.turnout_pct}%`
    : '\u2014';

  // Incumbent mini-summary
  const incCands   = candidates.filter(c => c.inc);
  const incElected = incCands.filter(c => c.e).length;
  const incDef     = incCands.length - incElected;
  const newElected = candidates.filter(c => !c.inc && c.e).length;
  const incSummary = incCands.length > 0
    ? `<div class="ward-inc-summary">
        <strong>Incumbents:</strong> ${incCands.length} stood
        &middot; <span class="inc-badge inc-badge--held">${incElected} HELD</span>
        &middot; <span class="inc-badge inc-badge--lost">${incDef} LOST</span>
        &nbsp;&nbsp;<strong>New elected:</strong>
        <span class="inc-badge inc-badge--new">${newElected} NEW</span>
      </div>`
    : '';

  const rows = candidates.map((cd, i) => {
    const pct = totalVotes > 0 ? ((Number(cd.v) || 0) / totalVotes * 100).toFixed(1) + '%' : '\u2014';
    const g = formatGenderLabel(cd.g);
    const electedCell = cd.e
      ? '<span class="elected-tick">&#10003;</span>'
      : '<span class="not-elected-cross">&#10007;</span>';
    return `
      <tr class="cand-row ${cd.e ? 'elected-row' : ''}" data-cand-idx="${i}">
        <td>${cd.n || '\u2014'}${_incBadge(cd)}</td>
        <td>${cd.p || '\u2014'}</td>
        <td class="num">${cd.v !== null && cd.v !== undefined ? Number(cd.v).toLocaleString() : '\u2014'}</td>
        <td class="num">${pct}</td>
        <td class="num">${electedCell}</td>
        <td><span class="${g.cls}">${g.text}</span></td>
        <td>${formatMethodLabel(cd.m)}</td>
        <td>${confCell(cd.cf)}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="ward-detail-bar">
      <button class="modal-back" id="modal-back">&#8592; Back to wards</button>
      <button class="btn-export" id="btn-export-ward-detail">&#8659;&nbsp;Export XLSX</button>
    </div>
    <div class="ward-results-title">${ward.ward}</div>
    <div class="ward-results-meta">Seats: ${ward.seats || '\u2014'} | Candidates: ${candidates.length} | Turnout: ${turnout}</div>
    ${incSummary}
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
}


// ── Breadcrumb strip ──────────────────────────────────────────────────────

function tmplBreadcrumb(parts) {
  let html = '';
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) html += '<span class="bc-sep" aria-hidden="true">\u203a</span>';
    const p = parts[i];
    if (p.clickable) {
      html += `<button class="bc-crumb bc-link" data-idx="${i}">${escHtml(p.label)}</button>`;
    } else {
      html += `<span class="bc-crumb bc-current">${escHtml(p.label)}</span>`;
    }
  }
  return html;
}
