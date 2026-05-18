"""
narrative_stats.py  —  Print all key Labour stats that drive the story.html narrative.
Run BEFORE writing prose to verify actual numbers.

Usage:
    py scripts/narrative_stats.py
"""

import json
import os

ROOT        = os.path.join(os.path.dirname(__file__), '..')
COUNCILS_IN = os.path.join(ROOT, 'docs', 'data', 'councils.json')

# Canonical display name → list of actual party name strings in the data
# Multiple entries are summed (e.g. Labour + Labour and Co-operative Party)
PARTY_ALIASES = {
    'Labour':        ['Labour Party', 'Labour and Co-operative Party'],
    'Conservative':  ['Conservative and Unionist Party'],
    'Lib Dems':      ['Liberal Democrats'],
    'Green':         ['Green Party'],
    'Reform UK':     ['Reform UK'],
}
STORY_PARTIES = ['Labour', 'Conservative', 'Lib Dems', 'Green', 'Reform UK']

with open(COUNCILS_IN, encoding='utf-8') as f:
    data = json.load(f)

summary = data['summary']
_raw_by_party = {p['party']: p for p in data['by_party']}
by_region = {r['region']: r for r in data['by_region']}
by_rbp    = data.get('by_region_by_party', {})


def _merge_parties(canonical):
    """Return a merged accumulator dict for a canonical party name."""
    keys = PARTY_ALIASES.get(canonical, [canonical])
    rows = [_raw_by_party[k] for k in keys if k in _raw_by_party]
    if not rows:
        return None
    if len(rows) == 1:
        return dict(rows[0])
    # Sum numeric fields across aliases
    merged = dict(rows[0])
    num_fields = [
        'total', 'female', 'male', 'unknown',
        'elected_total', 'elected_female', 'elected_male', 'elected_unknown',
        'conf_high', 'conf_medium', 'conf_low',
        'inc_total', 'inc_elected', 'inc_defeated', 'new_elected',
    ]
    optional_num = ['inc_female_elected', 'inc_male_elected', 'inc_female_defeated', 'inc_male_defeated']
    for field in num_fields + optional_num:
        if field in merged:
            merged[field] = sum(r.get(field, 0) for r in rows)
    # Recompute derived pct fields
    kn  = merged['female'] + merged['male']
    ekn = merged['elected_female'] + merged['elected_male']
    inc_kn = (merged.get('inc_female_elected', 0) + merged.get('inc_male_elected', 0) +
              merged.get('inc_female_defeated', 0) + merged.get('inc_male_defeated', 0))
    def sp(n, d): return round(n / d * 100, 1) if d else None
    merged['pct_female']          = sp(merged['female'], kn)
    merged['pct_female_elected']  = sp(merged['elected_female'], ekn)
    merged['female_win_rate']     = sp(merged['elected_female'], merged['female'])
    merged['male_win_rate']       = sp(merged['elected_male'], merged['male'])
    merged['inc_retention_pct']   = sp(merged['inc_elected'], merged['inc_total'])
    merged['inc_female_pct']      = sp(merged.get('inc_female_elected', 0) + merged.get('inc_female_defeated', 0),
                                       merged['inc_total'])
    merged['new_female_elected_pct'] = sp(
        sum(r.get('new_female_elected_pct', 0) or 0 for r in rows),  # fallback: not perfect but rare
        len(rows))
    merged['party'] = canonical
    return merged


# Build canonical party lookup
by_party = {name: _merge_parties(name) for name in STORY_PARTIES}

# Also expose a helper for region_by_party (fuzzy match inside region lists)
def _region_lab_entry(rp_list):
    """Return merged Labour entry from a region's party list."""
    keys = PARTY_ALIASES['Labour']
    rows = [p for p in rp_list if p['party'] in keys]
    if not rows:
        return None
    if len(rows) == 1:
        return rows[0]
    merged = dict(rows[0])
    num_fields = ['total','female','male','unknown','elected_total','elected_female','elected_male']
    for f in num_fields:
        merged[f] = sum(r.get(f, 0) for r in rows)
    kn  = merged['female'] + merged['male']
    ekn = merged['elected_female'] + merged['elected_male']
    def sp(n, d): return round(n/d*100, 1) if d else None
    merged['pct_female']          = sp(merged['female'], kn)
    merged['pct_female_elected']  = sp(merged['elected_female'], ekn)
    merged['female_win_rate']     = sp(merged['elected_female'], merged['female'])
    merged['male_win_rate']       = sp(merged['elected_male'], merged['male'])
    return merged

lab = by_party.get('Labour')
if not lab:
    print('ERROR: Labour not found in by_party (checked Labour Party + Labour and Co-operative Party)')
    exit(1)

nat = summary

def pct(n, d):
    return f'{n/d*100:.1f}%' if d else '—'

def pp(label, val, suffix=''):
    print(f'  {label:<50} {val}{suffix}')

SEP = '─' * 70

print(SEP)
print('NATIONAL BASELINE')
print(SEP)
pp('Total candidates', f'{nat["total_candidates"]:,}')
pp('Female candidates', f'{nat["female_candidates"]:,}  ({nat["pct_female"]}%)')
pp('Elected total', f'{nat["elected_total"]:,}')
pp('Female elected', f'{nat["elected_female"]:,}  ({nat["pct_female_elected"]}%)')
pp('National female win rate', f'{nat["national_female_win_rate"]}%')
pp('National male win rate', f'{nat["national_male_win_rate"]}%')

print()
print(SEP)
print('LABOUR — CANDIDACY')
print(SEP)
pp('Total Labour candidates', f'{lab["total"]:,}')
pp('Labour female candidates', f'{lab["female"]:,}')
pp('Labour male candidates', f'{lab["male"]:,}')
pp('% Labour candidates who are female', f'{lab["pct_female"]}%')
pp('Female candidacy vs national avg', f'{lab["pct_female"]}% vs {nat["pct_female"]}%')

print()
print(SEP)
print('LABOUR — ELECTION OUTCOMES')
print(SEP)
pp('Labour elected total', f'{lab["elected_total"]:,}')
pp('Labour female elected', f'{lab["elected_female"]:,}')
pp('Labour male elected', f'{lab["elected_male"]:,}')
pp('% Labour elected who are female', f'{lab["pct_female_elected"]}%')
pp('Labour female win rate', f'{lab["female_win_rate"]}%')
pp('Labour male win rate', f'{lab["male_win_rate"]}%')
win_gap = round(lab["female_win_rate"] - lab["male_win_rate"], 1) if lab["female_win_rate"] and lab["male_win_rate"] else None
pp('Female win rate minus male win rate', f'{win_gap:+}pp' if win_gap is not None else '—')
pp('Labour female win rate vs national', f'{lab["female_win_rate"]}% vs {nat["national_female_win_rate"]}%')
pp('Labour female win rate diff vs others', f'{lab.get("female_win_rate_diff_vs_others"):+}pp' if lab.get("female_win_rate_diff_vs_others") is not None else '—')

print()
print(SEP)
print('LABOUR — INCUMBENTS')
print(SEP)
pp('Labour incumbents who stood', f'{lab["inc_total"]:,}')
pp('Labour incumbents re-elected', f'{lab["inc_elected"]:,}')
pp('Labour incumbents defeated', f'{lab["inc_defeated"]:,}')
pp('Labour incumbent retention rate', f'{lab["inc_retention_pct"]}%')
pp('% of Labour incumbents who are female', f'{lab["inc_female_pct"]}%')
pp('Labour new elected (non-incumbents)', f'{lab["new_elected"]:,}')
pp('% of Labour new elected who are female', f'{lab["new_female_elected_pct"]}%')

# Female incumbent elected/defeated (from new fields if present)
if 'inc_female_elected' in lab:
    pp('Labour female incumbents re-elected', f'{lab["inc_female_elected"]:,}')
    pp('Labour female incumbents defeated', f'{lab["inc_female_defeated"]:,}')
    pp('Labour male incumbents re-elected', f'{lab["inc_male_elected"]:,}')
    pp('Labour male incumbents defeated', f'{lab["inc_male_defeated"]:,}')
    if lab['inc_total'] and lab['inc_female_pct']:
        inc_f = round(lab['inc_total'] * lab['inc_female_pct'] / 100)
        inc_m = lab['inc_total'] - inc_f
        f_ret = pct(lab['inc_female_elected'], inc_f)
        m_ret = pct(lab['inc_male_elected'], inc_m)
        pp('Labour female incumbent retention rate (approx)', f_ret)
        pp('Labour male incumbent retention rate (approx)', m_ret)
else:
    print('  [inc_female_elected not yet in data — run Phase 1 first]')

print()
print(SEP)
print('PARTY COMPARISON TABLE')
print(SEP)
headers = ['Party', 'Total', 'Female', '%F Cands', '%F Elected', 'F Win%', 'M Win%', 'F-M Win Gap']
print(f'  {"Party":<22} {"Total":>7} {"Female":>7} {"%F Cands":>9} {"%F Elec":>9} {"F Win%":>7} {"M Win%":>7} {"F-M Gap":>9}')
print('  ' + '-' * 75)
for party_name in STORY_PARTIES:
    p = by_party.get(party_name)
    if not p:
        print(f'  {party_name:<22} NOT IN DATA')
        continue
    gap = round(p['female_win_rate'] - p['male_win_rate'], 1) if p['female_win_rate'] is not None and p['male_win_rate'] is not None else None
    gap_str = f'{gap:+.1f}pp' if gap is not None else '—'
    print(f'  {party_name:<22} {p["total"]:>7,} {p["female"]:>7,} {str(p["pct_female"])+"%":>9} {str(p["pct_female_elected"])+"%":>9} {str(p["female_win_rate"])+"%":>7} {str(p["male_win_rate"])+"%":>7} {gap_str:>9}')

print()
print(SEP)
print('LABOUR BY REGION')
print(SEP)
print(f'  {"Region":<25} {"Total":>7} {"Female":>7} {"%F Cands":>9} {"%F Elec":>9} {"F Win%":>7} {"M Win%":>7} {"F-M Gap":>9}')
print('  ' + '-' * 75)
for region_name, rp in sorted(by_rbp.items()):
    lab_r = _region_lab_entry(rp)
    if not lab_r:
        continue
    gap = round(lab_r['female_win_rate'] - lab_r['male_win_rate'], 1) if lab_r.get('female_win_rate') is not None and lab_r.get('male_win_rate') is not None else None
    gap_str = f'{gap:+.1f}pp' if gap is not None else '—'
    print(f'  {region_name:<25} {lab_r["total"]:>7,} {lab_r["female"]:>7,} {str(lab_r["pct_female"])+"%":>9} {str(lab_r["pct_female_elected"])+"%":>9} {str(lab_r.get("female_win_rate","—"))+("%" if lab_r.get("female_win_rate") is not None else ""):>7} {str(lab_r.get("male_win_rate","—"))+("%" if lab_r.get("male_win_rate") is not None else ""):>7} {gap_str:>9}')

if 'by_election_type_by_party' in data:
    print()
    print(SEP)
    print('LABOUR BY ELECTION TYPE')
    print(SEP)
    for etype, plist in data['by_election_type_by_party'].items():
        keys = PARTY_ALIASES['Labour']
        lab_rows = [p for p in plist if p['party'] in keys]
        if not lab_rows:
            lab_et = None
        elif len(lab_rows) == 1:
            lab_et = lab_rows[0]
        else:
            lab_et = dict(lab_rows[0])
            for fld in ['total','female','elected_female','elected_male','elected_total']:
                lab_et[fld] = sum(r.get(fld,0) for r in lab_rows)
            kn = lab_et['female'] + lab_et.get('male', 0)
            ekn = lab_et['elected_female'] + lab_et['elected_male']
            def sp(n,d): return round(n/d*100,1) if d else None
            lab_et['pct_female'] = sp(lab_et['female'], kn)
            lab_et['pct_female_elected'] = sp(lab_et['elected_female'], ekn)
            lab_et['female_win_rate'] = sp(lab_et['elected_female'], lab_et['female'])
            lab_et['male_win_rate'] = sp(lab_et['elected_male'], lab_et.get('male',0))
        if not lab_et:
            continue
        gap = round(lab_et['female_win_rate'] - lab_et['male_win_rate'], 1) if lab_et.get('female_win_rate') is not None and lab_et.get('male_win_rate') is not None else None
        print(f'  {etype.upper()} elections:')
        pp(f'    Total Labour candidates', f'{lab_et["total"]:,}')
        pp(f'    % Female candidates', f'{lab_et["pct_female"]}%')
        pp(f'    Female elected', f'{lab_et["elected_female"]:,}  ({lab_et["pct_female_elected"]}%)')
        pp(f'    Female win rate', f'{lab_et.get("female_win_rate")}%')
        pp(f'    Male win rate', f'{lab_et.get("male_win_rate")}%')
        pp(f'    Female vs male win gap', f'{gap:+}pp' if gap is not None else '—')
else:
    print('\n  [by_election_type_by_party not yet in data — run Phase 1 first]')

print()
print(SEP)
print('NARRATIVE CALLOUTS (for prose writing)')
print(SEP)
# Headline stat
print(f'  HEADLINE: Labour fielded {lab["female"]:,} women out of {lab["total"]:,} candidates ({lab["pct_female"]}%)')
# Win rate direction
if win_gap is not None:
    direction = 'higher' if win_gap > 0 else 'lower'
    print(f'  WIN RATE: Labour women\'s win rate was {win_gap:+.1f}pp {direction} than Labour men\'s')
# Regional extremes
region_lab = {}
for rname, rp in by_rbp.items():
    lr = _region_lab_entry(rp)
    if lr and lr.get('pct_female') is not None:
        region_lab[rname] = lr
if region_lab:
    best_region = max(region_lab, key=lambda r: region_lab[r]['pct_female'])
    worst_region = min(region_lab, key=lambda r: region_lab[r]['pct_female'])
    print(f'  REGIONS: Highest Labour female candidacy: {best_region} ({region_lab[best_region]["pct_female"]}%)')
    print(f'           Lowest  Labour female candidacy: {worst_region} ({region_lab[worst_region]["pct_female"]}%)')
