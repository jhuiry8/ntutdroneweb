// Shows a frozen 財務報告 (預算書／決算書) snapshot: figures, a budget-vs-actual chart (inline SVG), the category table
// and the entries with receipt links and the committee's questions. Used by the finance page and the meeting page.
// Every value from the server is escaped; receipt links must be same-site /files/ paths.
(function () {
    'use strict';
    function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function money(value) { return 'NT$ ' + new Intl.NumberFormat('zh-TW').format(Number(value || 0)); }
    var KIND = { income: '收入', expense: '支出', transfer: '轉帳' };
    var STATUS = { approved: '已核准', pending: '待審核' };

    // Planned (grey) and actual (blue; red when over budget) bars for every budget category.
    function chart(categories) {
        var rows = categories.filter(function (item) { return item.planned > 0 || item.expense > 0; });
        if (!rows.length) return '';
        var max = Math.max.apply(null, rows.map(function (item) { return Math.max(item.planned, item.expense); })) || 1;
        var height = rows.length * 34 + 8, width = 520, left = 110, span = width - left - 90;
        var bars = rows.map(function (item, index) {
            var y = 6 + index * 34, planned = Math.round(item.planned / max * span), actual = Math.round(item.expense / max * span);
            var over = item.planned > 0 && item.expense > item.planned;
            return '<text x="0" y="' + (y + 12) + '" font-size="12" fill="currentColor">' + esc(item.name.slice(0, 8)) + '</text>' +
                '<rect x="' + left + '" y="' + y + '" width="' + Math.max(planned, 1) + '" height="11" rx="3" fill="#94a3b8" opacity=".55"></rect>' +
                '<rect x="' + left + '" y="' + (y + 13) + '" width="' + Math.max(actual, 1) + '" height="11" rx="3" fill="' + (over ? '#ef4444' : '#3b82f6') + '"></rect>' +
                '<text x="' + (left + Math.max(planned, actual) + 6) + '" y="' + (y + 20) + '" font-size="11" fill="currentColor">' + (item.rate === null ? '' : esc(item.rate) + '%') + '</text>';
        }).join('');
        return '<svg role="img" aria-label="各分類預算與實際支出" viewBox="0 0 ' + width + ' ' + height + '" style="width:100%; max-width:560px; height:auto; color:var(--text-main,#e2e8f0);">' + bars + '</svg>' +
            '<p style="font-size:.8rem; color:var(--text-muted);"><span style="color:#94a3b8;">■</span> 預算　<span style="color:#3b82f6;">■</span> 實際支出　<span style="color:#ef4444;">■</span> 超出預算</p>';
    }

    function card(label, value) { return '<div class="finance-card"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong></div>'; }

    // options: { comments: [...], canComment, canReply }
    function render(report, options) {
        options = options || {};
        var s = report.snapshot;
        if (!s) return '<p style="color:var(--text-muted);">這份報告沒有內容。</p>';
        var comments = options.comments || [];
        var byTx = {};
        comments.forEach(function (c) { (byTx[c.transactionId || ''] = byTx[c.transactionId || ''] || []).push(c); });
        function thread(txId) {
            return (byTx[txId] || []).map(function (c) {
                return '<div class="fr-comment" style="margin:6px 0 0 12px; padding:8px 10px; border-left:3px solid #fbbf24; background:rgba(251,191,36,.06);"><small>' + esc(c.by) + '・' + esc(String(c.at).slice(0, 16).replace('T', ' ')) + '</small><div style="white-space:pre-wrap;">' + esc(c.text) + '</div>' +
                    c.replies.map(function (r) { return '<div style="margin:6px 0 0 12px; padding-left:8px; border-left:3px solid #34d399;"><small>總務回覆 ' + esc(r.by) + '・' + esc(String(r.at).slice(0, 16).replace('T', ' ')) + '</small><div style="white-space:pre-wrap;">' + esc(r.text) + '</div></div>'; }).join('') +
                    (options.canReply ? '<button type="button" class="btn btn-secondary fr-reply" data-comment="' + esc(c.id) + '" style="margin-top:6px; padding:2px 10px;">回覆</button>' : '') + '</div>';
            }).join('');
        }
        var rate = s.totals.planned > 0 ? Math.round(s.totals.expense / s.totals.planned * 1000) / 10 + '%' : '—';
        var html = '<div class="fr-report"><h3 style="margin:0 0 4px;">' + esc(s.title) + '（版本 ' + esc(report.version) + '）</h3><p style="color:var(--text-muted); margin:0 0 10px;">期間 ' + esc(s.period.start) + ' ~ ' + esc(s.period.end) + '　製作 ' + esc(String(s.generatedAt).slice(0, 10)) + '</p>' +
            '<div class="finance-summary">' + card('期初現金', money(s.opening.cash)) + card('期初郵局', money(s.opening.postal)) + card('期末現金', money(s.closing.cash)) + card('期末郵局', money(s.closing.postal)) +
            card('本期收入', money(s.totals.income)) + card('本期支出', money(s.totals.expense)) + card('預算總額', money(s.totals.planned)) + card('執行率', rate) + '</div>' +
            (s.totals.pendingCount ? '<p style="color:#fbbf24;">另有 ' + esc(s.totals.pendingCount) + ' 筆待審核帳目，不計入上列數字。</p>' : '') +
            chart(s.categories) +
            '<div class="table-container" style="margin:12px 0;"><table><thead><tr><th>分類</th><th>預算</th><th>實際支出</th><th>執行率</th><th>收入</th></tr></thead><tbody>' +
            s.categories.map(function (c) { return '<tr><td>' + esc(c.name) + '</td><td>' + money(c.planned) + '</td><td>' + money(c.expense) + '</td><td>' + (c.rate === null ? '—' : esc(c.rate) + '%') + '</td><td>' + money(c.income) + '</td></tr>'; }).join('') +
            '<tr><td>未分類</td><td>—</td><td>' + money(s.uncategorized.expense) + '</td><td>—</td><td>' + money(s.uncategorized.income) + '</td></tr></tbody></table></div>' +
            '<h4 style="margin:12px 0 6px;">交易明細（' + s.transactions.length + ' 筆）</h4>' + thread('') +
            '<div class="table-container"><table><thead><tr><th>日期</th><th>事由</th><th>分類</th><th>類型</th><th>收入</th><th>支出</th><th>經手</th><th>狀態</th><th>收據</th>' + (options.canComment ? '<th>質詢</th>' : '') + '</tr></thead><tbody>' +
            s.transactions.map(function (t) {
                var receipt = /^\/files\/[0-9a-f-]{36}$/.test(t.receiptUrl) ? '<a href="' + esc(t.receiptUrl) + '" target="_blank" rel="noopener">收據</a>' : '—';
                return '<tr><td>' + esc(t.date) + '</td><td>' + esc(t.item) + '</td><td>' + esc(t.budgetName || '—') + '</td><td>' + esc(KIND[t.kind] || t.kind) + '</td><td>' + (t.income ? money(t.income) : '') + '</td><td>' + (t.expense ? money(t.expense) : '') + '</td><td>' + esc(t.createdBy) + '</td><td>' + esc(STATUS[t.status] || t.status) + '</td><td>' + receipt + '</td>' +
                    (options.canComment ? '<td><button type="button" class="btn btn-secondary fr-ask" data-tx="' + esc(t.id) + '" style="padding:2px 10px;">質詢</button></td>' : '') + '</tr>' +
                    (byTx[t.id] ? '<tr><td colspan="' + (options.canComment ? 10 : 9) + '">' + thread(t.id) + '</td></tr>' : '');
            }).join('') + '</tbody></table></div>' +
            (options.canComment ? '<p><button type="button" class="btn btn-secondary fr-ask" data-tx="">對整份報告提出意見</button></p>' : '') + '</div>';
        return html;
    }
    window.FinanceReportView = { render: render, esc: esc, money: money };
})();
