# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project overview

A static single-page app analysing gender representation in the 2026 England local elections (156 councils, ~25,000 candidates). Data is sourced from Democracy Club's open candidacy CSV (`dc_data.csv`). Gender was predicted in three stages — gender_guesser library, ONS historical baby names, then Claude Sonnet 4.6 for unresolved names. Incumbent status is determined by matching against 2025 sitting councillors from opencouncildata.co.uk.

The site is hosted on GitHub Pages from `docs/`.

## Build commands

```bash
# Regenerate all JSON data files from dc_data.csv
py scripts/build_data.py

# Serve locally for development (run from repo root)
py -m http.server 8080 --directory docs

# Then visit http://localhost:8080
```

No bundler, no install step. Python 3.12 required (invoke via `py` on Windows).

## Architecture

```
dc_data.csv                    # Source data (Democracy Club export)
scripts/
  build_data.py                # Data pipeline: CSV + incumbents.json → JSON
  identify_incumbents.py       # Match 2026 candidates → 2025 sitting councillors
  data/
    incumbents.json            # person_id → {is_incumbent, matched_name, ...}
    ward_fuzzy_log.json        # 182 fuzzy ward matches logged for review
docs/                          # GitHub Pages root (serve this directory)
  index.html                   # Single-page app entry point
  style.css                    # All styles
  js/
    utils.js                   # Pure helper functions: colour, fmt, pctStr, escHtml, toStackedPct
    charts.js                  # buildChart() + chartRegistry + colour constants
    export.js                  # XLSX export functions (SheetJS)
    views.js                   # Pure HTML template functions (data in → HTML string out)
    app.js                     # Application logic (map, charts, table, modals, state)
  data/
    councils.json              # Global aggregates, summary, by_party, by_region,
                               # by_council, by_region_by_party
    wards/{slug}.json          # Per-council ward drilldown (156 files, loaded on demand)
    LAD_boundaries.geojson     # Leaflet map boundaries (LAD25 codes)
Old/                           # Archive of earlier working notes
```

### Script load order (all globals, no ES modules)
`js/utils.js` → `js/charts.js` → `js/export.js` → `js/views.js` → `js/app.js`

### CDN libraries
- Leaflet 1.9.4 (map)
- Chart.js 4.4.3 (stacked bar charts)
- SheetJS 0.20.3 (XLSX export)

## Data schema

### `councils.json`
```json
{
  "summary": { "total": 25066, "female": 7800, "inc_total": 2292, "inc_elected": 1316, "inc_defeated": 976, "new_elected": 3742, "inc_female_pct": 41.6, "new_female_elected_pct": 32.7, "inc_retention_pct": 57.4, ... },
  "by_council": [{ "org_name": "...", "lad_code": "E07...", "nuts1": "South East", "ward_slug": "...", "total": 160, "female": 52, "inc_total": 7, "inc_elected": 4, "inc_defeated": 3, "new_elected": 10, "inc_female_pct": 14.3, "new_female_elected_pct": 0.0, "inc_retention_pct": 57.1, ... }],
  "by_party":   [{ "party": "Labour", "total": 8000, "female": 2900, "inc_total": ..., ... }],
  "by_region":  [{ "region": "South East", "total": 4200, "female": 1400, "inc_total": ..., ... }],
  "by_region_by_party": { "South East": [{ "party": "...", "inc_total": ..., ... }], ... }
}
```

All aggregate objects (`summary`, each `by_council` entry, each `by_party` entry, each `by_region` entry, each `by_region_by_party` value entry) include these incumbency fields:
- `inc_total` — incumbents who stood
- `inc_elected` — incumbents who were re-elected
- `inc_defeated` — incumbents who stood and lost (= `inc_total - inc_elected`)
- `new_elected` — non-incumbents who were elected
- `inc_female_pct` — % of incumbents who stood who are female
- `new_female_elected_pct` — % of new elected who are female
- `inc_retention_pct` — % of incumbents who stood and were re-elected

### `wards/{slug}.json`
```json
{
  "wards": [{
    "ward": "Birchwood",
    "seats": 2,
    "turnout_pct": 28.4,
    "results_url": "https://...",
    "candidates": [{
      "n": "Jane Smith",
      "p": "Labour",
      "v": 842,
      "r": 1,
      "e": true,
      "g": "female",
      "m": "existing",
      "cf": "high",
      "pid": "12345",
      "img": "https://...",
      "stmt": "Statement to voters...",
      "tw": "janesmith",
      "url": "https://...",
      "li": "https://...",
      "bs": "https://...",
      "bd": "1985-04-12"
    }]
  }]
}
```

Optional candidate fields (`pid`, `img`, `stmt`, `tw`, `url`, `li`, `bs`, `bd`, `inc`) are omitted when empty/false to keep file sizes small.

- **`inc`** — `true` if the candidate was a 2025 sitting councillor matched by `identify_incumbents.py`; **omitted (not `false`) when not an incumbent**.

## Key conventions

- **Short JSON keys**: Candidate fields use single/two-letter keys (`n`, `p`, `v`, `r`, `e`, `g`, `m`, `cf`, `pid`, `img`, etc.) to minimise file size across 156 JSON files.
- **No bundler**: All JS is plain globals. Do not introduce `import`/`export` or npm packages.
- **Colour system**: `COL_FEMALE = '#d6496f'`, `COL_MALE = '#2171b5'`. Map fill colour is computed by `councilColor()` in `js/utils.js` using HSL lerp between these hues, desaturated by confidence level.
- **Chart registry**: All Chart.js instances are tracked in `chartRegistry` (in `charts.js`) and destroyed before rebuild to avoid canvas conflicts.
- **Ward data cache**: Ward JSONs are loaded on demand via `fetch` and cached in `wardDataCache` (a `Map`). Check before fetching to avoid duplicate requests.
- **State variables**: `selectedCouncilName`, `selectedPartyName`, `selectedRegionName` drive the UI context. Clearing one usually requires clearing dependents (e.g. clearing council clears party).
- **Unicode in JS strings**: Avoid special chars (—, ≥, ×, ') in `replace_string_in_file` old-strings — they cause match failures. Use `\u2014` etc. or write a patch script.
- **Python command**: Use `py` (not `python`) on Windows.

## GitHub Pages

Repository: `https://github.com/saulsmcouk/2026ElectionAnalysis.git`  
Pages source: `main` branch, `/docs` folder.  
After pushing to `main`, changes go live automatically.
