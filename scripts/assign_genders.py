"""
Assign a predicted gender to every candidate in dc_data.csv.
Writes genders.csv (one row per candidate) with columns:
  person_id, surname, predicted_gender, prediction_method, confidence

Prediction cascade:
  1. existing   – gender field is already filled in dc_data.csv
  2. gender_guesser – local library, uses first name
  3. ons        – ONS historical baby names lookup, uses first name + birth_year
  4. unknown    – all else failed
"""

import csv
import json
import os
import re

import gender_guesser.detector as gg_detector

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ROOT = os.path.join(os.path.dirname(__file__), '..')
CSV_IN      = os.path.join(ROOT, 'dc_data.csv')
ONS_LOOKUP  = os.path.join(ROOT, 'scripts', 'data', 'ons_lookup.json')
CSV_OUT     = os.path.join(ROOT, 'genders.csv')

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
DECADES = list(range(1904, 2025, 10))  # [1904, 1914, ..., 2024]


def nearest_decade(year):
    """Return the closest decade value we have ONS data for."""
    return min(DECADES, key=lambda d: abs(d - year))


def first_token(text):
    """Return the first whitespace-delimited token, uppercased, or empty string."""
    text = (text or '').strip()
    if not text:
        return ''
    token = re.split(r'[\s\-]+', text)[0]
    return token.upper()


def normalise_existing(raw):
    """Normalise a pre-existing gender value to our output vocabulary."""
    v = raw.strip().lower()
    if v in ('male', 'm'):
        return 'male'
    if v in ('female', 'f'):
        return 'female'
    if v in ('nonbinary', 'non-binary', 'non_binary', 'enby'):
        return 'nonbinary'
    return None  # unrecognised – treat as missing


def ons_predict(first_name_upper, birth_year, lookup):
    """
    Return (gender, confidence) or (None, None) using ONS lookup.

    Logic:
      - Pick the decade(s) to look at based on birth_year.
      - Score: how many of the relevant decades list this name as girls vs boys.
      - If ratio > 0.8  → female/male with confidence based on ratio.
      - If ratio 0.2–0.8 → ambiguous, return (None, None).
      - If no data at all → return (None, None).
    """
    if first_name_upper not in lookup:
        return None, None

    entry = lookup[first_name_upper]
    girls_decades = set(entry['girls'])
    boys_decades  = set(entry['boys'])

    if birth_year:
        decade = nearest_decade(birth_year)
        # Use the target decade and its two neighbours for a small window.
        window = {decade}
        idx = DECADES.index(decade)
        if idx > 0:
            window.add(DECADES[idx - 1])
        if idx < len(DECADES) - 1:
            window.add(DECADES[idx + 1])
    else:
        # No birth year: use all decades.
        window = set(DECADES)

    g = len(girls_decades & window)
    b = len(boys_decades  & window)
    total = g + b

    if total == 0:
        return None, None

    ratio = g / total  # proportion that are girls decades

    if ratio >= 0.8:
        conf = 'high' if ratio == 1.0 else 'medium'
        return 'female', conf
    if ratio <= 0.2:
        conf = 'high' if ratio == 0.0 else 'medium'
        return 'male', conf

    return None, None  # ambiguous


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
GG_DETECTOR = gg_detector.Detector(case_sensitive=False)

GG_MALE_STRONG   = {'male'}
GG_FEMALE_STRONG = {'female'}
GG_MALE_WEAK     = {'mostly_male'}
GG_FEMALE_WEAK   = {'mostly_female'}


def predict_gender(first_name_upper, birth_year, lookup):
    """
    Returns (predicted_gender, method, confidence).
    predicted_gender: 'male' | 'female' | 'unknown'
    method:           'gender_guesser' | 'ons' | 'unknown'
    confidence:       'high' | 'medium' | 'low' | 'none'
    """
    name_title = first_name_upper.capitalize()

    # --- Tier 1: gender_guesser ---
    gg_result = GG_DETECTOR.get_gender(name_title, 'great_britain')

    if gg_result in GG_MALE_STRONG:
        return 'male',   'gender_guesser', 'high'
    if gg_result in GG_FEMALE_STRONG:
        return 'female', 'gender_guesser', 'high'
    if gg_result in GG_MALE_WEAK:
        return 'male',   'gender_guesser', 'low'
    if gg_result in GG_FEMALE_WEAK:
        return 'female', 'gender_guesser', 'low'

    # --- Tier 2: ONS ---
    ons_gender, ons_conf = ons_predict(first_name_upper, birth_year, lookup)
    if ons_gender:
        return ons_gender, 'ons', ons_conf

    # --- Tier 3: fallback ---
    return 'unknown', 'unknown', 'none'


def main():
    # Load ONS lookup
    if not os.path.exists(ONS_LOOKUP):
        print(f"ERROR: ONS lookup not found at {ONS_LOOKUP}")
        print("Run:  py scripts/parse_ons_data.py  first.")
        return

    with open(ONS_LOOKUP, encoding='utf-8') as f:
        lookup = json.load(f)
    print(f"Loaded ONS lookup: {len(lookup)} names")

    rows_written = 0
    method_counts = {}

    with open(CSV_IN,  encoding='utf-8', newline='') as fin, \
         open(CSV_OUT, 'w',  encoding='utf-8', newline='') as fout:

        reader = csv.DictReader(fin)
        writer = csv.DictWriter(fout, fieldnames=[
            'person_id', 'surname', 'predicted_gender', 'prediction_method', 'confidence'
        ])
        writer.writeheader()

        seen = {}  # person_id → first row written (dedup guard)

        for row in reader:
            person_id = row['person_id'].strip()
            surname   = row['sopn_last_name'].strip()

            # Extract first name from person_name (full legal name, not nickname).
            first_name_upper = first_token(row['person_name'])

            # Parse birth year (field may be e.g. "1964" or "1964-03-15" or "").
            birth_year = None
            raw_dob = (row.get('birth_date') or '').strip()
            if raw_dob:
                m = re.match(r'(\d{4})', raw_dob)
                if m:
                    birth_year = int(m.group(1))

            # --- Tier 0: existing gender in dc_data ---
            raw_gender = (row.get('gender') or '').strip()
            if raw_gender:
                norm = normalise_existing(raw_gender)
                if norm:
                    out_row = {
                        'person_id':        person_id,
                        'surname':          surname,
                        'predicted_gender': norm,
                        'prediction_method': 'existing',
                        'confidence':       'high',
                    }
                    writer.writerow(out_row)
                    method_counts['existing'] = method_counts.get('existing', 0) + 1
                    rows_written += 1
                    continue
                # Unrecognised existing value – fall through to prediction.

            # Predict
            if first_name_upper:
                pred_gender, method, confidence = predict_gender(
                    first_name_upper, birth_year, lookup
                )
            else:
                pred_gender, method, confidence = 'unknown', 'unknown', 'none'

            out_row = {
                'person_id':         person_id,
                'surname':           surname,
                'predicted_gender':  pred_gender,
                'prediction_method': method,
                'confidence':        confidence,
            }
            writer.writerow(out_row)
            method_counts[method] = method_counts.get(method, 0) + 1
            rows_written += 1

    print(f"\nWrote {rows_written} rows to {CSV_OUT}")
    print("Method breakdown:")
    for method, count in sorted(method_counts.items(), key=lambda x: -x[1]):
        pct = count / rows_written * 100
        print(f"  {method:<20} {count:>6}  ({pct:.1f}%)")


if __name__ == '__main__':
    main()
