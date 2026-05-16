# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project overview

A static single-page app analysing gender representation in the 2026 England local elections (156 councils, ~25,000 candidates). Data is sourced from Democracy Club's open candidacy CSV (`dc_data.csv`). Gender was predicted in three stages — gender_guesser library, ONS historical baby names, then Claude Sonnet 4.6 for unresolved names.

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
scripts/build_data.py          # Data pipeline: CSV → JSON
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
  "summary": { "total": 25066, "female": 7800, ... },
  "by_council": [{ "org_name": "...", "lad_code": "E07...", "nuts1": "South East", "ward_slug": "...", "total": 160, "female": 52, ... }],
  "by_party":   [{ "party": "Labour", "total": 8000, "female": 2900, ... }],
  "by_region":  [{ "region": "South East", "total": 4200, "female": 1400, ... }],
  "by_region_by_party": { "South East": [{ "party": "...", ... }], ... }
}
```

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

Optional candidate fields (`pid`, `img`, `stmt`, `tw`, `url`, `li`, `bs`, `bd`) are omitted when empty to keep file sizes small.

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
