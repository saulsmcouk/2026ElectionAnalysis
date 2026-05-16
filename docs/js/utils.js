'use strict';

// ── Colour constants (map bivariate encoding) ─────────────────────────────
//   Hue        = % female among candidates with known gender  (blue=male → pink=female)
//   Saturation = confidence = 1 − (unknown / total)           (grey = all unknown)
const C_MALE    = [33,  113, 181];   // #2171b5
const C_FEMALE  = [214,  73, 111];   // #d6496f
const C_UNKNOWN = [173, 181, 189];   // #adb5bd
const C_NODATA  = [220, 220, 222];   // light grey for LADs with no election data

function lerp3(a, b, t) {
  t = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function toHex([r, g, b]) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

/**
 * Bivariate colour for a council:
 *   1. Hue from % female among known-gender candidates (lerp MALE→FEMALE)
 *   2. Blend toward grey proportional to low/medium confidence predictions
 */
function councilColor(female, male, conf_low, conf_medium, total) {
  const known = female + male;
  if (total === 0) return toHex(C_NODATA);

  const femalePct = known > 0 ? female / known : 0.5;
  const genderRGB = lerp3(C_MALE, C_FEMALE, femalePct);
  const greyRatio = total > 0 ? (conf_low + conf_medium * 0.5) / total : 0;
  return toHex(lerp3(genderRGB, C_UNKNOWN, greyRatio));
}

// ── Number / string formatters ────────────────────────────────────────────

function fmt(n) {
  if (n === null || n === undefined) return '—';
  return typeof n === 'number' ? n.toLocaleString() : n;
}

function pctStr(n, d) {
  if (!d || n === null || n === undefined) return '—';
  return (n / d * 100).toFixed(1) + '%';
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Chart data transform ──────────────────────────────────────────────────

/**
 * For each item, compute [female%, male%] as stacked percentages (known gender only).
 * Stores raw counts as parallel arrays for tooltip use.
 */
function toStackedPct(items, fKey, mKey) {
  return items.map(item => {
    const f = item[fKey] || 0;
    const m = item[mKey] || 0;
    const t = f + m;
    if (t === 0) return { f: 0, m: 0, nf: 0, nm: 0, t: 0 };
    return {
      f: +(f / t * 100).toFixed(1),
      m: +(m / t * 100).toFixed(1),
      nf: f, nm: m, t,
    };
  });
}
