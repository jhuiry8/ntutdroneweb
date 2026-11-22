// Flight log and certificates panel (飛行紀錄與證照) in the dashboard: log flights, personal totals
// (CSV / print), operator certificates and, for officers, club-wide statistics.
// The container (#panel-flights) is rendered by the server with data-officer / data-editor; the server
// still enforces every permission. Data comes from /api/flights* and /api/certificates*, and every
// value is inserted with textContent.
(function () {
    'use strict';
    var panel = document.getElementById('panel-flights');
    if (!panel) return;
    var OFFICER = panel.dataset.officer === '1';
    var EDITOR = panel.dataset.editor === '1';
    var cfg = { types: {}, assets: [], people: [], certCategories: [] };
    var built = false;

    var style = document.createElement('style');
    style.textContent = [
        '#panel-flights section { border:1px solid var(--border-glass); border-radius:12px; padding:16px 18px; margin-top:14px; background:rgba(255,255,255,.02); }',
        '#panel-flights h2 { font-size:1.05rem; margin:0 0 8px; } #panel-flights .muted { color:var(--text-muted); font-size:.88rem; }',
        '#panel-flights .fl-tabs { display:flex; gap:8px; flex-wrap:wrap; margin-top:14px; } #panel-flights .fl-tabs .btn.on { background:var(--color-cyan); color:#fff; }',
        '#panel-flights .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px; } #panel-flights label { display:flex; flex-direction:column; gap:3px; font-size:.85rem; color:var(--text-secondary); }',
        '#panel-flights .stats { display:flex; gap:12px; flex-wrap:wrap; } #panel-flights .stat { border:1px solid var(--border-glass); border-radius:10px; padding:8px 14px; min-width:110px; } #panel-flights .stat b { display:block; font-size:1.4rem; }',
        '#panel-flights .bad { color:#f87171; font-weight:600; } #panel-flights .warn { color:#fbbf24; font-weight:600; } #panel-flights .hidden { display:none; }',
        '#panel-flights th, #panel-flights td { padding:8px 10px; font-size:.9rem; }',
        '@media print { .sidebar, .mobile-admin-bar, .mobile-tabbar, .install-hint, #toast, .noprint, #panel-flights .fl-tabs, #panel-flights form { display:none !important; } .main-content { padding:0; max-height:none; overflow:visible; } #panel-flights { border:0; box-shadow:none; background:#fff; color:#000; } }'
    ].join('\n');
    document.head.appendChild(style);

    function $(selector) { return panel.querySelector(selector); }
    function el(tag, text, cls) { var e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
    function say(text, bad) { if (typeof showToast === 'function') showToast(text, !!bad); else if (bad) alert(text); }
    async function api(path, method, body) {
        var r = await fetch(path, { method: method || 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
        var d = await r.json().catch(function () { return {}; });
        if (!r.ok) throw new Error(d.error || ('錯誤 ' + r.status));
        return d;
    }
    function hours(m) { return (Math.round(m / 6) / 10) + ' 小時'; }
    function stat(box, label, value) { var d = el('div', '', 'stat'); d.append(el('b', String(value)), el('span', label)); box.append(d); }
    function fillSelect(sel, items, first) { sel.replaceChildren(); if (first !== undefined) sel.append(new Option(first, '')); items.forEach(function (it) { sel.append(new Option(it[1], it[0])); }); }
    var STATUS = { valid: ['有效', ''], expiring90: ['90 天內到期', 'warn'], expiring30: ['30 天內到期', 'warn'], expired: ['已到期', 'bad'] };
    function formBody(form) { var o = {}; new FormData(form).forEach(function (v, k) { o[k] = v; }); o.incident = !!(form.incident && form.incident.checked); return o; }
    function applyWho(o) { if (o.who) { var parts = o.who.split('|'); if (parts[0]) o.username = parts[0]; else o.memberId = parts[1]; } delete o.who; }

    function build() {
        built = true;
        var who = OFFICER ? '<label>社員（幹部代登，留空為自己）<select name="who"><option value="">自己</option></select></label>' : '';
        panel.innerHTML = '<div class="content-header"><div><h1>飛行紀錄與證照</h1><p class="muted" style="margin-top:6px;">登錄每次飛行、累計時數與架次，並追蹤民航局無人機操作證的到期日。</p></div></div>'
            + '<div class="fl-tabs noprint"><button type="button" class="btn btn-secondary on" data-tab="log">飛行紀錄</button><button type="button" class="btn btn-secondary" data-tab="cert">證照</button>'
            + (OFFICER ? '<button type="button" class="btn btn-secondary" data-tab="club">全社統計</button>' : '') + '</div>'
            + '<div id="fl-tab-log">'
            + '<section class="noprint"><h2>新增飛行紀錄</h2><form id="fl-flightForm" class="grid">' + who
            + '<label>日期<input class="form-control" type="date" name="date" required></label><label>地點<input class="form-control" name="location" maxlength="100" required></label>'
            + '<label>飛行類型<select class="form-control" name="type" required></select></label><label>社團設備（可選）<select class="form-control" name="assetId"><option value="">不使用社團設備</option></select></label>'
            + '<label>機型（未選設備時必填）<input class="form-control" name="aircraft" maxlength="100"></label><label>時長（分鐘）<input class="form-control" type="number" name="minutes" min="1" max="1440" required></label>'
            + '<label>架次<input class="form-control" type="number" name="sorties" min="1" max="999" value="1"></label><label>天氣<input class="form-control" name="weather" maxlength="100"></label>'
            + '<label>備註<input class="form-control" name="note" maxlength="1000"></label><label><span><input type="checkbox" name="incident"> 發生異常或事故</span></label>'
            + '<label>事故說明<input class="form-control" name="incidentNote" maxlength="1000"></label><label>&nbsp;<button type="submit" class="btn btn-primary">新增</button></label></form></section>'
            + '<section><h2>我的飛行統計</h2><div id="fl-mine" class="stats"></div><div class="noprint" style="margin-top:10px;display:flex;gap:8px;"><button type="button" class="btn btn-secondary" id="fl-csvMine">匯出 CSV</button><button type="button" class="btn btn-secondary" id="fl-print">列印</button></div></section>'
            + '<section><h2>飛行紀錄</h2><div class="noprint grid"><label>類型<select class="form-control" id="fl-fType"><option value="">全部</option></select></label>'
            + (OFFICER ? '<label>範圍<select class="form-control" id="fl-fScope"><option value="mine">只看自己</option><option value="all">全社</option></select></label><label>篩選<select class="form-control" id="fl-fFilter"><option value="">全部</option><option value="incident">只看事故</option><option value="pending">待確認</option></select></label>' : '') + '</div>'
            + '<div class="table-container"><table><thead><tr><th>日期</th>' + (OFFICER ? '<th>社員</th>' : '') + '<th>地點</th><th>機型</th><th>類型</th><th>分鐘</th><th>架次</th><th>狀態</th><th class="noprint"></th></tr></thead><tbody id="fl-flights"></tbody></table></div></section>'
            + '</div>'
            + '<div id="fl-tab-cert" class="hidden">'
            + '<section class="noprint"><h2>登錄民航局無人機操作證</h2><form id="fl-certForm" class="grid">' + who
            + '<label>類別<select class="form-control" name="category" required></select></label><label>證號<input class="form-control" name="certNo" maxlength="60" required></label>'
            + '<label>核發日<input class="form-control" type="date" name="issueDate" required></label><label>到期日<input class="form-control" type="date" name="expiryDate" required></label>'
            + '<label>證件照片網址（https）<input class="form-control" name="photoUrl" maxlength="500"></label><label>備註<input class="form-control" name="note" maxlength="500"></label>'
            + '<label>&nbsp;<button type="submit" class="btn btn-primary">新增證照</button></label></form></section>'
            + '<section><h2>證照</h2><div class="table-container"><table><thead><tr><th>類別</th>' + (OFFICER ? '<th>持有人</th>' : '') + '<th>證號</th><th>核發</th><th>到期</th><th>狀態</th><th class="noprint"></th></tr></thead><tbody id="fl-certs"></tbody></table></div></section>'
            + (EDITOR ? '<section class="noprint"><h2>證照類別設定</h2><input class="form-control" id="fl-cats" aria-label="類別，以逗號分隔"><p class="muted">以逗號分隔。</p><button type="button" class="btn btn-secondary" id="fl-saveCats">儲存類別</button></section>' : '')
            + '</div>'
            + (OFFICER ? '<div id="fl-tab-club" class="hidden">'
                + '<section><h2>全社飛行統計</h2><div id="fl-clubStats" class="stats"></div><div class="table-container"><table><thead><tr><th>社員</th><th>時數</th><th>架次</th><th>事故</th></tr></thead><tbody id="fl-byMember"></tbody></table></div>'
                + '<h2 style="margin-top:14px;">設備累積使用時數</h2><div class="table-container"><table><thead><tr><th>設備</th><th>時數</th><th>架次</th></tr></thead><tbody id="fl-byAsset"></tbody></table></div></section>'
                + '<section><h2>全社持證統計</h2><div id="fl-certStats" class="stats"></div></section>'
                + '<section><h2>已到期與即將到期</h2><div class="table-container"><table><thead><tr><th>持有人</th><th>類別</th><th>證號</th><th>到期日</th><th>狀態</th></tr></thead><tbody id="fl-expiring"></tbody></table></div></section></div>' : '');

        panel.querySelectorAll('[data-tab]').forEach(function (b) {
            b.onclick = function () {
                panel.querySelectorAll('[data-tab]').forEach(function (x) { x.classList.toggle('on', x === b); });
                ['log', 'cert', 'club'].forEach(function (t) { var n = $('#fl-tab-' + t); if (n) n.classList.toggle('hidden', t !== b.dataset.tab); });
            };
        });
        $('#fl-flightForm').onsubmit = async function (e) { e.preventDefault(); var o = formBody(e.target); applyWho(o); try { await api('/api/flights', 'POST', o); e.target.reset(); say('已新增'); await refresh(); } catch (x) { say(x.message, true); } };
        $('#fl-certForm').onsubmit = async function (e) { e.preventDefault(); var o = formBody(e.target); delete o.incident; applyWho(o); try { await api('/api/certificates', 'POST', o); e.target.reset(); say('已新增'); await refresh(); } catch (x) { say(x.message, true); } };
        $('#fl-csvMine').onclick = function () { location.href = '/api/flights/export.csv'; };
        $('#fl-print').onclick = function () { window.print(); };
        $('#fl-fType').onchange = loadFlights;
        if (OFFICER) { $('#fl-fScope').onchange = loadFlights; $('#fl-fFilter').onchange = loadFlights; }
        if ($('#fl-saveCats')) $('#fl-saveCats').onclick = async function () { try { await api('/api/certificates/categories', 'PUT', { categories: $('#fl-cats').value.split(',') }); say('已儲存'); init(); } catch (e) { say(e.message, true); } };
    }

    async function loadMine() {
        var s = await api('/api/flights/summary'); var box = $('#fl-mine'); box.replaceChildren();
        stat(box, '累積飛行時數', hours(s.minutes)); stat(box, '已確認時數', hours(s.confirmedMinutes)); stat(box, '架次', s.sorties); stat(box, '異常/事故', s.incidents);
        Object.keys(s.byType).forEach(function (t) { var v = s.byType[t]; if (v.flights) stat(box, (cfg.types[t] || t) + '（' + v.sorties + ' 架次）', hours(v.minutes)); });
    }
    function flightQuery() {
        var q = new URLSearchParams(); var t = $('#fl-fType').value; if (t) q.set('type', t);
        if (OFFICER) { if ($('#fl-fScope').value === 'all') q.set('scope', 'all'); var f = $('#fl-fFilter').value; if (f === 'incident') q.set('incident', '1'); if (f === 'pending') q.set('status', 'pending'); }
        return q;
    }
    async function act1(path, method) { try { await api(path, method); await refresh(); } catch (e) { say(e.message, true); } }
    async function loadFlights() {
        var list = await api('/api/flights?' + flightQuery()); var tb = $('#fl-flights'); tb.replaceChildren();
        list.forEach(function (f) {
            var tr = el('tr'); tr.append(el('td', f.date)); if (OFFICER) tr.append(el('td', f.owner.name || f.owner.username));
            tr.append(el('td', f.location), el('td', f.aircraft), el('td', cfg.types[f.type] || f.type), el('td', String(f.minutes)), el('td', String(f.sorties)));
            var st = el('td', (f.status === 'confirmed' ? '已確認' : '待確認') + (f.incident ? ' ⚠事故' : ''), f.incident ? 'bad' : ''); if (f.incident && f.incidentNote) st.title = f.incidentNote; tr.append(st);
            var act = el('td', '', 'noprint');
            if (OFFICER && f.status !== 'confirmed') { var b = el('button', '確認', 'btn btn-secondary'); b.type = 'button'; b.onclick = function () { act1('/api/flights/' + f.id + '/confirm', 'POST'); }; act.append(b); }
            var d = el('button', '刪除', 'btn btn-danger'); d.type = 'button'; d.onclick = function () { if (confirm('刪除這筆紀錄？')) act1('/api/flights/' + f.id, 'DELETE'); }; act.append(' ', d); tr.append(act); tb.append(tr);
        });
        if (!list.length) { var tr = el('tr'); var td = el('td', '沒有紀錄', 'muted'); td.colSpan = 9; tr.append(td); tb.append(tr); }
    }
    async function loadCerts() {
        var list = await api('/api/certificates' + (OFFICER ? '?scope=all' : '')); var tb = $('#fl-certs'); tb.replaceChildren();
        list.forEach(function (c) {
            var tr = el('tr'); tr.append(el('td', c.category)); if (OFFICER) tr.append(el('td', c.owner.name || c.owner.username));
            tr.append(el('td', c.certNo), el('td', c.issueDate), el('td', c.expiryDate)); var st = STATUS[c.status]; tr.append(el('td', st[0] + (c.daysLeft >= 0 ? '（剩 ' + c.daysLeft + ' 天）' : ''), st[1]));
            var act = el('td', '', 'noprint'); if (c.photoUrl) { var a = el('a', '照片'); a.href = c.photoUrl; a.rel = 'noopener noreferrer'; a.target = '_blank'; act.append(a, ' '); }
            var d = el('button', '刪除', 'btn btn-danger'); d.type = 'button'; d.onclick = function () { if (confirm('刪除這張證照？')) act1('/api/certificates/' + c.id, 'DELETE'); }; act.append(d); tr.append(act); tb.append(tr);
        });
    }
    async function loadClub() {
        if (!OFFICER) return;
        var s = await api('/api/flights/summary?scope=all'); var box = $('#fl-clubStats'); box.replaceChildren();
        stat(box, '全社時數', hours(s.minutes)); stat(box, '架次', s.sorties); stat(box, '事故', s.incidents);
        var bm = $('#fl-byMember'); bm.replaceChildren(); s.byMember.forEach(function (m) { var tr = el('tr'); tr.append(el('td', m.name || m.username), el('td', hours(m.minutes)), el('td', String(m.sorties)), el('td', String(m.incidents))); bm.append(tr); });
        var ba = $('#fl-byAsset'); ba.replaceChildren(); s.byAsset.forEach(function (a) { var tr = el('tr'); tr.append(el('td', a.assetNo + ' ' + a.assetName), el('td', hours(a.minutes)), el('td', String(a.sorties))); ba.append(tr); });
        var c = await api('/api/certificates/summary'); var cb = $('#fl-certStats'); cb.replaceChildren();
        stat(cb, '持證社員（有效）', c.validHolders); stat(cb, '有效證照', c.valid + c.expiring90 + c.expiring30); stat(cb, '90 天內到期', c.expiring90); stat(cb, '30 天內到期', c.expiring30); stat(cb, '已到期', c.expired);
        Object.keys(c.byCategory).forEach(function (k) { stat(cb, k, c.byCategory[k].total); });
        var e = await api('/api/certificates/expiring'); var tb = $('#fl-expiring'); tb.replaceChildren();
        e.expired.concat(e.expiring).forEach(function (x) { var tr = el('tr'); var st = STATUS[x.status]; tr.append(el('td', x.owner.name || x.owner.username), el('td', x.category), el('td', x.certNo), el('td', x.expiryDate), el('td', st[0], st[1])); tb.append(tr); });
    }
    async function refresh() { await Promise.all([loadMine(), loadFlights(), loadCerts(), loadClub()]); }
    async function init() {
        cfg = await api('/api/flights/config');
        var ff = $('#fl-flightForm'), cf = $('#fl-certForm');
        fillSelect(ff.type, Object.keys(cfg.types).map(function (k) { return [k, cfg.types[k]]; })); fillSelect($('#fl-fType'), Object.keys(cfg.types).map(function (k) { return [k, cfg.types[k]]; }), '全部');
        fillSelect(ff.assetId, cfg.assets.map(function (a) { return [a.id, a.assetNo + ' ' + a.assetName]; }), '不使用社團設備');
        fillSelect(cf.category, cfg.certCategories.map(function (c) { return [c, c]; })); if ($('#fl-cats')) $('#fl-cats').value = cfg.certCategories.join(',');
        if (OFFICER) [ff, cf].forEach(function (f) { fillSelect(f.who, cfg.people.map(function (p) { return [p.username + '|' + p.memberId, (p.name || '') + (p.username ? '（' + p.username + '）' : '')]; }), '自己'); });
        await refresh();
    }
    function load() { if (!built) build(); return init().catch(function (e) { say(e.message, true); }); }

    window.loadAdminFlights = load;
    if (location.hash === '#flights' && typeof showPanel === 'function') { showPanel('flights'); load(); }
})();
