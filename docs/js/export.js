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
  const dataRows = wards.map(ward => {
    const counts = ward.candidates.reduce((acc, c) => {
      if (c.g === 'female') acc.f++;
      else if (c.g === 'male') acc.m++;
      else acc.u++;
      if (c.inc) {
        acc.incTotal++;
        if (c.e) acc.incElected++;
      }
      return acc;
    }, { f: 0, m: 0, u: 0, incTotal: 0, incElected: 0 });
    return [
      ward.ward, ward.seats ?? null, ward.candidates.length,
      counts.f, counts.m, counts.u,
      counts.incTotal, counts.incElected, counts.incTotal - counts.incElected,
      ward.turnout_pct ?? null,
    ];
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
