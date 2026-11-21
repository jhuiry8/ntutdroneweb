/* Tiny dependency-free chart helpers that draw inline SVG (no CDN, CSP-safe).
 *
 * Every function returns an HTML/SVG *string*, so it also runs in Node for tests; use
 * Charts.mount(el, html) to put the result on the page. All text is escaped.
 *
 *   Charts.pie(data, opts)      -> pie / donut + legend (label, count, percent)
 *   Charts.bar(data, opts)      -> horizontal bars with the value and percent printed at the bar end
 *   Charts.columns(data, opts)  -> vertical columns (e.g. a 1..5 rating distribution)
 *   Charts.legend(data, opts)   -> the legend alone
 *   Charts.table(data, opts)    -> plain accessible data table (same numbers as the chart)
 *   Charts.mount(el, html)      -> el.innerHTML = html (and injects the stylesheet once)
 *   Charts.palette              -> the 8 categorical colours (light/dark pairs)
 *   Charts.esc(value)           -> HTML escape
 *
 * data: [{ label: string, value: number, color?: number }]   (color = palette slot 0..7, default by position)
 * opts: { title, desc, unit ('' | '人' ...), total (percent denominator, default sum of values),
 *         size (pie px), donut (bool), maxLabel (chars), format (value -> text), percentDigits }
 *
 * Colours come from CSS custom properties (--ch-1..--ch-8, --ch-ink ...) defined by the stylesheet this
 * module injects. They follow the site theme: dark by default, [data-theme="light"] for light, and a
 * light set when printing. Values and percentages are always written out as text, so no meaning is
 * carried by colour alone.
 */
(function () {
    'use strict';
    var root = typeof window !== 'undefined' ? window : globalThis;

    // Validated categorical set: [light surface, dark surface]. Fixed order, never cycled past 8.
    var PALETTE = [
        ['#2a78d6', '#3987e5'], ['#eb6834', '#d95926'], ['#1baf7a', '#199e70'], ['#eda100', '#c98500'],
        ['#e87ba4', '#d55181'], ['#008300', '#0ca30c'], ['#6250d6', '#9085e9'], ['#e34948', '#e66767']
    ];
    var OTHER = ['#898781', '#898781'];

    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
    }
    function num(value) { var n = Number(value); return isFinite(n) && n > 0 ? n : 0; }
    function round(n, digits) { var f = Math.pow(10, digits == null ? 1 : digits); return Math.round(n * f) / f; }
    function pct(value, total, digits) { return total > 0 ? round(value / total * 100, digits == null ? 1 : digits) : 0; }
    function clip(text, max) { text = String(text == null ? '' : text); return text.length > max ? text.slice(0, max - 1) + '…' : text; }
    function slot(item, index) { return item && item.color != null ? item.color : index; }
    function fill(item, index) {
        var s = slot(item, index);
        return s >= PALETTE.length ? 'var(--ch-other)' : 'var(--ch-' + (s + 1) + ')';
    }

    function css() {
        var light = ':root[data-theme="light"] .ch, .ch.ch-light {', dark = '.ch {';
        var lightVars = '', darkVars = '';
        PALETTE.forEach(function (pair, i) { lightVars += '--ch-' + (i + 1) + ':' + pair[0] + ';'; darkVars += '--ch-' + (i + 1) + ':' + pair[1] + ';'; });
        lightVars += '--ch-other:' + OTHER[0] + ';--ch-ink:#0b0b0b;--ch-ink2:#52514e;--ch-muted:#6b6963;--ch-grid:#e1e0d9;--ch-track:#eceae4;--ch-surface:#fcfcfb;--ch-onfill:#ffffff;';
        darkVars += '--ch-other:' + OTHER[1] + ';--ch-ink:#f0efec;--ch-ink2:#c3c2b7;--ch-muted:#a3a198;--ch-grid:#2c2c2a;--ch-track:#2c2c2a;--ch-surface:#1a1a19;--ch-onfill:#ffffff;';
        return dark + darkVars + '}\n' + light + lightVars + '}\n'
            + '@media print { .ch { ' + lightVars + ' } }\n'
            + '.ch { color: var(--ch-ink); font-family: inherit; }\n'
            + '.ch svg { max-width: 100%; height: auto; display: block; }\n'
            + '.ch .ch-t { fill: var(--ch-ink); font-size: 13px; } .ch .ch-t2 { fill: var(--ch-ink2); font-size: 12px; } .ch .ch-axis { stroke: var(--ch-grid); stroke-width: 1; }\n'
            + '.ch .ch-track { fill: var(--ch-track); } .ch .ch-gap { stroke: var(--ch-surface); stroke-width: 2; }\n'
            + '.ch .ch-onfill { fill: var(--ch-onfill); font-size: 12px; font-weight: 700; }\n'
            + '.ch-wrap { display: flex; flex-wrap: wrap; gap: 16px 28px; align-items: center; }\n'
            + '.ch-legend { list-style: none; margin: 0; padding: 0; min-width: 200px; flex: 1 1 200px; }\n'
            + '.ch-legend li { display: grid; grid-template-columns: 14px 1fr auto auto; gap: 8px; align-items: baseline; padding: 4px 0; font-size: .92rem; color: var(--ch-ink); }\n'
            + '.ch-legend .sw { width: 12px; height: 12px; border-radius: 3px; display: inline-block; align-self: center; }\n'
            + '.ch-legend .n { color: var(--ch-ink2); font-variant-numeric: tabular-nums; } .ch-legend .p { font-weight: 700; font-variant-numeric: tabular-nums; min-width: 3.6em; text-align: right; }\n'
            + '.ch-table { width: 100%; border-collapse: collapse; font-size: .88rem; } .ch-table th, .ch-table td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--ch-grid); color: var(--ch-ink); } .ch-table td.r, .ch-table th.r { text-align: right; font-variant-numeric: tabular-nums; }\n'
            + '.ch-empty { color: var(--ch-muted); font-size: .9rem; }\n';
    }

    function mount(el, html) {
        if (typeof document !== 'undefined' && !document.getElementById('ch-style')) {
            var style = document.createElement('style'); style.id = 'ch-style'; style.textContent = css(); document.head.appendChild(style);
        }
        el.innerHTML = html;
    }

    function prepare(data, opts) {
        opts = opts || {};
        var items = (data || []).map(function (d, i) { return { label: String(d.label == null ? '' : d.label), value: num(d.value), color: d.color, index: i }; });
        var sum = items.reduce(function (a, d) { return a + d.value; }, 0);
        var total = opts.total != null && num(opts.total) > 0 ? num(opts.total) : sum;
        var digits = opts.percentDigits == null ? 1 : opts.percentDigits;
        var format = opts.format || function (v) { return String(round(v, 2)); };
        var unit = opts.unit || '';
        items.forEach(function (d) { d.pct = pct(d.value, total, digits); d.text = format(d.value) + unit; });
        return { items: items, sum: sum, total: total, opts: opts, digits: digits };
    }

    function wrapSvg(p, w, h, inner) {
        var o = p.opts;
        var label = (o.title ? o.title + '. ' : '') + p.items.map(function (d) { return d.label + ' ' + d.text + ' (' + d.pct + '%)'; }).join('; ');
        return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" role="img" aria-label="' + esc(label) + '" xmlns="http://www.w3.org/2000/svg">'
            + (o.title ? '<title>' + esc(o.title) + '</title>' : '') + (o.desc ? '<desc>' + esc(o.desc) + '</desc>' : '') + inner + '</svg>';
    }

    function legend(data, opts) {
        var p = prepare(data, opts);
        return '<ul class="ch ch-legend">' + p.items.map(function (d, i) {
            return '<li><span class="sw" style="background:' + fill(d, i) + '"></span><span>' + esc(clip(d.label, opts && opts.maxLabel || 60)) + '</span><span class="n">' + esc(d.text) + '</span><span class="p">' + d.pct + '%</span></li>';
        }).join('') + '</ul>';
    }

    function polar(cx, cy, r, angle) { return [round(cx + r * Math.sin(angle), 2), round(cy - r * Math.cos(angle), 2)]; }

    function pie(data, opts) {
        var p = prepare(data, opts), o = p.opts;
        if (!p.sum) return '<p class="ch-empty">' + esc(o.empty || '—') + '</p>';
        var size = o.size || 220, r = size / 2 - 4, cx = size / 2, cy = size / 2;
        var inner = o.donut === false ? 0 : r * 0.5;
        var angle = 0, parts = '';
        var visible = p.items.filter(function (d) { return d.value > 0; });
        visible.forEach(function (d) {
            var span = d.value / p.sum * Math.PI * 2, start = angle, end = angle + span;
            angle = end;
            var title = '<title>' + esc(d.label + ': ' + d.text + ' (' + d.pct + '%)') + '</title>';
            if (visible.length === 1) {
                parts += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + fill(d, d.index) + '" class="ch-gap">' + title + '</circle>';
                if (inner) parts += '<circle cx="' + cx + '" cy="' + cy + '" r="' + inner + '" fill="var(--ch-surface)"/>';
                return;
            }
            var a = polar(cx, cy, r, start), b = polar(cx, cy, r, end), large = span > Math.PI ? 1 : 0;
            var path = inner
                ? 'M' + a[0] + ' ' + a[1] + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + b[0] + ' ' + b[1] + ' L' + polar(cx, cy, inner, end).join(' ') + ' A' + inner + ' ' + inner + ' 0 ' + large + ' 0 ' + polar(cx, cy, inner, start).join(' ') + ' Z'
                : 'M' + cx + ' ' + cy + ' L' + a[0] + ' ' + a[1] + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + b[0] + ' ' + b[1] + ' Z';
            parts += '<path d="' + path + '" fill="' + fill(d, d.index) + '" class="ch-gap">' + title + '</path>';
        });
        // Percent printed on slices big enough to hold it; the legend lists every value anyway.
        angle = 0;
        visible.forEach(function (d) {
            var span = d.value / p.sum * Math.PI * 2, mid = angle + span / 2; angle += span;
            if (d.value / p.sum < 0.07 || visible.length === 1) return;
            var pos = polar(cx, cy, inner ? (r + inner) / 2 : r * 0.65, mid);
            parts += '<text x="' + pos[0] + '" y="' + (pos[1] + 4) + '" text-anchor="middle" class="ch-onfill" style="paint-order:stroke;stroke:rgba(0,0,0,.35);stroke-width:2px">' + d.pct + '%</text>';
        });
        if (visible.length === 1) parts += '<text x="' + cx + '" y="' + (cy + 5) + '" text-anchor="middle" class="ch-t" style="font-weight:700">' + visible[0].pct + '%</text>';
        else if (inner && o.center) parts += '<text x="' + cx + '" y="' + (cy + 5) + '" text-anchor="middle" class="ch-t" style="font-weight:700">' + esc(o.center) + '</text>';
        return '<div class="ch ch-wrap">' + wrapSvg(p, size, size, parts) + legend(data, opts) + '</div>';
    }

    function bar(data, opts) {
        var p = prepare(data, opts), o = p.opts;
        if (!p.items.length) return '<p class="ch-empty">' + esc(o.empty || '—') + '</p>';
        var rowH = 34, labelW = 150, valueW = 92, w = o.width || 520, plotW = w - labelW - valueW;
        var max = Math.max.apply(null, p.items.map(function (d) { return d.value; }).concat([1]));
        var scaleMax = o.max ? num(o.max) : max;
        var body = '';
        p.items.forEach(function (d, i) {
            var y = i * rowH + 4, bw = Math.max(d.value > 0 ? 3 : 0, plotW * d.value / scaleMax);
            body += '<g><title>' + esc(d.label + ': ' + d.text + ' (' + d.pct + '%)') + '</title>'
                + '<text x="' + (labelW - 8) + '" y="' + (y + 17) + '" text-anchor="end" class="ch-t">' + esc(clip(d.label, 14)) + '</text>'
                + '<rect x="' + labelW + '" y="' + y + '" width="' + plotW + '" height="22" rx="4" class="ch-track"/>'
                + (bw ? '<rect x="' + labelW + '" y="' + y + '" width="' + round(bw, 2) + '" height="22" rx="4" fill="' + fill(d, o.single ? 0 : d.index) + '"/>' : '')
                + '<text x="' + (labelW + plotW + 8) + '" y="' + (y + 17) + '" class="ch-t">' + esc(d.text) + ' · ' + d.pct + '%</text></g>';
        });
        var full = p.items.some(function (d) { return d.label.length > 14; });
        return '<div class="ch">' + wrapSvg(p, w, p.items.length * rowH + 8, body)
            + (full ? legendLong(p) : '') + '</div>';
    }
    // Long labels are cut inside the SVG, so list them in full below the chart.
    function legendLong(p) {
        return '<details style="margin-top:6px"><summary class="ch-empty" style="cursor:pointer">' + esc(p.opts.fullLabels || '…') + '</summary>' + legend(p.items, p.opts) + '</details>';
    }

    function columns(data, opts) {
        var p = prepare(data, opts), o = p.opts;
        if (!p.items.length) return '<p class="ch-empty">' + esc(o.empty || '—') + '</p>';
        var n = p.items.length, colW = Math.min(56, Math.max(24, Math.floor(480 / n))), gap = Math.max(6, Math.floor(colW / 4));
        var w = n * (colW + gap) + gap + 8, h = 190, base = h - 30, top = 28;
        var max = Math.max.apply(null, p.items.map(function (d) { return d.value; }).concat([1]));
        var body = '<line x1="0" x2="' + w + '" y1="' + base + '" y2="' + base + '" class="ch-axis"/>';
        p.items.forEach(function (d, i) {
            var x = gap + i * (colW + gap), bh = d.value > 0 ? Math.max(3, (base - top) * d.value / max) : 0;
            body += '<g><title>' + esc(d.label + ': ' + d.text + ' (' + d.pct + '%)') + '</title>'
                + (bh ? '<rect x="' + x + '" y="' + round(base - bh, 2) + '" width="' + colW + '" height="' + round(bh, 2) + '" rx="4" fill="' + fill(d, o.single === false ? d.index : 0) + '"/>' : '')
                + '<text x="' + (x + colW / 2) + '" y="' + round(base - bh - 6, 2) + '" text-anchor="middle" class="ch-t" style="font-weight:700">' + esc(d.text) + '</text>'
                + '<text x="' + (x + colW / 2) + '" y="' + (base + 16) + '" text-anchor="middle" class="ch-t2">' + esc(clip(d.label, 6)) + '</text>'
                + '<text x="' + (x + colW / 2) + '" y="' + (base + 28) + '" text-anchor="middle" class="ch-t2">' + d.pct + '%</text></g>';
        });
        return '<div class="ch">' + wrapSvg(p, w, h + 6, body) + '</div>';
    }

    function table(data, opts) {
        var p = prepare(data, opts);
        return '<table class="ch ch-table"><thead><tr><th>' + esc((opts && opts.labelHeader) || '') + '</th><th class="r">' + esc((opts && opts.valueHeader) || '#') + '</th><th class="r">%</th></tr></thead><tbody>'
            + p.items.map(function (d) { return '<tr><td>' + esc(d.label) + '</td><td class="r">' + esc(d.text) + '</td><td class="r">' + d.pct + '%</td></tr>'; }).join('') + '</tbody></table>';
    }

    root.Charts = { pie: pie, bar: bar, columns: columns, legend: legend, table: table, mount: mount, palette: PALETTE, esc: esc, css: css };
})();
