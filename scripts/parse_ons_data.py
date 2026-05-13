"""
Parse historicalnames2024.xlsx into scripts/data/ons_lookup.json.

Excel structure:
  Table_1 = girls top-100 per decade
  Table_2 = boys top-100 per decade
  Data starts at row 4 (0-indexed row 3).
  Col A = rank (ignored).
  Col B = names at 1904, Col C = 1914, ..., Col N = 2024 (13 decade columns).

Output ons_lookup.json format:
  {
    "OLIVIA": {"girls": [2004, 2014, 2024], "boys": []},
    "JAMES":  {"girls": [],                 "boys": [1904, 1914, ...]},
    ...
  }
  Keys are UPPERCASE first names.
"""

import json
import os
import shutil
import tempfile
import openpyxl

EXCEL_PATH = os.path.join(os.path.dirname(__file__), '..', 'historicalnames2024.xlsx')
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'data')
OUTPUT_PATH = os.path.join(OUTPUT_DIR, 'ons_lookup.json')

# Decade columns B–N correspond to years 1904–2024 at 10-year intervals.
DECADES = list(range(1904, 2025, 10))  # [1904, 1914, ..., 2024]

SHEET_GIRLS = 'Table_1'
SHEET_BOYS  = 'Table_2'
DATA_START_ROW = 4  # 1-indexed; rows 1–3 are headers


def parse_sheet(ws, gender_key):
    """
    Return dict: {NAME_UPPER: {decade: True, ...}}
    gender_key is 'girls' or 'boys'.
    """
    result = {}
    for row in ws.iter_rows(min_row=DATA_START_ROW, values_only=True):
        # row[0] = rank (col A), row[1..13] = names per decade
        decade_cells = row[1:]  # cols B onwards
        for i, cell_value in enumerate(decade_cells):
            if i >= len(DECADES):
                break
            if not cell_value:
                continue
            name = str(cell_value).strip().upper()
            if not name:
                continue
            if name not in result:
                result[name] = []
            result[name].append(DECADES[i])
    return result


def build_lookup():
    # Copy to a temp file first in case the original is locked (e.g. open in Excel).
    with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as tmp:
        tmp_path = tmp.name
    try:
        shutil.copy2(EXCEL_PATH, tmp_path)
        wb = openpyxl.load_workbook(tmp_path, read_only=True, data_only=True)
    except Exception:
        os.unlink(tmp_path)
        raise

    girls_data = parse_sheet(wb[SHEET_GIRLS], 'girls')
    boys_data  = parse_sheet(wb[SHEET_BOYS],  'boys')
    wb.close()
    os.unlink(tmp_path)

    # Merge into combined lookup
    all_names = set(girls_data) | set(boys_data)
    lookup = {}
    for name in sorted(all_names):
        lookup[name] = {
            'girls': sorted(set(girls_data.get(name, []))),
            'boys':  sorted(set(boys_data.get(name, []))),
        }

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(lookup, f, indent=2, ensure_ascii=False)

    print(f"Wrote {len(lookup)} names to {OUTPUT_PATH}")
    girl_only  = sum(1 for v in lookup.values() if v['girls'] and not v['boys'])
    boy_only   = sum(1 for v in lookup.values() if v['boys']  and not v['girls'])
    ambiguous  = sum(1 for v in lookup.values() if v['girls'] and v['boys'])
    print(f"  Girls only: {girl_only}, Boys only: {boy_only}, Ambiguous (both): {ambiguous}")


if __name__ == '__main__':
    build_lookup()
