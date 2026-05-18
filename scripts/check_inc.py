import json

with open('docs/data/councils.json') as f:
    c = json.load(f)

s = c['summary']
print('NATIONAL SUMMARY - INCUMBENT BREAKDOWN')
for k in ['inc_total','inc_female_elected','inc_male_elected','inc_female_defeated','inc_male_defeated','inc_female_retention_pct','inc_male_retention_pct']:
    print(f'  {k}: {s.get(k)}')

print()
print('ALL PARTIES (inc_total >= 50):')
for p in sorted(c['by_party'], key=lambda x: -x.get('inc_total',0)):
    if p.get('inc_total',0) < 50:
        continue
    f_r = p.get('inc_female_retention_pct')
    m_r = p.get('inc_male_retention_pct')
    gap = round(f_r - m_r, 1) if f_r is not None and m_r is not None else None
    f_stood = (p.get('inc_female_elected') or 0) + (p.get('inc_female_defeated') or 0)
    m_stood = (p.get('inc_male_elected') or 0) + (p.get('inc_male_defeated') or 0)
    print(f"  {p['party'][:40]:40s}  F_stood={f_stood}  F_ret={f_r}%  M_stood={m_stood}  M_ret={m_r}%  gap={gap}pp")
