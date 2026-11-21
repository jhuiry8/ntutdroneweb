// Survey report: response count and rate, a chart per question (pie / bar / distribution), searchable text
// answers, CSV export and printing. Charts come from /charts.js (inline SVG, no external libraries).
(function () {
    'use strict';
    var app = document.getElementById('app');
    var id = document.currentScript.dataset.id;
    var TYPES = { single: '單選', multi: '多選', dropdown: '下拉', short: '簡答', paragraph: '段落', rating: '評分', date: '日期' };
    var STATES = { open: '開放中', notStarted: '尚未開放', closed: '已截止' };

    function h(tag, attrs, kids) {
        var el = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) {
            if (k === 'text') el.textContent = attrs[k]; else if (k === 'class') el.className = attrs[k];
            else if (k.slice(0, 2) === 'on') el[k] = attrs[k]; else el.setAttribute(k, attrs[k]);
        });
        (kids || []).forEach(function (kid) { if (kid) el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid); });
        return el;
    }
    function chart(html) { var box = h('div', {}); Charts.mount(box, html); return box; }
    function details(summary, html) {
        var d = h('details', { class: 'noprint', style: 'margin-top:8px' }, [h('summary', { class: 'muted', style: 'cursor:pointer', text: summary })]);
        d.appendChild(chart(html)); return d;
    }

    function questionCard(q, index) {
        var card = h('div', { class: 'card' }, [h('h3', { text: (index + 1) + '. ' + q.title }),
            h('p', { class: 'muted', text: TYPES[q.type] + (q.required ? '・必填' : '') + '・' + q.answered + ' 人作答' })]);
        if (!q.answered) { card.appendChild(h('p', { class: 'muted', text: '尚無回答' })); return card; }
        if (q.type === 'single' || q.type === 'dropdown') {
            var data = q.options.map(function (o) { return { label: o.label, value: o.count }; });
            card.appendChild(chart(Charts.pie(data, { title: q.title, total: q.answered, unit: ' 人', percentDigits: 1, center: String(q.answered) })));
            card.appendChild(details('資料表', Charts.table(data, { labelHeader: '選項', valueHeader: '人數', total: q.answered })));
        } else if (q.type === 'multi') {
            var multi = q.options.map(function (o) { return { label: o.label, value: o.count }; });
            card.appendChild(h('p', { class: 'muted', text: '可複選；百分比 = 選此項的人數 ÷ 作答人數（' + q.answered + '）' }));
            card.appendChild(chart(Charts.bar(multi, { title: q.title, total: q.answered, unit: ' 人', single: true, fullLabels: '完整選項與數值' })));
        } else if (q.type === 'rating') {
            card.appendChild(h('p', { style: 'font-size:1.6rem;font-weight:800;margin:4px 0' }, [String(q.average), h('span', { class: 'muted', style: 'font-size:.9rem;font-weight:400', text: ' / ' + q.scale + '（平均，' + q.answered + ' 人）' })]));
            var dist = q.distribution.map(function (d) { return { label: String(d.value), value: d.count }; });
            card.appendChild(chart(Charts.columns(dist, { title: q.title + ' 分布', total: q.answered, unit: ' 人' })));
        } else if (q.type === 'date') {
            card.appendChild(chart(Charts.bar(q.dates.map(function (d) { return { label: d.date, value: d.count }; }), { title: q.title, total: q.answered, unit: ' 人', single: true })));
        } else {
            var search = h('input', { type: 'search', placeholder: '搜尋答案…', 'aria-label': '搜尋答案', class: 'noprint' });
            var count = h('p', { class: 'muted' });
            var list = h('ul', { style: 'list-style:none;margin:8px 0 0;padding:0' });
            var limit = 100;
            var more = h('button', { class: 'secondary noprint', type: 'button', text: '顯示更多', onclick: function () { limit += 200; draw(); } });
            var draw = function () {
                var needle = search.value.trim().toLowerCase();
                var rows = q.texts.filter(function (t) { return !needle || t.text.toLowerCase().indexOf(needle) >= 0 || (t.by || '').toLowerCase().indexOf(needle) >= 0; });
                count.textContent = '顯示 ' + Math.min(rows.length, limit) + ' / ' + rows.length + ' 則' + (needle ? '（符合搜尋）' : '');
                list.textContent = '';
                rows.slice(0, limit).forEach(function (t) {
                    list.appendChild(h('li', { style: 'padding:8px 0;border-bottom:1px solid var(--line);white-space:pre-wrap;word-break:break-word' }, [t.text, t.by ? h('div', { class: 'muted', text: '— ' + t.by }) : null]));
                });
                more.style.display = rows.length > limit ? '' : 'none';
            };
            search.oninput = function () { limit = 100; draw(); };
            card.appendChild(search); card.appendChild(count); card.appendChild(list); card.appendChild(more); draw();
        }
        return card;
    }

    fetch('/api/surveys/' + encodeURIComponent(id) + '/report', { credentials: 'same-origin' })
        .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || '發生錯誤'); return d; }); })
        .then(function (data) {
            var s = data.survey, st = data.stats;
            document.title = s.title + ' 報表 | 北科無人機社';
            app.textContent = '';
            app.appendChild(h('h1', { text: s.title + ' — 結果報表' }));
            app.appendChild(h('p', { class: 'muted noprint' }, [h('a', { href: '/admin/surveys', text: '← 回問卷列表' })]));
            app.appendChild(h('div', { class: 'row noprint' }, [
                h('a', { class: 'btn', href: '/api/surveys/' + encodeURIComponent(id) + '/export.csv', text: '匯出 CSV' }),
                h('button', { class: 'secondary', type: 'button', text: '列印', onclick: function () { window.print(); } }),
                h('a', { class: 'btn secondary', href: '/survey/' + encodeURIComponent(id), target: '_blank', rel: 'noopener', text: '開啟填寫頁' })
            ]));
            var summary = h('div', { class: 'card' }, [
                h('div', { class: 'grid' }, [
                    h('div', {}, [h('div', { class: 'muted', text: '回覆數' }), h('div', { style: 'font-size:1.8rem;font-weight:800', text: String(st.responseCount) })]),
                    h('div', {}, [h('div', { class: 'muted', text: '回覆率' }), h('div', { style: 'font-size:1.8rem;font-weight:800', text: st.responseRate == null ? '—' : st.responseRate + '%' }),
                        h('div', { class: 'muted', text: st.responseRate == null ? '未關聯社課／活動，無法計算' : st.responseCount + ' ÷ ' + st.denominator + '（' + data.denominatorLabel + '）' })]),
                    h('div', {}, [h('div', { class: 'muted', text: '狀態' }), h('div', { style: 'font-size:1.2rem;font-weight:700', text: STATES[s.state] || s.state }),
                        h('div', { class: 'muted', text: s.audience === 'public' ? '公開' : (s.audience === 'members' ? '社員' : '幹部') + (s.anonymous ? '・匿名' : '') })])
                ]),
                s.link ? h('p', { class: 'muted', text: (s.link.type === 'class' ? '關聯社課：' : '關聯活動：') + (s.link.label || s.link.id) }) : null,
                s.anonymous ? h('p', { class: 'muted', text: '匿名問卷：報表與 CSV 不含填寫者身分，回覆時間只保留日期。' }) : null
            ]);
            app.appendChild(summary);
            st.questions.forEach(function (q, i) { app.appendChild(questionCard(q, i)); });
        })
        .catch(function (e) { app.textContent = e.message; });
})();
