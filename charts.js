"use strict";

/* A small dependency-free SVG chart kit for the Quote Index. Charts are re-rendered at the
   container's pixel width so labels stay legible on phones. Each chart ships a hover tooltip
   and a collapsible data table so no reading depends on color alone. */
window.QuoteCharts = (() => {
  const SVG = "http://www.w3.org/2000/svg";
  const nf = new Intl.NumberFormat("en-US");
  const charts = new Map();
  let tooltip = null;

  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
  const fmt = value => value === null || value === undefined ? "—" : nf.format(value);
  const pct = (value, digits = 1) => value === null || value === undefined || Number.isNaN(value) ? "—" : `${value.toFixed(digits)}%`;

  function niceStep(max, ticks = 4) {
    const raw = max / ticks || 1;
    const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
    const candidates = [1, 2, 2.5, 5, 10].map(step => step * magnitude);
    return candidates.find(step => step >= raw) ?? candidates.at(-1);
  }

  function roundedTop(x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height);
    if (height <= 0) return "";
    return `M${x},${y + height} v${-(height - r)} q0,${-r} ${r},${-r} h${width - 2 * r} q${r},0 ${r},${r} v${height - r} z`;
  }

  function roundedRight(x, y, width, height, radius) {
    const r = Math.min(radius, height / 2, width);
    if (width <= 0) return "";
    return `M${x},${y} h${width - r} q${r},0 ${r},${r} v${height - 2 * r} q0,${r} ${-r},${r} h${-(width - r)} z`;
  }

  function textWidth(text, size) {
    return String(text).length * size * 0.56;
  }

  function tableView(headers, rows, caption) {
    return `<details class="chart-table"><summary>View as table</summary><div class="table-wrap"><table>
      <caption class="sr-only">${esc(caption)}</caption>
      <thead><tr>${headers.map((h, i) => `<th scope="col"${i ? ' class="num"' : ""}>${esc(h)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(row => `<tr>${row.map((cell, i) => `<td${i ? ' class="num"' : ""}>${esc(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div></details>`;
  }

  /* Vertical or horizontal bars for one series. `bands` draws labeled background ranges
     (used for the act structure of an episode). `emphasis` highlights one category. */
  function bars(width, options) {
    const {data, horizontal = false, format = fmt, emphasis = null, bands = [], unit = "", valueLabels = "auto",
      axisLabel = "", color = "var(--series-1)", emphasisColor = "var(--series-2)", maxValue = null} = options;
    const max = maxValue ?? Math.max(1, ...data.map(d => d.value ?? 0));
    const step = niceStep(max);
    const ceiling = Math.max(step, Math.ceil(max / step) * step);
    const fontSize = 12;
    if (horizontal) {
      const rowHeight = 26;
      const labelWidth = Math.min(width * 0.42, Math.max(...data.map(d => textWidth(d.label, 12.5))) + 10);
      const left = labelWidth + 6;
      const right = 54;
      const top = 6;
      const height = top + data.length * rowHeight + 8;
      const inner = Math.max(10, width - left - right);
      const x = value => left + inner * value / ceiling;
      let out = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(options.ariaLabel ?? "Bar chart")}">`;
      for (let tick = step; tick <= ceiling; tick += step) {
        out += `<line class="grid" x1="${x(tick)}" x2="${x(tick)}" y1="${top}" y2="${height - 8}"/>`;
      }
      data.forEach((d, i) => {
        const y = top + i * rowHeight;
        const barWidth = Math.max(0, inner * (d.value ?? 0) / ceiling);
        const fill = d.key !== undefined && d.key === emphasis ? emphasisColor : (d.color ?? color);
        out += `<g class="mark" data-tip="${esc(d.tip ?? `${d.label}: ${format(d.value)}${unit}`)}" ${d.focus ? `data-focus="${esc(d.focus)}"` : ""} tabindex="0">
          <rect class="hit" x="0" y="${y}" width="${width}" height="${rowHeight}"/>
          <text class="label" x="${left - 8}" y="${y + rowHeight / 2}" text-anchor="end" dominant-baseline="middle">${esc(d.label)}</text>
          <path d="${roundedRight(left, y + 5, barWidth, rowHeight - 10, 4)}" fill="${fill}"/>
          <text class="value" x="${left + barWidth + 6}" y="${y + rowHeight / 2}" dominant-baseline="middle">${esc(format(d.value))}${esc(unit)}</text>
        </g>`;
      });
      out += `<line class="axis" x1="${left}" x2="${left}" y1="${top}" y2="${height - 8}"/></svg>`;
      return out;
    }
    const tickFormat = options.tickFormat ?? format;
    const top = 18;
    const bottom = axisLabel ? 44 : 30;
    const left = 10 + textWidth(tickFormat(ceiling), fontSize);
    const right = 8;
    const height = options.height ?? Math.max(200, Math.min(320, width * 0.42));
    const inner = Math.max(10, width - left - right);
    const plot = height - top - bottom;
    const slot = inner / data.length;
    const barWidth = Math.max(2, Math.min(44, slot * 0.68));
    const y = value => top + plot - plot * value / ceiling;
    let out = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(options.ariaLabel ?? "Bar chart")}">`;
    for (const band of bands) {
      const x1 = left + slot * band.from;
      const x2 = left + slot * band.to;
      out += `<rect class="band" x="${x1}" y="${top}" width="${x2 - x1}" height="${plot}"/>
        <text class="band-label" x="${(x1 + x2) / 2}" y="${top - 6}" text-anchor="middle">${esc(band.label)}</text>`;
    }
    for (let tick = 0; tick <= ceiling; tick += step) {
      out += `<line class="grid" x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}"/>
        <text class="tick" x="${left - 6}" y="${y(tick)}" text-anchor="end" dominant-baseline="middle">${esc(tickFormat(tick))}</text>`;
    }
    const pinned = data.some(d => d.always);
    const every = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(inner / (Math.max(...data.map(d => textWidth(d.label, 11.5))) + 8)))));
    const showLabel = (d, i) => pinned ? d.always : i % every === 0;
    const showValues = valueLabels === "all" || (valueLabels === "auto" && slot >= 34 && data.length <= 12);
    data.forEach((d, i) => {
      const cx = left + slot * (i + 0.5);
      const value = d.value ?? 0;
      const fill = d.key !== undefined && d.key === emphasis ? emphasisColor : (d.color ?? color);
      out += `<g class="mark" data-tip="${esc(d.tip ?? `${d.label}: ${format(d.value)}${unit}`)}" ${d.focus ? `data-focus="${esc(d.focus)}"` : ""} tabindex="0">
        <rect class="hit" x="${cx - slot / 2}" y="${top}" width="${slot}" height="${plot + bottom}"/>
        <path d="${roundedTop(cx - barWidth / 2, y(value), barWidth, plot - (y(value) - top), 4)}" fill="${fill}"/>
        ${showValues && value > 0 ? `<text class="value" x="${cx}" y="${y(value) - 5}" text-anchor="middle">${esc(format(value))}</text>` : ""}
        ${showLabel(d, i) ? `<text class="label" x="${cx}" y="${height - bottom + 18}" text-anchor="middle">${esc(d.label)}</text>` : ""}
      </g>`;
    });
    out += `<line class="axis" x1="${left}" x2="${width - right}" y1="${y(0)}" y2="${y(0)}"/>`;
    if (axisLabel) out += `<text class="axis-label" x="${left + inner / 2}" y="${height - 4}" text-anchor="middle">${esc(axisLabel)}</text>`;
    return out + "</svg>";
  }

  /* A line with an area under it; markers on `callouts` carry direct labels. */
  function line(width, options) {
    const {data, format = fmt, callouts = [], xLabel = "", yFormat = format, log = false} = options;
    const top = 16;
    const bottom = xLabel ? 44 : 30;
    const left = 46;
    const right = 14;
    const height = options.height ?? Math.max(200, Math.min(300, width * 0.4));
    const inner = width - left - right;
    const plot = height - top - bottom;
    const xs = data.map(d => d.x);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const scaleX = log
      ? value => left + inner * (Math.log10(value) - Math.log10(xMin)) / (Math.log10(xMax) - Math.log10(xMin) || 1)
      : value => left + inner * (value - xMin) / (xMax - xMin || 1);
    const yMax = options.yMax ?? Math.max(1, ...data.map(d => d.y));
    const step = niceStep(yMax);
    const ceiling = Math.max(step, Math.ceil(yMax / step) * step);
    const scaleY = value => top + plot - plot * value / ceiling;
    const path = data.map((d, i) => `${i ? "L" : "M"}${scaleX(d.x).toFixed(1)},${scaleY(d.y).toFixed(1)}`).join(" ");
    let out = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(options.ariaLabel ?? "Line chart")}">`;
    for (let tick = 0; tick <= ceiling; tick += step) {
      out += `<line class="grid" x1="${left}" x2="${width - right}" y1="${scaleY(tick)}" y2="${scaleY(tick)}"/>
        <text class="tick" x="${left - 6}" y="${scaleY(tick)}" text-anchor="end" dominant-baseline="middle">${esc(yFormat(tick))}</text>`;
    }
    const xTicks = log
      ? [1, 10, 100, 1000, 10000, 100000].filter(value => value >= xMin && value <= xMax)
      : Array.from({length: 6}, (_, i) => Math.round(xMin + (xMax - xMin) * i / 5));
    for (const tick of xTicks) {
      out += `<text class="label" x="${scaleX(tick)}" y="${height - bottom + 18}" text-anchor="middle">${esc(format(tick))}</text>`;
    }
    out += `<path class="area" d="${path} L${scaleX(xMax)},${scaleY(0)} L${scaleX(xMin)},${scaleY(0)} z"/>
      <path class="line" d="${path}"/>`;
    for (const point of callouts) {
      const px = scaleX(point.x);
      const py = scaleY(point.y);
      const anchor = px > width - 120 ? "end" : "start";
      out += `<g class="mark" data-tip="${esc(point.tip)}" tabindex="0">
        <circle class="hit" cx="${px}" cy="${py}" r="14"/>
        <circle class="marker" cx="${px}" cy="${py}" r="5"/>
        <text class="callout" x="${px + (anchor === "end" ? -9 : 9)}" y="${py + (point.dy ?? -9)}" text-anchor="${anchor}">${esc(point.label)}</text>
      </g>`;
    }
    out += `<line class="axis" x1="${left}" x2="${width - right}" y1="${scaleY(0)}" y2="${scaleY(0)}"/>`;
    if (xLabel) out += `<text class="axis-label" x="${left + inner / 2}" y="${height - 4}" text-anchor="middle">${esc(xLabel)}</text>`;
    return out + "</svg>";
  }

  /* A single-hue heatmap. `cell(r, c)` returns a number or null (no data). */
  function heatmap(width, options) {
    const {rows, cols, cell, format = fmt, rowLabelWidth = 44, square = false, tip, legendMax = null,
      levels = 7, rowFocus = null} = options;
    const left = rowLabelWidth;
    const top = 20;
    const gap = 2;
    const cellWidth = Math.max(8, (width - left - 2) / cols.length - gap);
    const cellHeight = square ? cellWidth : Math.max(16, Math.min(26, cellWidth * 0.8));
    const height = top + rows.length * (cellHeight + gap) + 6;
    let max = legendMax;
    if (max === null) {
      max = 0;
      rows.forEach((_, r) => cols.forEach((__, c) => { max = Math.max(max, cell(r, c) ?? 0); }));
    }
    const every = Math.max(1, Math.ceil(textWidth(cols.at(-1), 11) / (cellWidth + gap)));
    let out = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(options.ariaLabel ?? "Heatmap")}">`;
    cols.forEach((label, c) => {
      if (c % every === 0) out += `<text class="label" x="${left + c * (cellWidth + gap) + cellWidth / 2}" y="${top - 7}" text-anchor="middle">${esc(label)}</text>`;
    });
    rows.forEach((rowLabel, r) => {
      const y = top + r * (cellHeight + gap);
      out += `<text class="label" x="${left - 6}" y="${y + cellHeight / 2}" text-anchor="end" dominant-baseline="middle">${esc(rowLabel)}</text>`;
      cols.forEach((colLabel, c) => {
        const value = cell(r, c);
        const x = left + c * (cellWidth + gap);
        const level = value === null ? "na" : value === 0 ? 0 : Math.max(1, Math.ceil(levels * value / (max || 1)));
        const focus = rowFocus ? rowFocus(r, c) : null;
        out += `<rect class="cell mark" data-level="${level}" x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" rx="3"
          data-tip="${esc(tip ? tip(r, c, value) : `${rowLabel} · ${colLabel}: ${value === null ? "no data" : format(value)}`)}" ${focus ? `data-focus="${esc(focus)}"` : ""} tabindex="0"/>`;
      });
    });
    out += "</svg>";
    const swatches = Array.from({length: levels + 1}, (_, level) => `<span class="swatch" data-level="${level}"></span>`).join("");
    out += `<div class="legend"><span>0</span>${swatches}<span>${esc(format(max))}</span></div>`;
    return out;
  }

  /* One tall segmented bar: part-to-whole for up to six categories with a legend. */
  function segmented(width, options) {
    const {parts, format = fmt, total = parts.reduce((sum, part) => sum + part.value, 0)} = options;
    const height = 44;
    const gap = 2;
    let x = 0;
    let out = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(options.ariaLabel ?? "Segmented bar")}">`;
    parts.forEach((part, index) => {
      const w = Math.max(0, width * part.value / (total || 1) - gap);
      const share = 100 * part.value / (total || 1);
      out += `<g class="mark" data-tip="${esc(`${part.label}: ${format(part.value)} · ${pct(share)}`)}" tabindex="0">
        <rect x="${x}" y="4" width="${w}" height="${height - 8}" rx="4" fill="var(--series-${index + 1})"/>
        ${w > textWidth(pct(share, 0), 12) + 8 ? `<text class="on-fill" x="${x + w / 2}" y="${height / 2}" text-anchor="middle" dominant-baseline="middle">${esc(pct(share, 0))}</text>` : ""}
      </g>`;
      x += w + gap;
    });
    out += "</svg>";
    out += `<ul class="legend legend-list">${parts.map((part, index) =>
      `<li><span class="swatch" style="background: var(--series-${index + 1})"></span>${esc(part.label)} <b>${esc(format(part.value))}</b></li>`).join("")}</ul>`;
    return out;
  }

  function showTip(target, event) {
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.className = "chart-tip";
      tooltip.setAttribute("role", "status");
      document.body.append(tooltip);
    }
    tooltip.textContent = target.dataset.tip;
    tooltip.hidden = false;
    const rect = target.getBoundingClientRect();
    const px = event?.clientX ?? rect.left + rect.width / 2;
    const py = event?.clientY ?? rect.top;
    const tipRect = tooltip.getBoundingClientRect();
    const x = Math.min(window.innerWidth - tipRect.width - 8, Math.max(8, px - tipRect.width / 2));
    const y = py - tipRect.height - 14 < 8 ? py + 18 : py - tipRect.height - 14;
    tooltip.style.transform = `translate(${Math.round(x + window.scrollX)}px, ${Math.round(y + window.scrollY)}px)`;
  }

  function hideTip() {
    if (tooltip) tooltip.hidden = true;
  }

  function bindTips(container) {
    container.addEventListener("pointermove", event => {
      const mark = event.target.closest("[data-tip]");
      if (mark) showTip(mark, event);
      else hideTip();
    });
    container.addEventListener("pointerleave", hideTip);
    container.addEventListener("focusin", event => {
      const mark = event.target.closest("[data-tip]");
      if (mark) showTip(mark);
    });
    container.addEventListener("focusout", hideTip);
    container.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const mark = event.target.closest("[data-focus]");
      if (!mark) return;
      event.preventDefault();
      mark.dispatchEvent(new CustomEvent("chart-focus", {bubbles: true, detail: mark.dataset.focus}));
    });
    container.addEventListener("click", event => {
      const mark = event.target.closest("[data-focus]");
      if (mark) mark.dispatchEvent(new CustomEvent("chart-focus", {bubbles: true, detail: mark.dataset.focus}));
    });
  }

  /* Register a chart: `render(width)` returns SVG markup; a table view is appended when given. */
  function mount(id, render, table) {
    const host = document.getElementById(id);
    if (!host) return;
    const figure = host.querySelector(".chart-figure") ?? host;
    let frame = 0;
    const draw = () => {
      const width = Math.max(240, Math.floor(figure.clientWidth));
      figure.innerHTML = render(width);
      if (table) {
        let details = host.querySelector(".chart-table");
        if (details) details.remove();
        host.insertAdjacentHTML("beforeend", tableView(table.headers, table.rows, table.caption));
      }
    };
    charts.set(id, draw);
    if (!figure.dataset.bound) {
      bindTips(figure);
      figure.dataset.bound = "true";
      new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(draw);
      }).observe(figure);
    }
    draw();
  }

  return {bars, line, heatmap, segmented, mount, tableView, pct, fmt, esc};
})();
