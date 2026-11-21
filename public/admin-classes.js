// Class check-in panel (社課簽到): create class sessions, show a short-lived check-in link and
// QR code, review the attendance list (free-trial limit, visitors), add or remove people and export CSV.
(function () {
    'use strict';
    var nav = document.querySelector('.sidebar-nav');
    var main = document.querySelector('.main-content');
    if (!nav || !main) return;

    var state = { classes: [], roster: [], currentId: '', detail: null };
    var countdown = null;

    function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function toast(message, isError) { if (typeof showToast === 'function') showToast(message, isError); else if (isError) alert(message); }
    async function api(path, method, body) {
        var response = await fetch(path, { method: method || 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
        var data = {};
        try { data = await response.json(); } catch (e) { /* empty */ }
        if (!response.ok) throw new Error(data.error || ('請求失敗（' + response.status + '）'));
        return data;
    }
    function guard(task) { return task.catch(function (error) { toast(error.message, true); }); }

    var style = document.createElement('style');
    style.textContent = [
        '.cl-card { padding:16px 18px; border:1px solid var(--border-glass); border-radius:12px; margin-bottom:14px; background:rgba(255,255,255,.02); }',
        '.cl-card h2 { font-size:1.05rem; margin-bottom:8px; } .cl-muted { color:var(--text-muted); font-size:.86rem; line-height:1.6; }',
        '.cl-row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:10px; } .cl-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px; }',
        '.cl-qr { background:#fff; padding:10px; border-radius:10px; display:inline-block; line-height:0; } .cl-qr svg { width:240px; height:240px; }',
        '.cl-pill { display:inline-block; padding:2px 10px; border-radius:999px; font-size:.8rem; border:1px solid currentColor; } .cl-warn { color:#fbbf24; } .cl-ok { color:#34d399; } .cl-bad { color:#f87171; }'
    ].join('\n');
    document.head.appendChild(style);

    var meetingsButton = nav.querySelector('button[onclick*="meetings"]');
    var navButton = document.createElement('button');
    navButton.className = 'nav-item'; navButton.type = 'button';
    navButton.setAttribute('onclick', "showPanel('classes')");
    navButton.innerHTML = '<i data-lucide="qr-code"></i> 社課簽到';
    navButton.addEventListener('click', function () { guard(load()); });
    if (meetingsButton) meetingsButton.insertAdjacentElement('afterend', navButton); else nav.firstElementChild.appendChild(navButton);

    var panel = document.createElement('div');
    panel.id = 'panel-classes'; panel.className = 'panel';
    panel.innerHTML = '<div class="content-header"><div><h1>社課簽到</h1><p class="cl-muted" style="margin-top:6px;">建立社課場次，產生短時間有效的簽到 QR code。社員用學號＋姓名簽到；非正式社員自動扣除本學年免費體驗次數（2 次），超過會提示繳費，由幹部決定是否放行。</p></div></div><div id="cl-body"></div>';
    main.appendChild(panel);
    if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
    var body = document.getElementById('cl-body');

    async function load() {
        var data = await api('/api/classes');
        state.classes = data.classes; state.roster = data.roster;
        if (state.currentId) await openClass(state.currentId, true); else render();
    }
    async function openClass(id, quiet) {
        try { state.detail = await api('/api/classes/' + encodeURIComponent(id)); state.currentId = id; }
        catch (error) { state.currentId = ''; state.detail = null; if (!quiet) throw error; }
        render();
    }

    function listHtml() {
        var rows = state.classes.map(function (c) {
            return '<tr><td>' + esc(c.date) + '</td><td>' + esc(c.topic) + '<br><small class="cl-muted">' + esc([c.instructor, c.location].filter(Boolean).join('・')) + '</small></td><td>' + esc(c.statusLabel) + '</td><td>' + c.attendanceCount + (c.pendingCount ? ' <span class="cl-warn">（' + c.pendingCount + ' 筆待處理）</span>' : '') + '</td><td><button class="btn btn-secondary" data-open="' + esc(c.id) + '">開啟</button></td></tr>';
        }).join('') || '<tr><td colspan="5" style="text-align:center;" class="cl-muted">還沒有社課場次。</td></tr>';
        return '<div class="cl-card"><h2>新增社課場次</h2><form id="cl-create"><div class="cl-grid">'
            + '<input class="form-control" name="date" type="date" required aria-label="日期">'
            + '<input class="form-control" name="time" type="time" aria-label="時間">'
            + '<input class="form-control" name="topic" placeholder="主題" maxlength="120" required>'
            + '<input class="form-control" name="instructor" placeholder="講師" maxlength="60">'
            + '<input class="form-control" name="location" placeholder="地點" maxlength="200"></div>'
            + '<div class="cl-row"><button class="btn btn-primary" type="submit">建立並開始簽到</button></div></form></div>'
            + '<div class="table-container"><table><thead><tr><th>日期</th><th>主題</th><th>狀態</th><th>簽到人數</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }

    function tokenHtml(c) {
        var html = '<div class="cl-card"><h2>簽到連結與 QR code</h2>';
        if (c.status !== 'open') return html + '<p class="cl-muted">簽到已結束。按「重新開放簽到」後才能產生連結。</p></div>';
        var live = c.tokenState === 'valid';
        html += '<p class="cl-muted">連結只在有效時間內可用；產生新連結會讓舊連結立刻失效，避免連結外流後被遠端代簽。現場請用投影顯示 QR code，過期後重新產生即可。</p>';
        html += '<div class="cl-row"><label class="cl-muted">有效時間 <select id="cl-ttl" class="form-control" style="display:inline-block; width:auto;">' + [10, 30, 60, 120].map(function (m) { return '<option value="' + m + '"' + (m === 30 ? ' selected' : '') + '>' + m + ' 分鐘</option>'; }).join('') + '</select></label><button class="btn btn-primary" id="cl-token">' + (live ? '重新產生連結' : '產生簽到連結與 QR code') + '</button></div>';
        if (live) {
            var link = location.origin + '/class/' + c.id + '?t=' + c.token;
            var svg = '';
            try { var qr = qrcode(0, 'M'); qr.addData(link); qr.make(); svg = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true }); } catch (e) { svg = ''; }
            html += '<div class="cl-row" style="align-items:flex-start;"><div class="cl-qr" aria-label="簽到 QR code">' + svg + '</div><div style="flex:1; min-width:220px;"><p>剩餘有效時間：<strong id="cl-left" data-until="' + esc(c.tokenExpiresAt) + '"></strong></p><input class="form-control" id="cl-link" readonly value="' + esc(link) + '"><div class="cl-row"><button class="btn btn-secondary" id="cl-copy">複製連結</button></div></div></div>';
        } else if (c.tokenState === 'expired') html += '<p class="cl-warn" style="margin-top:10px;">上一個連結已過期。</p>';
        return html + '</div>';
    }

    function attendanceHtml(c) {
        var rows = c.attendance.map(function (e) {
            var cls = e.overLimit && !e.approved ? 'cl-warn' : '';
            var actions = '';
            if (e.overLimit) actions += '<button class="btn btn-secondary" data-approve="' + esc(e.id) + '" data-value="' + (e.approved ? 'false' : 'true') + '">' + (e.approved ? '取消放行' : '放行') + '</button> ';
            actions += '<button class="btn btn-danger" data-remove="' + esc(e.id) + '">刪除</button>';
            return '<tr><td>' + esc(e.name) + '<br><small class="cl-muted">' + esc(e.studentId || '無學號') + '</small></td><td>' + esc(e.kindLabel) + (e.levelLabel && e.kind === 'member' ? '<br><small class="cl-muted">' + esc(e.levelLabel) + (e.paid === false ? '・未繳費' : '') + '</small>' : '') + '</td><td class="' + cls + '">' + esc(e.statusLabel) + (e.syncError ? '<br><small class="cl-bad">體驗次數未同步，請到社員管理確認</small>' : '') + '</td><td><small>' + esc(e.at.slice(5, 16).replace('T', ' ')) + '<br>' + (e.by === 'self' ? '自行簽到' : '補簽：' + esc(e.by)) + '</small></td><td style="white-space:nowrap;">' + actions + '</td></tr>';
        }).join('') || '<tr><td colspan="5" style="text-align:center;" class="cl-muted">還沒有人簽到。</td></tr>';
        var taken = {};
        c.attendance.forEach(function (e) { if (e.memberId) taken[e.memberId] = true; });
        var options = state.roster.filter(function (m) { return !taken[m.id]; }).map(function (m) { return '<option value="' + esc(m.id) + '">' + esc((m.name || '（無姓名）') + '・' + (m.studentId || '無學號') + '・' + m.levelLabel + (m.trialRemaining !== null ? '・免費剩 ' + m.trialRemaining : '')) + '</option>'; }).join('');
        return '<div class="cl-card"><h2>出席名單（' + c.attendanceCount + ' 人' + (c.pendingCount ? '，' + c.pendingCount + ' 筆需繳費待處理' : '') + '）</h2><div class="table-container"><table><thead><tr><th>姓名／學號</th><th>類別</th><th>狀態</th><th>時間</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
            + '<h3 style="margin-top:16px; font-size:.98rem;">手動補簽</h3><form id="cl-add-member" class="cl-row"><select class="form-control" name="memberId" style="max-width:420px;" required><option value="">選擇社員…</option>' + options + '</select><button class="btn btn-secondary" type="submit">補簽社員</button></form>'
            + '<form id="cl-add-guest" class="cl-row"><input class="form-control" name="name" placeholder="訪客姓名" maxlength="50" required style="max-width:180px;"><input class="form-control" name="studentId" placeholder="學號（選填）" maxlength="30" style="max-width:180px;"><button class="btn btn-secondary" type="submit">補簽訪客</button></form></div>';
    }

    function detailHtml(c) {
        return '<p><button class="btn btn-secondary" id="cl-back">← 返回場次列表</button></p><div class="cl-card"><h2>' + esc(c.topic) + ' <span class="cl-pill ' + (c.status === 'open' ? 'cl-ok' : 'cl-muted') + '">' + esc(c.statusLabel) + '</span></h2><p class="cl-muted">' + esc(c.date + (c.time ? ' ' + c.time : '') + '・' + (c.instructor ? '講師 ' + c.instructor + '・' : '') + (c.location || '地點未填') + '・' + c.year + ' 學年') + '</p>'
            + '<div class="cl-row"><button class="btn btn-secondary" id="cl-toggle">' + (c.status === 'open' ? '結束簽到' : '重新開放簽到') + '</button><a class="btn btn-secondary" href="/api/classes/' + esc(c.id) + '/export.csv">匯出 CSV</a><button class="btn btn-secondary" id="cl-feedback">產生回饋問卷</button><button class="btn btn-danger" id="cl-delete">刪除場次</button></div><div id="cl-feedback-out" class="cl-muted" style="margin-top:8px;"></div></div>'
            + tokenHtml(c) + attendanceHtml(c);
    }

    function render() {
        clearInterval(countdown);
        var c = state.detail;
        body.innerHTML = c ? detailHtml(c) : listHtml();
        bind(c);
    }

    function tick() {
        var el = document.getElementById('cl-left');
        if (!el) return clearInterval(countdown);
        var seconds = Math.max(0, Math.round((Date.parse(el.dataset.until) - Date.now()) / 1000));
        el.textContent = seconds ? Math.floor(seconds / 60) + ' 分 ' + (seconds % 60) + ' 秒' : '已過期，請重新產生';
        if (!seconds) clearInterval(countdown);
    }

    function on(id, event, handler) { var el = document.getElementById(id); if (el) el.addEventListener(event, handler); }
    function bind(c) {
        if (!c) {
            on('cl-create', 'submit', function (event) {
                event.preventDefault();
                var form = event.target, fields = {};
                ['date', 'time', 'topic', 'instructor', 'location'].forEach(function (name) { fields[name] = form.elements[name].value; });
                guard(api('/api/classes', 'POST', fields).then(function (created) { toast('已建立社課場次'); state.currentId = created.id; return load(); }));
            });
            body.querySelectorAll('[data-open]').forEach(function (button) { button.addEventListener('click', function () { guard(openClass(button.dataset.open)); }); });
            return;
        }
        var base = '/api/classes/' + encodeURIComponent(c.id);
        function update(promise, message) { return guard(promise.then(function (updated) { state.detail = updated; if (message) toast(message); return load(); })); }
        on('cl-back', 'click', function () { state.currentId = ''; state.detail = null; guard(load()); });
        on('cl-toggle', 'click', function () { update(api(base + '/status', 'POST', { status: c.status === 'open' ? 'closed' : 'open' })); });
        on('cl-delete', 'click', function () {
            if (!confirm('刪除「' + c.topic + '」與其 ' + c.attendanceCount + ' 筆簽到紀錄？已扣除的免費體驗次數會退回，無法復原。')) return;
            guard(api(base, 'DELETE').then(function () { state.currentId = ''; state.detail = null; toast('已刪除場次'); return load(); }));
        });
        on('cl-feedback', 'click', function () {
            guard(api('/api/surveys/from-link', 'POST', { type: 'class', id: c.id }).then(function (r) {
                var out = document.getElementById('cl-feedback-out');
                out.innerHTML = (r.existing ? '這場社課已有回饋問卷：' : '已建立回饋問卷：') + '<a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.url) + '</a>　<a href="/admin/surveys/' + esc(r.survey.id) + '/report">看報表</a>　<a href="/admin/surveys">編輯問卷</a><br>學員簽到成功後，簽到頁會自動顯示「填寫回饋」連結。';
                if (navigator.clipboard) navigator.clipboard.writeText(r.url).then(function () { toast('已複製回饋問卷連結'); }, function () {});
            }));
        });
        on('cl-token', 'click', function () { update(api(base + '/token', 'POST', { ttlMinutes: Number(document.getElementById('cl-ttl').value) }), '已產生新的簽到連結，舊連結已失效'); });
        on('cl-copy', 'click', function () {
            var input = document.getElementById('cl-link');
            input.select();
            (navigator.clipboard ? navigator.clipboard.writeText(input.value) : Promise.reject()).then(function () { toast('已複製連結'); }, function () { document.execCommand('copy'); toast('已複製連結'); });
        });
        on('cl-add-member', 'submit', function (event) {
            event.preventDefault();
            update(api(base + '/attendance', 'POST', { memberId: event.target.elements.memberId.value }), '已補簽');
        });
        on('cl-add-guest', 'submit', function (event) {
            event.preventDefault();
            update(api(base + '/attendance', 'POST', { guest: { name: event.target.elements.name.value, studentId: event.target.elements.studentId.value } }), '已補簽訪客');
        });
        body.querySelectorAll('[data-remove]').forEach(function (button) {
            button.addEventListener('click', function () { if (confirm('刪除這筆簽到？若已扣免費體驗次數會退回。')) update(api(base + '/attendance', 'POST', { remove: true, entryId: button.dataset.remove }), '已刪除簽到'); });
        });
        body.querySelectorAll('[data-approve]').forEach(function (button) {
            button.addEventListener('click', function () { update(api(base + '/attendance', 'POST', { approve: true, entryId: button.dataset.approve, approved: button.dataset.value === 'true' }), button.dataset.value === 'true' ? '已放行' : '已取消放行'); });
        });
        if (document.getElementById('cl-left')) { tick(); countdown = setInterval(tick, 1000); }
    }
})();
