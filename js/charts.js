/*
 * MoneyMonkey — tiny dependency-free SVG charts.
 * Colors come from CSS custom properties (--series-N, --grid, --axis, ...).
 */
(function (root) {
  'use strict';

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // segments: [{ label, value, color }] — renders a donut with a 2px surface gap between slices.
  function donut(segments, opts = {}) {
    const size = opts.size || 200;
    const stroke = opts.stroke || 28;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
    const cx = size / 2;
    if (!total) {
      return `<svg viewBox="0 0 ${size} ${size}" class="donut" role="img" aria-label="No assets yet">
        <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="var(--grid)" stroke-width="${stroke}"/></svg>`;
    }
    const gap = segments.filter((s) => s.value > 0).length > 1 ? 2 : 0;
    let offset = 0;
    const arcs = segments
      .filter((s) => s.value > 0)
      .map((s) => {
        const len = (s.value / total) * c;
        const dash = Math.max(0, len - gap);
        const arc = `<circle class="donut-seg" cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${stroke}"
          stroke-dasharray="${dash} ${c - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cx})"
          data-tip="${esc(s.label)}: ${esc(s.display || '')} (${((s.value / total) * 100).toFixed(1)}%)"></circle>`;
        offset += len;
        return arc;
      })
      .join('');
    return `<svg viewBox="0 0 ${size} ${size}" class="donut" role="img" aria-label="Asset allocation">${arcs}
      ${opts.center ? `<text x="${cx}" y="${cx - 4}" text-anchor="middle" class="donut-label">${esc(opts.centerLabel || '')}</text>
      <text x="${cx}" y="${cx + 18}" text-anchor="middle" class="donut-value">${esc(opts.center)}</text>` : ''}</svg>`;
  }

  // points: [{ date: 'YYYY-MM-DD', value }]; format: number -> string
  function lineChart(points, opts = {}) {
    const W = opts.width || 640;
    const H = opts.height || 220;
    const pad = { l: 8, r: 8, t: 16, b: 24 };
    if (points.length < 2) {
      return `<div class="chart-empty">Net worth history builds up automatically — one point per day you open MoneyMonkey.</div>`;
    }
    const vals = points.map((p) => p.value);
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;
    min -= span * 0.08;
    max += span * 0.08;
    const x = (i) => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r);
    const y = (v) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
    const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
    const area = `${path}L${x(points.length - 1).toFixed(1)},${H - pad.b}L${x(0).toFixed(1)},${H - pad.b}Z`;
    const grid = [0.25, 0.5, 0.75]
      .map((f) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t + f * (H - pad.t - pad.b)}" y2="${pad.t + f * (H - pad.t - pad.b)}" class="grid"/>`)
      .join('');
    const fmt = opts.format || String;
    const data = esc(JSON.stringify(points.map((p, i) => [x(i), y(p.value), p.date, fmt(p.value)])));
    return `<div class="line-wrap" data-points="${data}" data-w="${W}">
      <svg viewBox="0 0 ${W} ${H}" class="line-chart" preserveAspectRatio="none" role="img" aria-label="Net worth over time">
        ${grid}
        <line x1="${pad.l}" x2="${W - pad.r}" y1="${H - pad.b}" y2="${H - pad.b}" class="axis"/>
        <path d="${area}" class="area"/>
        <path d="${path}" class="line" vector-effect="non-scaling-stroke"/>
        <line class="crosshair" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" vector-effect="non-scaling-stroke" style="display:none"/>
      </svg>
      <div class="line-dot" style="display:none"></div>
      <div class="axis-labels"><span>${esc(points[0].date)}</span><span>${esc(points[points.length - 1].date)}</span></div>
    </div>`;
  }

  // Hover layer for every .line-wrap inside container: crosshair + dot + tooltip at nearest point.
  function bindLineHover(container, tooltip) {
    container.querySelectorAll('.line-wrap').forEach((wrap) => {
      const pts = JSON.parse(wrap.dataset.points);
      const W = +wrap.dataset.w;
      const svg = wrap.querySelector('svg');
      const cross = wrap.querySelector('.crosshair');
      const dot = wrap.querySelector('.line-dot');
      const vb = svg.viewBox.baseVal;
      wrap.addEventListener('pointermove', (e) => {
        const rect = svg.getBoundingClientRect();
        const vx = ((e.clientX - rect.left) / rect.width) * W;
        let best = pts[0];
        for (const p of pts) if (Math.abs(p[0] - vx) < Math.abs(best[0] - vx)) best = p;
        cross.setAttribute('x1', best[0]);
        cross.setAttribute('x2', best[0]);
        cross.style.display = '';
        dot.style.display = '';
        dot.style.left = `${(best[0] / vb.width) * rect.width}px`;
        dot.style.top = `${(best[1] / vb.height) * rect.height}px`;
        tooltip.show(`<div class="tip-date">${esc(best[2])}</div><div class="tip-val">${esc(best[3])}</div>`, e.clientX, e.clientY, e.pointerType);
      });
      wrap.addEventListener('pointerleave', (e) => {
        cross.style.display = 'none';
        dot.style.display = 'none';
        tooltip.hide(e.pointerType);
      });
    });
  }

  // Small inline sparkline for property valuation history etc.
  function sparkline(values, opts = {}) {
    const W = opts.width || 90;
    const H = opts.height || 24;
    if (values.length < 2) return '';
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) { min -= 1; max += 1; }
    const d = values
      .map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * (W - 4) + 2).toFixed(1)},${(2 + (1 - (v - min) / (max - min)) * (H - 4)).toFixed(1)}`)
      .join('');
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><path d="${d}"/></svg>`;
  }

  root.Charts = { donut, lineChart, bindLineHover, sparkline };
})(typeof self !== 'undefined' ? self : this);
