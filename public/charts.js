// Tiny inline-SVG charts (no library, no CDN: the CSP only allows this site's own scripts).
//
//   Charts.pie(el,  [{ label, value }],                 opts)
//   Charts.bar(el,  [{ label, value }] | [{ label, values: [..] }],  opts)   // values = one per series
//   Charts.line(el, [{ label, value }] | [{ label, values: [..] }],  opts)   // label = x axis, null values leave a gap
//
// opts (all optional): title (accessible name), series ['報名','出席'] (names for `values`), unit ('人'),
// format (value => text), width (px, default 640), horizontal (bar only), max (fixed y maximum, e.g. 100),
// empty (text when there is nothing to draw).
// Every chart carries text for its numbers (legend with value and share, value labels on bars and points), so
// colour is never the only encoding. Series colours follow the palette order and swap with the page theme:
// light by default, dark under prefers-color-scheme / [data-theme="dark"], light again when printing.
// All text goes in through textContent; data is never parsed as HTML.
(function (root) {
    'use strict';
    var NS = 'http://www.w3.org/2000/svg';
    var LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
    var DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'];
    function vars(list, surface) { return list.map(function (c, i) { return '--ch-' + (i + 1) + ':' + c + ';'; }).join('') + '--ch-surface:' + surface + ';'; }
    var CSS = [
        '.ch{' + vars(LIGHT, '#fcfcfb') + 'color:inherit;font-size:.85rem;max-width:100%}',
        '@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .ch{' + vars(DARK, '#1a1a19') + '}}',
        ':root[data-theme="dark"] .ch{' + vars(DARK, '#1a1a19') + '}',
        '.ch svg{display:block;width:100%;height:auto;max-width:100%}',
        '.ch text{fill:currentColor;font-family:inherit}.ch .ch-muted{opacity:.72}.ch .ch-grid{stroke:currentColor;opacity:.16}',
        '.ch .ch-axis{stroke:currentColor;opacity:.45}',
        '.ch-pie{display:flex;flex-wrap:wrap;gap:12px 24px;align-items:center}.ch-pie svg{flex:0 0 auto;width:min(220px,100%)}',
        '.ch-legend{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;min-width:150px;flex:1}',
        '.ch-legend li{display:flex;gap:8px;align-items:baseline}.ch-legend .sw{width:11px;height:11px;border-radius:3px;flex:0 0 auto;align-self:center}',
        '.ch-legend .v{margin-left:auto;font-variant-numeric:tabular-nums;white-space:nowrap}',
        '.ch-legend.row{flex-direction:row;flex-wrap:wrap;gap:4px 16px;margin-bottom:6px}',
        '.ch-empty{opacity:.72;padding:12px 0}',
        '@media print{:root .ch,:root[data-theme] .ch{' + vars(LIGHT, '#ffffff') + '}}'
    ].join('\n');
    function injectCss() {
        if (!root.document || root.document.getElementById('charts-css')) return;
        var style = root.document.createElement('style');
        style.id = 'charts-css'; style.textContent = CSS;
        root.document.head.appendChild(style);
    }
    function svg(tag, attrs, text) {
        var node = root.document.createElementNS(NS, tag);
        for (var key in attrs) if (Object.prototype.hasOwnProperty.call(attrs, key)) node.setAttribute(key, attrs[key]);
        if (text !== undefined) node.textContent = text;
        return node;
    }
    function html(tag, cls, text) {
        var node = root.document.createElement(tag);
        if (cls) node.className = cls;
        if (text !== undefined) node.textContent = text;
        return node;
    }
    var color = function (i) { return 'var(--ch-' + ((i % 8) + 1) + ')'; };
    function prepare(el, opts) {
        injectCss();
        el.textContent = '';
        el.classList.add('ch');
        return opts || {};
    }
    function fmt(opts) {
        return opts.format || function (v) { return (Math.round(v * 10) / 10).toLocaleString('zh-TW') + (opts.unit || ''); };
    }
    function empty(el, opts) { el.appendChild(html('p', 'ch-empty', opts.empty || '這個學期還沒有資料')); }
    function legend(names, cls) {
        var list = html('ul', 'ch-legend ' + (cls || ''));
        names.forEach(function (name, i) {
            var item = html('li');
            var sw = html('span', 'sw'); sw.style.background = color(i);
            item.appendChild(sw); item.appendChild(html('span', '', name));
            list.appendChild(item);
        });
        return list;
    }
    function short(text, max) { text = String(text); return text.length > max ? text.slice(0, max - 1) + '…' : text; }
    // Smallest 1/2/5×10ⁿ at or above the data maximum, so the axis ends on a round number.
    function niceMax(max) {
        if (max <= 0) return 1;
        var pow = Math.pow(10, Math.floor(Math.log(max) / Math.LN10)), n = max / pow;
        return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
    }
    function seriesOf(data, opts) {
        var count = 1;
        data.forEach(function (d) { if (d.values) count = Math.max(count, d.values.length); });
        var names = opts.series && opts.series.length ? opts.series.slice(0, count) : [];
        while (names.length < count) names.push(count === 1 ? (opts.title || '數值') : '系列 ' + (names.length + 1));
        return { count: count, names: names, rows: data.map(function (d) { return { label: d.label, values: d.values ? d.values : [d.value] }; }) };
    }

    // ---- pie -----------------------------------------------------------------------------
    function pie(el, data, opts) {
        opts = prepare(el, opts);
        var f = fmt(opts);
        var items = (data || []).map(function (d) { return { label: String(d.label), value: Math.max(0, Number(d.value) || 0) }; });
        // At most 8 colours: the rest fold into 其他.
        if (items.length > 8) {
            var rest = items.slice(7);
            items = items.slice(0, 7).concat([{ label: '其他', value: rest.reduce(function (s, d) { return s + d.value; }, 0) }]);
        }
        var total = items.reduce(function (s, d) { return s + d.value; }, 0);
        if (!total) return empty(el, opts);
        var wrap = html('div', 'ch-pie');
        var size = 220, r = 100, c = size / 2;
        var chart = svg('svg', { viewBox: '0 0 ' + size + ' ' + size, role: 'img', 'aria-label': (opts.title || '圓餅圖') + '：' + items.map(function (d) { return d.label + ' ' + f(d.value); }).join('、') });
        var angle = -Math.PI / 2;
        items.forEach(function (d, i) {
            if (!d.value) return;
            var share = d.value / total, tip = d.label + '：' + f(d.value) + '（' + Math.round(share * 1000) / 10 + '%）';
            var node;
            if (share >= 0.9999) node = svg('circle', { cx: c, cy: c, r: r });
            else {
                var end = angle + share * 2 * Math.PI, large = share > 0.5 ? 1 : 0;
                node = svg('path', { d: 'M' + c + ' ' + c + ' L' + (c + r * Math.cos(angle)).toFixed(2) + ' ' + (c + r * Math.sin(angle)).toFixed(2) + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + (c + r * Math.cos(end)).toFixed(2) + ' ' + (c + r * Math.sin(end)).toFixed(2) + ' Z' });
                angle = end;
            }
            node.setAttribute('fill', color(i));
            node.setAttribute('stroke', 'var(--ch-surface)'); node.setAttribute('stroke-width', '2');
            node.appendChild(svg('title', {}, tip));
            chart.appendChild(node);
        });
        wrap.appendChild(chart);
        var list = html('ul', 'ch-legend');
        items.forEach(function (d, i) {
            var item = html('li'), sw = html('span', 'sw');
            sw.style.background = color(i);
            item.appendChild(sw); item.appendChild(html('span', '', d.label));
            item.appendChild(html('span', 'v', f(d.value) + '（' + Math.round(d.value / total * 1000) / 10 + '%）'));
            list.appendChild(item);
        });
        wrap.appendChild(list);
        el.appendChild(wrap);
    }

    var tick = function (v) { return String(Math.round(v * 100) / 100); };

    // ---- shared axes for bar and line --------------------------------------------------------
    // Returns the plot box and draws grid lines with value ticks.
    function axes(chart, w, h, pad, max, f) {
        var ticks = 5;
        for (var i = 0; i <= ticks; i++) {
            var y = pad.top + (h - pad.top - pad.bottom) * (1 - i / ticks);
            chart.appendChild(svg('line', { x1: pad.left, x2: w - pad.right, y1: y, y2: y, 'class': i ? 'ch-grid' : 'ch-axis' }));
            chart.appendChild(svg('text', { x: pad.left - 6, y: y + 4, 'text-anchor': 'end', 'class': 'ch-muted', 'font-size': 12 }, tick(max * i / ticks)));
        }
    }

    // ---- bar -----------------------------------------------------------------------------
    function bar(el, data, opts) {
        opts = prepare(el, opts);
        var f = fmt(opts), s = seriesOf(data || [], opts);
        if (!s.rows.length) return empty(el, opts);
        var max = opts.max || niceMax(Math.max.apply(null, [0].concat(s.rows.map(function (r) { return Math.max.apply(null, r.values.map(function (v) { return Number(v) || 0; })); }))));
        if (s.count > 1) el.appendChild(legend(s.names, 'row'));
        var w = opts.width || 520, horizontal = opts.horizontal === true;
        var chart;
        if (horizontal) {
            var rowH = s.count * 18 + 12, pad = { top: 8, right: 64, bottom: 22, left: 130 }, h = pad.top + pad.bottom + rowH * s.rows.length;
            chart = svg('svg', { viewBox: '0 0 ' + w + ' ' + h, role: 'img', 'aria-label': opts.title || '長條圖' });
            for (var t = 0; t <= 5; t++) {
                var x = pad.left + (w - pad.left - pad.right) * t / 5;
                chart.appendChild(svg('line', { x1: x, x2: x, y1: pad.top, y2: h - pad.bottom, 'class': t ? 'ch-grid' : 'ch-axis' }));
                chart.appendChild(svg('text', { x: x, y: h - 5, 'text-anchor': 'middle', 'class': 'ch-muted', 'font-size': 12 }, tick(max * t / 5)));
            }
            s.rows.forEach(function (row, i) {
                var y0 = pad.top + i * rowH + 6;
                var label = svg('text', { x: pad.left - 8, y: y0 + (s.count * 18) / 2 + 3, 'text-anchor': 'end', 'font-size': 12 }, short(row.label, 11));
                label.appendChild(svg('title', {}, row.label)); chart.appendChild(label);
                row.values.forEach(function (v, k) {
                    var len = Math.max(0, (Number(v) || 0) / max * (w - pad.left - pad.right)), y = y0 + k * 18;
                    var rect = svg('rect', { x: pad.left, y: y, width: len, height: 13, rx: 3, fill: color(k) });
                    rect.appendChild(svg('title', {}, row.label + (s.count > 1 ? '・' + s.names[k] : '') + '：' + f(Number(v) || 0)));
                    chart.appendChild(rect);
                    chart.appendChild(svg('text', { x: pad.left + len + 6, y: y + 11, 'font-size': 12 }, f(Number(v) || 0)));
                });
            });
        } else {
            var many = s.rows.length > 6, p = { top: 20, right: 16, bottom: many ? 84 : 34, left: many ? 64 : 48 }, hh = 310;
            chart = svg('svg', { viewBox: '0 0 ' + w + ' ' + hh, role: 'img', 'aria-label': opts.title || '長條圖' });
            axes(chart, w, hh, p, max, f);
            var plotW = w - p.left - p.right, plotH = hh - p.top - p.bottom, group = plotW / s.rows.length;
            var barW = Math.min(36, (group * 0.72) / s.count);
            s.rows.forEach(function (row, i) {
                var gx = p.left + group * i + (group - barW * s.count) / 2;
                row.values.forEach(function (v, k) {
                    var value = Number(v) || 0, bh = Math.max(0, value / max * plotH), x = gx + k * barW, y = p.top + plotH - bh;
                    var rect = svg('rect', { x: x + 1, y: y, width: Math.max(1, barW - 2), height: bh, rx: 3, fill: color(k) });
                    rect.appendChild(svg('title', {}, row.label + (s.count > 1 ? '・' + s.names[k] : '') + '：' + f(value)));
                    chart.appendChild(rect);
                    chart.appendChild(svg('text', { x: x + barW / 2, y: y - 4, 'text-anchor': 'middle', 'font-size': 12 }, tick(value)));
                });
                var cx = p.left + group * (i + 0.5), ty = hh - p.bottom + 16;
                var label = svg('text', { x: cx, y: ty, 'text-anchor': many ? 'end' : 'middle', 'font-size': 12, transform: many ? 'rotate(-40 ' + cx + ' ' + ty + ')' : '' }, short(row.label, many ? 9 : 8));
                label.appendChild(svg('title', {}, row.label)); chart.appendChild(label);
            });
        }
        el.appendChild(chart);
    }

    // ---- line ----------------------------------------------------------------------------
    function line(el, data, opts) {
        opts = prepare(el, opts);
        var f = fmt(opts), s = seriesOf(data || [], opts);
        var any = s.rows.some(function (r) { return r.values.some(function (v) { return v !== null && v !== undefined && !isNaN(v); }); });
        if (!s.rows.length || !any) return empty(el, opts);
        var max = opts.max || niceMax(Math.max.apply(null, [0].concat(s.rows.map(function (r) { return Math.max.apply(null, r.values.map(function (v) { return Number(v) || 0; })); }))));
        if (s.count > 1) el.appendChild(legend(s.names, 'row'));
        var w = opts.width || 520, hh = 310, many = s.rows.length > 6, p = { top: 22, right: 40, bottom: many ? 84 : 34, left: many ? 64 : 48 };
        var chart = svg('svg', { viewBox: '0 0 ' + w + ' ' + hh, role: 'img', 'aria-label': opts.title || '折線圖' });
        axes(chart, w, hh, p, max, f);
        var plotW = w - p.left - p.right, plotH = hh - p.top - p.bottom, step = s.rows.length > 1 ? plotW / (s.rows.length - 1) : 0;
        var xOf = i => s.rows.length > 1 ? p.left + step * i : p.left + plotW / 2, yOf = v => p.top + plotH - Math.max(0, v) / max * plotH;
        s.rows.forEach(function (row, i) {
            var label = svg('text', { x: xOf(i), y: hh - p.bottom + 16, 'text-anchor': many ? 'end' : 'middle', 'font-size': 12, transform: many ? 'rotate(-40 ' + xOf(i) + ' ' + (hh - p.bottom + 16) + ')' : '' }, short(row.label, many ? 9 : 8));
            label.appendChild(svg('title', {}, row.label)); chart.appendChild(label);
        });
        for (var k = 0; k < s.count; k++) {
            var path = '', open = false;
            s.rows.forEach(function (row, i) {
                var v = row.values[k];
                if (v === null || v === undefined || isNaN(v)) { open = false; return; }
                path += (open ? 'L' : 'M') + xOf(i).toFixed(1) + ' ' + yOf(Number(v)).toFixed(1) + ' '; open = true;
            });
            chart.appendChild(svg('path', { d: path, fill: 'none', stroke: color(k), 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
            s.rows.forEach(function (row, i) {
                var v = row.values[k];
                if (v === null || v === undefined || isNaN(v)) return;
                var dot = svg('circle', { cx: xOf(i), cy: yOf(Number(v)), r: 4.5, fill: color(k), stroke: 'var(--ch-surface)', 'stroke-width': 2 });
                dot.appendChild(svg('title', {}, row.label + (s.count > 1 ? '・' + s.names[k] : '') + '：' + f(Number(v))));
                chart.appendChild(dot);
                chart.appendChild(svg('text', { x: xOf(i), y: yOf(Number(v)) - 9 - k * 0, 'text-anchor': 'middle', 'font-size': 12 }, f(Number(v)).replace(/\.0$/, '')));
            });
        }
        el.appendChild(chart);
    }

    root.Charts = { pie: pie, bar: bar, line: line };
})(typeof window !== 'undefined' ? window : globalThis);
