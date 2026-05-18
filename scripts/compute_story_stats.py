"""
compute_story_stats.py  —  Ward-level statistical analysis for story.html.

Reads all ward JSON files + councils.json. For each ward, extracts Labour
candidate data (party name 'Labour', as merged by build_data.py).
Computes Pearson correlations and grouped comparisons. Outputs
docs/data/story_stats.json which story.js reads at runtime.

Usage:
    py scripts/compute_story_stats.py
"""

import json
import math
import os
import re

ROOT        = os.path.join(os.path.dirname(__file__), '..')
COUNCILS_IN = os.path.join(ROOT, 'docs', 'data', 'councils.json')
WARDS_DIR   = os.path.join(ROOT, 'docs', 'data', 'wards')
OUT_PATH    = os.path.join(ROOT, 'docs', 'data', 'story_stats.json')

LABOUR_NAMES = {'Labour'}  # Canonical name after merging in build_data.py

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def pearson_r(pairs):
    """Pearson r from list of (x, y) pairs. Returns (r, n) or (None, n)."""
    pairs = [(x, y) for x, y in pairs if x is not None and y is not None
             and not math.isnan(x) and not math.isnan(y)]
    n = len(pairs)
    if n < 5:
        return None, n
    xs = [p[0] for p in pairs]
    ys = [p[1] for p in pairs]
    mx, my = sum(xs) / n, sum(ys) / n
    num  = sum((x - mx) * (y - my) for x, y in pairs)
    den_x = math.sqrt(sum((x - mx) ** 2 for x in xs))
    den_y = math.sqrt(sum((y - my) ** 2 for y in ys))
    if den_x * den_y == 0:
        return None, n
    return round(num / (den_x * den_y), 4), n


def direction(r):
    if r is None:
        return 'insufficient data'
    if r > 0.1:
        return 'positive'
    if r < -0.1:
        return 'negative'
    return 'negligible'


def safe_pct(n, d):
    return round(n / d * 100, 1) if d else None


# ---------------------------------------------------------------------------
# Load council metadata: org_name → {nuts1, election_type, council_size, avg_turnout}
# ---------------------------------------------------------------------------
with open(COUNCILS_IN, encoding='utf-8') as f:
    councils_data = json.load(f)

council_meta = {
    c['org_name']: {
        'nuts1':         c.get('nuts1', ''),
        'election_type': c.get('election_type'),
        'council_size':  c.get('council_size'),
        'avg_turnout':   c.get('avg_turnout'),
    }
    for c in councils_data['by_council']
}

# ---------------------------------------------------------------------------
# Process ward files
# ---------------------------------------------------------------------------
print('Reading ward files…')

# Accumulators for correlations (ward-level observations)
# Each entry: (x_value, y_value)
obs_turnout_vs_fwinrate  = []   # turnout_pct vs Labour female win rate
obs_pct_f_cands_vs_fwin  = []   # % Labour female cands vs Labour female win rate
obs_csize_vs_fwinrate    = []   # council_size vs Labour female win rate
obs_turnout_vs_gap       = []   # turnout_pct vs (f_win_rate - m_win_rate)
obs_pct_f_cands_vs_gap   = []   # pct_f_cands vs (f_win_rate - m_win_rate)

# Grouped: election_type → {f_wins, f_total, m_wins, m_total, wards}
by_etype = {}

# Grouped: region → {f_wins, f_total, m_wins, m_total, wards}
by_region = {}

ward_count = 0
labour_ward_count = 0
both_gender_count = 0

ward_files = sorted(f for f in os.listdir(WARDS_DIR) if f.endswith('.json'))

for fname in ward_files:
    fpath = os.path.join(WARDS_DIR, fname)
    with open(fpath, encoding='utf-8') as fh:
        payload = json.load(fh)

    org  = payload.get('org', '')
    meta = council_meta.get(org, {})
    nuts1        = meta.get('nuts1', '')
    election_type = meta.get('election_type')  # 'full', 'partial', or None
    council_size  = meta.get('council_size')

    for ward in payload.get('wards', []):
        ward_count += 1
        turnout = ward.get('turnout_pct')

        cands     = ward.get('candidates', [])
        lab_cands = [c for c in cands if c.get('p') in LABOUR_NAMES]
        if not lab_cands:
            continue
        labour_ward_count += 1

        lab_f = [c for c in lab_cands if c.get('g') == 'female']
        lab_m = [c for c in lab_cands if c.get('g') == 'male']
        f_total, m_total = len(lab_f), len(lab_m)
        f_won = sum(1 for c in lab_f if c.get('e'))
        m_won = sum(1 for c in lab_m if c.get('e'))

        pct_f_cands = safe_pct(f_total, f_total + m_total)

        f_win_rate = f_won / f_total if f_total > 0 else None
        m_win_rate = m_won / m_total if m_total > 0 else None
        gap = round(f_win_rate - m_win_rate, 4) if (f_win_rate is not None and m_win_rate is not None) else None
        if f_total > 0 and m_total > 0:
            both_gender_count += 1

        # Observations for correlation
        if f_win_rate is not None:
            obs_turnout_vs_fwinrate.append((turnout, f_win_rate))
            obs_pct_f_cands_vs_fwin.append((pct_f_cands, f_win_rate))
            obs_csize_vs_fwinrate.append((council_size, f_win_rate))
        if gap is not None:
            obs_turnout_vs_gap.append((turnout, gap))
            obs_pct_f_cands_vs_gap.append((pct_f_cands, gap))

        # Grouped by election type
        if election_type:
            if election_type not in by_etype:
                by_etype[election_type] = {'f_wins': 0, 'f_total': 0, 'm_wins': 0, 'm_total': 0, 'wards': 0}
            g = by_etype[election_type]
            g['f_wins']  += f_won
            g['f_total'] += f_total
            g['m_wins']  += m_won
            g['m_total'] += m_total
            g['wards']   += 1

        # Grouped by region
        if nuts1:
            if nuts1 not in by_region:
                by_region[nuts1] = {'f_wins': 0, 'f_total': 0, 'm_wins': 0, 'm_total': 0, 'wards': 0}
            g = by_region[nuts1]
            g['f_wins']  += f_won
            g['f_total'] += f_total
            g['m_wins']  += m_won
            g['m_total'] += m_total
            g['wards']   += 1

print(f'  Wards total: {ward_count}')
print(f'  Wards with Labour candidates: {labour_ward_count}')
print(f'  Wards with Labour of both genders: {both_gender_count}')

# ---------------------------------------------------------------------------
# Pearson correlations
# ---------------------------------------------------------------------------
r_turnout_fwin,    n_tf  = pearson_r(obs_turnout_vs_fwinrate)
r_pctf_fwin,       n_pf  = pearson_r(obs_pct_f_cands_vs_fwin)
r_csize_fwin,      n_cf  = pearson_r(obs_csize_vs_fwinrate)
r_turnout_gap,     n_tg  = pearson_r(obs_turnout_vs_gap)
r_pctf_gap,        n_pg  = pearson_r(obs_pct_f_cands_vs_gap)

# ---------------------------------------------------------------------------
# Election type grouped stats
# ---------------------------------------------------------------------------
etype_out = {}
for etype, g in by_etype.items():
    f_wr = safe_pct(g['f_wins'], g['f_total'])
    m_wr = safe_pct(g['m_wins'], g['m_total'])
    etype_out[etype] = {
        'lab_f_win_rate':  f_wr,
        'lab_m_win_rate':  m_wr,
        'f_minus_m':       round(f_wr - m_wr, 1) if (f_wr is not None and m_wr is not None) else None,
        'lab_f_total':     g['f_total'],
        'lab_m_total':     g['m_total'],
        'wards':           g['wards'],
    }

# ---------------------------------------------------------------------------
# Region outperformance (sorted descending by f_minus_m gap)
# ---------------------------------------------------------------------------
region_out = []
for rname, g in by_region.items():
    f_wr = safe_pct(g['f_wins'], g['f_total'])
    m_wr = safe_pct(g['m_wins'], g['m_total'])
    gap  = round(f_wr - m_wr, 1) if (f_wr is not None and m_wr is not None) else None
    region_out.append({
        'region':          rname,
        'lab_f_win_rate':  f_wr,
        'lab_m_win_rate':  m_wr,
        'f_minus_m':       gap,
        'lab_f_total':     g['f_total'],
        'lab_m_total':     g['m_total'],
        'wards':           g['wards'],
    })
region_out.sort(key=lambda x: (x['f_minus_m'] is None, -(x['f_minus_m'] or 0)))

# ---------------------------------------------------------------------------
# Narrative flags (pre-computed strings/booleans for story.js prose)
# ---------------------------------------------------------------------------
national_f_total = sum(g['f_total'] for g in by_region.values())
national_f_wins  = sum(g['f_wins']  for g in by_region.values())
national_m_total = sum(g['m_total'] for g in by_region.values())
national_m_wins  = sum(g['m_wins']  for g in by_region.values())
national_f_wr    = safe_pct(national_f_wins, national_f_total)
national_m_wr    = safe_pct(national_m_wins, national_m_total)
national_gap     = round(national_f_wr - national_m_wr, 1) if (national_f_wr is not None and national_m_wr is not None) else None

regions_with_gap = [r for r in region_out if r['f_minus_m'] is not None]
best_region      = regions_with_gap[0]['region']  if regions_with_gap else None
worst_region     = regions_with_gap[-1]['region'] if regions_with_gap else None
regions_women_outperform = [r['region'] for r in regions_with_gap if r['f_minus_m'] > 0]
regions_men_outperform   = [r['region'] for r in regions_with_gap if r['f_minus_m'] < 0]

etype_gaps = {k: v['f_minus_m'] for k, v in etype_out.items() if v['f_minus_m'] is not None}
best_etype = max(etype_gaps, key=etype_gaps.get) if etype_gaps else None

flags = {
    'women_outperform_nationally':  national_gap is not None and national_gap > 0,
    'national_gap_pp':              national_gap,
    'best_region_for_women':        best_region,
    'worst_region_for_women':       worst_region,
    'regions_women_outperform':     regions_women_outperform,
    'regions_men_outperform':       regions_men_outperform,
    'election_type_favours_women':  best_etype,
    'turnout_r_direction':          direction(r_turnout_fwin),
    'selection_r_direction':        direction(r_pctf_fwin),
    'council_size_r_direction':     direction(r_csize_fwin),
    'turnout_gap_r_direction':      direction(r_turnout_gap),
    'selection_gap_r_direction':    direction(r_pctf_gap),
}

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
output = {
    'ward_count_total':         ward_count,
    'ward_count_labour':        labour_ward_count,
    'ward_count_both_genders':  both_gender_count,
    'national_lab_f_win_rate':  national_f_wr,
    'national_lab_m_win_rate':  national_m_wr,
    'national_lab_gap_pp':      national_gap,
    'correlations': {
        'turnout_vs_f_win_rate': {
            'r': r_turnout_fwin, 'n': n_tf,
            'label': 'Turnout vs Labour female win rate',
            'direction': direction(r_turnout_fwin),
        },
        'pct_f_cands_vs_f_win_rate': {
            'r': r_pctf_fwin, 'n': n_pf,
            'label': '% Labour female candidates vs Labour female win rate',
            'direction': direction(r_pctf_fwin),
        },
        'council_size_vs_f_win_rate': {
            'r': r_csize_fwin, 'n': n_cf,
            'label': 'Council size vs Labour female win rate',
            'direction': direction(r_csize_fwin),
        },
        'turnout_vs_gender_gap': {
            'r': r_turnout_gap, 'n': n_tg,
            'label': 'Turnout vs Labour female\u2212male win rate gap',
            'direction': direction(r_turnout_gap),
        },
        'pct_f_cands_vs_gender_gap': {
            'r': r_pctf_gap, 'n': n_pg,
            'label': '% Labour female candidates vs female\u2212male win gap',
            'direction': direction(r_pctf_gap),
        },
    },
    'by_election_type':           etype_out,
    'by_region_outperformance':   region_out,
    'narrative_flags':            flags,
}

os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
with open(OUT_PATH, 'w', encoding='utf-8') as fh:
    json.dump(output, fh, indent=2, ensure_ascii=False)
print(f'Wrote {OUT_PATH}')

# Human-readable summary
print()
print('=== KEY FINDINGS ===')
print(f'National Labour gap (women - men win rate): {national_gap:+}pp' if national_gap is not None else 'N/A')
print(f'Women outperform nationally: {flags["women_outperform_nationally"]}')
print(f'Best region for Labour women: {best_region}')
print(f'Worst region for Labour women: {worst_region}')
print(f'Regions where Labour women outperform: {regions_women_outperform}')
print()
print('Correlations (Labour female win rate):')
print(f'  vs turnout:      r={r_turnout_fwin}  n={n_tf}  [{direction(r_turnout_fwin)}]')
print(f'  vs %f cands:     r={r_pctf_fwin}  n={n_pf}  [{direction(r_pctf_fwin)}]')
print(f'  vs council size: r={r_csize_fwin}  n={n_cf}  [{direction(r_csize_fwin)}]')
print()
print('Correlations (Labour female-male win gap):')
print(f'  vs turnout:   r={r_turnout_gap}  n={n_tg}  [{direction(r_turnout_gap)}]')
print(f'  vs %f cands:  r={r_pctf_gap}  n={n_pg}  [{direction(r_pctf_gap)}]')
print()
print('By election type:')
for et, v in etype_out.items():
    print(f'  {et}: F win {v["lab_f_win_rate"]}%, M win {v["lab_m_win_rate"]}%, gap {v["f_minus_m"]:+}pp  ({v["wards"]} wards)')
print()
print('By region (sorted by Labour women outperformance):')
for r in region_out:
    gap_str = f'{r["f_minus_m"]:+}pp' if r['f_minus_m'] is not None else '—'
    print(f'  {r["region"]:<30} F win: {str(r["lab_f_win_rate"])+"%":>6}  M win: {str(r["lab_m_win_rate"])+"%":>6}  gap: {gap_str}')
