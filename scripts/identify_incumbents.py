"""
identify_incumbents.py

Cross-references 2025 sitting councillors (old_councillors.json) against 2026
candidates (dc_data.csv) to identify incumbents.

A candidate is an incumbent if and only if they stood in the 2026 election in
the same ward and council that they held in 2025, matched by full-name fuzzy
comparison (SequenceMatcher ratio >= 0.80).

Outputs:
  scripts/data/incumbents.json      -- person_id -> {is_incumbent, ...}
  scripts/data/ward_fuzzy_log.json  -- ward matches that required fuzzy lookup

Usage:
  py scripts/identify_incumbents.py
"""

import csv
import difflib
import json
import pathlib
import re

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ROOT = pathlib.Path(__file__).parent.parent
OLD_COUNCILLORS = ROOT / "scripts" / "data" / "old_councillors.json"
DC_DATA = ROOT / "dc_data.csv"
OUT_INCUMBENTS = ROOT / "scripts" / "data" / "incumbents.json"
OUT_WARD_FUZZY = ROOT / "scripts" / "data" / "ward_fuzzy_log.json"

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
NAME_MATCH_THRESHOLD = 0.80
WARD_FUZZY_CUTOFF = 0.60

# GSS code pattern - these are council metadata rows, not real wards
GSS_PATTERN = re.compile(r"^[EWS]\d{8}$")

# Titles/prefixes to strip before name comparison
TITLE_PATTERN = re.compile(
    r"^(cllr\.?|councillor\.?|dr\.?|prof\.?|mr\.?|mrs\.?|ms\.?|miss\.?|sir\.?)\s+",
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# Council name normalisation
# ---------------------------------------------------------------------------
_COUNCIL_PREFIXES = [
    "London Borough of ",
    "Royal Borough of ",
    "City of ",
    "Metropolitan Borough of ",
    "Borough of ",
]

_COUNCIL_SUFFIXES = [
    " County Council",
    " Borough Council",
    " District Council",
    " City Council",
    " Council",
]

# Manual overrides applied AFTER prefix/suffix stripping
_COUNCIL_OVERRIDES = {
    "Hammersmith & Fulham": "Hammersmith and Fulham",
    "St Helens": "St. Helens",
    "Westminster": "Westminster",  # "City of Westminster" -> "Westminster"
    "Lincoln": "Lincoln",          # "City of Lincoln" -> "Lincoln"
}


def normalise_council(raw: str) -> str:
    """Map a dc_data organisation_name to an old_councillors.json key."""
    name = raw.strip()
    for prefix in _COUNCIL_PREFIXES:
        if name.startswith(prefix):
            name = name[len(prefix):]
            break
    for suffix in _COUNCIL_SUFFIXES:
        if name.endswith(suffix):
            name = name[: -len(suffix)]
            break
    return _COUNCIL_OVERRIDES.get(name, name)


# ---------------------------------------------------------------------------
# Name normalisation
# ---------------------------------------------------------------------------

def normalise_name(raw: str) -> str:
    """Lowercase, strip titles, collapse whitespace."""
    name = raw.strip().lower()
    # Strip title prefix (one pass is enough)
    name = TITLE_PATTERN.sub("", name)
    # Collapse internal spaces
    name = " ".join(name.split())
    return name


def candidate_name(row: dict) -> str:
    """
    Return the best comparison name for a dc_data candidate.

    Prefers SOPN fields (more official). SOPN last name is often all-caps
    in the source CSV, so we title-case it.
    """
    last = row.get("sopn_last_name", "").strip()
    first = row.get("sopn_first_names", "").strip()
    if last and first:
        # Title-case the surname (it's frequently all-caps in the source data)
        return normalise_name(f"{first} {last.title()}")
    # Fallback to person_name
    return normalise_name(row.get("person_name", ""))


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------

def load_old_councillors() -> dict:
    """
    Load old_councillors.json.

    Returns a dict:
        { normalised_council_name: { ward_name: [normalised_councillor_names] } }

    Skips GSS-code ward keys (council metadata rows) and "Vacant" entries.
    """
    with open(OLD_COUNCILLORS, encoding="utf-8") as f:
        raw = json.load(f)

    result = {}
    for council, data in raw.items():
        wards = {}
        for ward_key, councillors in data["wards"].items():
            if GSS_PATTERN.match(ward_key):
                continue  # skip council metadata row
            names = []
            for c in councillors:
                name = c.get("name", "").strip()
                if not name or name.lower() == "vacant":
                    continue
                names.append(normalise_name(name))
            if names:
                wards[ward_key] = names
        if wards:
            result[council] = wards
    return result


def load_dc_data() -> list[dict]:
    """
    Load dc_data.csv, deduplicated by person_id (first occurrence wins).
    """
    seen = set()
    rows = []
    with open(DC_DATA, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            pid = row["person_id"]
            if pid not in seen:
                seen.add(pid)
                rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------

def find_ward(
    post_label: str,
    ward_keys: list[str],
    fuzzy_log: list,
    fuzzy_seen: set,
    dc_council: str,
) -> tuple[str | None, bool]:
    """
    Find the best-matching ward key for a dc_data post_label.

    Returns (matched_ward_key | None, was_fuzzy).
    Appends to fuzzy_log (deduplicated by council+ward pair) if a fuzzy match
    was used. Rejects fuzzy matches where the first word differs, to avoid
    cross-area false positives caused by ward boundary changes.
    """
    # Exact match first (case-insensitive)
    for key in ward_keys:
        if key.lower() == post_label.lower():
            return key, False

    # Fuzzy fallback — require first word to match to avoid cross-area errors
    post_first_word = post_label.split()[0].lower() if post_label.split() else ""
    candidates = [
        k for k in ward_keys
        if k.split()[0].lower() == post_first_word
    ] if post_first_word else []

    # If no candidates share the first word, try against all wards but
    # keep a higher implicit bar (get_close_matches still filters by cutoff)
    search_pool = candidates if candidates else ward_keys
    matches = difflib.get_close_matches(
        post_label, search_pool, n=1, cutoff=WARD_FUZZY_CUTOFF
    )

    if matches:
        matched = matches[0]
        # Enforce first-word check: reject if first words differ and we fell
        # back to the full pool
        matched_first_word = matched.split()[0].lower() if matched.split() else ""
        if not candidates and matched_first_word != post_first_word:
            return None, False  # reject cross-area fuzzy match

        score = difflib.SequenceMatcher(None, post_label.lower(), matched.lower()).ratio()
        log_key = (dc_council, post_label, matched)
        if log_key not in fuzzy_seen:
            fuzzy_seen.add(log_key)
            fuzzy_log.append(
                {
                    "dc_council": dc_council,
                    "dc_ward": post_label,
                    "matched_ward": matched,
                    "score": round(score, 3),
                }
            )
        return matched, True

    return None, False


def match_name(candidate_norm: str, councillor_names: list[str]) -> tuple[str | None, float]:
    """
    Return the best-matching councillor name and its score,
    or (None, 0.0) if no match exceeds NAME_MATCH_THRESHOLD.
    """
    best_name = None
    best_score = 0.0
    for cname in councillor_names:
        score = difflib.SequenceMatcher(None, candidate_norm, cname).ratio()
        if score > best_score:
            best_score = score
            best_name = cname
    if best_score >= NAME_MATCH_THRESHOLD:
        return best_name, best_score
    return None, best_score


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("Loading data...")
    old = load_old_councillors()
    candidates = load_dc_data()
    print(f"  {len(candidates):,} unique candidates in dc_data")
    print(f"  {len(old):,} councils in old_councillors.json")

    incumbents: dict[str, dict] = {}
    ward_fuzzy_log: list[dict] = []
    ward_fuzzy_seen: set[tuple] = set()

    # Counters for the validation report
    counts = {
        "no_2025_data": 0,
        "ward_not_found": 0,
        "incumbent": 0,
        "not_incumbent": 0,
    }

    for row in candidates:
        pid = row["person_id"]
        org = row["organisation_name"].strip()
        post = row["post_label"].strip()
        elected = row["elected"].strip().lower() == "t"

        council_key = normalise_council(org)

        # Council not in scraped data?
        if council_key not in old:
            incumbents[pid] = {
                "is_incumbent": False,
                "reason": "no_2025_data",
                "dc_council": org,
            }
            counts["no_2025_data"] += 1
            continue

        council_wards = old[council_key]
        ward_keys = list(council_wards.keys())

        # Find ward
        matched_ward, was_fuzzy = find_ward(post, ward_keys, ward_fuzzy_log, ward_fuzzy_seen, council_key)

        if matched_ward is None:
            incumbents[pid] = {
                "is_incumbent": False,
                "reason": "ward_not_found",
                "dc_council": org,
                "dc_ward": post,
            }
            counts["ward_not_found"] += 1
            continue

        # Match name against 2025 councillors in that ward
        candidate_norm = candidate_name(row)
        councillor_names = council_wards[matched_ward]
        matched_name, score = match_name(candidate_norm, councillor_names)

        if matched_name is not None:
            incumbents[pid] = {
                "is_incumbent": True,
                "matched_name": matched_name,
                "candidate_name": candidate_norm,
                "matched_ward": matched_ward,
                "dc_ward": post,
                "council_key": council_key,
                "match_score": round(score, 3),
                "elected": elected,
                "ward_was_fuzzy": was_fuzzy,
            }
            counts["incumbent"] += 1
        else:
            incumbents[pid] = {
                "is_incumbent": False,
                "reason": "no_name_match",
                "dc_council": org,
                "dc_ward": post,
                "best_score": round(score, 3),
                "candidate_name": candidate_norm,
            }
            counts["not_incumbent"] += 1

    # Write outputs
    OUT_INCUMBENTS.parent.mkdir(parents=True, exist_ok=True)

    with open(OUT_INCUMBENTS, "w", encoding="utf-8") as f:
        json.dump(incumbents, f, indent=2)
    print(f"\nWrote {OUT_INCUMBENTS}")

    with open(OUT_WARD_FUZZY, "w", encoding="utf-8") as f:
        json.dump(ward_fuzzy_log, f, indent=2)
    print(f"Wrote {OUT_WARD_FUZZY} ({len(ward_fuzzy_log)} fuzzy ward matches)")

    # ---------------------------------------------------------------------------
    # Validation report
    # ---------------------------------------------------------------------------
    total = len(candidates)
    inc = counts["incumbent"]
    inc_pct = inc / total * 100

    inc_elected = sum(
        1 for v in incumbents.values()
        if v.get("is_incumbent") and v.get("elected")
    )
    inc_reelect_pct = inc_elected / inc * 100 if inc else 0

    print("\n" + "=" * 60)
    print("VALIDATION REPORT")
    print("=" * 60)
    print(f"  Total candidates:          {total:>6,}")
    print(f"  No 2025 data (council):    {counts['no_2025_data']:>6,}  ({counts['no_2025_data']/total*100:.1f}%)")
    print(f"  Ward not found:            {counts['ward_not_found']:>6,}  ({counts['ward_not_found']/total*100:.1f}%)")
    print(f"  Incumbents identified:     {inc:>6,}  ({inc_pct:.1f}%)")
    print(f"  Non-incumbents:            {counts['not_incumbent']:>6,}  ({counts['not_incumbent']/total*100:.1f}%)")
    print(f"  Incumbent re-election pct: {inc_reelect_pct:.1f}%")
    print(f"  Fuzzy ward matches:        {len(ward_fuzzy_log):>6,}")

    # Sanity checks
    print()
    if inc_pct > 60:
        print("  *** WARNING: Incumbency rate > 60% -- data may be bad! ***")
    elif inc_pct < 5:
        print("  *** WARNING: Incumbency rate < 5% -- matching may be too strict! ***")
    else:
        print("  Incumbency rate looks plausible.")

    if inc_reelect_pct > 95:
        print("  *** WARNING: Re-election rate > 95% -- check elected field. ***")


if __name__ == "__main__":
    main()
