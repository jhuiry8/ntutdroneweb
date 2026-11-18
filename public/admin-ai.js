// AI features in the admin dashboard: the built-in assistant panel, weekly
// reports, and AI buttons added to the post/page editors, finance, member
// import and regulation amendment screens. Every AI result is a suggestion the
// officer reviews; nothing is saved without a click.
(function () {
    'use strict';
    var formsPanel = document.getElementById('panel-forms');
    if (!formsPanel) return;
    var role = formsPanel.dataset.role || 'member';
    var can = {
        editCms: role === 'president' || role === 'cadre',
        viewCms: role !== 'member',
        finance: role === 'president' || role === 'finance',
        members: role === 'president' || role === 'finance',
        president: role === 'president'
    };
    var status = { enabled: false };
    var HISTORY_KEY = 'ntutDroneAiChat';

    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
    }
    // Escaped text with **bold**, `code` and line breaks; never raw HTML from the model.
    function richText(value) {
        return esc(value).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\n/g, '<br>');
    }
    function toast(message, isError) {
        if (typeof showToast === 'function') showToast(message, isError); else if (isError) alert(message);
    }
    async function api(path, method, body) {
        var response = await fetch(path, { method: method || 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
        var data = {};
        try { data = await response.json(); } catch (e) { /* empty */ }
        if (!response.ok) throw new Error(data.error || ('請求失敗（' + response.status + '）'));
        return data;
    }
    function busy(button, on, label) {
        if (!button) return;
        if (on) { button.dataset.label = button.textContent; button.textContent = label || 'AI 處理中…'; button.disabled = true; }
        else { button.textContent = button.dataset.label || button.textContent; button.disabled = false; }
    }
    function el(html) { var box = document.createElement('div'); box.innerHTML = html.trim(); return box.firstElementChild; }
    function refreshIcons() { if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons(); }

    var style = document.createElement('style');
    style.textContent = [
        '.ai-card { padding:16px 18px; border:1px solid rgba(167,139,250,.35); border-radius:12px; background:rgba(167,139,250,.06); margin-bottom:18px; }',
        '.ai-card h2, .ai-card summary { font-size:1.02rem; font-weight:600; }',
        '.ai-card summary { cursor:pointer; }',
        '.ai-muted { color:var(--text-muted); font-size:.86rem; line-height:1.6; }',
        '.ai-row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:10px; }',
        '.ai-chat-log { display:grid; gap:12px; max-height:60vh; overflow-y:auto; padding:4px; margin-bottom:12px; }',
        '.ai-msg { padding:12px 14px; border-radius:12px; line-height:1.7; max-width:92%; overflow-wrap:anywhere; }',
        '.ai-msg.user { justify-self:end; background:rgba(56,189,248,.14); border:1px solid rgba(56,189,248,.3); }',
        '.ai-msg.assistant { justify-self:start; background:rgba(255,255,255,.04); border:1px solid var(--border-glass); }',
        '.ai-msg small { display:block; color:var(--text-muted); margin-top:6px; font-size:.78rem; }',
        '.ai-action { margin-top:10px; padding:10px 12px; border:1px dashed rgba(167,139,250,.5); border-radius:10px; }',
        '.ai-chip { padding:4px 12px !important; font-size:.82rem !important; }',
        '.ai-concern-high { color:#f87171; } .ai-concern-medium { color:#fbbf24; } .ai-concern-low { color:#93c5fd; }',
        '.ai-report { padding:14px 16px; border:1px solid var(--border-glass); border-radius:12px; margin-bottom:12px; white-space:pre-wrap; line-height:1.7; font-size:.92rem; }',
        '.ai-fab { position:fixed; right:20px; bottom:20px; z-index:50; border-radius:999px !important; box-shadow:0 8px 24px rgba(0,0,0,.35); }',
        '@media (max-width: 720px) { .ai-fab { right:12px; bottom:12px; } .ai-msg { max-width:100%; } }'
    ].join('\n');
    document.head.appendChild(style);

    // ───────────── Navigation and assistant panel ─────────────

    var loaders = { forms: 'loadForms', members: 'loadMembers', finance: 'loadFinance', equipment: 'loadEquipment', notes: 'loadNotes', regulations: 'loadRegulations', settings: 'loadMyMember', users: 'loadUsers', ai: null };
    function openPanel(name) {
        if (typeof showPanel !== 'function' || !document.getElementById('panel-' + name)) return toast('您沒有此頁面的權限', true);
        showPanel(name);
        var loader = loaders[name] && window[loaders[name]];
        if (typeof loader === 'function') loader();
        if (name === 'ai') loadReports();
    }

    var nav = document.querySelector('.sidebar-nav');
    if (nav) {
        var group = el('<div class="nav-group"><p class="nav-group-label">AI 工具</p><button class="nav-item" type="button" onclick="showPanel(\'ai\')"><i data-lucide="sparkles"></i> AI 助理與週報</button></div>');
        group.querySelector('button').addEventListener('click', function () { loadReports(); });
        nav.insertBefore(group, nav.lastElementChild);
    }
    var main = document.querySelector('.main-content');
    var suggestions = ['這學期還有誰沒繳社費？', '目前有哪些設備借出去還沒還？', '幫我整理本週社務重點', '章程裡關於表決權的規定是什麼？'];
    if (!can.members) suggestions = can.viewCms ? ['最近有哪些表單？', '幫我整理本週社務重點', '章程裡關於表決權的規定是什麼？', '寫一篇社課活動紀錄的草稿'] : ['我填過哪些表單？', '社費要繳多少？', '章程裡關於表決權的規定是什麼？'];
    var panel = el('<div id="panel-ai" class="panel">' +
        '<div class="content-header"><div><h1>AI 助理</h1><p id="ai-status-line" class="ai-muted" style="margin-top:6px;">檢查 AI 設定中…</p></div><button type="button" class="btn btn-secondary" id="ai-chat-clear">清除對話</button></div>' +
        '<div class="ai-card"><div id="ai-chat-log" class="ai-chat-log" aria-live="polite"></div>' +
        '<div class="ai-row" id="ai-chips">' + suggestions.map(function (text) { return '<button type="button" class="btn btn-secondary ai-chip">' + esc(text) + '</button>'; }).join('') + '</div>' +
        '<form id="ai-chat-form" style="display:grid; grid-template-columns:1fr auto; gap:10px; margin-top:12px;"><textarea id="ai-chat-input" class="form-control" rows="2" maxlength="4000" placeholder="問 AI 助理社團的事，或請它幫忙寫公告、查資料（Enter 送出，Shift+Enter 換行）"></textarea><button class="btn btn-primary" type="submit" id="ai-chat-send">送出</button></form>' +
        '<p class="ai-muted" style="margin-top:8px;">AI 只能讀取你有權限看的資料，不會自己修改任何東西；它提出的動作都要你按下確認才會執行。AI 可能出錯，重要數字請以系統頁面為準。</p></div>' +
        (can.viewCms ? '<div class="ai-card"><div style="display:flex; justify-content:space-between; gap:12px; align-items:center; flex-wrap:wrap;"><h2>每週社務報告</h2>' + (can.president || can.finance ? '<button type="button" class="btn btn-secondary" id="ai-report-now">立即產生一份</button>' : '') + '</div><p id="ai-report-hint" class="ai-muted" style="margin:6px 0 12px;">系統每週一早上 9 點自動統計財務、社員、設備、表單與法規狀況，並由 AI 整理成摘要。</p><div id="ai-reports"><p class="ai-muted">載入中…</p></div></div>' : '') +
        '</div>');
    if (main) main.appendChild(panel);
    var fab = el('<button type="button" class="btn btn-primary ai-fab" title="開啟 AI 助理"><i data-lucide="sparkles"></i> AI</button>');
    fab.addEventListener('click', function () { openPanel('ai'); setTimeout(function () { var input = document.getElementById('ai-chat-input'); if (input) input.focus(); }, 50); });
    document.body.appendChild(fab);

    var toolLabels = { search_regulations: '法規條文', open_amendments: '修正案', my_forms: '我的表單', club_overview: '社團概況', recent_forms: '表單紀錄', list_posts: '官網文章', class_notes: '社課備忘錄', finance_summary: '財務總覽', search_transactions: '帳目', query_members: '社員名冊', query_equipment: '設備清冊', equipment_loans: '設備借用' };
    var history = [];
    try { history = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]') || []; } catch (e) { history = []; }
    function saveHistory() { try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-40))); } catch (e) { /* storage unavailable */ } }

    function actionHtml(action, index) {
        if (action.type === 'post_draft') return '<div class="ai-action"><strong>文章草稿：</strong>' + esc(action.title || '（未命名）') + '<div class="ai-row"><button type="button" class="btn btn-primary" data-action="' + index + '">在文章編輯器開啟</button></div></div>';
        if (action.type === 'finance_transaction') return '<div class="ai-action"><strong>建議帳目：</strong>' + esc(action.date + '「' + action.item + '」' + { income: '收入', expense: '支出', transfer: '轉帳' }[action.kind] + ' ' + Number(action.amount).toLocaleString('en-US') + ' 元（' + (action.account === 'postal' ? '郵局' : '現金') + '）') + '<div class="ai-row"><button type="button" class="btn btn-primary" data-action="' + index + '">送出給社長審核</button></div></div>';
        if (action.type === 'open_panel') return '<div class="ai-row"><button type="button" class="btn btn-secondary" data-action="' + index + '">前往相關頁面</button></div>';
        return '';
    }
    function renderChat() {
        var log = document.getElementById('ai-chat-log');
        if (!log) return;
        if (!history.length) { log.innerHTML = '<p class="ai-muted">可以問我社團的大小事，例如社費、設備、法規條文，或請我幫忙寫公告草稿。</p>'; return; }
        log.innerHTML = history.map(function (message, messageIndex) {
            if (message.role === 'user') return '<div class="ai-msg user">' + richText(message.content) + '</div>';
            if (message.pending) return '<div class="ai-msg assistant ai-muted">思考中…</div>';
            return '<div class="ai-msg assistant" data-message="' + messageIndex + '">' + richText(message.content) +
                (message.actions || []).map(actionHtml).join('') +
                (message.tools && message.tools.length ? '<small>查詢了：' + esc(message.tools.map(function (name) { return toolLabels[name] || name; }).join('、')) + '</small>' : '') + '</div>';
        }).join('');
        log.scrollTop = log.scrollHeight;
    }
    async function runAction(action, button) {
        if (action.type === 'open_panel') return openPanel(action.panel);
        if (action.type === 'post_draft') {
            if (typeof openPostForm !== 'function') return toast('您沒有編輯文章的權限', true);
            openPanel('posts'); openPostForm();
            fillEditor('post', action);
            return toast('已填入草稿，請檢查後再按「儲存文章」');
        }
        if (action.type === 'finance_transaction') {
            if (!confirm('確定送出這筆帳目？送出後仍需社長審核才會計入餘額。')) return;
            busy(button, true, '送出中…');
            try {
                await api('/api/finance/transactions', 'POST', { date: action.date, item: action.item, kind: action.kind, account: action.account, amount: action.amount, budgetId: '' });
                toast('已送出待審核帳目');
                button.textContent = '已送出'; button.disabled = true;
            } catch (error) { busy(button, false); toast(error.message, true); }
        }
    }
    document.addEventListener('click', function (event) {
        var button = event.target.closest('#ai-chat-log [data-action]');
        if (!button) return;
        var message = history[Number(button.closest('[data-message]').dataset.message)];
        var action = message && message.actions && message.actions[Number(button.dataset.action)];
        if (action) runAction(action, button);
    });
    async function sendChat(text) {
        text = String(text || '').trim();
        if (!text) return;
        if (!status.enabled) return toast('尚未設定 AI 金鑰，請社長在 Cloudflare 設定 GROQ_API_KEY 或 GEMINI_API_KEY', true);
        var send = document.getElementById('ai-chat-send');
        history.push({ role: 'user', content: text });
        var payload = history.filter(function (m) { return !m.pending && !m.error; }).map(function (m) { return { role: m.role, content: m.content }; });
        history.push({ role: 'assistant', pending: true });
        renderChat(); busy(send, true, '思考中…');
        try {
            var data = await api('/api/ai/assistant', 'POST', { messages: payload });
            history[history.length - 1] = { role: 'assistant', content: data.reply, actions: data.actions || [], tools: data.tools || [] };
        } catch (error) {
            history[history.length - 1] = { role: 'assistant', content: '⚠️ ' + error.message, error: true };
        } finally {
            busy(send, false); saveHistory(); renderChat();
        }
    }
    var chatForm = document.getElementById('ai-chat-form');
    var chatInput = document.getElementById('ai-chat-input');
    if (chatForm) chatForm.addEventListener('submit', function (event) { event.preventDefault(); var text = chatInput.value; chatInput.value = ''; sendChat(text); });
    if (chatInput) chatInput.addEventListener('keydown', function (event) { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); chatForm.requestSubmit(); } });
    document.querySelectorAll('#ai-chips button').forEach(function (button) { button.addEventListener('click', function () { sendChat(button.textContent); }); });
    var clearButton = document.getElementById('ai-chat-clear');
    if (clearButton) clearButton.addEventListener('click', function () { history = []; saveHistory(); renderChat(); });
    renderChat();

    // ───────────── Weekly reports ─────────────

    var reportsLoaded = false;
    async function loadReports(force) {
        var box = document.getElementById('ai-reports');
        if (!box || (reportsLoaded && !force)) return;
        try {
            var reports = await api('/api/ai/reports');
            reportsLoaded = true;
            box.innerHTML = reports.length ? reports.map(function (report, index) {
                var when = new Date(report.createdAt).toLocaleString('zh-TW', { hour12: false });
                var meta = (report.trigger === 'cron' ? '自動產生' : (report.createdBy || '') + ' 手動產生') + (report.webhook === 'sent' ? '・已發送到群組' : report.webhook && report.webhook !== 'skipped' ? '・群組發送失敗' : '') + (report.aiError ? '・AI 摘要失敗：' + report.aiError : '');
                return '<details' + (index === 0 ? ' open' : '') + ' style="margin-bottom:10px;"><summary style="cursor:pointer;">' + esc(when) + ' <small class="ai-muted">' + esc(meta) + '</small></summary><div class="ai-report">' + esc(report.text) + '</div><button type="button" class="btn btn-secondary ai-chip" data-copy="' + index + '">複製文字</button></details>';
            }).join('') : '<p class="ai-muted">還沒有報告。第一份會在下週一自動產生' + (can.president || can.finance ? '，也可以按上方按鈕立即產生' : '') + '。</p>';
            box.querySelectorAll('[data-copy]').forEach(function (button) {
                button.addEventListener('click', function () {
                    var text = reports[Number(button.dataset.copy)].text;
                    if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast('已複製，可以貼到社團群組'); }, function () { toast('複製失敗', true); });
                });
            });
        } catch (error) { box.innerHTML = '<p class="ai-muted">' + esc(error.message) + '</p>'; }
    }
    var reportNow = document.getElementById('ai-report-now');
    if (reportNow) reportNow.addEventListener('click', async function () {
        busy(reportNow, true, '產生中…');
        try { await api('/api/ai/reports', 'POST', {}); toast('已產生週報'); await loadReports(true); }
        catch (error) { toast(error.message, true); }
        finally { busy(reportNow, false); }
    });

    api('/api/ai/status').then(function (data) {
        status = data;
        var line = document.getElementById('ai-status-line');
        if (line) line.textContent = data.enabled ? 'AI 已啟用（' + data.provider + '・' + data.model + '）；每人每天可使用 ' + data.dailyLimit + ' 次（與表單 AI 共用）。' : '尚未啟用：請社長在 Cloudflare Workers 設定 GROQ_API_KEY（或 GEMINI_API_KEY）。週報的系統統計仍會照常產生。';
        var hint = document.getElementById('ai-report-hint');
        if (hint && data.webhook) hint.textContent += '已設定群組 Webhook，報告會自動發送到社團群組。';
    }).catch(function () { /* status line stays */ });

    // ───────────── Post and page editors ─────────────

    var undo = {};
    function field(prefix, name) { return document.getElementById(prefix + '-' + name); }
    function fillEditor(prefix, data) {
        undo[prefix] = { title: (field(prefix, 'title') || {}).value, summary: (field(prefix, 'summary') || {}).value, content: (field(prefix, 'content') || {}).value, slug: (field(prefix, 'slug') || {}).value, lang: (field(prefix, 'lang') || {}).value };
        if (data.title && field(prefix, 'title')) field(prefix, 'title').value = data.title;
        if (data.summary !== undefined && data.summary && field(prefix, 'summary')) field(prefix, 'summary').value = data.summary;
        if (data.content && field(prefix, 'content')) field(prefix, 'content').value = data.content;
        if (data.lang && field(prefix, 'lang')) field(prefix, 'lang').value = data.lang;
        if (data.slug && field(prefix, 'slug') && (!field(prefix, 'slug').value || data.forceSlug)) field(prefix, 'slug').value = data.slug;
        if (typeof updateLivePreview === 'function' && field(prefix, 'content')) updateLivePreview(prefix + '-content');
        var undoButton = document.getElementById('ai-undo-' + prefix);
        if (undoButton) undoButton.hidden = false;
    }
    function addWritingAssistant(prefix) {
        var view = document.getElementById(prefix + 's-form-view');
        var form = document.getElementById(prefix + '-form');
        if (!view || !form || !can.editCms) return;
        var noun = prefix === 'post' ? '文章' : '頁面';
        var card = el('<details class="ai-card" style="margin-bottom:20px;"><summary>✨ AI 寫作助手</summary>' +
            '<p class="ai-muted" style="margin-top:8px;">輸入活動重點（時間、地點、內容、心得），AI 會寫成' + noun + '草稿；也可以潤稿、產生摘要，或翻成另一種語言另存一篇。AI 只會用你提供的事實，缺的資訊會標「待補」。</p>' +
            '<textarea id="ai-notes-' + prefix + '" class="form-control" rows="3" maxlength="6000" placeholder="例如：11/16 社課在操場練習 FPV 穿越，20 人參加，教了基本油門控制，下次社課 11/23 教翻滾"></textarea>' +
            '<div class="ai-row"><button type="button" class="btn btn-primary" data-ai="draft">產生草稿</button><button type="button" class="btn btn-secondary" data-ai="polish">潤飾目前內容</button>' + (prefix === 'post' ? '<button type="button" class="btn btn-secondary" data-ai="summary">產生摘要與網址</button>' : '') + '<button type="button" class="btn btn-secondary" data-ai="translate">翻譯成另一語言（另存新' + noun + '）</button><button type="button" class="btn btn-secondary" id="ai-undo-' + prefix + '" hidden>復原上一步</button></div>' +
            '<p id="ai-notes-result-' + prefix + '" class="ai-muted" style="margin-top:8px;"></p></details>');
        view.insertBefore(card, form);
        card.querySelector('#ai-undo-' + prefix).addEventListener('click', function () {
            var previous = undo[prefix]; if (!previous) return;
            ['title', 'summary', 'content', 'slug', 'lang'].forEach(function (name) { if (field(prefix, name) && previous[name] !== undefined) field(prefix, name).value = previous[name]; });
            if (typeof updateLivePreview === 'function') updateLivePreview(prefix + '-content');
            this.hidden = true;
        });
        card.querySelectorAll('[data-ai]').forEach(function (button) {
            button.addEventListener('click', async function () {
                var action = button.dataset.ai;
                if (!status.enabled) return toast('尚未設定 AI 金鑰', true);
                var notes = document.getElementById('ai-notes-' + prefix).value;
                var current = { title: (field(prefix, 'title') || {}).value || '', summary: (field(prefix, 'summary') || {}).value || '', content: (field(prefix, 'content') || {}).value || '', lang: (field(prefix, 'lang') || {}).value || 'zh' };
                if (action === 'translate' && !confirm('翻譯後表單會換成另一語言的版本，儲存時會另存為新' + noun + '，原本的' + noun + '不受影響。繼續？')) return;
                busy(button, true);
                try {
                    var result = await api('/api/ai/content', 'POST', { action: action, notes: notes, title: current.title, summary: current.summary, content: current.content, lang: current.lang });
                    if (action === 'translate') {
                        var original = field(prefix, 'original-slug');
                        var slug = result.slug || '';
                        var currentSlug = (field(prefix, 'slug') || {}).value || '';
                        if (!slug || slug === currentSlug) slug = (currentSlug || 'article') + '-' + result.lang;
                        fillEditor(prefix, { title: result.title, summary: result.summary, content: result.content, lang: result.lang, slug: slug, forceSlug: true });
                        if (original) original.value = '';
                        var heading = document.getElementById(prefix + '-form-title');
                        if (heading) heading.textContent = '新增' + noun + '（' + (result.lang === 'en' ? '英文' : '中文') + '翻譯版）';
                    } else {
                        fillEditor(prefix, result);
                    }
                    document.getElementById('ai-notes-result-' + prefix).textContent = result.notes ? 'AI 備註：' + result.notes : '已填入，請檢查後再儲存。';
                } catch (error) { toast(error.message, true); }
                finally { busy(button, false); }
            });
        });
    }
    addWritingAssistant('post');
    addWritingAssistant('page');

    // ───────────── Finance review ─────────────

    var financeBody = document.getElementById('finance-transactions');
    if (financeBody && can.finance) {
        var tableBox = financeBody.closest('.table-container');
        var anchor = tableBox && tableBox.previousElementSibling && tableBox.previousElementSibling.tagName === 'H2' ? tableBox.previousElementSibling : tableBox;
        var financeCard = el('<div class="ai-card"><div style="display:flex; justify-content:space-between; gap:12px; align-items:center; flex-wrap:wrap;"><h2>AI 帳目檢查</h2><button type="button" class="btn btn-secondary" id="ai-finance-run">檢查帳目並建議預算分類</button></div><p class="ai-muted" style="margin-top:6px;">找出可能重複、送審太久或內容可疑的帳目，並為還沒分類的支出建議預算分類。建議要勾選並按「套用」才會寫入。</p><div id="ai-finance-result"></div></div>');
        anchor.parentNode.insertBefore(financeCard, anchor);
        var financeResult = financeCard.querySelector('#ai-finance-result');
        var findTransaction = function (id) { return ((window.financeState || (typeof financeState !== 'undefined' ? financeState : {})).transactions || []).find(function (item) { return item.id === id; }); };
        var budgetName = function (id) { var budgets = (typeof financeState !== 'undefined' ? financeState.budgets : []) || []; var budget = budgets.find(function (item) { return item.id === id; }); return budget ? budget.name : id; };
        var describe = function (id) { var item = findTransaction(id); return item ? item.date + '「' + item.item + '」' + Number(item.amount).toLocaleString('en-US') + ' 元' : id; };
        financeCard.querySelector('#ai-finance-run').addEventListener('click', async function () {
            var button = this;
            busy(button, true, '檢查中…');
            try {
                if (typeof loadFinance === 'function') await loadFinance();
                var review = await api('/api/ai/finance-review', 'POST', {});
                var html = review.summary ? '<p style="margin-top:12px;">' + richText(review.summary) + '</p>' : '';
                html += review.anomalies.length ? '<h3 style="font-size:.95rem; margin:12px 0 6px;">需要注意（' + review.anomalies.length + '）</h3><ul style="margin-left:18px; line-height:1.7;">' + review.anomalies.map(function (finding) {
                    return '<li>' + (finding.source === 'rule' ? '🔎 ' : '✨ ') + esc(finding.issue) + (finding.ids.length && finding.source === 'ai' ? '<br><small class="ai-muted">' + esc(finding.ids.slice(0, 5).map(describe).join('；')) + '</small>' : '') + '</li>';
                }).join('') + '</ul>' : '<p class="ai-muted" style="margin-top:12px;">沒有發現明顯異常。</p>';
                if (review.suggestions.length) {
                    html += '<h3 style="font-size:.95rem; margin:12px 0 6px;">預算分類建議（' + review.suggestions.length + '）</h3><div class="table-container"><table><thead><tr><th><input type="checkbox" id="ai-finance-all" checked aria-label="全選"></th><th>帳目</th><th>建議分類</th><th>理由</th></tr></thead><tbody>' + review.suggestions.map(function (item) {
                        return '<tr><td><input type="checkbox" class="ai-finance-pick" checked data-id="' + esc(item.id) + '" data-budget="' + esc(item.budgetId) + '"></td><td>' + esc(describe(item.id)) + '</td><td>' + esc(budgetName(item.budgetId)) + '</td><td>' + esc(item.reason) + '</td></tr>';
                    }).join('') + '</tbody></table></div><div class="ai-row"><button type="button" class="btn btn-primary" id="ai-finance-apply">套用勾選的分類</button></div>';
                }
                financeResult.innerHTML = html;
                var all = document.getElementById('ai-finance-all');
                if (all) all.addEventListener('change', function () { financeResult.querySelectorAll('.ai-finance-pick').forEach(function (box) { box.checked = all.checked; }); });
                var apply = document.getElementById('ai-finance-apply');
                if (apply) apply.addEventListener('click', async function () {
                    var picks = Array.prototype.slice.call(financeResult.querySelectorAll('.ai-finance-pick:checked'));
                    if (!picks.length) return toast('請至少勾選一筆', true);
                    busy(apply, true, '套用中…');
                    var done = 0, failed = 0;
                    for (var i = 0; i < picks.length; i++) {
                        try { await api('/api/finance/transactions/' + encodeURIComponent(picks[i].dataset.id) + '/budget', 'PATCH', { budgetId: picks[i].dataset.budget }); done++; picks[i].closest('tr').style.opacity = '.45'; picks[i].disabled = true; picks[i].checked = false; }
                        catch (error) { failed++; }
                    }
                    busy(apply, false);
                    toast('已套用 ' + done + ' 筆' + (failed ? '，' + failed + ' 筆失敗' : ''), failed > 0);
                    if (typeof loadFinance === 'function') loadFinance();
                });
            } catch (error) { toast(error.message, true); }
            finally { busy(button, false); }
        });
    }

    // ───────────── Member import ─────────────

    var previewButton = document.querySelector('#panel-members button[onclick="previewMemberImport()"]');
    if (previewButton && can.members) {
        var memberAi = el('<button type="button" class="btn btn-secondary" title="欄位雜亂、格式不一的名單也能整理">✨ AI 整理雜亂名單</button>');
        previewButton.insertAdjacentElement('afterend', memberAi);
        memberAi.addEventListener('click', async function () {
            if (!status.enabled) return toast('尚未設定 AI 金鑰', true);
            var textArea = document.getElementById('member-import-text');
            var fileInput = document.getElementById('member-import-file');
            var text = textArea.value.trim();
            if (!text && fileInput.files[0]) text = (await fileInput.files[0].text()).trim();
            if (!text) return toast('請選擇檔案或貼上名單', true);
            if (!confirm('名單會傳送給外部 AI 服務（' + (status.provider || 'AI') + '）整理，內容可能含姓名、學號、電話等個人資料。建議先刪掉不需要的欄位。確定傳送？')) return;
            busy(memberAi, true);
            try {
                var result = await api('/api/ai/member-import', 'POST', { text: text });
                if (!result.rows.length) return toast('AI 沒有辨識出社員資料', true);
                memberImportRows = result.rows;
                renderMemberImportPreview();
                var preview = document.getElementById('member-import-preview');
                if (preview) preview.insertAdjacentHTML('afterbegin', '<p class="ai-card" style="padding:10px 14px;">✨ AI 整理出 ' + result.rows.length + ' 筆，請逐欄檢查後再按「確認新增」。' + (result.notes ? '<br><span class="ai-muted">AI 備註：' + esc(result.notes) + '</span>' : '') + '</p>');
            } catch (error) { toast(error.message, true); }
            finally { busy(memberAi, false); }
        });
    }

    // ───────────── Regulation amendments ─────────────

    var requirementLabels = function (needs) {
        var list = [];
        if (needs.officersMeeting) list.push('幹部會議通過');
        if (needs.presidentApproval) list.push('社長核定');
        if (needs.assembly === 'major') list.push('社員大會（重大決議門檻）');
        else if (needs.assembly) list.push('社員大會');
        if (needs.school) list.push('送學校核備');
        if (needs.schoolAnnouncement) list.push('依學校公告登錄');
        return list.join(' → ');
    };
    function renderReview(review) {
        return '<div class="ai-card" style="margin-top:10px;">' +
            (review.summary ? '<p><strong>總結：</strong>' + richText(review.summary) + '</p>' : '') +
            (review.requirements ? '<p class="ai-muted" style="margin-top:6px;">系統判定的通過程序：' + esc(requirementLabels(review.requirements)) + '</p>' : '') +
            (review.changes.length ? '<p style="margin-top:8px;"><strong>改了什麼</strong></p><ul style="margin-left:18px; line-height:1.7;">' + review.changes.map(function (item) { return '<li>' + esc(item) + '</li>'; }).join('') + '</ul>' : '') +
            (review.concerns.length ? '<p style="margin-top:8px;"><strong>可能的問題</strong></p><ul style="margin-left:18px; line-height:1.7;">' + review.concerns.map(function (item) { return '<li class="ai-concern-' + esc(item.level) + '">' + esc({ high: '【重要】', medium: '【注意】', low: '【建議】' }[item.level] + item.text) + '</li>'; }).join('') + '</ul>' : '<p class="ai-muted" style="margin-top:8px;">AI 沒有發現明顯問題。</p>') +
            (review.suggestions.length ? '<p style="margin-top:8px;"><strong>文字修改建議</strong></p><ul style="margin-left:18px; line-height:1.7;">' + review.suggestions.map(function (item) { return '<li>' + esc(item) + '</li>'; }).join('') + '</ul>' : '') +
            '<p class="ai-muted" style="margin-top:8px;">AI 審閱僅供參考，正式判斷仍以法規監察委員會與會議決議為準。</p></div>';
    }
    async function requestReview(body, target, button) {
        if (!status.enabled) return toast('尚未設定 AI 金鑰', true);
        busy(button, true, 'AI 審閱中…');
        try { target.innerHTML = renderReview(await api('/api/ai/regulation-review', 'POST', body)); }
        catch (error) { toast(error.message, true); }
        finally { busy(button, false); }
    }
    var amendmentList = document.getElementById('amendment-list');
    if (amendmentList && can.viewCms) {
        var decorate = function () {
            amendmentList.querySelectorAll('div[id^="adopt-"]').forEach(function (slot) {
                if (slot.previousElementSibling && slot.previousElementSibling.classList.contains('ai-review-slot')) return;
                var id = slot.id.slice('adopt-'.length);
                var box = el('<div class="ai-review-slot"><div class="ai-row"><button type="button" class="btn btn-secondary ai-chip">✨ AI 審閱此修正案</button></div><div></div></div>');
                box.querySelector('button').addEventListener('click', function () { requestReview({ amendmentId: id }, box.lastElementChild, this); });
                slot.parentNode.insertBefore(box, slot);
            });
        };
        new MutationObserver(decorate).observe(amendmentList, { childList: true, subtree: false });
        decorate();
    }
    var amendmentForm = document.getElementById('amendment-form');
    if (amendmentForm) {
        var buttonRow = amendmentForm.querySelector('button[type="submit"]').parentNode;
        var draftCheck = el('<button type="button" class="btn btn-secondary">✨ AI 檢查草稿</button>');
        var draftResult = document.createElement('div');
        buttonRow.appendChild(draftCheck);
        buttonRow.insertAdjacentElement('afterend', draftResult);
        draftCheck.addEventListener('click', function () {
            var value = function (id) { var input = document.getElementById(id); return input ? input.value : ''; };
            var needs = document.getElementById('amendment-needs-assembly');
            requestReview({ action: value('amendment-action'), regulationId: value('amendment-regulation'), kind: value('amendment-kind'), title: value('amendment-title'), content: value('amendment-content'), reason: value('amendment-reason'), needsAssembly: Boolean(needs && needs.checked) }, draftResult, draftCheck);
        });
    }

    refreshIcons();
})();
