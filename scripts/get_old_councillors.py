"""
get_old_councillors.py
Reads the council list embedded in old_councillors.py (DATA string),
fetches each council's 2025 composition from opencouncildata.co.uk,
and writes scripts/data/old_councillors.json.

Output structure:
{
  "Hertfordshire": {
    "_id": "11",
    "wards": {
      "Abbots Langley": [{"name": "Stephen Giles-Medhurst", "party": "Liberal Democrats"}],
      ...
    }
  },
  ...
}
"""

import json
import pathlib
import time
import requests
from bs4 import BeautifulSoup

# ── 1. Extract council IDs and names from the DATA string in old_councillors.py ──

src = (pathlib.Path(__file__).parent / "old_councillors.py").read_text(encoding="utf-8")
i1 = src.index('DATA = """') + len('DATA = """')
i2 = src.index('"""', i1)
data_html = src[i1:i2]

soup = BeautifulSoup(data_html, "html.parser")
council_elems = soup.find_all("td", class_="scottish-gov-second")

councils = []
for elem in council_elems:
    a = elem.find("a")
    if not a:
        continue
    href = a.get("href", "")
    if "c=" not in href:
        continue
    c_id = href.split("c=")[1].split("&")[0]
    name = a.get_text(strip=True)
    if c_id and name:
        councils.append({"id": c_id, "name": name})

print(f"Found {len(councils)} councils in DATA")

# Deduplicate by name — DATA repeats the full list multiple times
seen_names = set()
unique_councils = []
for c in councils:
    if c["name"] not in seen_names:
        seen_names.add(c["name"])
        unique_councils.append(c)
councils = unique_councils
print(f"Deduplicated to {len(councils)} unique councils")

# ── 2. Fetch 2025 composition for each council ────────────────────────────────

HEADERS = {"User-Agent": "Mozilla/5.0 (research project; contact via GitHub saulsmcouk/2026ElectionAnalysis)"}
BASE_URL = "https://opencouncildata.co.uk/council.php?c={id}&y=2025"

out_path = pathlib.Path(__file__).parent / "data" / "old_councillors.json"
out_path.parent.mkdir(exist_ok=True)

# Load existing output so we can resume / skip already-fetched councils
if out_path.exists():
    with open(out_path, encoding="utf-8") as f:
        output = json.load(f)
    print(f"Resuming — {len(output)} councils already in output file")
else:
    output = {}

for i, council in enumerate(councils, 1):
    name = council["name"]
    c_id = council["id"]
    url  = BASE_URL.format(id=c_id)
    print(f"[{i}/{len(councils)}] {name} (id={c_id})")

    # Skip if already fetched (resume support)
    if name in output:
        print(f"  (already in output, skipping)")
        continue

    try:
        resp = requests.get(url, timeout=20, headers=HEADERS)
        resp.raise_for_status()
    except Exception as e:
        print(f"  ERROR fetching: {e}")
        output[name] = {"_id": c_id, "wards": {}}
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(output, f, indent=2, ensure_ascii=False)
        time.sleep(0.5)
        continue

    page_soup = BeautifulSoup(resp.text, "html.parser")
    wards = {}

    for row in page_soup.find_all("tr"):
        cells = row.find_all("td")
        if len(cells) < 3:
            continue
        cname = cells[0].get_text(strip=True)
        party = cells[1].get_text(strip=True)
        ward  = cells[2].get_text(strip=True)
        if not cname or not ward:
            continue
        wards.setdefault(ward, []).append({"name": cname, "party": party})

    councillor_count = sum(len(v) for v in wards.values())
    print(f"  → {len(wards)} wards, {councillor_count} councillors")
    output[name] = {"_id": c_id, "wards": wards}

    # Write incrementally after each council
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    time.sleep(0.5)

total_councillors = sum(
    sum(len(v) for v in c["wards"].values()) for c in output.values()
)
print(f"\nDone. {len(output)} councils, {total_councillors} councillors total.")
print(f"Written to {out_path}")
