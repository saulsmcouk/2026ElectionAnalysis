'use strict';

// ── XLSX Export helpers ───────────────────────────────────────────────────
// These functions have no external effects beyond triggering a browser file
// download. They read only data passed as arguments (no app state).

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
    ['Stage 3 — 63 candidates (<0.3%) remain Unclassified (names where gender could not be determined).'],
    [''],
    ['Percentages are calculated only among candidates with a known gender.'],
    ['Gender is treated as binary (male/female) for prediction purposes.'],
    [''],
    ['Incumbency Methodology'],
    [''],
    ['Incumbent status = the candidate was a sitting councillor in the same ward and council as of 2025.'],
    ['Matching requires: (1) council name match; (2) ward name match (exact, then fuzzy with first-word constraint);'],
    ['(3) full-name fuzzy match (SequenceMatcher ratio ≥ 0.80).'],
    [''],
    ['Incumbent data sourced from opencouncildata.co.uk (scraped May 2026).'],
    ['"Defeated" = stood and lost. Incumbents who chose not to re-stand are NOT counted.'],
    ['Some incumbents cannot be identified due to ward boundary reorganisations.'],
    [''],
    ['Data Sources'],
    ['Election data: Democracy Club (democracyclub.org.uk), licensed under CC BY 4.0'],
    ['  Licence: https://creativecommons.org/licenses/by/4.0/'],
    ['Incumbent data: opencouncildata.co.uk'],
    ['ONS data: Office for National Statistics, licensed under the Open Government Licence v.3.0'],
    ['  Licence: https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/'],
    ['Contains OS data © Crown copyright and database right [2026]'],
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

function exportWardList(council, wards) {
  const headers = [
    'Ward', 'Seats', 'Total Candidates', 'Female', 'Male', 'Unclassified',
    'Incumbents Stood', 'Re-elected', 'Defeated', 'Turnout %',
  ];
  const dataRows = wards.map(ward => [
    ward.ward, ward.seats ?? null, ward.candidates.length,
    ward.female_count ?? null, ward.male_count ?? null, ward.unknown_count ?? null,
    ward.inc_total ?? 0, ward.inc_elected ?? 0, ward.inc_defeated ?? 0,
    ward.turnout_pct ?? null,
  ]);
  exportToXlsx(
    `${council.org_name.replace(/[^\w-]/g, '_')}-wards.xlsx`,
    headers, dataRows,
    `${council.org_name} \u2014 Ward summary`,
  );
}

function exportWardDetail(council, ward, candidates) {
  const totalVotes = candidates.reduce((sum, c) => sum + (Number(c.v) || 0), 0);
  const methodText = { existing: 'Recorded', gender_guesser: 'gender_guesser', ons: 'ONS names', claude: 'Claude AI', unknown: 'Unclassified' };
  const headers = ['Name', 'Party', 'Votes', '% Votes', 'Elected', 'Incumbent', 'Outcome', 'Gender', 'Assignment Method', 'Confidence'];
  const dataRows = candidates.map(c => {
    const pct = totalVotes > 0 ? +((Number(c.v) || 0) / totalVotes * 100).toFixed(1) : null;
    const confLabel = c.cf === 'high' ? 'High' : c.cf === 'medium' ? 'Medium' : c.cf === 'low' ? 'Low' : 'Unknown';
    const incumbent = c.inc ? 'Yes' : 'No';
    const outcome = c.inc
      ? (c.e ? 'Held' : 'Lost')
      : (c.e ? 'New'  : 'Candidate');
    return [
      c.n || '', c.p || '', c.v ?? null, pct,
      c.e ? 'Yes' : 'No',
      incumbent, outcome,
      c.g || 'unclassified',
      methodText[c.m] || c.m || 'Unclassified',
      confLabel,
    ];
  });
  const slug = `${council.org_name}-${ward.ward}`.replace(/[^\w-]/g, '_');
  exportToXlsx(`${slug}.xlsx`, headers, dataRows, `${council.org_name} — ${ward.ward}`);
}

// ── Party / Region section XLSX export ────────────────────────────────────

function exportPartyExcel(parties, contextLabel, partyDetail) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildMethodologySheet(contextLabel), 'Methodology');

  const candHeaders = ['Party', 'Total Candidates', 'Female', 'Male', 'Unclassified', '% Female'];
  const candRows = parties.map(p => [
    p.party, p.total, p.female, p.male, p.unknown ?? 0, p.pct_female ?? null,
  ]);
  const wsCands = XLSX.utils.aoa_to_sheet([candHeaders, ...candRows]);
  wsCands['!cols'] = candHeaders.map(() => ({ wch: 18 }));
  wsCands['!autofilter'] = { ref: wsCands['!ref'] };
  XLSX.utils.book_append_sheet(wb, wsCands, 'Candidates by party');

  const elecHeaders = [
    'Party', 'Elected Total', 'Female Elected', 'Male Elected', '% Female Elected',
    'Female Win Rate %', 'Male Win Rate %',
    'Incumbents Stood', 'Re-elected', 'Defeated', 'New Elected', 'Retention %',
  ];
  const elecRows = parties.map(p => [
    p.party, p.elected_total, p.elected_female, p.elected_male, p.pct_female_elected ?? null,
    p.female_win_rate ?? null, p.male_win_rate ?? null,
    p.inc_total ?? null, p.inc_elected ?? null, p.inc_defeated ?? null,
    p.new_elected ?? null, p.inc_retention_pct ?? null,
  ]);
  const wsElec = XLSX.utils.aoa_to_sheet([elecHeaders, ...elecRows]);
  wsElec['!cols'] = elecHeaders.map(() => ({ wch: 18 }));
  wsElec['!autofilter'] = { ref: wsElec['!ref'] };
  XLSX.utils.book_append_sheet(wb, wsElec, 'Elected by party');

  if (partyDetail) {
    const pdRows = [
      ['Field', 'Value'],
      ['Party', partyDetail.party],
      ['Total candidates', partyDetail.total],
      ['Female candidates', partyDetail.female],
      ['Male candidates', partyDetail.male],
      ['% Female', partyDetail.pct_female],
      ['Elected total', partyDetail.elected_total],
      ['Female elected', partyDetail.elected_female],
      ['Male elected', partyDetail.elected_male],
      ['% Female elected', partyDetail.pct_female_elected],
      ['Female win rate %', partyDetail.female_win_rate ?? null],
      ['Male win rate %', partyDetail.male_win_rate ?? null],
      ['Incumbents stood', partyDetail.inc_total ?? null],
      ['Re-elected', partyDetail.inc_elected ?? null],
      ['Defeated', partyDetail.inc_defeated ?? null],
      ['New elected', partyDetail.new_elected ?? null],
      ['Retention %', partyDetail.inc_retention_pct ?? null],
    ];
    const wsPD = XLSX.utils.aoa_to_sheet(pdRows);
    wsPD['!cols'] = [{ wch: 24 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, wsPD, 'Party drilldown');
  }

  const suffix = contextLabel !== 'England' ? '-' + contextLabel.replace(/[^\w]/g, '_') : '';
  XLSX.writeFile(wb, `party-gender-breakdown${suffix}.xlsx`);
}

function exportRegionExcel(regions, contextLabel, regionDetail) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildMethodologySheet(contextLabel), 'Methodology');

  const candHeaders = ['Region', 'Total Candidates', 'Female', 'Male', '% Female'];
  const candRows = regions.map(r => [r.region, r.total, r.female, r.male, r.pct_female ?? null]);
  const wsCands = XLSX.utils.aoa_to_sheet([candHeaders, ...candRows]);
  wsCands['!cols'] = candHeaders.map(() => ({ wch: 20 }));
  wsCands['!autofilter'] = { ref: wsCands['!ref'] };
  XLSX.utils.book_append_sheet(wb, wsCands, 'Candidates by region');

  const elecHeaders = [
    'Region', 'Elected Total', 'Female Elected', 'Male Elected', '% Female Elected',
    'Female Win Rate %', 'Male Win Rate %',
    'Incumbents Stood', 'Re-elected', 'Defeated', 'New Elected', 'Retention %',
  ];
  const elecRows = regions.map(r => [
    r.region, r.elected_total, r.elected_female, r.elected_male, r.pct_female_elected ?? null,
    r.female_win_rate ?? null, r.male_win_rate ?? null,
    r.inc_total ?? null, r.inc_elected ?? null, r.inc_defeated ?? null,
    r.new_elected ?? null, r.inc_retention_pct ?? null,
  ]);
  const wsElec = XLSX.utils.aoa_to_sheet([elecHeaders, ...elecRows]);
  wsElec['!cols'] = elecHeaders.map(() => ({ wch: 20 }));
  wsElec['!autofilter'] = { ref: wsElec['!ref'] };
  XLSX.utils.book_append_sheet(wb, wsElec, 'Elected by region');

  if (regionDetail) {
    const rdRows = [
      ['Field', 'Value'],
      ['Region', regionDetail.region],
      ['Total candidates', regionDetail.total],
      ['Female candidates', regionDetail.female],
      ['Male candidates', regionDetail.male],
      ['% Female', regionDetail.pct_female],
      ['Elected total', regionDetail.elected_total],
      ['Female elected', regionDetail.elected_female],
      ['Male elected', regionDetail.elected_male],
      ['% Female elected', regionDetail.pct_female_elected],
      ['Female win rate %', regionDetail.female_win_rate ?? null],
      ['Male win rate %', regionDetail.male_win_rate ?? null],
      ['Incumbents stood', regionDetail.inc_total ?? null],
      ['Re-elected', regionDetail.inc_elected ?? null],
      ['Defeated', regionDetail.inc_defeated ?? null],
      ['New elected', regionDetail.new_elected ?? null],
      ['Retention %', regionDetail.inc_retention_pct ?? null],
    ];
    const wsRD = XLSX.utils.aoa_to_sheet(rdRows);
    wsRD['!cols'] = [{ wch: 24 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, wsRD, 'Region drilldown');
  }

  const suffix = contextLabel !== 'England' ? '-' + contextLabel.replace(/[^\w]/g, '_') : '';
  XLSX.writeFile(wb, `region-gender-breakdown${suffix}.xlsx`);
}
