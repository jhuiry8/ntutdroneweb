// 統計報表: draws /api/stats with the inline-SVG charts of /charts.js. All values go in through textContent.
(function () {
    'use strict';
    var root = document.getElementById('sections'), select = document.getElementById('semester'), msg = document.getElementById('msg');
    var current = new URLSearchParams(location.search).get('semester') || '';

    function h(tag, attrs, kids) {
        var node = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (key) { if (key === 'text') node.textContent = attrs[key]; else node.setAttribute(key, attrs[key]); });
        [].concat(kids || []).forEach(function (kid) { if (kid) node.appendChild(kid); });
        return node;
    }
    function tile(label, value) { return h('div', { 'class': 'tile' }, [h('b', { text: String(value) }), h('span', { 'class': 'muted', text: label })]); }
    function chartBox(title) { return h('div', {}, [h('h3', { text: title }), h('div')]); }
    function draw(box, kind, data, opts) { Charts[kind](box.lastChild, data, opts); return box; }
    function table(head, rows) {
        return h('div', { 'class': 'scroll' }, [h('table', {}, [h('thead', {}, [h('tr', {}, head.map(function (t) { return h('th', { text: t }); }))]),
            h('tbody', {}, rows.map(function (row) { return h('tr', {}, row.map(function (cell) { return h('td', { text: cell === null || cell === undefined ? '—' : String(cell) }); })); }))])]);
    }
    function pct(v) { return v === null || v === undefined ? '—' : v + '%'; }
    function money(v) { return 'NT$ ' + Number(v).toLocaleString('zh-TW'); }
    function card(title, name, body, note) {
        var node = h('section', { id: 'sec-' + name }, [h('div', { 'class': 'head' }, [h('h2', { text: title }),
            h('a', { 'class': 'btn noprint', href: '/api/stats/export.csv?section=' + name + '&semester=' + encodeURIComponent(current), text: '匯出 CSV' })])]);
        if (note) node.appendChild(h('p', { 'class': 'muted', text: note }));
        body.forEach(function (part) { node.appendChild(part); });
        return node;
    }
    function failed(title, name) { return h('section', {}, [h('h2', { text: title }), h('p', { 'class': 'err', text: '這個區塊暫時無法讀取，請稍後再試。' })]); }
    function grid(parts) { return h('div', { 'class': 'charts' }, parts); }

    var RENDER = {
        members: function (d) {
            return card('社員組成', 'members', [h('div', { 'class': 'tiles' }, [tile('名冊總人數', d.total)]), grid([
                draw(chartBox('社員級別'), 'pie', d.byLevel, { title: '社員級別', unit: ' 人' }),
                draw(chartBox('會籍與繳費狀態'), 'pie', d.byFee, { title: '會籍與繳費狀態', unit: ' 人' })])], d.note);
        },
        classes: function (d) {
            var t = d.totals, rows = d.sessions;
            return card('社課', 'classes', [
                h('div', { 'class': 'tiles' }, [tile('場次', t.sessions), tile('報名人次', t.registered), tile('出席人次', t.attended), tile('已報名者出席率', pct(t.attendanceRate)),
                    tile('體驗學員轉正式', d.conversion.trialAttendees ? d.conversion.converted + ' / ' + d.conversion.trialAttendees + '（' + pct(d.conversion.rate) + '）' : '—')]),
                grid([draw(chartBox('每場報名與出席'), 'bar', rows.map(function (r) { return { label: r.label, values: [r.registered, r.attended] }; }), { title: '每場報名與出席', series: ['報名', '出席'], unit: ' 人' }),
                    draw(chartBox('出席率趨勢（已報名者）'), 'line', rows.filter(function (r) { return r.registration; }).map(function (r) { return { label: r.label, value: r.rate }; }), { title: '出席率趨勢', unit: '%', max: 100, empty: '沒有開放報名的場次' })]),
                h('h3', { text: '明細' }), table(['日期', '主題', '報名', '候補', '出席', '已報名已到', '出席率'], rows.map(function (r) { return [r.date, r.topic, r.registered, r.waitlist, r.attended, r.registeredAttended, pct(r.rate)]; }))
            ], '出席率 = 已報名且到場 ÷ 已確認報名人數。體驗學員轉正式 = 本學期來過的非正式社員中，現在已不是非正式的比例。');
        },
        events: function (d) {
            return card('活動', 'events', [h('div', { 'class': 'tiles' }, [tile('活動數', d.totals.events), tile('報名人數', d.totals.confirmed), tile('候補人數', d.totals.waitlist)]),
                draw(chartBox('每場活動報名與候補'), 'bar', d.events.map(function (e) { return { label: e.label, values: [e.confirmed, e.waitlist] }; }), { title: '每場活動報名與候補', series: ['報名', '候補'], unit: ' 人' })]);
        },
        finance: function (d) {
            var maxRate = Math.max.apply(null, [100].concat(d.budgets.map(function (b) { return b.rate || 0; })));
            return card('財務（僅社長與財務可見）', 'finance', [
                h('div', { 'class': 'tiles' }, [tile('本學期收入', money(d.totals.income)), tile('本學期支出', money(d.totals.expense))]),
                grid([draw(chartBox('收入（依預算分類）'), 'pie', d.incomeByBudget, { title: '收入依預算分類', format: money }),
                    draw(chartBox('支出（依預算分類）'), 'pie', d.expenseByBudget, { title: '支出依預算分類', format: money })]),
                draw(chartBox('每月收支'), 'bar', d.monthly.map(function (m) { return { label: m.label, values: [m.income, m.expense] }; }), { title: '每月收支', series: ['收入', '支出'], format: money }),
                draw(chartBox('預算執行率'), 'bar', d.budgets.map(function (b) { return { label: b.name, value: b.rate || 0 }; }), { title: '預算執行率', horizontal: true, unit: '%', max: maxRate, empty: '尚未設定預算' }),
                table(['預算分類', '預算', '累計支出', '本學期支出', '執行率'], d.budgets.map(function (b) { return [b.name, money(b.planned), money(b.spent), money(b.spentInSemester), pct(b.rate)]; }))
            ], d.note);
        },
        equipment: function (d) {
            return card('設備', 'equipment', [h('div', { 'class': 'tiles' }, [tile('列管設備', d.total)]), grid([
                draw(chartBox('設備狀態'), 'pie', d.byStatus, { title: '設備狀態', unit: ' 件' }),
                draw(chartBox('借用次數排行（本學期前 10 名）'), 'bar', d.ranking.map(function (r) { return { label: r.assetName, value: r.loans }; }), { title: '借用次數排行', horizontal: true, unit: ' 次', empty: '本學期沒有借用紀錄' })])]);
        },
        flights: function (d) {
            return card('飛行', 'flights', [h('div', { 'class': 'tiles' }, [tile('飛行紀錄', d.flights), tile('總時數', d.hours + ' 小時'), tile('異常或事故', d.incidents)]),
                draw(chartBox('飛行時數（依類型）'), 'pie', d.byType, { title: '飛行時數依類型', unit: ' 小時' })]);
        }
    };
    var TITLES = { members: '社員組成', classes: '社課', events: '活動', finance: '財務', equipment: '設備', flights: '飛行' };

    function load() {
        msg.textContent = '';
        fetch('/api/stats' + (current ? '?semester=' + encodeURIComponent(current) : ''), { headers: { Accept: 'application/json' } }).then(function (response) {
            return response.json().then(function (data) { if (!response.ok) throw new Error(data.error || '載入失敗'); return data; });
        }).then(function (data) {
            current = data.semester;
            select.textContent = '';
            data.semesters.forEach(function (term) { var option = h('option', { value: term, text: term }); if (term === current) option.selected = true; select.appendChild(option); });
            document.getElementById('range').textContent = '統計期間：' + data.range.from + ' 至 ' + data.range.to;
            root.textContent = '';
            Object.keys(RENDER).forEach(function (name) {
                var section = data.sections[name];
                if (!section) return; // not visible to this account: the API did not send it
                root.appendChild(section.error ? failed(TITLES[name], name) : RENDER[name](section));
            });
        }).catch(function (error) { root.textContent = ''; msg.textContent = error.message; });
    }
    select.addEventListener('change', function () { current = select.value; history.replaceState(null, '', '?semester=' + encodeURIComponent(current)); load(); });
    document.getElementById('print').addEventListener('click', function () { window.print(); });
    load();
})();
