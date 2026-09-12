/* Hábitos — hand-rolled SVG charts.
   No chart library: the app has to work offline from the cache, so every mark
   is built here. Colours come from CSS custom properties, which means both
   themes are handled by the stylesheet rather than by branching in JS. */
(function (global) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';

  function el(name, attrs, parent) {
    const node = document.createElementNS(NS, name);
    for (const k in attrs) {
      if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  /* Every chart shares one tooltip element per host container. */
  function tipFor(host) {
    let tip = host.querySelector('.viz-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'viz-tip';
      host.appendChild(tip);
    }
    return tip;
  }

  function showTip(host, tip, x, y, html) {
    tip.innerHTML = html;
    const rect = host.getBoundingClientRect();
    const clampedX = Math.max(58, Math.min(rect.width - 58, x));
    tip.style.left = clampedX + 'px';
    tip.style.top = y + 'px';
    tip.classList.add('is-on');
  }
  function hideTip(tip) {
    tip.classList.remove('is-on');
  }

  /* Maps an SVG user-space point to CSS pixels inside the host. */
  function pxScale(svg, host) {
    const vb = svg.viewBox.baseVal;
    const w = host.getBoundingClientRect().width || vb.width;
    return w / vb.width;
  }

  /* Draw at the host's real pixel width so 11px text renders as 11px. */
  function widthOf(host, min) {
    const w = Math.round(host.getBoundingClientRect().width || host.clientWidth || 0);
    return Math.max(min || 280, w || 340);
  }

  function reset(host) {
    const tip = host.querySelector('.viz-tip');
    host.innerHTML = '';
    if (tip) host.appendChild(tip);
    return tip || tipFor(host);
  }

  /* Rough ellipsis at the label column's width — ~6.2px per character at 11px. */
  function fit(text, widthPx) {
    const max = Math.max(6, Math.floor(widthPx / 6.2));
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
  }

  function legend(host, series) {
    const box = document.createElement('div');
    box.className = 'viz-legend';
    series.forEach((s) => {
      const item = document.createElement('span');
      const swatch = document.createElement('i');
      swatch.style.background = s.color;
      item.appendChild(swatch);
      item.appendChild(document.createTextNode(s.name));
      box.appendChild(item);
    });
    host.appendChild(box);
  }

  /* ── Line chart with a crosshair + tooltip ───────────────────────────
     One series (mood over time). A single series needs no legend box —
     the figure caption names it. */
  function line(host, opts) {
    const tip = reset(host);
    const pts = opts.points;
    const W = widthOf(host);
    const H = opts.height || 200;
    const M = { t: 12, r: 14, b: 26, l: 30 };
    const innerW = W - M.l - M.r;
    const innerH = H - M.t - M.b;
    const min = opts.min !== undefined ? opts.min : 0;
    const max = opts.max !== undefined ? opts.max : 5;

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.ariaLabel || '' }, host);

    const xAt = (i) => M.l + (pts.length === 1 ? innerW / 2 : (i / (pts.length - 1)) * innerW);
    const yAt = (v) => M.t + innerH - ((v - min) / (max - min)) * innerH;

    (opts.yTicks || [1, 2, 3, 4, 5]).forEach((v) => {
      const y = yAt(v);
      el('line', { class: 'viz-grid', x1: M.l, x2: W - M.r, y1: y, y2: y }, svg);
      el('text', { class: 'viz-tick', x: M.l - 7, y: y + 3.5, 'text-anchor': 'end' }, svg).textContent = v;
    });
    el('line', { class: 'viz-axis', x1: M.l, x2: W - M.r, y1: M.t + innerH, y2: M.t + innerH }, svg);

    /* x labels: first, middle and last only — dense date ticks collide. */
    const xLabelIdx = pts.length > 2 ? [0, Math.floor((pts.length - 1) / 2), pts.length - 1] : pts.map((_, i) => i);
    xLabelIdx.forEach((i) => {
      const anchor = i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle';
      el('text', { class: 'viz-tick', x: xAt(i), y: H - 8, 'text-anchor': anchor }, svg).textContent = pts[i].label;
    });

    /* Gaps (days with no entry) break the path rather than interpolating. */
    let d = '';
    let open = false;
    pts.forEach((p, i) => {
      if (p.value === null || p.value === undefined) { open = false; return; }
      d += (open ? 'L' : 'M') + xAt(i).toFixed(1) + ' ' + yAt(p.value).toFixed(1) + ' ';
      open = true;
    });
    if (d) el('path', { class: 'viz-line', d: d.trim(), stroke: opts.color || 'var(--s1)' }, svg);

    const filled = [];
    pts.forEach((p, i) => {
      if (p.value === null || p.value === undefined) return;
      filled.push(i);
      el('circle', { class: 'viz-dot', cx: xAt(i), cy: yAt(p.value), r: pts.length > 45 ? 2.6 : 4, fill: opts.color || 'var(--s1)' }, svg);
    });

    const cross = el('line', { class: 'viz-crosshair', y1: M.t, y2: M.t + innerH, opacity: 0 }, svg);
    const focus = el('circle', { r: 6, fill: opts.color || 'var(--s1)', stroke: 'var(--surface)', 'stroke-width': 2, opacity: 0 }, svg);

    const hit = el('rect', { x: 0, y: 0, width: W, height: H, fill: 'transparent' }, svg);
    hit.style.cursor = 'crosshair';

    function nearest(evt) {
      const rect = svg.getBoundingClientRect();
      const ux = ((evt.clientX - rect.left) / rect.width) * W;
      let best = null;
      let bestD = Infinity;
      filled.forEach((i) => {
        const dist = Math.abs(xAt(i) - ux);
        if (dist < bestD) { bestD = dist; best = i; }
      });
      return best;
    }

    function move(evt) {
      const i = nearest(evt);
      if (i === null) return;
      const p = pts[i];
      const s = pxScale(svg, host);
      cross.setAttribute('x1', xAt(i));
      cross.setAttribute('x2', xAt(i));
      cross.setAttribute('opacity', 1);
      focus.setAttribute('cx', xAt(i));
      focus.setAttribute('cy', yAt(p.value));
      focus.setAttribute('opacity', 1);
      showTip(host, tip, xAt(i) * s, yAt(p.value) * s, p.tip || `<b>${p.value}</b>`);
    }
    function leave() {
      cross.setAttribute('opacity', 0);
      focus.setAttribute('opacity', 0);
      hideTip(tip);
    }
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', leave);
  }

  /* ── Horizontal bars ─────────────────────────────────────────────────
     Magnitude by habit. Direct-labelled at the end of every bar, which is
     also the relief the light palette needs for its low-contrast hues. */
  function bars(host, opts) {
    const tip = reset(host);
    const items = opts.items;
    const W = widthOf(host);
    const rowH = 36;
    const gap = 8;
    const labelW = Math.round(Math.min(190, Math.max(96, W * 0.42)));
    const H = items.length * (rowH + gap) + 18;
    const innerW = W - labelW - 46;

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.ariaLabel || '' }, host);
    const max = opts.max || 100;

    items.forEach((item, i) => {
      const y = i * (rowH + gap);
      const barH = 18;
      const barY = y + (rowH - barH) / 2;

      const name = el('text', { class: 'viz-label', x: 0, y: y + rowH / 2 - 1, 'dominant-baseline': 'middle' }, svg);
      name.textContent = fit(item.label, labelW - 8);
      if (item.sub) {
        el('text', { class: 'viz-tick', x: 0, y: y + rowH / 2 + 12 }, svg).textContent = item.sub;
      }

      el('rect', { class: 'viz-bar', x: labelW, y: barY, width: innerW, height: barH, fill: 'var(--surface-3)' }, svg);
      const w = Math.max(item.value > 0 ? 4 : 0, (item.value / max) * innerW);
      const bar = el('rect', { class: 'viz-bar', x: labelW, y: barY, width: w, height: barH, fill: item.color || 'var(--s1)' }, svg);
      bar.style.cursor = 'pointer';

      el('text', {
        class: 'viz-value', x: labelW + innerW + 8, y: barY + barH / 2 + 1, 'dominant-baseline': 'middle',
      }, svg).textContent = item.valueLabel;

      const hit = el('rect', { x: labelW, y: y, width: innerW, height: rowH, fill: 'transparent' }, svg);
      hit.addEventListener('pointerenter', () => {
        const s = pxScale(svg, host);
        showTip(host, tip, (labelW + w) * s, barY * s, item.tip || item.valueLabel);
      });
      hit.addEventListener('pointerleave', () => hideTip(tip));
    });
  }

  /* ── Grouped bars (two series) ───────────────────────────────────────
     Mood on completed versus missed days. Two series get a legend and
     direct value labels, so identity is never colour-alone. */
  function groupedBars(host, opts) {
    const tip = reset(host);
    const groups = opts.groups;
    const series = opts.series;
    const W = widthOf(host);
    const H = 40 + groups.length * 52;
    const labelW = Math.round(Math.min(190, Math.max(96, W * 0.42)));
    const innerW = W - labelW - 44;
    const max = opts.max || 5;

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.ariaLabel || '' }, host);

    /* Value gridlines behind the marks. */
    for (let v = 1; v <= max; v++) {
      const x = labelW + (v / max) * innerW;
      el('line', { class: 'viz-grid', x1: x, x2: x, y1: 0, y2: H - 22 }, svg);
      el('text', { class: 'viz-tick', x: x, y: H - 8, 'text-anchor': 'middle' }, svg).textContent = v;
    }
    el('line', { class: 'viz-axis', x1: labelW, x2: labelW, y1: 0, y2: H - 22 }, svg);

    groups.forEach((g, gi) => {
      const top = gi * 52 + 4;
      const name = el('text', { class: 'viz-label', x: 0, y: top + 22, 'dominant-baseline': 'middle' }, svg);
      name.textContent = fit(g.label, labelW - 8);

      g.values.forEach((v, si) => {
        /* 2px surface gap between adjacent bars keeps the pair readable. */
        const barH = 16;
        const y = top + si * (barH + 2);
        if (v.value === null) return;
        const w = Math.max(3, (v.value / max) * innerW);
        const bar = el('rect', { class: 'viz-bar', x: labelW, y: y, width: w, height: barH, fill: series[si].color }, svg);
        bar.style.cursor = 'pointer';
        el('text', {
          class: 'viz-value', x: labelW + w + 7, y: y + barH / 2 + 1, 'dominant-baseline': 'middle',
        }, svg).textContent = v.valueLabel;

        bar.addEventListener('pointerenter', () => {
          const s = pxScale(svg, host);
          showTip(host, tip, (labelW + w) * s, y * s, v.tip || v.valueLabel);
        });
        bar.addEventListener('pointerleave', () => hideTip(tip));
      });
    });

    legend(host, series);
  }

  /* ── Calendar heatmap ────────────────────────────────────────────────
     Sequential one-hue ramp (light→dark on light, dark→light on dark):
     magnitude only, never a rainbow. Unscheduled days stay blank. */
  function heatmap(host, opts) {
    const tip = reset(host);
    const days = opts.days;           // ordered oldest → newest
    const gap = 3;
    const leftPad = 26;
    const topPad = 16;

    /* Column = calendar week, offset so each row is a fixed weekday. */
    const firstOffset = opts.firstOffset || 0;
    const weeks = Math.ceil((days.length + firstOffset) / 7);
    const avail = widthOf(host) - leftPad;
    const cell = Math.max(11, Math.min(30, Math.floor(avail / weeks) - gap));
    const step = cell + gap;
    const W = leftPad + weeks * step;
    const H = topPad + 7 * step + 4;

    const svg = el('svg', {
      viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.ariaLabel || '',
      preserveAspectRatio: 'xMinYMin meet',
    }, host);
    svg.style.maxWidth = W + 'px';
    svg.style.margin = '0 auto';

    (opts.dowLabels || []).forEach((label, row) => {
      if (row % 2 === 1) return;      // every other row, to avoid crowding
      el('text', { class: 'viz-tick', x: 0, y: topPad + row * step + cell - 2 }, svg).textContent = label;
    });

    let lastMonth = null;
    days.forEach((d, i) => {
      const pos = i + firstOffset;
      const col = Math.floor(pos / 7);
      const row = pos % 7;
      const x = leftPad + col * step;
      const y = topPad + row * step;

      if (d.monthLabel && d.monthLabel !== lastMonth) {
        lastMonth = d.monthLabel;
        el('text', { class: 'viz-tick', x: x, y: 9 }, svg).textContent = d.monthLabel;
      }

      const fill = d.scheduled === false
        ? 'transparent'
        : 'var(--seq-' + d.level + ')';
      const rect = el('rect', {
        class: 'viz-cell is-hit', x: x, y: y, width: cell, height: cell, fill: fill,
      }, svg);
      if (d.scheduled === false) {
        rect.setAttribute('stroke', 'var(--grid)');
        rect.setAttribute('stroke-dasharray', '2 2');
      }
      rect.addEventListener('pointerenter', () => {
        const s = pxScale(svg, host);
        showTip(host, tip, (x + cell / 2) * s, y * s, d.tip);
      });
      rect.addEventListener('pointerleave', () => hideTip(tip));
    });

    /* Ramp legend — the ordinal key for the fills above. */
    const scale = document.createElement('div');
    scale.className = 'viz-scale';
    scale.appendChild(document.createTextNode(opts.lessLabel || 'Less'));
    [0, 1, 2, 3, 4, 5].forEach((lv) => {
      const swatch = document.createElement('i');
      swatch.style.background = 'var(--seq-' + lv + ')';
      scale.appendChild(swatch);
    });
    scale.appendChild(document.createTextNode(opts.moreLabel || 'More'));
    host.appendChild(scale);
  }

  global.Charts = { line, bars, groupedBars, heatmap };
})(window);
