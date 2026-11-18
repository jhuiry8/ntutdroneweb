// Meetings panel: convene general assemblies, officers' and committee meetings
// online — notice (AI from keywords), check-in, quorum, anonymous online voting
// with charter thresholds, and minutes (AI from the keywords recorded per item).
(function () {
    'use strict';
    var nav = document.querySelector('.sidebar-nav');
    var main = document.querySelector('.main-content');
    if (!nav || !main) return;

    var state = { meetings: [], me: {}, options: { types: {}, kinds: {}, thresholds: {}, statuses: {} }, roster: [], ai: false, currentId: '', amendments: [] };
    var timer = null;

    function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function toast(message, isError) { if (typeof showToast === 'function') showToast(message, isError); else if (isError) alert(message); }
    async function api(path, method, body) {
        var response = await fetch(path, { method: method || 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
        var data = {};
        try { data = await response.json(); } catch (e) { /* empty */ }
        if (!response.ok) throw new Error(data.error || ('請求失敗（' + response.status + '）'));
        return data;
    }
    function busy(button, on, label) {
        if (!button) return;
        if (on) { button.dataset.label = button.textContent; button.textContent = label || '處理中…'; button.disabled = true; }
        else { button.textContent = button.dataset.label || button.textContent; button.disabled = false; }
    }
    function current() { return state.meetings.find(function (m) { return m.id === state.currentId; }); }
    function replaceMeeting(meeting) {
        var index = state.meetings.findIndex(function (m) { return m.id === meeting.id; });
        if (index >= 0) state.meetings[index] = meeting; else state.meetings.unshift(meeting);
    }
    var statusColors = { draft: '#94a3b8', announced: '#60a5fa', open: '#34d399', closed: '#a78bfa' };
    function badge(text, color) { return '<span style="display:inline-block; padding:2px 10px; border-radius:999px; font-size:.8rem; border:1px solid ' + color + '; color:' + color + ';">' + esc(text) + '</span>'; }

    var style = document.createElement('style');
    style.textContent = [
        '.mt-card { padding:16px 18px; border:1px solid var(--border-glass); border-radius:12px; margin-bottom:14px; background:rgba(255,255,255,.02); }',
        '.mt-card h2 { font-size:1.05rem; margin-bottom:8px; } .mt-card h3 { font-size:.98rem; }',
        '.mt-muted { color:var(--text-muted); font-size:.86rem; line-height:1.6; }',
        '.mt-row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:10px; }',
        '.mt-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }',
        '.mt-grid label, .mt-field { display:grid; gap:4px; font-size:.85rem; color:var(--text-muted); }',
        '.mt-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:10px; margin:10px 0; }',
        '.mt-stat { padding:10px 12px; border:1px solid var(--border-glass); border-radius:10px; } .mt-stat strong { display:block; font-size:1.3rem; }',
        '.mt-item { padding:14px 16px; border:1px solid var(--border-glass); border-radius:12px; margin-bottom:12px; }',
        '.mt-pass { color:#34d399; font-weight:600; } .mt-fail { color:#f87171; font-weight:600; }',
        '.mt-vote-buttons .btn { min-width:90px; }',
        '.mt-text { white-space:pre-wrap; line-height:1.8; padding:12px 14px; border-radius:10px; background:rgba(255,255,255,.03); border:1px solid var(--border-glass); }',
        '.mt-agenda-row { display:grid; grid-template-columns:130px 1fr 1fr auto; gap:8px; margin-bottom:8px; }',
        '@media (max-width: 760px) { .mt-grid { grid-template-columns:1fr; } .mt-agenda-row { grid-template-columns:1fr; } }'
    ].join('\n');
    document.head.appendChild(style);

    var regulationsButton = nav.querySelector('button[onclick*="regulations"]');
    var navButton = document.createElement('button');
    navButton.className = 'nav-item'; navButton.type = 'button';
    navButton.setAttribute('onclick', "showPanel('meetings')");
    navButton.innerHTML = '<i data-lucide="users-round"></i> 會議與社員大會';
    navButton.addEventListener('click', function () { load(); });
    if (regulationsButton) regulationsButton.insertAdjacentElement('afterend', navButton); else nav.firstElementChild.appendChild(navButton);

    var panel = document.createElement('div');
    panel.id = 'panel-meetings'; panel.className = 'panel';
    panel.innerHTML = '<div class="content-header"><div><h1>會議與社員大會</h1><p class="mt-muted" style="margin-top:6px;">線上公告開會通知、簽到、計算法定出席人數、無記名線上投票，並把現場紀錄的關鍵字整理成會議紀錄。表決門檻依組織章程第十條（一般／重大決議）、第九條（罷免）、第十二條（委員會）自動判定。</p></div><div id="mt-header-actions"></div></div><div id="mt-body"><p class="mt-muted">載入中…</p></div>';
    main.appendChild(panel);
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();

    async function load() {
        try {
            var data = await api('/api/meetings');
            state.meetings = data.meetings; state.me = data.me; state.options = data.options; state.roster = data.roster; state.ai = data.ai; state.myIp = data.myIp || '';
            if (state.me.officer && !state.amendments.length) {
                try { state.amendments = (await api('/api/regulation-amendments')).filter(function (a) { return a.status === 'proposed'; }); } catch (e) { state.amendments = []; }
            }
            render();
        } catch (error) { document.getElementById('mt-body').innerHTML = '<p class="mt-muted">' + esc(error.message) + '</p>'; }
    }
    function render() {
        var actions = document.getElementById('mt-header-actions');
        actions.innerHTML = state.me.officer && !state.currentId ? '<button type="button" class="btn btn-primary" id="mt-new">召開新會議</button>' : (state.currentId ? '<button type="button" class="btn btn-secondary" id="mt-back">回到會議列表</button>' : '');
        var newButton = document.getElementById('mt-new'); if (newButton) newButton.onclick = function () { renderEditor(null); };
        var backButton = document.getElementById('mt-back'); if (backButton) backButton.onclick = function () { state.currentId = ''; stopPolling(); render(); };
        if (state.currentId && current()) return renderDetail();
        renderList();
    }

    // ───────────── List ─────────────

    // ROC academic term: Aug–Jan is term 1, Feb–Jul term 2 (same rule as the server).
    function semester() {
        var now = new Date(Date.now() + 8 * 3600000), year = now.getUTCFullYear(), month = now.getUTCMonth() + 1;
        return month >= 8 ? (year - 1911) + '-1' : (year - 1912) + '-' + (month === 1 ? 1 : 2);
    }
    var TEMPLATES = {
        opening: { name: '期初社員大會', agenda: [
            { kind: 'report', title: '社長報告：本學期社務與活動規劃' },
            { kind: 'report', title: '總務報告：本學期預算（章程第十一條第二款）' },
            { kind: 'discussion', title: '本學期預算案', threshold: 'ordinary' },
            { kind: 'discussion', title: '本學期社課與活動規劃案', threshold: 'ordinary' }
        ] },
        closing: { name: '期末社員大會', agenda: [
            { kind: 'report', title: '社長報告：本學期社務成果' },
            { kind: 'report', title: '總務報告：本學期決算（章程第十一條第二款）' },
            { kind: 'report', title: '器材報告：財產清點與借用狀況' },
            { kind: 'discussion', title: '本學期決算案', threshold: 'ordinary' },
            { kind: 'election', title: '下屆幹部選舉／交接', threshold: 'ordinary' }
        ] }
    };
    function quickCreate(kind) {
        var term = semester(), template = TEMPLATES[kind];
        var exists = state.meetings.some(function (m) { return m.title.indexOf(term) === 0 && m.title.indexOf(template.name) >= 0; });
        if (exists && !confirm(term + ' 已經有' + template.name + '，還要再建立一場嗎？')) return;
        renderEditor({ type: 'assembly', title: term + ' 學期' + template.name, date: new Date(Date.now() + 8 * 3600000 + 14 * 86400000).toISOString().slice(0, 10), time: '19:00', location: '', onlineUrl: '', convener: '', chair: '', recorder: '', checkInCode: '', keywords: '', guestAccess: true, allowedIps: [], maxPerIp: 0, agenda: template.agenda.concat([{ kind: 'motion', title: '臨時動議', threshold: 'none' }]) }, true);
    }

    function renderList() {
        stopPolling();
        var body = document.getElementById('mt-body');
        var quick = state.me.officer ? '<div class="mt-card"><h2>定期社員大會</h2><p class="mt-muted">章程規定每學期至少召開一次定期大會。本社於學期初、學期末各開一次，可一鍵建立並帶入常用議程（預算／決算報告、選舉等），再依需要修改。</p><div class="mt-row"><button type="button" class="btn btn-secondary" data-quick="opening">建立 ' + esc(semester()) + ' 期初社員大會</button><button type="button" class="btn btn-secondary" data-quick="closing">建立 ' + esc(semester()) + ' 期末社員大會</button></div></div>' : '';
        if (!state.meetings.length) { body.innerHTML = quick + '<p class="mt-muted">目前沒有會議。' + (state.me.officer ? '' : '') + '</p>'; bindQuick(body); return; }
        body.innerHTML = quick + state.meetings.map(function (m) {
            var votes = m.agenda.filter(function (item) { return item.vote.state === 'open'; }).length;
            return '<div class="mt-card"><div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:center;"><div><h2 style="margin:0;">' + esc(m.title) + '</h2><p class="mt-muted">' + esc(m.typeLabel + '・' + m.date + (m.time ? ' ' + m.time : '') + (m.location ? '・' + m.location : '')) + '</p></div><div style="display:flex; gap:8px; align-items:center;">' + badge(m.statusLabel, statusColors[m.status]) + (votes ? badge('投票中', '#fbbf24') : '') + (m.minutes && m.minutes.finalizedAt ? badge('紀錄已定稿', '#a78bfa') : '') + '<button type="button" class="btn btn-secondary" data-open="' + esc(m.id) + '">' + (m.status === 'open' ? '進入會議' : '查看') + '</button></div></div></div>';
        }).join('');
        body.querySelectorAll('[data-open]').forEach(function (button) { button.onclick = function () { state.currentId = button.dataset.open; render(); }; });
        bindQuick(body);
    }
    function bindQuick(body) { body.querySelectorAll('[data-quick]').forEach(function (button) { button.onclick = function () { quickCreate(button.dataset.quick); }; }); }

    // ───────────── Editor ─────────────

    function options(map, selected) { return Object.keys(map).map(function (key) { return '<option value="' + esc(key) + '"' + (key === selected ? ' selected' : '') + '>' + esc(map[key]) + '</option>'; }).join(''); }
    function agendaRow(item) {
        item = item || { kind: 'discussion', threshold: '', title: '', description: '', amendmentId: '' };
        var amendmentOptions = '<option value="">不連結修正案</option>' + state.amendments.map(function (a) { return '<option value="' + esc(a.id) + '"' + (a.id === item.amendmentId ? ' selected' : '') + '>修正案：' + esc(a.title) + '</option>'; }).join('');
        return '<div class="mt-item mt-agenda" data-id="' + esc(item.id || '') + '"><div class="mt-agenda-row"><select class="form-control mt-kind" aria-label="議程類別">' + options(state.options.kinds, item.kind) + '</select><input class="form-control mt-title" maxlength="200" placeholder="案由，例如：115-1 學期社費調整案" value="' + esc(item.title) + '"><select class="form-control mt-threshold" aria-label="表決門檻"><option value="">依會議類型預設</option>' + options(state.options.thresholds, item.threshold) + '</select><button type="button" class="btn btn-danger mt-remove">刪除</button></div>' +
            '<textarea class="form-control mt-desc" rows="2" maxlength="3000" placeholder="說明（選填）">' + esc(item.description) + '</textarea>' + (state.amendments.length ? '<select class="form-control mt-amendment" style="margin-top:8px;" aria-label="連結修正案">' + amendmentOptions + '</select>' : '') + '</div>';
    }
    function readAgenda(container) {
        return Array.prototype.map.call(container.querySelectorAll('.mt-agenda'), function (row) {
            var amendment = row.querySelector('.mt-amendment');
            return { id: row.dataset.id || undefined, kind: row.querySelector('.mt-kind').value, title: row.querySelector('.mt-title').value, threshold: row.querySelector('.mt-threshold').value, description: row.querySelector('.mt-desc').value, amendmentId: amendment ? amendment.value : '' };
        });
    }
    function renderEditor(meeting, isTemplate) {
        stopPolling();
        var m = meeting || { type: 'assembly', title: '', date: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10), time: '19:00', location: '', onlineUrl: '', convener: '', chair: '', recorder: '', checkInCode: '', keywords: '', guestAccess: true, allowedIps: [], maxPerIp: 0, agenda: [] };
        if (isTemplate) meeting = null;
        var locked = meeting && (meeting.status === 'open' || meeting.status === 'closed');
        document.getElementById('mt-header-actions').innerHTML = '<button type="button" class="btn btn-secondary" id="mt-cancel">取消</button>';
        document.getElementById('mt-cancel').onclick = function () { render(); };
        var body = document.getElementById('mt-body');
        body.innerHTML = '<form id="mt-form" class="mt-card"><h2>' + (meeting ? '編輯會議' : '召開新會議') + '</h2>' + (locked ? '<p class="mt-muted">會議已開始，日期、時間、地點不能再修改。</p>' : '') +
            '<div class="mt-grid"><label>會議類型<select class="form-control" name="type"' + (locked ? ' disabled' : '') + '>' + options(state.options.types, m.type) + '</select></label>' +
            '<label style="grid-column:span 2;">會議名稱<input class="form-control" name="title" maxlength="120" required value="' + esc(m.title) + '" placeholder="例如：115 學年度第 1 學期定期社員大會"' + (locked ? ' disabled' : '') + '></label>' +
            '<label>日期<input class="form-control" type="date" name="date" required value="' + esc(m.date) + '"' + (locked ? ' disabled' : '') + '></label><label>時間<input class="form-control" type="time" name="time" value="' + esc(m.time) + '"' + (locked ? ' disabled' : '') + '></label><label>地點<input class="form-control" name="location" maxlength="200" value="' + esc(m.location) + '" placeholder="例如：綜合科館 B1"' + (locked ? ' disabled' : '') + '></label>' +
            '<label style="grid-column:span 2;">線上會議連結（選填，https://）<input class="form-control" name="onlineUrl" maxlength="500" value="' + esc(m.onlineUrl) + '" placeholder="Google Meet／Teams 連結"' + (locked ? ' disabled' : '') + '></label><label>簽到碼（選填，4–12 位英數字）<input class="form-control" name="checkInCode" maxlength="12" value="' + esc(m.checkInCode || '') + '" placeholder="現場公布，防止遠端代簽"></label>' +
            '<label>召集人<input class="form-control" name="convener" maxlength="50" value="' + esc(m.convener) + '"></label><label>主席<input class="form-control" name="chair" maxlength="50" value="' + esc(m.chair) + '"></label><label>紀錄<input class="form-control" name="recorder" maxlength="50" value="' + esc(m.recorder) + '"></label></div>' +
            '<div class="mt-card" style="margin:14px 0 0;"><h3>免帳號簽到（學號＋姓名）</h3><p class="mt-muted">沒有後台帳號的社員可用會議連結，輸入學號與姓名（須與社員名冊相符）簽到並投票。每台裝置只能替一位社員簽到；可再限定會場網路與每個 IP 的人數，並搭配簽到碼。</p>' +
            '<label style="display:flex; gap:8px; align-items:center; margin-top:8px;"><input type="checkbox" name="guestAccess"' + (m.guestAccess ? ' checked' : '') + '> 開放學號＋姓名簽到與投票</label>' +
            '<div class="mt-grid" style="margin-top:8px;"><label style="grid-column:span 2;">只允許這些網路（IP 或網段，空白＝不限制）<textarea class="form-control" name="allowedIps" rows="2" placeholder="例如 140.124.0.0/16（學校網路）">' + esc((m.allowedIps || []).join('\n')) + '</textarea></label><label>每個 IP 最多簽到人數（0＝不限）<input class="form-control" type="number" min="0" name="maxPerIp" value="' + esc(m.maxPerIp || 0) + '"></label></div>' +
            (state.myIp ? '<div class="mt-row"><button type="button" class="btn btn-secondary" id="mt-add-ip">加入我目前的網路（' + esc(state.myIp) + '）</button><span class="mt-muted">在會場連上 Wi-Fi 後按此鈕，只有同一網路的人能簽到。</span></div>' : '') + '</div>' +
            '<label class="mt-field" style="margin-top:12px;">會議重點／關鍵字（AI 會用來寫開會通知與會議紀錄）<textarea class="form-control" name="keywords" rows="3" maxlength="3000" placeholder="例如：期末成果展分工、社費調漲到 600 元、選舉下屆社長、帶學生證">' + esc(m.keywords || '') + '</textarea></label>' +
            '<h3 style="margin:16px 0 8px;">議程</h3><div id="mt-agenda">' + m.agenda.map(agendaRow).join('') + '</div><button type="button" class="btn btn-secondary" id="mt-add-item">新增議案</button>' +
            '<div class="mt-row" style="margin-top:16px;"><button type="submit" class="btn btn-primary">儲存</button></div></form>';
        var addIp = document.getElementById('mt-add-ip');
        if (addIp) addIp.onclick = function () {
            var box = document.querySelector('#mt-form [name=allowedIps]');
            var rule = state.myIp.indexOf(':') >= 0 ? state.myIp.split(':').slice(0, 4).join(':') + '::/64' : state.myIp.split('.').slice(0, 3).join('.') + '.0/24';
            if (box.value.split(/\s+/).indexOf(rule) < 0) box.value = (box.value.trim() ? box.value.trim() + '\n' : '') + rule;
        };
        var agenda = document.getElementById('mt-agenda');
        function bindRemove() { agenda.querySelectorAll('.mt-remove').forEach(function (button) { button.onclick = function () { button.closest('.mt-agenda').remove(); }; }); }
        bindRemove();
        document.getElementById('mt-add-item').onclick = function () { agenda.insertAdjacentHTML('beforeend', agendaRow(null)); bindRemove(); };
        if (!m.agenda.length) document.getElementById('mt-add-item').click();
        document.getElementById('mt-form').onsubmit = async function (event) {
            event.preventDefault();
            var form = event.target, button = form.querySelector('button[type="submit"]');
            var fields = {};
            ['type', 'title', 'date', 'time', 'location', 'onlineUrl', 'checkInCode', 'convener', 'chair', 'recorder', 'keywords'].forEach(function (name) { if (form.elements[name] && !form.elements[name].disabled) fields[name] = form.elements[name].value; });
            fields.guestAccess = form.elements.guestAccess.checked;
            fields.allowedIps = form.elements.allowedIps.value;
            fields.maxPerIp = form.elements.maxPerIp.value || 0;
            fields.agenda = readAgenda(agenda).filter(function (item) { return item.title.trim(); });
            busy(button, true, '儲存中…');
            try {
                var saved = meeting ? await api('/api/meetings/' + encodeURIComponent(meeting.id), 'PATCH', fields) : await api('/api/meetings', 'POST', fields);
                replaceMeeting(saved); state.currentId = saved.id; toast('已儲存'); render();
            } catch (error) { toast(error.message, true); busy(button, false); }
        };
    }

    // ───────────── Detail ─────────────

    async function act(path, method, body, button, label) {
        busy(button, true, label);
        try { var meeting = await api(path, method, body); replaceMeeting(meeting); renderDetail(); return meeting; }
        catch (error) { toast(error.message, true); busy(button, false); return null; }
    }
    function base() { return '/api/meetings/' + encodeURIComponent(state.currentId); }

    function quorumText(m) {
        if (m.totalMembers === null || m.totalMembers === undefined) return '開會時會依社員名冊自動計算應出席人數。';
        var total = m.totalMembers;
        if (m.type === 'assembly' || m.type === 'extraordinary') return '一般決議需 ' + Math.ceil(total / 3) + ' 人出席；重大決議（修改章程等）需 ' + Math.ceil(total * 2 / 3) + ' 人；罷免需 ' + Math.ceil(total / 2) + ' 人。只有具表決權的社員計入。';
        if (m.type === 'committee') return '委員會需 ' + Math.ceil(total / 2) + ' 位委員出席。';
        return '出席者過半數同意即通過，可否同數不通過。';
    }

    function voteBlock(m, item) {
        var html = '';
        var vote = item.vote;
        if (item.threshold === 'none') return '<p class="mt-muted">' + (item.kind === 'report' ? '報告事項，不表決。' : '此項不表決；如有臨時提案，可按「新增臨時動議」另列議案表決。') + '</p>';
        if (vote.state === 'open') {
            html += '<p><strong style="color:#fbbf24;">🗳️ 投票中</strong>（第 ' + (vote.round || 1) + ' 次表決，已有 ' + vote.ballots + ' 人投票；結束前不顯示票數）</p>';
            if (item.voted) html += '<p class="mt-pass">您已投票。投票為無記名，系統只記錄誰投過，不記錄投給哪一方。</p>';
            else if (m.checkedIn && !m.canVote) html += '<p class="mt-muted">您以列席身分出席，不具表決權（需為已繳費正式社員或正式幹部）。</p>';
            else if (m.checkedIn) html += '<div class="mt-row mt-vote-buttons"><button type="button" class="btn btn-primary" data-ballot="agree" data-item="' + esc(item.id) + '">同意</button><button type="button" class="btn btn-danger" data-ballot="oppose" data-item="' + esc(item.id) + '">反對</button><button type="button" class="btn btn-secondary" data-ballot="abstain" data-item="' + esc(item.id) + '">棄權</button></div>';
            else if (state.me.memberId) html += '<p class="mt-muted">請先在上方簽到才能投票。</p>';
        } else if (vote.state === 'closed' && vote.result) {
            var r = vote.result;
            html += '<p>同意 <strong>' + vote.agree + '</strong>・反對 <strong>' + vote.oppose + '</strong>・棄權 <strong>' + vote.abstain + '</strong>（' + (vote.source === 'manual' ? '現場計票' : '線上投票') + '；出席 ' + r.attendance + ' / 應出席 ' + r.total + '）</p><p class="' + (r.passed ? 'mt-pass' : 'mt-fail') + '">' + (r.passed ? '✅ ' : '❌ ') + esc(r.reason) + '</p><p class="mt-muted">依據：' + esc(r.basis || '') + '；門檻需出席 ' + r.needAttendance + ' 人、同意 ' + r.needAgree + ' 票。</p>';
        } else html += '<p class="mt-muted">尚未表決。</p>';
        if (state.me.officer && m.status === 'open') {
            html += '<div class="mt-row">' + (vote.state === 'open' ? '<button type="button" class="btn btn-primary" data-vote="close" data-item="' + esc(item.id) + '">結束投票並計票</button>' : '<button type="button" class="btn btn-primary" data-vote="open" data-item="' + esc(item.id) + '">' + (vote.state === 'closed' ? '重新表決（線上）' : '開放線上投票') + '</button><button type="button" class="btn btn-secondary" data-manual="' + esc(item.id) + '">輸入現場票數</button>') + '</div>' +
                '<div class="mt-row" id="mt-manual-' + esc(item.id) + '" hidden><input class="form-control" type="number" min="0" placeholder="同意" style="max-width:100px;"><input class="form-control" type="number" min="0" placeholder="反對" style="max-width:100px;"><input class="form-control" type="number" min="0" placeholder="棄權" style="max-width:100px;"><input class="form-control" type="number" min="0" placeholder="出席（預設簽到數）" style="max-width:170px;"><button type="button" class="btn btn-primary" data-manual-save="' + esc(item.id) + '">登錄</button></div>';
        }
        if (state.me.president && item.amendmentId && vote.state === 'closed' && vote.result && vote.result.passed) html += '<div class="mt-row"><button type="button" class="btn btn-secondary" data-adopt="' + esc(item.id) + '">帶入「法規查詢」登錄修正案通過</button></div>';
        return html;
    }

    function renderDetail() {
        var m = current();
        if (!m) { state.currentId = ''; return render(); }
        var focused = document.activeElement;
        if (focused && panel.contains(focused) && /^(TEXTAREA|INPUT|SELECT)$/.test(focused.tagName) && timer) return; // do not clobber typing during polling
        var officer = state.me.officer;
        var body = document.getElementById('mt-body');
        var html = '<div class="mt-card"><div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;"><div><h2 style="font-size:1.3rem; margin:0;">' + esc(m.title) + '</h2><p class="mt-muted">' + esc(m.typeLabel + '・' + m.date + (m.time ? ' ' + m.time : '') + (m.location ? '・' + m.location : '')) + (m.onlineUrl ? '・<a href="' + esc(m.onlineUrl) + '" target="_blank" rel="noopener noreferrer">線上會議連結</a>' : '') + '</p><p class="mt-muted">' + esc([m.convener && '召集人 ' + m.convener, m.chair && '主席 ' + m.chair, m.recorder && '紀錄 ' + m.recorder].filter(Boolean).join('・')) + '</p></div><div>' + badge(m.statusLabel, statusColors[m.status]) + '</div></div>';
        if (officer) {
            var buttons = '';
            if (m.status !== 'closed' || !(m.minutes && m.minutes.finalizedAt)) buttons += '<button type="button" class="btn btn-secondary" id="mt-edit">' + (m.status === 'open' || m.status === 'closed' ? '簽到設定與議程' : '編輯會議與議程') + '</button>';
            if (m.status === 'draft') buttons += '<button type="button" class="btn btn-primary" data-status="announced">公告會議</button><button type="button" class="btn btn-danger" id="mt-delete">刪除</button>';
            if (m.status === 'announced') buttons += '<button type="button" class="btn btn-secondary" data-status="draft">撤回公告</button><input id="mt-total" class="form-control" type="number" min="0" style="max-width:190px;" placeholder="應出席人數（留空自動）"><button type="button" class="btn btn-primary" data-status="open">開始開會</button>';
            if (m.status === 'open') buttons += '<button type="button" class="btn btn-secondary" id="mt-motion">新增臨時動議</button><button type="button" class="btn btn-danger" data-status="closed">宣布散會</button>';
            if (m.status === 'closed' && !(m.minutes && m.minutes.finalizedAt)) buttons += '<button type="button" class="btn btn-secondary" data-status="open">重新開會</button>';
            html += '<div class="mt-row">' + buttons + '</div>';
            if (m.guestAccess && m.status !== 'draft') {
                var link = location.origin + '/meeting/' + m.id;
                html += '<div class="mt-row"><span class="mt-muted">免帳號簽到連結：</span><code style="overflow-wrap:anywhere;">' + esc(link) + '</code><button type="button" class="btn btn-secondary" id="mt-copy-link">複製連結</button></div><p class="mt-muted">' + esc((m.allowedIps && m.allowedIps.length ? '限定網路：' + m.allowedIps.join('、') : '未限定網路') + (m.maxPerIp ? '；每個 IP 最多 ' + m.maxPerIp + ' 人' : '')) + '</p>';
            }
            if (m.checkInCode) html += '<p class="mt-muted" style="margin-top:8px;">簽到碼：<strong style="font-size:1.2rem; letter-spacing:.2em; color:var(--text-main, #fff);">' + esc(m.checkInCode) + '</strong>（請在現場公布）</p>';
        }
        html += '</div>';

        // Notice
        if (officer) {
            html += '<details class="mt-card"' + (m.status === 'draft' ? ' open' : '') + '><summary style="cursor:pointer; font-weight:600;">開會通知' + (m.notice ? '（已儲存）' : '') + '</summary><p class="mt-muted" style="margin:8px 0;">輸入關鍵字，AI 依會議資料與議程寫成開會通知；可修改後儲存，或發佈成官網公告。</p><textarea id="mt-keywords" class="form-control" rows="2" maxlength="3000" placeholder="關鍵字，例如：期末大會、社費調整、帶學生證、會後聚餐">' + esc(m.keywords || '') + '</textarea><div class="mt-row"><button type="button" class="btn btn-primary" id="mt-ai-notice"' + (state.ai ? '' : ' disabled title="尚未設定 AI 金鑰"') + '>✨ AI 產生開會通知</button></div><input id="mt-notice-title" class="form-control" style="margin-top:10px;" placeholder="公告標題" maxlength="200"><textarea id="mt-notice" class="form-control" rows="10" maxlength="20000" style="margin-top:8px;" placeholder="開會通知內容（Markdown）">' + esc(m.notice || '') + '</textarea><div class="mt-row"><button type="button" class="btn btn-secondary" id="mt-save-notice">儲存通知</button><button type="button" class="btn btn-secondary" id="mt-publish-notice">發佈成官網公告</button></div></details>';
        } else if (m.notice) html += '<div class="mt-card"><h2>開會通知</h2><div class="mt-text">' + esc(m.notice) + '</div></div>';

        // Attendance
        html += '<div class="mt-card"><h2>出席與簽到</h2><div class="mt-stats"><div class="mt-stat"><span class="mt-muted">應出席</span><strong>' + (m.totalMembers == null ? '—' : m.totalMembers) + '</strong></div><div class="mt-stat"><span class="mt-muted">已簽到</span><strong>' + m.attendanceCount + '</strong></div><div class="mt-stat"><span class="mt-muted">計入法定人數</span><strong>' + m.counted + '</strong></div></div><p class="mt-muted">' + esc(quorumText(m)) + '</p>';
        if (m.status === 'open' || (officer && m.status === 'announced')) {
            if (m.checkedIn) html += '<p class="mt-pass" style="margin-top:8px;">✅ 您已簽到</p>';
            else if (state.me.memberId && (m.type === 'assembly' || m.type === 'extraordinary' || officer)) html += '<div class="mt-row">' + (m.requiresCode && !officer ? '<input id="mt-code" class="form-control" style="max-width:200px;" maxlength="12" placeholder="現場簽到碼">' : '') + '<button type="button" class="btn btn-primary" id="mt-checkin">我要簽到</button>' + (!state.me.voting && (m.type === 'assembly' || m.type === 'extraordinary') ? '<span class="mt-muted">（您目前不具表決權，簽到後列為列席）</span>' : '') + '</div>';
            else if (!state.me.memberId) html += '<p class="mt-muted" style="margin-top:8px;">您的帳號尚未綁定社員資料，無法線上簽到與投票；請聯絡社長綁定。</p>';
            if (officer) html += '<div class="mt-row"><select id="mt-attendee" class="form-control" style="max-width:320px;" aria-label="登記出席社員"><option value="">選擇社員登記出席（現場簽到）</option>' + state.roster.filter(function (r) { return !m.attendance.some(function (a) { return a.memberId === r.id; }); }).map(function (r) { return '<option value="' + esc(r.id) + '">' + esc((r.name || '（未填姓名）') + (r.studentId ? '（' + r.studentId + '）' : '') + (r.voting ? '' : '・無表決權')) + '</option>'; }).join('') + '</select><button type="button" class="btn btn-secondary" id="mt-add-attendee">登記出席</button></div>';
        }
        if (officer && m.attendance.length) html += '<details style="margin-top:10px;"><summary style="cursor:pointer;">簽到名單（' + m.attendance.length + ' 人）</summary><div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;">' + m.attendance.map(function (a) { return '<span class="mt-stat" style="padding:4px 10px;">' + esc(a.name) + (a.voting ? '' : '（列席）') + (a.by === 'guest' ? '<small class="mt-muted">・學號簽到 ' + esc(a.ip || '') + '</small>' : '') + (m.status === 'open' ? ' <button type="button" class="btn btn-danger" style="padding:0 6px; font-size:.75rem;" data-remove="' + esc(a.memberId) + '">×</button>' : '') + '</span>'; }).join('') + '</div></details>';
        html += '</div>';

        // Agenda
        html += '<h2 style="font-size:1.1rem; margin:18px 0 10px;">議程</h2>' + (m.agenda.length ? '' : '<p class="mt-muted">尚無議程。</p>');
        m.agenda.forEach(function (item, index) {
            html += '<div class="mt-item"><p class="mt-muted">' + esc((state.options.kinds[item.kind] || '') + '・第 ' + (index + 1) + ' 案・' + item.thresholdLabel) + '</p><h3 style="margin:4px 0 6px;">' + esc(item.title) + '</h3>' + (item.description ? '<p style="white-space:pre-wrap; line-height:1.7;">' + esc(item.description) + '</p>' : '') + voteBlock(m, item);
            if (officer && !(m.minutes && m.minutes.finalizedAt) && m.status !== 'draft') html += '<label class="mt-field" style="margin-top:10px;">現場紀錄（關鍵字即可，AI 會整理成會議紀錄）<textarea class="form-control" rows="2" maxlength="5000" data-notes="' + esc(item.id) + '" placeholder="例如：小明贊成調漲、擔心新生負擔、建議分期">' + esc(item.notes || '') + '</textarea></label><label class="mt-field" style="margin-top:6px;">決議<input class="form-control" maxlength="2000" data-resolution="' + esc(item.id) + '" value="' + esc(item.resolution || '') + '" placeholder="表決後自動帶入，可修改"></label>';
            else if (item.resolution && m.status === 'closed') html += '<p style="margin-top:8px;"><strong>決議：</strong>' + esc(item.resolution) + '</p>';
            html += '</div>';
        });

        // Minutes
        if (m.status === 'open' || m.status === 'closed') {
            var finalized = m.minutes && m.minutes.finalizedAt;
            html += '<div class="mt-card"><h2>會議紀錄' + (finalized ? ' ' + badge('已定稿', '#a78bfa') : '') + '</h2>';
            if (officer && !finalized) html += '<p class="mt-muted">AI 會用議程、出席人數、表決結果與每案的關鍵字寫成正式會議紀錄；票數一律照系統資料。產生後請檢查修改，散會後再按「定稿」。</p><div class="mt-row"><button type="button" class="btn btn-primary" id="mt-ai-minutes"' + (state.ai ? '' : ' disabled title="尚未設定 AI 金鑰"') + '>✨ AI 產生會議紀錄</button></div><textarea id="mt-minutes" class="form-control" rows="16" maxlength="50000" style="margin-top:10px;" placeholder="會議紀錄（Markdown）">' + esc(m.minutes.content || '') + '</textarea><p id="mt-minutes-note" class="mt-muted"></p><div class="mt-row"><button type="button" class="btn btn-secondary" id="mt-save-minutes">儲存草稿</button>' + (m.status === 'closed' ? '<button type="button" class="btn btn-primary" id="mt-finalize">定稿（之後不能修改）</button>' : '') + '<a class="btn btn-secondary" target="_blank" rel="noopener" href="/admin/meetings/' + esc(m.id) + '/minutes">預覽列印</a></div>';
            else if (finalized) html += '<div class="mt-text">' + esc(m.minutes.content) + '</div><div class="mt-row"><a class="btn btn-secondary" target="_blank" rel="noopener" href="/admin/meetings/' + esc(m.id) + '/minutes">列印／另存 PDF</a>' + (officer ? '<button type="button" class="btn btn-secondary" id="mt-publish-minutes">發佈成官網文章</button>' : '') + (state.me.president ? '<button type="button" class="btn btn-secondary" id="mt-unfinalize">取消定稿</button>' : '') + '</div>';
            else html += '<p class="mt-muted">會議紀錄定稿後會顯示在這裡。</p>';
            html += '</div>';
        }
        body.innerHTML = html;
        bindDetail(m);
        if (m.status === 'open') startPolling(); else stopPolling();
    }

    function openPostDraft(title, content) {
        if (typeof openPostForm !== 'function') return toast('您沒有發佈官網文章的權限', true);
        showPanel('posts'); openPostForm();
        document.getElementById('post-title').value = title;
        document.getElementById('post-content').value = content;
        var summary = document.getElementById('post-summary'); if (summary) summary.value = title;
        if (typeof updateLivePreview === 'function') updateLivePreview('post-content');
        toast('已填入文章編輯器，請填寫網址代稱後儲存');
    }

    function bindDetail(m) {
        var $ = function (id) { return document.getElementById(id); };
        var on = function (id, handler) { var node = $(id); if (node) node.onclick = handler; };
        on('mt-edit', function () { renderEditor(m); });
        on('mt-copy-link', function () { var link = location.origin + '/meeting/' + m.id; if (navigator.clipboard) navigator.clipboard.writeText(link).then(function () { toast('已複製，可以貼到社團群組'); }); });
        on('mt-delete', async function () { if (!confirm('確定刪除這場會議？')) return; try { await api(base(), 'DELETE'); state.meetings = state.meetings.filter(function (x) { return x.id !== m.id; }); state.currentId = ''; render(); } catch (error) { toast(error.message, true); } });
        panel.querySelectorAll('[data-status]').forEach(function (button) {
            button.onclick = function () {
                var next = button.dataset.status;
                var confirmText = { announced: '公告後社員就能在後台看到這場會議。確定公告？', open: '開始開會後即可簽到與投票，並鎖定應出席人數。確定開始？', closed: '確定宣布散會？散會後不能再簽到或投票（可重新開會）。', draft: '確定撤回公告？' }[next];
                if (confirmText && !confirm(confirmText)) return;
                var total = $('mt-total');
                act(base() + '/status', 'POST', { status: next, totalMembers: total && total.value !== '' ? Number(total.value) : undefined }, button);
            };
        });
        on('mt-motion', async function () {
            var title = prompt('臨時動議案由：'); if (!title) return;
            var agenda = m.agenda.map(function (item) { return { id: item.id, kind: item.kind, title: item.title, description: item.description, threshold: item.threshold, amendmentId: item.amendmentId }; });
            agenda.push({ kind: 'motion', title: title });
            act(base(), 'PATCH', { agenda: agenda }, this);
        });
        on('mt-checkin', function () { var code = $('mt-code'); act(base() + '/attendance', 'POST', { code: code ? code.value : '' }, this, '簽到中…').then(function (r) { if (r) toast('簽到完成'); }); });
        on('mt-add-attendee', function () { var select = $('mt-attendee'); if (!select.value) return toast('請選擇社員', true); act(base() + '/attendance', 'POST', { memberId: select.value }, this); });
        panel.querySelectorAll('[data-remove]').forEach(function (button) { button.onclick = function () { if (confirm('確定移除這位出席者？')) act(base() + '/attendance', 'POST', { memberId: button.dataset.remove, remove: true }, button); }; });
        panel.querySelectorAll('[data-ballot]').forEach(function (button) {
            button.onclick = function () {
                var label = { agree: '同意', oppose: '反對', abstain: '棄權' }[button.dataset.ballot];
                if (!confirm('確定投「' + label + '」？送出後不能更改。')) return;
                act(base() + '/agenda/' + encodeURIComponent(button.dataset.item) + '/ballot', 'POST', { choice: button.dataset.ballot }, button, '送出中…').then(function (r) { if (r) toast('已投票'); });
            };
        });
        panel.querySelectorAll('[data-vote]').forEach(function (button) {
            button.onclick = function () {
                if (button.dataset.vote === 'open' && !confirm('開放線上投票？已簽到且具表決權的社員可在後台投票。')) return;
                act(base() + '/agenda/' + encodeURIComponent(button.dataset.item) + '/vote', 'POST', { action: button.dataset.vote }, button);
            };
        });
        panel.querySelectorAll('[data-manual]').forEach(function (button) { button.onclick = function () { var row = $('mt-manual-' + button.dataset.manual); row.hidden = !row.hidden; }; });
        panel.querySelectorAll('[data-manual-save]').forEach(function (button) {
            button.onclick = function () {
                var inputs = button.parentNode.querySelectorAll('input');
                act(base() + '/agenda/' + encodeURIComponent(button.dataset.manualSave) + '/vote', 'POST', { action: 'manual', agree: inputs[0].value || 0, oppose: inputs[1].value || 0, abstain: inputs[2].value || 0, attendance: inputs[3].value }, button);
            };
        });
        panel.querySelectorAll('[data-notes]').forEach(function (area) {
            var save = async function () {
                var id = area.dataset.notes, resolution = panel.querySelector('[data-resolution="' + id + '"]');
                var item = m.agenda.find(function (x) { return x.id === id; });
                if (item && item.notes === area.value && item.resolution === resolution.value) return;
                try { replaceMeeting(await api(base() + '/agenda/' + encodeURIComponent(id) + '/notes', 'POST', { notes: area.value, resolution: resolution.value })); toast('已儲存紀錄'); }
                catch (error) { toast(error.message, true); }
            };
            area.addEventListener('blur', save);
            panel.querySelector('[data-resolution="' + area.dataset.notes + '"]').addEventListener('blur', save);
        });
        panel.querySelectorAll('[data-adopt]').forEach(function (button) {
            button.onclick = async function () {
                var item = m.agenda.find(function (x) { return x.id === button.dataset.adopt; });
                if (typeof openAdoptForm !== 'function') return;
                showPanel('regulations');
                if (typeof loadRegulations === 'function') await loadRegulations();
                await openAdoptForm(item.amendmentId);
                var set = function (id, value) { var input = document.getElementById(id); if (input) input.value = value; };
                if (m.type === 'officers') set('adopt-officers-date', m.date);
                else { set('adopt-assembly-date', m.date); set('adopt-total', item.vote.result.total); set('adopt-attendance', item.vote.result.attendance); set('adopt-agree', item.vote.agree); }
                if (typeof updateThresholdHint === 'function') updateThresholdHint();
                var target = document.getElementById('adopt-' + item.amendmentId); if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                toast('已帶入會議日期與票數，請確認其他欄位後登錄');
            };
        });
        on('mt-ai-notice', async function () {
            var button = this; busy(button, true, 'AI 撰寫中…');
            try { var draft = await api(base() + '/ai-notice', 'POST', { keywords: $('mt-keywords').value }); $('mt-notice-title').value = draft.title; $('mt-notice').value = draft.content; toast('已產生，請檢查後儲存'); }
            catch (error) { toast(error.message, true); } finally { busy(button, false); }
        });
        on('mt-save-notice', function () { act(base(), 'PATCH', { notice: $('mt-notice').value, keywords: $('mt-keywords').value }, this).then(function (r) { if (r) toast('已儲存通知'); }); });
        on('mt-publish-notice', function () { var content = $('mt-notice').value.trim(); if (!content) return toast('請先產生或填寫通知', true); openPostDraft($('mt-notice-title').value || m.title + ' 開會通知', content); });
        on('mt-ai-minutes', async function () {
            var button = this;
            if ($('mt-minutes').value.trim() && !confirm('會覆蓋目前的會議紀錄草稿，確定重新產生？')) return;
            busy(button, true, 'AI 撰寫中…');
            try { var draft = await api(base() + '/ai-minutes', 'POST', {}); $('mt-minutes').value = draft.content; $('mt-minutes-note').textContent = draft.notes ? 'AI 備註：' + draft.notes : ''; replaceMeeting(await api(base() + '/minutes', 'PUT', { content: draft.content, generated: true })); toast('已產生並儲存草稿'); }
            catch (error) { toast(error.message, true); } finally { busy(button, false); }
        });
        on('mt-save-minutes', function () { act(base() + '/minutes', 'PUT', { content: $('mt-minutes').value }, this).then(function (r) { if (r) toast('已儲存草稿'); }); });
        on('mt-finalize', function () { if (confirm('定稿後所有社員都能看到這份紀錄，且不能再修改。確定定稿？')) act(base() + '/minutes', 'PUT', { content: $('mt-minutes').value, finalize: true }, this); });
        on('mt-unfinalize', function () { if (confirm('取消定稿後可以再修改紀錄。確定？')) act(base() + '/minutes', 'PUT', { unfinalize: true }, this); });
        on('mt-publish-minutes', function () { openPostDraft(m.title + ' 會議紀錄', m.minutes.content); });
    }

    // Member login switch (president): members without accounts use the meeting link instead.
    var usersPanel = document.getElementById('panel-users');
    if (usersPanel) {
        var card = document.createElement('div');
        card.className = 'mt-card'; card.style.maxWidth = '720px';
        card.innerHTML = '<h2>社員帳號登入</h2><p class="mt-muted">關閉時，角色為「社員」的帳號無法登入後台（已登入者也會被登出）；社長、財務、一般幹部不受影響。社員仍可用會議連結以學號＋姓名簽到與投票。</p><label style="display:flex; gap:8px; align-items:center; margin-top:8px;"><input type="checkbox" id="mt-member-login"> 開放社員帳號登入</label>';
        var header = usersPanel.querySelector('.content-header');
        if (header) header.insertAdjacentElement('afterend', card); else usersPanel.prepend(card);
        var toggle = card.querySelector('#mt-member-login');
        api('/api/site-settings').then(function (settings) { toggle.checked = settings.memberLogin !== false; }).catch(function () { toggle.disabled = true; });
        toggle.onchange = async function () {
            toggle.disabled = true;
            try { var settings = await api('/api/site-settings', 'PUT', { memberLogin: toggle.checked }); toggle.checked = settings.memberLogin; toast(settings.memberLogin ? '已開放社員帳號登入' : '已關閉社員帳號登入'); }
            catch (error) { toggle.checked = !toggle.checked; toast(error.message, true); }
            finally { toggle.disabled = false; }
        };
    }

    // While a meeting is open, refresh every 5 seconds so check-ins and vote state stay current.
    function startPolling() {
        if (timer) return;
        timer = setInterval(async function () {
            if (!panel.classList.contains('active') || !state.currentId) return stopPolling();
            try { replaceMeeting(await api(base())); renderDetail(); } catch (e) { /* keep last view */ }
        }, 5000);
    }
    function stopPolling() { if (timer) { clearInterval(timer); timer = null; } }
})();
