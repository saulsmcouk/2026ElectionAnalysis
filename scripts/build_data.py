"""
Build docs/data/councils.json and copy the GeoJSON boundary file.

Reads:
  dc_data.csv         - candidacy data from Democracy Club
  genders.csv         - predicted genders (from assign_genders.py)
  LAD_MAY_2025_UK_BUC_*.geojson  - local authority boundary file

Outputs:
  docs/data/councils.json
  docs/data/LAD_boundaries.geojson
"""

import csv
import json
import os
import re
import shutil
from collections import defaultdict
from datetime import date
from glob import glob

ROOT = os.path.join(os.path.dirname(__file__), '..')
CSV_IN      = os.path.join(ROOT, 'dc_data.csv')
GENDERS_IN  = os.path.join(ROOT, 'genders.csv')
OUT_DIR     = os.path.join(ROOT, 'docs', 'data')
COUNCILS_OUT = os.path.join(OUT_DIR, 'councils.json')
GEOJSON_OUT  = os.path.join(OUT_DIR, 'LAD_boundaries.geojson')

# Find the geojson file dynamically
_geojson_candidates = glob(os.path.join(ROOT, 'LAD_MAY_2025*.geojson'))
if not _geojson_candidates:
    raise FileNotFoundError('No LAD_MAY_2025*.geojson file found in project root.')
GEOJSON_IN = _geojson_candidates[0]

# ---------------------------------------------------------------------------
# LAD name matching
# ---------------------------------------------------------------------------

def _strip(name):
    """Normalise an organisation/LAD name for matching."""
    name = name.strip()
    prefixes = [
        'London Borough of ', 'Royal Borough of ',
        'Metropolitan Borough of ', 'City of ',
    ]
    for p in prefixes:
        if name.lower().startswith(p.lower()):
            name = name[len(p):]
            break
    suffixes = [
        ' County Council', ' City Council', ' Borough Council',
        ' District Council', ' Council',
    ]
    for s in suffixes:
        if name.lower().endswith(s.lower()):
            name = name[:-len(s)]
            break
    return name.strip().lower()


# Hardcoded overrides for names that don't normalise cleanly.
# Key: normalised org name  Value: LAD25NM (or None to explicitly leave unmapped)
_OVERRIDES = {
    'kingston upon hull':        'Kingston upon Hull, City of',
    'bristol':                   'Bristol, City of',
    'herefordshire':             'Herefordshire, County of',
    'hertfordshire':             None,   # county council, spans many LADs
    'east sussex':               None,   # county council
    'essex':                     None,
    'gloucestershire':           None,
    'hampshire':                 None,
    'east surrey':               None,   # recently merged authority not yet in May-2025 LADs
    'west surrey':               None,
    'hammersmith & fulham':      'Hammersmith and Fulham',
    'hertsmere':                 'Hertsmere',
    'horsham':                   'Horsham',
    'lewes':                     'Lewes',
    'st albans':                 'St Albans',
    'st helens':                 'St. Helens',
    "king's lynn and west norfolk": "King's Lynn and West Norfolk",
}


def build_lad_lookup(geojson_path):
    """Return dict: normalised_name → {lad_code, lad_name, lat, lon}."""
    with open(geojson_path, encoding='utf-8') as f:
        gj = json.load(f)
    lookup = {}
    for feat in gj['features']:
        p = feat['properties']
        key = _strip(p['LAD25NM'])
        lookup[key] = {
            'lad_code': p['LAD25CD'],
            'lad_name': p['LAD25NM'],
            'lat':  p.get('LAT'),
            'lon':  p.get('LONG'),
        }
    return lookup


def match_org(org_name, lad_lookup):
    norm = _strip(org_name)
    if norm in _OVERRIDES:
        target = _OVERRIDES[norm]
        if target is None:
            return None
        norm = _strip(target)
    if norm in lad_lookup:
        return lad_lookup[norm]
    return None


# ---------------------------------------------------------------------------
# Accumulator helpers
# ---------------------------------------------------------------------------

def _empty_acc():
    return {
        'total': 0, 'female': 0, 'male': 0, 'unknown': 0,
        'elected_total': 0, 'elected_female': 0,
        'elected_male': 0, 'elected_unknown': 0,
        'turnout_sum': 0.0, 'turnout_count': 0,
        'by_election_count': 0,
    }


def _add(d, key, gender, elected, turnout, by_election):
    if key not in d:
        d[key] = _empty_acc()
    e = d[key]
    e['total'] += 1
    e[gender] += 1
    if elected:
        e['elected_total'] += 1
        e['elected_' + gender] += 1
    if turnout is not None:
        e['turnout_sum'] += turnout
        e['turnout_count'] += 1
    if by_election:
        e['by_election_count'] += 1


def _safe_pct(num, denom):
    if not denom:
        return None
    return round(num / denom * 100, 1)


def _clean_nuts1(raw):
    return raw.strip().strip('"')


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    # Load gender lookup: person_id → predicted_gender
    gender_lookup = {}
    with open(GENDERS_IN, encoding='utf-8', newline='') as f:
        for row in csv.DictReader(f):
            pid = row['person_id']
            if pid not in gender_lookup:
                gender_lookup[pid] = row['predicted_gender']

    lad_lookup = build_lad_lookup(GEOJSON_IN)

    councils = {}   # org_name → acc + metadata
    parties  = {}   # party_name → acc
    regions  = {}   # nuts1 → acc
    council_meta = {}   # org_name → {nuts1, lad_match}

    total = female = male = unknown = 0
    tot_elected = e_female = e_male = e_unknown = 0

    with open(CSV_IN, encoding='utf-8', newline='') as f:
        reader = csv.DictReader(f)
        for row in reader:
            pid    = row['person_id'].strip()
            org    = row['organisation_name'].strip()
            party  = row['party_name'].strip() or 'Unknown'
            nuts1  = _clean_nuts1(row.get('nuts1', ''))

            gender = gender_lookup.get(pid, 'unknown')
            if gender not in ('male', 'female'):
                gender = 'unknown'

            elected    = row.get('elected', '').strip().lower() in ('t', 'true', '1', 'yes')
            by_election = row.get('by_election', '').strip().lower() in ('t', 'true', '1', 'yes')

            turnout = None
            raw_t = (row.get('turnout_percentage') or '').strip()
            if raw_t:
                try:
                    turnout = float(raw_t)
                except ValueError:
                    pass

            # Global tallies
            total += 1
            if gender == 'female': female += 1
            elif gender == 'male': male += 1
            else: unknown += 1
            if elected:
                tot_elected += 1
                if gender == 'female': e_female += 1
                elif gender == 'male': e_male += 1
                else: e_unknown += 1

            _add(councils, org, gender, elected, turnout, by_election)
            if org not in council_meta:
                council_meta[org] = {'nuts1': nuts1}
            elif nuts1:
                council_meta[org]['nuts1'] = nuts1

            _add(parties, party, gender, elected, turnout, by_election)
            if nuts1:
                _add(regions, nuts1, gender, elected, turnout, by_election)

    # Match councils to LADs
    for org in councils:
        council_meta[org]['lad'] = match_org(org, lad_lookup)

    # Serialise
    def council_obj(org):
        d = councils[org]
        meta = council_meta[org]
        lad = meta.get('lad')
        kn  = d['female'] + d['male']
        ekn = d['elected_female'] + d['elected_male']
        return {
            'org_name':           org,
            'lad_code':           lad['lad_code'] if lad else None,
            'lad_name':           lad['lad_name'] if lad else None,
            'nuts1':              meta.get('nuts1', ''),
            'total':              d['total'],
            'female':             d['female'],
            'male':               d['male'],
            'unknown':            d['unknown'],
            'pct_female':         _safe_pct(d['female'], kn),
            'elected_total':      d['elected_total'],
            'elected_female':     d['elected_female'],
            'elected_male':       d['elected_male'],
            'elected_unknown':    d['elected_unknown'],
            'pct_female_elected': _safe_pct(d['elected_female'], ekn),
            'avg_turnout':        round(d['turnout_sum'] / d['turnout_count'], 1) if d['turnout_count'] else None,
            'by_election_count':  d['by_election_count'],
        }

    def party_obj(p):
        d = parties[p]
        kn  = d['female'] + d['male']
        ekn = d['elected_female'] + d['elected_male']
        return {
            'party':              p,
            'total':              d['total'],
            'female':             d['female'],
            'male':               d['male'],
            'unknown':            d['unknown'],
            'pct_female':         _safe_pct(d['female'], kn),
            'elected_total':      d['elected_total'],
            'elected_female':     d['elected_female'],
            'elected_male':       d['elected_male'],            'elected_unknown':     d['elected_unknown'],            'pct_female_elected': _safe_pct(d['elected_female'], ekn),
        }

    def region_obj(r):
        d = regions[r]
        kn  = d['female'] + d['male']
        ekn = d['elected_female'] + d['elected_male']
        return {
            'region':             r,
            'total':              d['total'],
            'female':             d['female'],
            'male':               d['male'],
            'unknown':            d['unknown'],
            'pct_female':         _safe_pct(d['female'], kn),
            'elected_total':      d['elected_total'],
            'elected_female':     d['elected_female'],
            'elected_male':       d['elected_male'],
            'elected_unknown':    d['elected_unknown'],
            'pct_female_elected': _safe_pct(d['elected_female'], ekn),
        }

    kn_total  = female + male
    ekn_total = e_female + e_male

    # Filter parties to those with >= 30 candidates, sort by total desc
    party_list = sorted(
        [party_obj(p) for p, d in parties.items() if d['total'] >= 30],
        key=lambda x: -x['total']
    )

    output = {
        'generated': str(date.today()),
        'summary': {
            'total_candidates':    total,
            'female_candidates':   female,
            'male_candidates':     male,
            'unknown_candidates':  unknown,
            'pct_female':          _safe_pct(female, kn_total),
            'elected_total':       tot_elected,
            'elected_female':      e_female,
            'elected_male':        e_male,
            'elected_unknown':     e_unknown,
            'pct_female_elected':  _safe_pct(e_female, ekn_total),
        },
        'by_council': sorted([council_obj(o) for o in councils], key=lambda x: x['org_name']),
        'by_party':   party_list,
        'by_region':  sorted([region_obj(r) for r in regions], key=lambda x: -x['total']),
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(COUNCILS_OUT, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f'Wrote {COUNCILS_OUT}')

    shutil.copy2(GEOJSON_IN, GEOJSON_OUT)
    print(f'Copied GeoJSON → {GEOJSON_OUT}')

    # Summary report
    s = output['summary']
    print(f'\nCandidates : {s["total_candidates"]:,}  |  Female: {s["female_candidates"]:,} ({s["pct_female"]}%)  |  Male: {s["male_candidates"]:,}  |  Unknown: {s["unknown_candidates"]:,}')
    print(f'Elected    : {s["elected_total"]:,}  |  Female: {s["elected_female"]:,} ({s["pct_female_elected"]}%)  |  Male: {s["elected_male"]:,}')
    print(f'Councils   : {len(output["by_council"])}  |  Parties: {len(output["by_party"])}  |  Regions: {len(output["by_region"])}')

    unmatched = [c['org_name'] for c in output['by_council'] if not c['lad_code']]
    if unmatched:
        print(f'\nNo map match for {len(unmatched)} councils (typically county councils):')
        for u in unmatched:
            print(f'  {u}')


if __name__ == '__main__':
    main()
