'use strict';

// ── Chart colours ─────────────────────────────────────────────────────────
const COL_FEMALE  = '#d6496f';
const COL_MALE    = '#2171b5';
const COL_UNKNOWN = '#b0bec5';

// ── Chart registry ────────────────────────────────────────────────────────
// Tracks live Chart.js instances by canvas ID so they can be destroyed before rebuild.
const chartRegistry = {};

// ── Chart builder ─────────────────────────────────────────────────────────

/**
 * Build (or rebuild) a horizontal stacked 100% bar chart.
 *
 * @param {string}   canvasId   - ID of the <canvas> element
 * @param {string}   scrollId   - ID of the scrollable wrapper (height is set here)
 * @param {string[]} labels     - Bar labels (one per row)
 * @param {object[]} rows       - Output of toStackedPct(): [{f, m, nf, nm, t}, ...]
 * @param {Function} [onBarClick] - Called with the label string when a bar is clicked
 */
function buildChart(canvasId, scrollId, labels, rows, onBarClick) {
  if (chartRegistry[canvasId]) { chartRegistry[canvasId].destroy(); delete chartRegistry[canvasId]; }
  const BAR_H  = 30;
  const FOOTER = 55;
  const height = Math.max(labels.length === 1 ? 110 : 180, labels.length * BAR_H + FOOTER);
  const scroll = document.getElementById(scrollId);
  if (scroll) { scroll.style.height = height + 'px'; }

  const canvas = document.getElementById(canvasId);

  const makeDataset = (label, key, color, rows) => ({
    label,
    data: rows.map(r => r[key]),
    backgroundColor: color,
    _rawN: rows.map(r => key === 'f' ? r.nf : r.nm),
    _totN: rows.map(r => r.t),
  });

  const _chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        makeDataset('Female', 'f', COL_FEMALE, rows),
        makeDataset('Male',   'm', COL_MALE,   rows),
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      onClick: onBarClick ? (evt, elements) => {
        if (!elements.length) return;
        onBarClick(labels[elements[0].index]);
      } : undefined,
      scales: {
        x: {
          stacked: true, min: 0, max: 100,
          ticks: { callback: v => v + '%', maxTicksLimit: 6, font: { size: 11 } },
          grid: { color: '#eaecf0' },
          border: { display: false },
        },
        y: {
          stacked: true,
          ticks: {
            font: { size: 11 },
            callback: (val, i) => {
              const lbl = labels[i];
              return lbl.length > 30 ? lbl.slice(0, 28) + '…' : lbl;
            },
          },
          grid: { display: false },
        },
      },
      plugins: {
        legend: {
          position: labels.length === 1 ? 'top' : 'bottom',
          labels: { boxWidth: 12, font: { size: 11 }, padding: 10 },
        },
        tooltip: {
          callbacks: {
            label(ctx) {
              const i  = ctx.dataIndex;
              const ds = ctx.dataset;
              const n  = ds._rawN ? ds._rawN[i] : '?';
              const t  = ds._totN ? ds._totN[i] : '?';
              return ` ${ds.label}: ${ctx.parsed.x.toFixed(1)}%  (${n.toLocaleString()} of ${t.toLocaleString()})`;
            },
          },
        },
      },
    },
  });
  chartRegistry[canvasId] = _chart;
  return _chart;
}
