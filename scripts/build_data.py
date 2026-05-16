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
from datetime import date
from glob import glob

ROOT = os.path.join(os.path.dirname(__file__), '..')
CSV_IN              = os.path.join(ROOT, 'dc_data.csv')
GENDERS_IN          = os.path.join(ROOT, 'genders.csv')
INCUMBENTS_IN       = os.path.join(ROOT, 'scripts', 'data', 'incumbents.json')
OLD_COUNCILLORS_IN  = os.path.join(ROOT, 'scripts', 'data', 'old_councillors.json')
OUT_DIR        = os.path.join(ROOT, 'docs', 'data')
COUNCILS_OUT   = os.path.join(OUT_DIR, 'councils.json')
GEOJSON_OUT    = os.path.join(OUT_DIR, 'LAD_boundaries.geojson')

# Find the geojson file dynamically
_geojson_candidates = glob(os.path.join(ROOT, 'LAD_MAY_2025*.geojson'))
if not _geojson_candidates:
    raise FileNotFoundError('No LAD_MAY_2025*.geojson file found in project root.')
GEOJSON_IN = _geojson_candidates[0]

# ---------------------------------------------------------------------------
# Election model lookup (from old_councillors.json GSS metadata)
# ---------------------------------------------------------------------------

def _norm_council(name):
    """Normalise council name for matching against old_councillors.json."""
    name = re.sub(r'^(London Borough of |Royal Borough of |City of |Metropolitan Borough of |Borough of )', '', name, flags=re.I)
    name = re.sub(r' (County Council|Borough Council|District Council|City Council|Council)$', '', name, flags=re.I)
    return name.strip().lower()


def build_election_model_lookup(path):
    """Return dict: normalised_name → {model, total_seats}.
    model is 'ALL' (whole-council), 'THIRDS' (by thirds), or 'HALVES' (by halves).
    """
    if not os.path.exists(path):
        return {}
    with open(path, encoding='utf-8') as f:
        old = json.load(f)
    lookup = {}
    for cname, cdata in old.items():
        wards = cdata.get('wards', {})
        for wk, wv in wards.items():
            if re.match(r'^[EWS]\d{8}$', wk) and isinstance(wv, list) and wv:
                meta = wv[0].get('name', '')
                m  = re.search(r'Election Model(\w+)', meta)
                ts = re.search(r'Total Seats \(Majority\)(\d+)', meta)
                if m:
                    raw = m.group(1).upper()
                    if 'ALL' in raw:
                        model = 'ALL'
                    elif 'THIRDS' in raw:
                        model = 'THIRDS'
                    elif 'HALVES' in raw:
                        model = 'HALVES'
                    else:
                        model = raw
                    lookup[_norm_council(cname)] = {
                        'model':       model,
                        'total_seats': int(ts.group(1)) if ts else None,
                    }
                break
    return lookup


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
        'conf_high': 0, 'conf_medium': 0, 'conf_low': 0,
        # Incumbency counters
        'inc_total': 0, 'inc_female': 0, 'inc_male': 0,
        'inc_elected': 0, 'inc_female_elected': 0, 'inc_male_elected': 0,
        'new_elected': 0, 'new_female_elected': 0, 'new_male_elected': 0,
    }


def _add(d, key, gender, elected, turnout, by_election, conf='low', incumbent=False):
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
    conf_key = conf if conf in ('high', 'medium', 'low') else 'low'
    e['conf_' + conf_key] += 1
    # Incumbency tracking
    if incumbent:
        e['inc_total'] += 1
        if gender in ('female', 'male'):
            e['inc_' + gender] += 1
        if elected:
            e['inc_elected'] += 1
            if gender in ('female', 'male'):
                e['inc_' + gender + '_elected'] += 1
    elif elected:
        e['new_elected'] += 1
        if gender in ('female', 'male'):
            e['new_' + gender + '_elected'] += 1


def _safe_pct(num, denom):
    if not denom:
        return None
    return round(num / denom * 100, 1)


def _clean_nuts1(raw):
    return raw.strip().strip('"')


def _opt(s):
    """Return stripped string or None if empty."""
    s = (s or '').strip()
    return s if s else None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    # Load gender lookup: person_id → {gender, method, conf}
    gender_lookup = {}
    with open(GENDERS_IN, encoding='utf-8-sig', newline='') as f:
        for row in csv.DictReader(f):
            pid = row['person_id']
            if pid not in gender_lookup:
                raw_conf = row.get('confidence', '').strip().lower()
                conf = raw_conf if raw_conf in ('high', 'medium', 'low') else 'low'
                gender_lookup[pid] = {
                    'gender': row['predicted_gender'],
                    'method': row['prediction_method'],
                    'conf':   conf,
                }

    # Load incumbents lookup: person_id → {is_incumbent, ...}
    incumbents_lookup = {}
    if os.path.exists(INCUMBENTS_IN):
        with open(INCUMBENTS_IN, encoding='utf-8') as f:
            incumbents_lookup = json.load(f)
    else:
        print(f'WARNING: {INCUMBENTS_IN} not found; incumbency data will be absent.')

    lad_lookup = build_lad_lookup(GEOJSON_IN)
    election_model_lookup = build_election_model_lookup(OLD_COUNCILLORS_IN)

    councils = {}        # org_name → acc + metadata
    parties  = {}        # party_name → acc
    regions  = {}        # nuts1 → acc
    region_parties = {}  # nuts1 → {party_name → acc}
    council_meta = {}    # org_name → {nuts1, lad_match}
    wards = {}         # org_name → ward_label → {seats, turnout_pct, candidates[]}

    total = female = male = unknown = 0
    tot_elected = e_female = e_male = e_unknown = 0

    with open(CSV_IN, encoding='utf-8', newline='') as f:
        reader = csv.DictReader(f)
        for row in reader:
            pid    = row['person_id'].strip()
            org    = row['organisation_name'].strip()
            party  = row['party_name'].strip() or 'Unknown'
            nuts1  = _clean_nuts1(row.get('nuts1', ''))

            g_entry = gender_lookup.get(pid, {})
            gender = g_entry.get('gender', 'unknown')
            method = g_entry.get('method', 'unknown')
            conf   = g_entry.get('conf', 'low')
            if gender not in ('male', 'female'):
                gender = 'unknown'

            elected    = row.get('elected', '').strip().lower() in ('t', 'true', '1', 'yes')
            by_election = row.get('by_election', '').strip().lower() in ('t', 'true', '1', 'yes')
            incumbent  = incumbents_lookup.get(pid, {}).get('is_incumbent', False)

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

            _add(councils, org, gender, elected, turnout, by_election, conf, incumbent=incumbent)
            if org not in council_meta:
                council_meta[org] = {'nuts1': nuts1}
            elif nuts1:
                council_meta[org]['nuts1'] = nuts1

            _add(parties, party, gender, elected, turnout, by_election, conf, incumbent=incumbent)
            if nuts1:
                _add(regions, nuts1, gender, elected, turnout, by_election, conf, incumbent=incumbent)
                if nuts1 not in region_parties:
                    region_parties[nuts1] = {}
                _add(region_parties[nuts1], party, gender, elected, turnout, by_election, conf, incumbent=incumbent)

            # Ward-level candidate data for drilldown
            ward_label = row.get('post_label', '').strip()
            if org and ward_label:
                if org not in wards:
                    wards[org] = {}
                if ward_label not in wards[org]:
                    try:
                        seats = int(row.get('seats_contested') or 1)
                    except (ValueError, TypeError):
                        seats = 1
                    raw_tp = (row.get('turnout_percentage') or '').strip()
                    ward_turnout = float(raw_tp) if raw_tp else None
                    wards[org][ward_label] = {
                        'seats': seats,
                        'turnout_pct': ward_turnout,
                        'results_url': _opt(row.get('results_source', '')),
                        'candidates': [],
                    }
                raw_votes = (row.get('votes_cast') or '').strip()
                votes = int(raw_votes) if raw_votes and raw_votes.isdigit() else None
                try:
                    rank = int(row.get('rank') or 0)
                except (ValueError, TypeError):
                    rank = 0
                stmt_raw = (row.get('statement_to_voters') or '').strip()
                cand = {
                    'n': row['person_name'].strip(),
                    'p': party,
                    'v': votes,
                    'r': rank,
                    'e': elected,
                    'g': gender,
                    'm': method,
                    'cf': conf,
                }
                if incumbent:
                    cand['inc'] = True
                for _k, _v in [
                    ('pid', _opt(row.get('person_id', ''))),
                    ('img', _opt(row.get('image', ''))),
                    ('stmt', stmt_raw[:2000] if stmt_raw else None),
                    ('tw',  _opt(row.get('twitter_username', ''))),
                    ('url', _opt(row.get('homepage_url', ''))),
                    ('li',  _opt(row.get('linkedin_url', ''))),
                    ('bs',  _opt(row.get('blue_sky_url', ''))),
                    ('bd',  _opt(row.get('birth_date', ''))),
                ]:
                    if _v:
                        cand[_k] = _v
                wards[org][ward_label]['candidates'].append(cand)

    # Match councils to LADs
    for org in councils:
        council_meta[org]['lad'] = match_org(org, lad_lookup)

    # Serialise
    def _inc_fields(d):
        """Return the incumbency-derived fields for any accumulator dict."""
        inc_total   = d['inc_total']
        inc_elected = d['inc_elected']
        inc_kn      = d['inc_female'] + d['inc_male']
        new_kn      = d['new_female_elected'] + d['new_male_elected']
        return {
            'inc_total':            inc_total,
            'inc_elected':          inc_elected,
            'inc_defeated':         inc_total - inc_elected,
            'new_elected':          d['new_elected'],
            'inc_female_pct':       _safe_pct(d['inc_female'], inc_kn),
            'new_female_elected_pct': _safe_pct(d['new_female_elected'], new_kn),
            'inc_retention_pct':    _safe_pct(inc_elected, inc_total),
        }

    def council_obj(org):
        d = councils[org]
        meta = council_meta[org]
        lad = meta.get('lad')
        kn  = d['female'] + d['male']
        ekn = d['elected_female'] + d['elected_male']
        slug = re.sub(r'[^a-z0-9]+', '-', org.lower()).strip('-')
        em = election_model_lookup.get(_norm_council(org))
        election_model = em['model'] if em else None
        election_type  = ('full' if election_model == 'ALL' else 'partial') if election_model else None
        council_size   = em['total_seats'] if em else None
        return {
            'org_name':           org,
            'ward_slug':          slug,
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
            'female_win_rate':    _safe_pct(d['elected_female'], d['female']),
            'male_win_rate':      _safe_pct(d['elected_male'],   d['male']),
            'avg_turnout':        round(d['turnout_sum'] / d['turnout_count'], 1) if d['turnout_count'] else None,
            'by_election_count':  d['by_election_count'],
            'conf_high':          d['conf_high'],
            'conf_medium':        d['conf_medium'],
            'conf_low':           d['conf_low'],
            'pct_high_conf':      _safe_pct(d['conf_high'], d['total']),
            'election_model':     election_model,
            'election_type':      election_type,
            'council_size':       council_size,
            **_inc_fields(d),
        }

    # Pre-compute seats_available and wards_stood per party from ward data
    party_seats = {}  # party_name → {'seats': int, 'wards': int}
    for _org_wards in wards.values():
        for _wd in _org_wards.values():
            for _p in {c['p'] for c in _wd['candidates']}:
                if _p not in party_seats:
                    party_seats[_p] = {'seats': 0, 'wards': 0}
                party_seats[_p]['seats'] += _wd['seats'] or 0
                party_seats[_p]['wards'] += 1

    def party_obj(p):
        d   = parties[p]
        kn  = d['female'] + d['male']
        ekn = d['elected_female'] + d['elected_male']
        ps  = party_seats.get(p, {'seats': 0, 'wards': 0})

        f_win       = _safe_pct(d['elected_female'], d['female'])
        m_win       = _safe_pct(d['elected_male'],   d['male'])
        other_ef    = e_female - d['elected_female']
        other_f     = female   - d['female']
        other_f_win = _safe_pct(other_ef, other_f)
        nat_f_win   = _safe_pct(e_female, female)

        return {
            'party':              p,
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
            'conf_high':          d['conf_high'],
            'conf_medium':        d['conf_medium'],
            'conf_low':           d['conf_low'],
            'pct_high_conf':      _safe_pct(d['conf_high'], d['total']),
            'seats_available':    ps['seats'],
            'wards_stood':        ps['wards'],
            'female_win_rate':    f_win,
            'male_win_rate':      m_win,
            'other_female_win_rate':            other_f_win,
            'female_win_rate_diff_vs_others':   round(f_win - other_f_win, 1) if f_win is not None and other_f_win is not None else None,
            'national_female_win_rate':         nat_f_win,
            'female_win_rate_diff_vs_national': round(f_win - nat_f_win, 1) if f_win is not None and nat_f_win is not None else None,
            **_inc_fields(d),
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
            'female_win_rate':    _safe_pct(d['elected_female'], d['female']),
            'male_win_rate':      _safe_pct(d['elected_male'],   d['male']),
            'conf_high':          d['conf_high'],
            'conf_medium':        d['conf_medium'],
            'conf_low':           d['conf_low'],
            'pct_high_conf':      _safe_pct(d['conf_high'], d['total']),
            **_inc_fields(d),
        }

    def region_party_entry(r, p):
        d   = region_parties[r][p]
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
            'elected_male':       d['elected_male'],
            'elected_unknown':    d['elected_unknown'],
            'pct_female_elected': _safe_pct(d['elected_female'], ekn),
            'female_win_rate':    _safe_pct(d['elected_female'], d['female']),
            'male_win_rate':      _safe_pct(d['elected_male'],   d['male']),
            **_inc_fields(d),
        }

    kn_total  = female + male
    ekn_total = e_female + e_male

    # Filter parties to those with >= 30 candidates, sort by total desc
    party_list = sorted(
        [party_obj(p) for p, d in parties.items() if d['total'] >= 30],
        key=lambda x: -x['total']
    )

    conf_high_total  = sum(d['conf_high']  for d in councils.values())
    conf_medium_total = sum(d['conf_medium'] for d in councils.values())
    conf_low_total    = sum(d['conf_low']   for d in councils.values())

    # Global incumbency totals (summed across all councils)
    _global_inc = _empty_acc()
    for _k in ('inc_total', 'inc_female', 'inc_male',
                'inc_elected', 'inc_female_elected', 'inc_male_elected',
                'new_elected', 'new_female_elected', 'new_male_elected'):
        _global_inc[_k] = sum(d[_k] for d in councils.values())

    council_list = sorted([council_obj(o) for o in councils], key=lambda x: x['org_name'])
    councils_full    = sum(1 for c in council_list if c.get('election_type') == 'full')
    councils_partial = sum(1 for c in council_list if c.get('election_type') == 'partial')

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
            'conf_high':           conf_high_total,
            'conf_medium':         conf_medium_total,
            'conf_low':            conf_low_total,
            'pct_high_conf':       _safe_pct(conf_high_total, total),
            'national_female_win_rate': _safe_pct(e_female, female),
            'national_male_win_rate':   _safe_pct(e_male, male),
            'councils_full':       councils_full,
            'councils_partial':    councils_partial,
            **_inc_fields(_global_inc),
        },
        'by_council': council_list,
        'by_party':   party_list,
        'by_region':  sorted([region_obj(r) for r in regions], key=lambda x: -x['total']),
        'by_region_by_party': {
            r: sorted(
                [region_party_entry(r, p) for p, d in rp.items() if d['total'] >= 5],
                key=lambda x: -x['total']
            )
            for r, rp in region_parties.items()
        },
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(COUNCILS_OUT, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f'Wrote {COUNCILS_OUT}')

    # Write one JSON file per council for ward drilldown
    wards_dir = os.path.join(OUT_DIR, 'wards')
    os.makedirs(wards_dir, exist_ok=True)
    for org, ward_dict in wards.items():
        # Sort candidates within each ward by rank (then by name)
        for w in ward_dict.values():
            w['candidates'].sort(key=lambda c: (c['r'] if c['r'] else 999, c['n']))
        # Use a safe filename: strip non-alphanumeric chars
        safe = re.sub(r'[^a-z0-9]+', '-', org.lower()).strip('-')
        ward_path = os.path.join(wards_dir, safe + '.json')
        # Convert to list sorted by ward name
        ward_list = sorted(
            [{'ward': k, **v} for k, v in ward_dict.items()],
            key=lambda x: x['ward']
        )
        with open(ward_path, 'w', encoding='utf-8') as f:
            json.dump({'org': org, 'wards': ward_list}, f, separators=(',', ':'), ensure_ascii=False)

    print(f'Wrote ward files for {len(wards)} councils → {wards_dir}/')

    shutil.copy2(GEOJSON_IN, GEOJSON_OUT)
    print(f'Copied GeoJSON → {GEOJSON_OUT}')

    # Summary report
    s = output['summary']
    print(f'\nCandidates : {s["total_candidates"]:,}  |  Female: {s["female_candidates"]:,} ({s["pct_female"]}%)  |  Male: {s["male_candidates"]:,}  |  Unknown: {s["unknown_candidates"]:,}')
    print(f'Elected    : {s["elected_total"]:,}  |  Female: {s["elected_female"]:,} ({s["pct_female_elected"]}%)  |  Male: {s["elected_male"]:,}')
    print(f'Incumbents : stood {s["inc_total"]:,}  |  Re-elected: {s["inc_elected"]:,} ({s["inc_retention_pct"]}%)  |  Defeated: {s["inc_defeated"]:,}  |  New elected: {s["new_elected"]:,}')
    print(f'Councils   : {len(output["by_council"])}  |  Parties: {len(output["by_party"])}  |  Regions: {len(output["by_region"])}')
    print(f'Election   : Full (all seats): {councils_full}  |  Partial (by thirds/halves): {councils_partial}  |  Unknown: {len(output["by_council"]) - councils_full - councils_partial}')

    unmatched = [c['org_name'] for c in output['by_council'] if not c['lad_code']]
    if unmatched:
        print(f'\nNo map match for {len(unmatched)} councils (typically county councils):')
        for u in unmatched:
            print(f'  {u}')


if __name__ == '__main__':
    main()
