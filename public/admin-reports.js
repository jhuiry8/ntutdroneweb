// 學期財務報告 inside the finance panel: create 預算書／決算書 for a semester, submit them to the 法規監察委員會,
// see their review status (草稿、送審中、委員會審核通過、退回), submit new versions and add an approved 決算 to the next assembly.
(function () {
    'use strict';
    var panel = document.getElementById('panel-finance');
    if (!panel || typeof FinanceReportView === 'undefined') return;
    var esc = FinanceReportView.esc;
    var state = { reports: [], semesters: [], canEdit: false };
    var COLORS = { draft: '#94a3b8', submitted: '#60a5fa', approved: '#34d399', returned: '#f87171', superseded: '#a78bfa' };
    var toast = function (text, isError) { if (typeof showToast === 'function') showToast(text, isError); };
    async function api(path, method, body) {
        var response = await fetch(path, { method: method || 'GET', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
        var data = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error(data.error || '操作失敗');
        return data;
    }

    var card = document.createElement('div');
    card.id = 'finance-reports';
    card.style.cssText = 'padding:18px; border:1px solid var(--border-glass); border-radius:12px; margin:24px 0;';
    var anchor = document.getElementById('finance-summary');
    if (anchor) anchor.insertAdjacentElement('afterend', card); else panel.appendChild(card);

    function badge(report) { return '<span style="display:inline-block; padding:2px 10px; border-radius:999px; font-size:.8rem; border:1px solid ' + COLORS[report.status] + '; color:' + COLORS[report.status] + ';">' + esc(report.statusLabel) + '</span>'; }

    async function load() {
        try {
            var data = await api('/api/finance/reports');
            state = data;
            draw();
        } catch (error) { card.innerHTML = '<h2 style="font-size:1.1rem;">學期財務報告</h2><p style="color:var(--text-muted);">無法載入：' + esc(error.message) + '</p>'; }
    }

    function draw() {
        var rows = state.reports.map(function (r) {
            var actions = '<button type="button" class="btn btn-secondary" data-act="view" data-id="' + esc(r.id) + '">檢視</button>';
            if (state.canEdit && r.status === 'draft') actions += ' <button type="button" class="btn btn-primary" data-act="submit" data-id="' + esc(r.id) + '">送審</button> <button type="button" class="btn btn-danger" data-act="delete" data-id="' + esc(r.id) + '">刪除草稿</button>';
            if (state.canEdit && r.latest && (r.status === 'returned' || (r.changed && (r.status === 'submitted' || r.status === 'approved')))) actions += ' <button type="button" class="btn btn-primary" data-act="resubmit" data-id="' + esc(r.id) + '">送審新版本</button>';
            if (r.kind === 'settlement' && r.status === 'approved') actions += ' <button type="button" class="btn btn-secondary" data-act="assembly" data-id="' + esc(r.id) + '">加入社員大會報告事項</button>';
            var note = r.changed ? '<div style="color:#fbbf24; font-size:.82rem;">帳目已變動，可重新送審新版本</div>' : '';
            var review = r.review ? '<div style="font-size:.82rem; color:var(--text-muted);">' + esc(String(r.review.decidedAt).slice(0, 10)) + ' 委員會會議</div>' : '';
            return '<tr><td>' + esc(r.semester) + '</td><td>' + esc(r.kindLabel) + '</td><td>v' + esc(r.version) + '</td><td>' + badge(r) + note + review + '</td><td>' + esc(String(r.submittedAt || r.createdAt).slice(0, 10)) + '</td><td style="white-space:normal;">' + actions + '</td></tr>';
        }).join('') || '<tr><td colspan="6" style="color:var(--text-muted);">還沒有報告。</td></tr>';
        card.innerHTML = '<h2 style="font-size:1.1rem; margin-bottom:6px;">學期財務報告（預算書、決算書）</h2>' +
            '<p style="color:var(--text-muted); font-size:.88rem; margin-bottom:10px;">依學期從帳冊產生。送審時數字會凍結成固定版本，交給法規監察委員會在會議中審核與表決（章程第十一條第二款、第十二條）；之後帳目再變動不影響已送審的版本。</p>' +
            (state.canEdit ? '<div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px;"><select id="fr-semester" class="form-control" style="max-width:150px;">' + state.semesters.map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('') + '</select><select id="fr-kind" class="form-control" style="max-width:150px;">' + Object.keys(state.kinds).map(function (k) { return '<option value="' + esc(k) + '">' + esc(state.kinds[k]) + '</option>'; }).join('') + '</select><button type="button" class="btn btn-primary" id="fr-create">建立報告草稿</button></div>' : '') +
            '<div class="table-container"><table><thead><tr><th>學期</th><th>類型</th><th>版本</th><th>審核狀態</th><th>日期</th><th>操作</th></tr></thead><tbody>' + rows + '</tbody></table></div><div id="fr-detail" style="margin-top:16px;"></div>';
        var create = document.getElementById('fr-create');
        if (create) create.onclick = async function () {
            try { var report = await api('/api/finance/reports', 'POST', { semester: document.getElementById('fr-semester').value, kind: document.getElementById('fr-kind').value }); toast('已建立草稿'); await load(); show(report.id); }
            catch (error) { toast(error.message, true); }
        };
        card.querySelectorAll('button[data-act]').forEach(function (button) {
            button.onclick = async function () {
                var id = button.dataset.id, act = button.dataset.act;
                try {
                    if (act === 'view') return show(id);
                    if (act === 'submit' && !confirm('送審後數字會凍結成固定版本，交給委員會審核。確定送審？')) return;
                    if (act === 'delete' && !confirm('刪除這份草稿？')) return;
                    if (act === 'resubmit' && !confirm('用目前的帳目產生新版本並送審？舊版本與審核紀錄都會保留。')) return;
                    if (act === 'delete') await api('/api/finance/reports/' + id, 'DELETE');
                    else if (act === 'assembly') { var added = await api('/api/finance/reports/' + id + '/add-to-assembly', 'POST', {}); toast('已加入「' + added.meetingTitle + '」（' + added.date + '）的報告事項'); }
                    else await api('/api/finance/reports/' + id + '/' + act, 'POST', {});
                    if (act !== 'assembly') toast(act === 'delete' ? '已刪除' : '已送審');
                    await load();
                } catch (error) { toast(error.message, true); }
            };
        });
    }

    async function show(id) {
        var holder = document.getElementById('fr-detail');
        try {
            var report = await api('/api/finance/reports/' + id);
            var review = report.review ? '<p style="margin:0 0 8px;">審核結果：<strong>' + esc(report.statusLabel) + '</strong>（' + esc(report.review.meetingTitle || '') + '，' + esc(String(report.review.decidedAt).slice(0, 16).replace('T', ' ')) + '）' + (report.review.note ? '<br><span style="white-space:pre-wrap;">' + esc(report.review.note) + '</span>' : '') + '</p>' : '';
            holder.innerHTML = review + (report.status === 'draft' ? '<p style="color:#fbbf24;">這是草稿，數字是目前帳冊的即時結果；送審後才會凍結。</p>' : '') + FinanceReportView.render(report, { comments: report.comments, canReply: state.canEdit && report.status !== 'draft' }) +
                '<details style="margin-top:12px;"><summary style="cursor:pointer;">版本與審核紀錄</summary><ul>' + report.history.map(function (h) { return '<li>' + esc(String(h.at).slice(0, 16).replace('T', ' ')) + '　' + esc(h.by) + '　' + esc(h.action) + (h.note ? '：' + esc(h.note) : '') + '</li>'; }).join('') + '</ul></details>';
            holder.querySelectorAll('.fr-reply').forEach(function (button) {
                button.onclick = async function () {
                    var text = prompt('回覆委員的質詢'); if (!text) return;
                    try { await api('/api/finance/reports/' + id + '/comments/' + button.dataset.comment + '/reply', 'POST', { text: text }); toast('已回覆'); show(id); } catch (error) { toast(error.message, true); }
                };
            });
            holder.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch (error) { toast(error.message, true); }
    }

    var originalLoadFinance = window.loadFinance;
    window.loadFinance = async function () {
        var result = typeof originalLoadFinance === 'function' ? await originalLoadFinance.apply(this, arguments) : undefined;
        load();
        return result;
    };
})();
