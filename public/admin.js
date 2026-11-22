// Dashboard (/admin/dashboard) behaviour: CMS editors, finance, members, equipment, notes, users and regulations.
// ADMIN holds what the server decided for this account (see renderAdminDashboard in src/templates/admin.js).
const ADMIN = JSON.parse(document.body?.dataset.admin || '{}');

if (typeof lucide !== 'undefined' && lucide.createIcons) { lucide.createIcons(); }

// showPanel, openPostForm, openPageForm, logout are defined in <head> script


function showToast(text, isError = false) {
    const toast = document.getElementById('toast');
    if (isError) {
        toast.style.borderColor = '#ef4444';
        toast.innerHTML = '<i data-lucide="alert-circle" style="color:#ef4444; width:20px; height:20px;"></i> <span id="toast-text"></span>';
    } else {
        toast.style.borderColor = 'var(--color-cyan)';
        toast.innerHTML = '<i data-lucide="check-circle" style="color:var(--color-cyan); width:20px; height:20px;"></i> <span id="toast-text"></span>';
    }
    if (typeof lucide !== 'undefined' && lucide.createIcons) { lucide.createIcons(); }
    
    toast.querySelector('span').textContent = text;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

function insertCodeInlineMD(targetId) {
    var tick = String.fromCharCode(96);
    insertMD(targetId, tick, tick, '程式碼');
}

function insertCodeBlockMD(targetId) {
    var ticks = String.fromCharCode(96) + String.fromCharCode(96) + String.fromCharCode(96);
    var nl = String.fromCharCode(10);
    insertMD(targetId, nl + ticks + 'javascript' + nl, nl + ticks + nl, '// 在此寫入程式碼');
}

function insertMD(targetId, prefix, suffix, defaultText) {
    var textarea = document.getElementById(targetId);
    if (!textarea) return;
    textarea.focus();

    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var selected = textarea.value.substring(start, end);
    var textToWrap = selected || defaultText;

    var replacement = prefix + textToWrap + suffix;
    textarea.value = textarea.value.substring(0, start) + replacement + textarea.value.substring(end);
    
    var newStart = start + prefix.length;
    var newEnd = newStart + textToWrap.length;
    textarea.setSelectionRange(newStart, newEnd);
    
    updateLivePreview(targetId);
}

function insertLinkMD(targetId) {
    var url = prompt('請輸入超連結網址 (例如 https://example.com):', 'https://');
    if (!url) return;
    var text = prompt('請輸入顯示的連結文字:', '點此造訪網址');
    insertMD(targetId, '[' + (text || '連結文字') + '](' + url + ')', '', '');
}

function insertImageMD(targetId) {
    var url = prompt('請輸入圖片網址 (https:// 開頭):', 'https://');
    if (!url) return;
    var alt = prompt('請輸入圖片說明文字 (Alt text):', '圖片說明');
    insertMD(targetId, '![' + (alt || '圖片說明') + '](' + url + ')', '', '');
}

function insertTableMD(targetId) {
    var nl = String.fromCharCode(10);
    var tableTemplate = nl + '| 欄位標題 1 | 欄位標題 2 | 欄位標題 3 |' + nl + '| --- | --- | --- |' + nl + '| 內容資料 A | 內容資料 B | 內容資料 C |' + nl + '| 內容資料 D | 內容資料 E | 內容資料 F |' + nl;
    insertMD(targetId, tableTemplate, '', '');
}

function togglePreview(targetId) {
    var pane = document.getElementById('preview-' + targetId);
    var container = document.getElementById('container-' + targetId);
    var btn = container ? container.querySelector('.tb-preview-btn') : null;

    if (!pane) return;
    if (pane.style.display === 'none' || !pane.style.display) {
        pane.style.display = 'flex';
        if (btn) btn.classList.add('active');
        updateLivePreview(targetId);
    } else {
        pane.style.display = 'none';
        if (btn) btn.classList.remove('active');
    }
}

const previewTimers = new Map();
function updateLivePreview(targetId) {
    const textarea = document.getElementById(targetId);
    const body = document.getElementById('preview-body-' + targetId);
    if (!textarea || !body) return;
    clearTimeout(previewTimers.get(targetId));
    const version = String(Number(body.dataset.version || 0) + 1);
    body.dataset.version = version;
    const content = textarea.value || '*(尚未輸入任何內容)*';
    previewTimers.set(targetId, setTimeout(async () => {
        try {
            const response = await fetch('/api/preview', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            });
            if (!response.ok) throw new Error('Preview unavailable');
            const data = await response.json();
            if (body.dataset.version === version) body.innerHTML = data.html;
        } catch {
            if (body.dataset.version === version) body.textContent = content;
        }
    }, 200));
}

function openPostForm() {
    var listView = document.getElementById('posts-list-view');
    var formView = document.getElementById('posts-form-view');
    if (listView) listView.style.display = 'none';
    if (formView) formView.style.display = 'block';
    var title = document.getElementById('post-form-title');
    if (title) title.innerText = '新增文章';
    var form = document.getElementById('post-form');
    if (form) form.reset();
    var origSlug = document.getElementById('post-original-slug');
    if (origSlug) origSlug.value = '';
    var slug = document.getElementById('post-slug');
    if (slug) slug.disabled = false;
    updateLivePreview('post-content');
}

function closePostForm() {
    const listView = document.getElementById('posts-list-view'), formView = document.getElementById('posts-form-view');
    if (listView) listView.style.display = 'block';
    if (formView) formView.style.display = 'none';
}

async function savePost(e) {
    e.preventDefault();
    const title = document.getElementById('post-title').value;
    const lang = document.getElementById('post-lang').value;
    const originalSlug = document.getElementById('post-original-slug').value;
    const slugInput = document.getElementById('post-slug').value.trim();
    const slug = slugInput || originalSlug;
    const summary = document.getElementById('post-summary').value;
    const content = document.getElementById('post-content').value;

    if (!slug || !(new RegExp('^[a-zA-Z0-9_-]+$').test(slug))) {
        showToast('網址代稱只能包含英文、數字與底線或橫槓！', true);
        return;
    }

    try {
        const res = await fetch('/api/posts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, lang, slug, summary, content, originalSlug })
        });
        
        const data = await res.json();
        if (res.ok) {
            showToast(originalSlug ? '文章更新成功！' : '文章發佈成功！');
            setTimeout(() => location.reload(), 1000);
        } else {
            showToast(data.error || '儲存失敗', true);
        }
    } catch (err) {
        showToast('與伺服器連線失敗', true);
    }
}

async function editPost(slug) {
    openPostForm();
    document.getElementById('post-form-title').innerText = '編輯文章';
    document.getElementById('post-slug').value = slug;
    document.getElementById('post-slug').disabled = true;
    document.getElementById('post-original-slug').value = slug;
    
    try {
        const res = await fetch('/api/posts/' + slug);
        if (!res.ok) throw new Error();
        const post = await res.json();
        
        document.getElementById('post-title').value = post.title || '';
        document.getElementById('post-lang').value = post.lang || 'zh';
        document.getElementById('post-summary').value = post.summary || '';
        document.getElementById('post-content').value = post.content || '';
        updateLivePreview('post-content');
    } catch (err) {
        showToast('載入文章詳細內容時發生警告，請手動確認', true);
    }
}

async function deletePost(slug) {
    if (!confirm('確定要刪除此文章嗎？刪除後無法恢復。')) return;
    try {
        const res = await fetch('/api/posts/' + slug, { method: 'DELETE' });
        if (res.ok) {
            showToast('文章已刪除');
            document.getElementById('row-post-' + slug).remove();
        } else {
            showToast('刪除失敗', true);
        }
    } catch (err) {
        showToast('網路連線失敗', true);
    }
}

function openPageForm() {
    var listView = document.getElementById('pages-list-view');
    var formView = document.getElementById('pages-form-view');
    if (listView) listView.style.display = 'none';
    if (formView) formView.style.display = 'block';
    var title = document.getElementById('page-form-title');
    if (title) title.innerText = '新增頁面';
    var form = document.getElementById('page-form');
    if (form) form.reset();
    var origSlug = document.getElementById('page-original-slug');
    if (origSlug) origSlug.value = '';
    var slug = document.getElementById('page-slug');
    if (slug) slug.disabled = false;
    updateLivePreview('page-content');
}

function closePageForm() {
    const listView = document.getElementById('pages-list-view'), formView = document.getElementById('pages-form-view');
    if (listView) listView.style.display = 'block';
    if (formView) formView.style.display = 'none';
}

async function savePage(e) {
    e.preventDefault();
    const title = document.getElementById('page-title').value;
    const lang = document.getElementById('page-lang').value;
    const originalSlug = document.getElementById('page-original-slug').value;
    const slugInput = document.getElementById('page-slug').value.trim();
    const slug = slugInput || originalSlug;
    const content = document.getElementById('page-content').value;

    if (!slug || !(new RegExp('^[a-zA-Z0-9_-]+$').test(slug))) {
        showToast('網址路徑只能包含英文、數字與底線或橫槓！', true);
        return;
    }

    try {
        const res = await fetch('/api/pages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, lang, slug, content, originalSlug })
        });
        
        const data = await res.json();
        if (res.ok) {
            showToast(originalSlug ? '頁面更新成功！' : '頁面建立成功！');
            setTimeout(() => location.reload(), 1000);
        } else {
            showToast(data.error || '儲存失敗', true);
        }
    } catch (err) {
        showToast('與伺服器連線失敗', true);
    }
}

async function editPage(slug) {
    openPageForm();
    document.getElementById('page-form-title').innerText = '編輯頁面';
    document.getElementById('page-slug').value = slug;
    document.getElementById('page-slug').disabled = true;
    document.getElementById('page-original-slug').value = slug;
    
    try {
        const res = await fetch('/api/pages/' + slug);
        if (!res.ok) throw new Error();
        const page = await res.json();
        
        document.getElementById('page-title').value = page.title || '';
        document.getElementById('page-lang').value = page.lang || 'zh';
        document.getElementById('page-content').value = page.content || '';
        updateLivePreview('page-content');
    } catch (err) {
        showToast('載入頁面詳細內容時發生警告，請手動確認', true);
    }
}

async function deletePage(slug) {
    if (!confirm('確定要刪除此自訂頁面嗎？')) return;
    try {
        const res = await fetch('/api/pages/' + slug, { method: 'DELETE' });
        if (res.ok) {
            showToast('頁面已刪除');
            document.getElementById('row-page-' + slug).remove();
        } else {
            showToast('刪除失敗', true);
        }
    } catch (err) {
        showToast('網路連線失敗', true);
    }
}

async function changePassword(e) {
    e.preventDefault();
    const oldPassword = document.getElementById('old-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPass = document.getElementById('new-password-confirm').value;

    if (newPassword !== confirmPass) {
        showToast('兩次輸入的新密碼不一致！', true);
        return;
    }
    if (newPassword.length < 8) {
        showToast('新密碼必須至少為 8 個字元！', true);
        return;
    }

    try {
        const res = await fetch('/api/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldPassword, newPassword })
        });
        
        const data = await res.json();
        if (res.ok) {
            showToast('密碼變更成功！請重新登入。');
            setTimeout(() => logout(), 1500);
        } else {
            showToast(data.error || '變更密碼失敗', true);
        }
    } catch (err) {
        showToast('伺服器連線失敗', true);
    }
}

let pendingAccountMember = '';
async function loadUsers() {
    const [res, membersRes, orgRes] = await Promise.all([fetch('/api/users'), fetch('/api/members'), fetch('/api/org/overview').catch(() => null)]);
    if (!res.ok) return showToast('無法載入帳號', true);
    const users = await res.json();
    // With the OrgStore, accounts have positions (職位) and individual permissions; the old four roles are only the fallback.
    const positionList = orgRes && orgRes.ok ? ((await orgRes.json()).positions || []).filter(item => item.id !== 'member') : null;
    const positionNames = Object.fromEntries((positionList || []).map(item => [item.id, item.name]));
    const roleSelect = document.getElementById('account-role');
    if (positionList && roleSelect && roleSelect.dataset.mode !== 'positions') {
        roleSelect.dataset.mode = 'positions';
        roleSelect.replaceChildren(new Option('社員（無職位）', ''), ...positionList.map(item => new Option(item.name + '（' + item.group + '）', item.id)));
        const header = document.getElementById('users-role-header'); if (header) header.textContent = '職位';
    }
    const members = membersRes.ok ? await membersRes.json() : [];
    const memberLabel = item => (item.name || '姓名待查') + '（' + (item.studentId || '無學號') + '）';
    const memberOptions = (select, current, owner) => {
        select.add(new Option(owner ? '不綁定' : '不綁定社員（之後可再綁定）', ''));
        for (const item of members) {
            if (item.account && item.account !== owner) continue;
            select.add(new Option(memberLabel(item) + '・' + item.status.levelLabel, item.id));
        }
        select.value = current || '';
    };
    const createSelect = document.getElementById('account-member');
    if (createSelect) { createSelect.replaceChildren(); memberOptions(createSelect, pendingAccountMember, ''); pendingAccountMember = ''; }
    const tbody = document.getElementById('users-list');
    tbody.replaceChildren();
    for (const user of users) {
        const tr = document.createElement('tr');
        const bound = user.member ? memberLabel(user.member) + '・' + user.member.status.levelLabel + '・' + user.member.status.feeLabel : '未綁定';
        const positionText = (user.positions || []).map(id => positionNames[id] || id).join('、') || '社員';
        for (const value of [user.username, positionList ? positionText : {president:'社長',finance:'財務',cadre:'一般幹部',member:'社員'}[user.role], user.active ? '啟用' : '停用', bound]) {
            const td = document.createElement('td'); td.textContent = value; tr.appendChild(td);
        }
        const td = document.createElement('td');
        const binding = document.createElement('select'); binding.className = 'form-control'; binding.setAttribute('aria-label', user.username + ' 綁定社員');
        memberOptions(binding, user.memberId, user.username);
        const bind = document.createElement('button'); bind.className = 'btn btn-secondary'; bind.textContent = '儲存綁定';
        bind.onclick = () => updateUser(user.username, { memberId: binding.value });
        const line = () => { const div = document.createElement('div'); div.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-bottom:6px;'; return div; };
        const bindLine = line(); bindLine.append(binding, bind); binding.style.flex = '1 1 200px';
        td.append(bindLine);
        const role = document.createElement('select'); role.className = 'form-control';
        for (const [value, label] of Object.entries({president:'社長',finance:'財務',cadre:'一般幹部',member:'社員'})) {
            const option = new Option(label, value); role.add(option);
        }
        role.value = user.role;
        const save = document.createElement('button'); save.className = 'btn btn-secondary'; save.textContent = '儲存角色';
        save.onclick = () => updateUser(user.username, { role: role.value });
        const toggle = document.createElement('button'); toggle.className = 'btn btn-secondary'; toggle.textContent = user.active ? '停用' : '啟用';
        toggle.onclick = () => { if (!user.active || confirm('確定停用帳號 ' + user.username + '？停用後對方會立即被登出。')) updateUser(user.username, { active: !user.active }); };
        const reset = document.createElement('button'); reset.className = 'btn btn-secondary'; reset.textContent = '重設密碼';
        reset.onclick = () => { const password = prompt('輸入新密碼（至少 8 位）'); if (password) updateUser(user.username, { password }); };
        // Positions are edited in the cards below the table; the old role dropdown would overwrite them.
        const roleLine = line(); role.style.flex = '1 1 120px';
        if (positionList) roleLine.append(toggle, reset); else roleLine.append(role, save, toggle, reset);
        td.append(roleLine); tr.appendChild(td); tbody.appendChild(tr);
    }
}
async function updateUser(username, changes) {
    const res = await fetch('/api/users', { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ username, ...changes }) });
    const data = await res.json(); showToast(res.ok ? '帳號已更新' : data.error, !res.ok);
    if (res.ok) loadUsers();
}
async function createUser(event) {
    event.preventDefault();
    const roleSelect = document.getElementById('account-role');
    const body = { username: document.getElementById('account-username').value, password: document.getElementById('account-password').value, memberId: document.getElementById('account-member')?.value || '' };
    if (roleSelect.dataset.mode === 'positions') body.positions = roleSelect.value ? [roleSelect.value] : [];
    else body.role = roleSelect.value;
    const res = await fetch('/api/users', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const data = await res.json(); showToast(res.ok ? '帳號已新增' : data.error, !res.ok);
    if (res.ok) { event.target.reset(); loadUsers(); }
}

const financeCanReview = ADMIN.canApprove ?? ADMIN.isPresident;
let financeState = { transactions: [], budgets: [], totals: {} };
const money = value => 'NT$ ' + new Intl.NumberFormat('zh-TW').format(Number(value || 0));
const escapeText = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);

function setFinanceDate() {
    const date = document.getElementById('finance-date');
    if (date && !date.value) date.value = new Date().toISOString().slice(0, 10);
}
function financeStatus(item) {
    if (item.status === 'approved') return '<span style="color:#34d399">已核准</span>';
    if (item.status === 'rejected') return '<span style="color:#f87171">已退回</span>';
    return '<span style="color:#fbbf24">待審核</span>';
}
function renderFinance() {
    const totals = financeState.totals || {};
    const summary = document.getElementById('finance-summary');
    if (summary) summary.innerHTML = '<div class="finance-card"><span>現金餘額</span><strong>' + money(totals.cashBalance) + '</strong></div><div class="finance-card"><span>郵局餘額</span><strong>' + money(totals.postalBalance) + '</strong></div><div class="finance-card"><span>核准總餘額</span><strong>' + money((totals.cashBalance || 0) + (totals.postalBalance || 0)) + '</strong></div><div class="finance-card"><span>待審核帳目</span><strong>' + (totals.pendingCount || 0) + ' 筆</strong></div>';
    const budget = document.getElementById('finance-budget');
    if (budget) budget.innerHTML = '<option value="">不歸入預算分類</option>' + financeState.budgets.map(item => '<option value="' + escapeText(item.id) + '">' + escapeText(item.name) + '（剩餘 ' + money(item.planned - item.spent) + '）</option>').join('');
    const budgetRows = document.getElementById('finance-budgets');
    if (budgetRows) budgetRows.innerHTML = financeState.budgets.map(item => budgetRow(item)).join('') || '<p style="color:var(--text-muted);">尚無預算分類。</p>';
    const body = document.getElementById('finance-transactions');
    if (body) body.innerHTML = financeState.transactions.map(item => '<tr><td>' + escapeText(item.date) + '</td><td>' + escapeText(item.item) + (item.reviewNote ? '<br><small style="color:#f87171">退回：' + escapeText(item.reviewNote) + '</small>' : '') + '</td><td>' + (item.income ? money(item.income) : '') + '</td><td>' + (item.expense ? money(item.expense) : '') + '</td><td>' + money(item.cashDelta) + '</td><td>' + money(item.postalDelta) + '</td><td>' + financeStatus(item) + '</td><td>' + (financeCanReview && item.status === 'pending' ? '<button class="btn btn-primary" data-id="' + escapeText(item.id) + '" onclick="reviewFinance(this.dataset.id, &quot;approved&quot;)">核准</button> <button class="btn btn-danger" data-id="' + escapeText(item.id) + '" onclick="reviewFinance(this.dataset.id, &quot;rejected&quot;)">退回</button>' : '') + (financeCanReview && item.status === 'rejected' ? '<button class="btn btn-danger" data-id="' + escapeText(item.id) + '" onclick="deleteRejectedFinance(this.dataset.id)">刪除</button>' : '') + '</td></tr>').join('') || '<tr><td colspan="8" style="text-align:center; color:var(--text-muted)">尚無帳目。</td></tr>';
}
function budgetRow(item = {}) { return '<div class="responsive-form-grid finance-budget-row" data-id="' + escapeText(item.id || '') + '" style="display:grid; grid-template-columns:1fr 150px auto; gap:8px;"><input class="form-control budget-name" placeholder="分類，例如：器材" value="' + escapeText(item.name || '') + '"><input class="form-control budget-planned" type="number" min="0" step="1" placeholder="預算" value="' + (Number.isSafeInteger(item.planned) ? item.planned : '') + '"><button type="button" class="btn btn-danger" onclick="this.parentElement.remove()">刪除</button></div>'; }
function addBudgetRow() { const container = document.getElementById('finance-budgets'); if (container) { if (container.querySelector('p')) container.innerHTML = ''; container.insertAdjacentHTML('beforeend', budgetRow()); } }
async function loadFinance() {
    setFinanceDate();
    const res = await fetch('/api/finance/summary');
    if (!res.ok) return showToast('無法載入財務資料', true);
    financeState = await res.json(); renderFinance();
}
async function saveFinanceTransaction(event) {
    event.preventDefault();
    const body = { date: document.getElementById('finance-date').value, item: document.getElementById('finance-item').value, kind: document.getElementById('finance-kind').value, account: document.getElementById('finance-account').value, amount: Number(document.getElementById('finance-amount').value), budgetId: document.getElementById('finance-budget').value };
    const res = await fetch('/api/finance/transactions', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    const data = await res.json(); showToast(res.ok ? '已送交審核' : data.error, !res.ok);
    if (res.ok) { event.target.reset(); setFinanceDate(); loadFinance(); }
}
async function reviewFinance(id, status) {
    const note = status === 'rejected' ? prompt('請輸入退回原因') : '';
    if (status === 'rejected' && !note) return;
    const res = await fetch('/api/finance/transactions/' + encodeURIComponent(id) + '/review', { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status, note}) });
    const data = await res.json(); showToast(res.ok ? (status === 'approved' ? '已核准帳目' : '已退回帳目') : data.error, !res.ok); if (res.ok) loadFinance();
}
async function deleteRejectedFinance(id) {
    if (!confirm('確定永久刪除這筆已退回帳目？')) return;
    const res = await fetch('/api/finance/transactions/' + encodeURIComponent(id), {method:'DELETE'});
    const data = await res.json(); showToast(res.ok ? '已刪除退回帳目' : data.error, !res.ok); if (res.ok) loadFinance();
}
async function saveBudgets() {
    const budgets = [...document.querySelectorAll('.finance-budget-row')].map(row => ({id:row.dataset.id, name:row.querySelector('.budget-name').value, planned:Number(row.querySelector('.budget-planned').value)})).filter(item => item.name || item.planned);
    const res = await fetch('/api/finance/budgets', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({budgets})}); const data = await res.json(); showToast(res.ok ? '預算已儲存' : data.error, !res.ok); if (res.ok) loadFinance();
}
function parseSheet(text) {
    const delimiter = text.includes('\t') ? '\t' : ',';
    const rows = []; let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) { const char = text[i], next = text[i + 1]; if (char === '"' && quoted && next === '"') { cell += '"'; i++; } else if (char === '"') quoted = !quoted; else if (char === delimiter && !quoted) { row.push(cell.trim()); cell = ''; } else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && next === '\n') i++; row.push(cell.trim()); if (row.some(value => value)) rows.push(row); row = []; cell = ''; } else cell += char; } if (cell || row.length) { row.push(cell.trim()); rows.push(row); } return rows;
}
async function sourceText(fileId, textId) { const text = document.getElementById(textId).value.trim(); if (text) return text; const file = document.getElementById(fileId).files[0]; return file ? await file.text() : ''; }
async function importFinanceLedger() {
    const text = await sourceText('finance-import-file', 'finance-import-text'); if (!text) return showToast('請選擇檔案或貼上資料', true);
    const rows = parseSheet(text); const header = rows.shift().map(value => value.replace(/^﻿/, '').trim()); const index = name => header.indexOf(name);
    const required = ['日期','事宜','收入','支出','現金餘額','郵局餘額']; if (required.some(name => index(name) < 0)) return showToast('欄位需包含：' + required.join('、'), true);
    const data = rows.filter(row => row[index('日期')]).map(row => ({date:row[index('日期')], item:row[index('事宜')], income:row[index('收入')], expense:row[index('支出')], cashBalance:row[index('現金餘額')], postalBalance:row[index('郵局餘額')] }));
    const res = await fetch('/api/finance/import', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows:data})}); const result = await res.json(); showToast(res.ok ? '已匯入 ' + result.imported + ' 筆待審核帳目' : result.error, !res.ok); if (res.ok) loadFinance();
}
async function importBudgets() { const text = await sourceText('budget-import-file', 'budget-import-text'); if (!text) return showToast('請選擇檔案或貼上預算', true); const rows = parseSheet(text); const header = rows[0].map(value => value.replace(/^﻿/, '').trim()); const hasHeader = header.includes('分類') && header.includes('預算'); if (hasHeader) rows.shift(); const budgets = rows.filter(row => row[0]).map(row => ({name:row[0], planned:Number(String(row[1] || '').replace(/[,s]/g,''))})); const res = await fetch('/api/finance/budgets',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({budgets})}); const data=await res.json(); showToast(res.ok?'預算已匯入':data.error,!res.ok); if(res.ok)loadFinance(); }
function exportFinanceCsv() { const header = ['日期','事宜','收入','支出','現金變動','郵局變動','狀態','建立者','審核者']; const quote = value => '"' + String(value ?? '').replace(/"/g,'""') + '"'; const rows = financeState.transactions.map(item => [item.date,item.item,item.income,item.expense,item.cashDelta,item.postalDelta,item.status,item.createdBy,item.reviewedBy]); const blob = new Blob(['\uFEFF' + [header,...rows].map(row=>row.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}); const link=document.createElement('a'); link.href=URL.createObjectURL(blob); link.download='ntut-drone-finance.csv'; link.click(); URL.revokeObjectURL(link.href); }

let equipmentCache = [];
const equipmentStatusLabel = {storage:'庫存保管',in_use:'使用中',repair:'維修中',retired:'已除列'};
const equipmentConditionLabel = {good:'狀況良好',fair:'尚可',poor:'待維修'};
async function loadEquipment() {
    const query=document.getElementById('equipment-search')?.value||'';
    const response=await fetch('/api/equipment?q='+encodeURIComponent(query));
    const data=await response.json();
    if(!response.ok)return showToast(data.error||'無法載入設備資料',true);
    equipmentCache=data;
    const body=document.getElementById('equipment-list');
    body.innerHTML=data.map(item=>'<tr><td><input class="equipment-select" type="checkbox" aria-label="選取 '+escapeText(item.assetNo)+'" data-id="'+escapeText(item.id)+'" onchange="updateEquipmentSelectedCount()"></td><td><strong>'+escapeText(item.assetNo)+'</strong></td><td>'+escapeText(item.assetName)+'<br><small>'+escapeText(item.category||'其他')+(item.serialNo?' · 序號 '+escapeText(item.serialNo):'')+'</small></td><td>'+escapeText(equipmentStatusLabel[item.status]||item.status)+'<br><small>'+escapeText(equipmentConditionLabel[item.condition]||item.condition)+'</small>'+equipmentLoanNote(item)+'</td><td>'+escapeText(item.location||'—')+'<br><small>'+escapeText(item.custodian||'未指定保管人')+'</small></td><td>'+escapeText(item.purchaseDate||'—')+'<br><small>'+(item.purchasePrice?'NT$ '+new Intl.NumberFormat('zh-TW').format(item.purchasePrice):'未記錄金額')+'</small></td><td><button type="button" class="btn btn-secondary" data-id="'+escapeText(item.id)+'" onclick="editEquipment(this.dataset.id)">編輯</button> <button type="button" class="btn btn-secondary" data-id="'+escapeText(item.id)+'" onclick="showEquipmentHistory(this.dataset.id)">借用紀錄</button></td></tr>').join('')||'<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">查無設備資料。</td></tr>';
    const totalValue=equipmentCache.reduce((sum,item)=>sum+(Number(item.purchasePrice)||0),0);
    const summary=document.getElementById('equipment-summary');
    summary.innerHTML='<div class="finance-card"><span>列管設備</span><strong>'+equipmentCache.length+' 件</strong></div><div class="finance-card"><span>使用中</span><strong>'+equipmentCache.filter(item=>item.status==='in_use').length+' 件</strong></div><div class="finance-card"><span>維修中</span><strong>'+equipmentCache.filter(item=>item.status==='repair'||item.condition==='poor').length+' 件</strong></div><div class="finance-card"><span>購入金額合計（目前結果）</span><strong>NT$ '+new Intl.NumberFormat('zh-TW').format(totalValue)+'</strong></div>';
    updateEquipmentSelectedCount();
    renderLoanPanels();
}
// Who has an asset right now (set when its loan slip is approved, cleared when it is returned).
function equipmentLoanNote(item) {
    const loan=item.currentLoan;
    if(!loan)return '';
    const late=loan.endDate&&loan.endDate<new Date().toISOString().slice(0,10);
    return '<br><small'+(late?' style="color:#f87171"':'')+'>借用人 '+escapeText(loan.borrower)+' · 借據 '+escapeText(loan.formNumber||'—')+' · 應還 '+escapeText(loan.endDate||'—')+(late?'（逾期）':'')+'</small>';
}
// The overdue list and the borrowing history are drawn into containers created here, above and below the register table.
function loanPanel(id,before) {
    let box=document.getElementById(id);
    if(!box){box=document.createElement('div');box.id=id;box.style.margin='0 0 22px';const table=document.getElementById('equipment-list').closest('.table-container');before?table.before(box):table.after(box);}
    return box;
}
async function renderLoanPanels() {
    const box=loanPanel('equipment-loans',true);
    try{
        const response=await fetch('/api/loans');
        const loans=await response.json();
        if(!response.ok)throw new Error(loans.error||'無法載入借用中清單');
        const overdue=loans.filter(loan=>loan.overdue);
        if(!loans.length){box.innerHTML='';return;}
        const row=loan=>'<tr><td>'+escapeText(loan.number)+'</td><td>'+escapeText(loan.borrower)+(loan.phone?'<br><small>'+escapeText(loan.phone)+'</small>':'')+'</td><td>'+loan.items.map(escapeText).join('、')+'</td><td>'+escapeText(loan.endDate)+(loan.overdue?'<br><small style="color:#f87171">逾期 '+loan.daysOverdue+' 天</small>':'')+'</td></tr>';
        box.innerHTML='<h3 style="font-size:1.05rem;margin:0 0 8px;">'+(overdue.length?'⚠️ 逾期未還 '+overdue.length+' 張　':'')+'借用中 '+loans.length+' 張</h3><div class="table-container"><table><thead><tr><th>借據</th><th>借用人</th><th>設備</th><th>應還日</th></tr></thead><tbody>'+loans.slice().sort((a,b)=>Number(b.overdue)-Number(a.overdue)).map(row).join('')+'</tbody></table></div><p style="color:var(--text-muted);font-size:.85rem;margin:6px 0 0;">在「表單申請」的借據紀錄按「辦理歸還」即可歸還並把設備改回庫存。</p>';
    }catch(error){box.innerHTML='';}
}
async function showEquipmentHistory(id) {
    const box=loanPanel('equipment-history',false);
    const response=await fetch('/api/equipment/'+encodeURIComponent(id)+'/history');
    const data=await response.json();
    if(!response.ok)return showToast(data.error||'無法載入借用紀錄',true);
    box.innerHTML='<h3 style="font-size:1.05rem;margin:14px 0 8px;">借用紀錄 · '+escapeText(data.asset.assetName)+'（'+escapeText(data.asset.assetNo)+'）</h3>'+(data.history.length?'<div class="table-container"><table><thead><tr><th>借據</th><th>借用人</th><th>借出</th><th>應還</th><th>歸還</th></tr></thead><tbody>'+data.history.map(entry=>'<tr><td>'+escapeText(entry.formNumber||'—')+'</td><td>'+escapeText(entry.borrower)+'</td><td>'+escapeText(String(entry.since||'').slice(0,10))+'</td><td>'+escapeText(entry.endDate||'—')+'</td><td>'+(entry.returnedAt?escapeText(entry.returnedAt.slice(0,10)):'<strong>借出中</strong>')+'</td></tr>').join('')+'</tbody></table></div>':'<p style="color:var(--text-muted)">尚無借用紀錄。</p>');
    box.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function resetEquipmentForm() { document.getElementById('equipment-form').reset(); document.getElementById('equipment-edit-id').value=''; document.getElementById('equipment-save-button').textContent='建立列管資料'; document.querySelector('#equipment-form-details summary').textContent='新增設備'; }
function editEquipment(id) {
    const item=equipmentCache.find(asset=>asset.id===id); if(!item)return;
    document.getElementById('equipment-edit-id').value=item.id;
    document.getElementById('equipment-name').value=item.assetName||'';
    document.getElementById('equipment-category').value=item.category||'';
    document.getElementById('equipment-serial').value=item.serialNo||'';
    document.getElementById('equipment-purchase-date').value=item.purchaseDate||'';
    document.getElementById('equipment-price').value=item.purchasePrice||'';
    document.getElementById('equipment-condition').value=item.condition||'good';
    document.getElementById('equipment-status').value=item.status||'storage';
    document.getElementById('equipment-location').value=item.location||'';
    document.getElementById('equipment-custodian').value=item.custodian||'';
    document.getElementById('equipment-note').value=item.note||'';
    document.getElementById('equipment-save-button').textContent='儲存設備變更';
    document.querySelector('#equipment-form-details summary').textContent='編輯設備 · '+item.assetNo;
    document.getElementById('equipment-form-details').open=true;
    document.getElementById('equipment-form').scrollIntoView({behavior:'smooth',block:'center'});
}
async function saveEquipment(event) {
    event.preventDefault();
    const id=document.getElementById('equipment-edit-id').value;
    const body={assetName:document.getElementById('equipment-name').value,category:document.getElementById('equipment-category').value,serialNo:document.getElementById('equipment-serial').value,purchaseDate:document.getElementById('equipment-purchase-date').value,purchasePrice:document.getElementById('equipment-price').value,condition:document.getElementById('equipment-condition').value,status:document.getElementById('equipment-status').value,location:document.getElementById('equipment-location').value,custodian:document.getElementById('equipment-custodian').value,note:document.getElementById('equipment-note').value};
    const response=await fetch(id?'/api/equipment/'+encodeURIComponent(id):'/api/equipment',{method:id?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json();
    showToast(response.ok?(id?'設備資料已更新：'+data.assetNo:'已建立財產編號：'+data.assetNo):data.error,!response.ok);
    if(response.ok){resetEquipmentForm();document.querySelector('#equipment-form-details summary').textContent='新增設備';document.getElementById('equipment-form-details').open=false;loadEquipment();}
}
function toggleAllEquipment(checked) { document.querySelectorAll('.equipment-select').forEach(input=>input.checked=checked);updateEquipmentSelectedCount(); }
function updateEquipmentSelectedCount() { const count=[...document.querySelectorAll('.equipment-select:checked')].length; const label=document.getElementById('equipment-selected-count'); if(label)label.textContent=count; }
function printSelectedEquipmentLabels() {
    const ids=new Set([...document.querySelectorAll('.equipment-select:checked')].map(input=>input.dataset.id));
    const items=equipmentCache.filter(item=>ids.has(item.id));
    if(!items.length)return showToast('請先選取要列印標籤的設備',true);
    const small=document.getElementById('equipment-label-size')?.value==='20x10';
    const popup=window.open('','_blank','width=900,height=700');
    if(!popup)return showToast('瀏覽器封鎖了列印視窗，請允許此網站開啟視窗',true);
    const labels=items.map(item=>'<article class="label '+(small?'small':'large')+'"><h1>'+escapeText(item.assetName)+'</h1><div class="asset-code">'+escapeText(item.assetNo)+'</div><div class="custodian">管理人：'+escapeText(item.custodian||'未指定')+'</div>'+(small?'':'<div class="meta">'+escapeText(item.category||'其他')+(item.serialNo?'　·　序號 '+escapeText(item.serialNo):'')+'</div>')+'</article>').join('');
    popup.opener=null;
    popup.document.open();
    popup.document.write('<!doctype html><html lang="zh-TW"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>設備財產標籤</title><style>*{box-sizing:border-box}body{font-family:Arial,"Noto Sans TC",sans-serif;margin:0;color:#111}.sheet{display:flex;flex-wrap:wrap;align-content:flex-start;gap:2mm;padding:5mm}.label{border:0.2mm solid #222;border-radius:1mm;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;break-inside:avoid;padding:1.2mm}.label.large{width:40mm;height:20mm}.label.small{width:20mm;height:10mm;padding:.55mm}.label h1{font-weight:700;line-height:1.1;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.large h1{font-size:7.5pt}.small h1{font-size:4.2pt}.asset-code{font-family:ui-monospace,Consolas,monospace;font-weight:700;white-space:nowrap;letter-spacing:-.03em}.large .asset-code{font-size:6.2pt}.small .asset-code{font-size:3.1pt;letter-spacing:-.06em}.custodian{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.large .custodian{font-size:6pt}.small .custodian{font-size:3.8pt}.meta{font-size:5pt;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}@page{margin:0}@media print{.sheet{padding:5mm}}</style><main class="sheet">'+labels+'</main></html>');
    popup.document.close(); popup.focus(); popup.print();
}

let memberCache = [];
let memberImportRows = [];
function invalidateMemberImport() { memberImportRows=[]; const button=document.getElementById('member-import-submit'); if(button)button.disabled=true; const preview=document.getElementById('member-import-preview'); if(preview)preview.innerHTML=''; }
const importFields = {name:'姓名',studentId:'學號',level:'身分',feeStatus:'社費狀態',email:'Email',phone:'電話',position:'職務',joinedAt:'加入日期',note:'備註'};
function renderMemberImportPreview() {
    const seenIds=new Set(), seenNames=new Set(), seenNamesWithoutId=new Set(); let duplicates=0;
    const rows=memberImportRows.map((item,index)=>{
        const id=String(item.studentId||'').trim().toUpperCase(), name=String(item.name||'').trim().toLowerCase();
        const duplicate=id?(seenIds.has(id)||seenNamesWithoutId.has(name)):seenNames.has(name);
        if(id)seenIds.add(id); if(name){seenNames.add(name);if(!id)seenNamesWithoutId.add(name);}
        if(duplicate)duplicates++;
        const cells=Object.keys(importFields).map(key=>'<td><input class="form-control" data-key="'+key+'" aria-label="'+importFields[key]+'，第 '+(index+1)+' 筆" value="'+escapeText(item[key]||'')+'" maxlength="'+({name:50,studentId:30,level:20,feeStatus:20,email:100,phone:30,position:60,joinedAt:10,note:1000}[key])+'" onchange="updateMemberImport('+index+',this.dataset.key,this.value)" '+(key==='joinedAt'?'type="date"':'')+'></td>').join('');
        return '<tr>'+cells+'<td>'+ (duplicate?'<span style="color:#fbbf24">重複，將跳過</span>':'<span style="color:#34d399">待新增</span>')+'</td><td><button type="button" class="btn btn-danger" onclick="removeMemberImportRow('+index+')">移除</button></td></tr>';
    }).join('');
    document.getElementById('member-import-preview').innerHTML='<p style="margin-bottom:8px;">辨識 '+memberImportRows.length+' 筆；目前 '+duplicates+' 筆重複資料將略過。可直接修改欄位或移除列。</p><div class="table-container"><table style="min-width:1100px"><thead><tr>'+Object.values(importFields).map(label=>'<th>'+label+'</th>').join('')+'<th>狀態</th><th>操作</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
    document.getElementById('member-import-submit').disabled=!memberImportRows.length;
}
function updateMemberImport(index,key,value) { if(memberImportRows[index]){memberImportRows[index][key]=value;renderMemberImportPreview();} }
function removeMemberImportRow(index) { memberImportRows.splice(index,1);renderMemberImportPreview(); }
function previewMemberImport() {
    const input = document.getElementById('member-import-text').value.trim();
    const file = document.getElementById('member-import-file').files[0];
    Promise.resolve(input || (file ? file.text() : '')).then(text => {
        if (!text) { memberImportRows = []; document.getElementById('member-import-submit').disabled = true; return showToast('請選擇 CSV／TSV 檔案或貼上資料', true); }
        const rows = parseSheet(text); if (!rows.length) return showToast('沒有可匯入的資料', true);
        const headers = rows.shift().map(value => value.replace(/^﻿/, '').trim().toLowerCase());
        const aliases = {name:['姓名','name'],studentId:['學號','studentid','student id'],level:['身分','社員身分','社團身分','level','membership_status'],feeStatus:['社費狀態','社費繳交狀態','繳費狀態','feestatus','fee_status'],email:['email','電子郵件'],phone:['電話','手機','phone'],position:['職務','幹部職務','position'],joinedAt:['加入日期','入社日期','joinedat','joined at'],note:['備註','note']};
        const columns = Object.fromEntries(Object.entries(aliases).map(([key, names]) => [key, headers.findIndex(value => names.includes(value))]));
        let data;
        const dateColumn=headers.indexOf('日期'), itemColumn=headers.indexOf('事宜'), incomeColumn=headers.indexOf('收入');
        if(itemColumn>=0 && dateColumn>=0 && incomeColumn>=0) {
            data=rows.filter(row=>row[itemColumn] && /社費/.test(row[itemColumn]) && !/社費存郵局/.test(row[itemColumn]) && Number(String(row[incomeColumn]||'').replace(/[,$\s]/g,''))>0).map(row=>{
                const raw=String(row[itemColumn]).replace(/社費/g,'').replace(/[。．·\s]/g,'').trim();
                const studentId=/^(?:\d{9}|\d{4}[a-z]\d{4})$/i.test(raw)?raw.toUpperCase():'';
                const rawDate=String(row[dateColumn]||'').trim(); const dateMatch=/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(rawDate);
                const feeDate=dateMatch?dateMatch[1]+'-'+dateMatch[2].padStart(2,'0')+'-'+dateMatch[3].padStart(2,'0'):'';
                const paidAmount=Number(String(row[incomeColumn]||'').replace(/[,$\s]/g,''));
                const semester=dateMatch?(Number(dateMatch[2])>=8?(Number(dateMatch[1])-1911)+'-1':(Number(dateMatch[1])-1912)+'-'+(Number(dateMatch[2])===1?1:2)):'';
                const prices=feePrices(feeDate); const feeStatus=paidAmount>=prices.lifetime?'在學會籍':paidAmount>=prices.semester?'一年會籍':'未繳費';
                return {name:studentId?'':raw,studentId,level:'正式社員',feeStatus,feeSemester:feeStatus==='一年會籍'?semester:'',email:'',phone:'',position:'',joinedAt:'',note:feeDate?'社費紀錄日期：'+feeDate:''};
            }).filter(item=>item.name||item.studentId);
        } else {
            if (columns.name < 0 && columns.studentId < 0) { memberImportRows=[]; return showToast('找不到可辨識的社員欄位；請提供姓名／學號欄，或社費帳本的日期、事宜、收入欄', true); }
            data = rows.filter(row => row.some(value => value)).map(row => Object.fromEntries(Object.entries(columns).map(([key, col]) => [key, col < 0 ? '' : (row[col] || '')])));
        }
        if (!data.length || data.length > 500) { memberImportRows=[]; return showToast('匯入資料需為 1 至 500 筆', true); }
        memberImportRows=data; renderMemberImportPreview();
    }).catch(() => showToast('讀取匯入資料失敗', true));
}
async function submitMemberImport() {
    if (!memberImportRows.length) return showToast('請先完成匯入預覽', true);
    if (!confirm('確認處理這 '+memberImportRows.length+' 筆資料？重複資料會自動略過。')) return;
    const button=document.getElementById('member-import-submit'); button.disabled=true;
    try { const res=await fetch('/api/members/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows:memberImportRows})}); const data=await res.json(); showToast(res.ok?'已新增 '+data.imported+' 位，略過重複 '+data.skipped+' 位':data.error,!res.ok); if(res.ok){memberImportRows=[];document.getElementById('member-import-text').value='';document.getElementById('member-import-file').value='';document.getElementById('member-import-preview').innerHTML='';loadMembers();} }
    catch { showToast('匯入失敗，請稍後重試',true); } finally { button.disabled=!memberImportRows.length; }
}
const memberLevelLabels={trial:'非正式社員',member:'正式社員',prep:'籌備幹部',officer:'正式幹部'};
const feeTypeLabels={semester:'一年會籍',lifetime:'在學會籍',other:'其他'};
function memberBadge(text,color) { return '<span style="display:inline-block; padding:2px 8px; border-radius:999px; font-size:.8rem; border:1px solid '+color+'; color:'+color+'; white-space:nowrap;">'+escapeText(text)+'</span>'; }
function memberFeeCell(status) { return status.paid?memberBadge(status.feeLabel,'#34d399'):status.exempt?memberBadge(status.feeLabel,'#60a5fa'):memberBadge(status.feeLabel,'#fbbf24'); }
function syncMemberForm() { const fee=document.getElementById('member-fee-status').value, level=document.getElementById('member-level').value; document.getElementById('member-fee-semester-wrap').style.display=fee==='semester'?'grid':'none'; document.getElementById('member-trial-wrap').style.display=level==='trial'?'grid':'none'; }
async function loadMembers() {
    const query = document.getElementById('member-search')?.value || ''; const filter = document.getElementById('member-filter')?.value || '';
    const [res, allRes] = await Promise.all([fetch('/api/members?q=' + encodeURIComponent(query) + '&filter=' + encodeURIComponent(filter)), fetch('/api/members')]);
    if (!res.ok || !allRes.ok) return showToast('無法載入社員資料', true);
    const members = await res.json(); const all = await allRes.json(); memberCache = all;
    const count = test => all.filter(test).length;
    const summary = document.getElementById('member-summary');
    if (summary) summary.innerHTML = [['名冊人數', all.length], ['社員總額（具表決權）', count(item => item.status.voting)], ['未繳費社員', count(item => item.status.unpaid)], ['非正式社員', count(item => item.status.level === 'trial')]].map(([label, value]) => '<div class="finance-card"><span>' + label + '</span><strong>' + value + '</strong></div>').join('') + '<p style="grid-column:1/-1; margin:0; color:var(--text-muted); font-size:.82rem;">目前學期：' + escapeText(all[0]?.status.semester || '') + '。社員總額依組織章程第四條，計入具表決權之正式社員與幹部。</p>';
    const body = document.getElementById('members-list');
    body.innerHTML = members.map(item => {
        const status = item.status; const trial = status.level === 'trial' ? '<br><small>免費體驗剩 ' + status.trialRemaining + ' 次</small>' : '';
        return '<tr' + (selectedMembers.has(item.id) ? ' style="background:rgba(96,165,250,.08);"' : '') + '><td><input type="checkbox" aria-label="選取 ' + escapeText(item.name || item.studentId || '社員') + '" data-id="' + escapeText(item.id) + '" ' + (selectedMembers.has(item.id) ? 'checked' : '') + ' onchange="toggleMember(this.dataset.id, this.checked)"></td><td>' + escapeText(item.name || '（姓名待查）') + '<br><small>' + escapeText(item.studentId || '無學號') + '</small></td><td>' + escapeText(status.levelLabel) + trial + '<br><small>社課出席 ' + ((item.attendance && item.attendance.total) || 0) + ' 次（本學年 ' + ((item.attendance && item.attendance.year) || 0) + '）</small></td><td>' + memberFeeCell(status) + '</td><td>' + (status.voting ? '有' : '無') + '</td><td>' + escapeText(item.account || '—') + '</td><td>' + escapeText(item.position || '—') + '</td><td>' + escapeText([item.email,item.phone].filter(Boolean).join('／') || '—') + '</td><td style="white-space:pre-wrap">' + escapeText(item.note || '—') + '</td><td>' + escapeText(item.joinedAt || '—') + '</td><td style="white-space:nowrap;">' + (status.unpaid ? '<button class="btn btn-primary" data-id="' + escapeText(item.id) + '" onclick="startFeeFor(this.dataset.id)">記錄繳費</button> ' : '') + (canCreateAccounts && !item.account ? '<button class="btn btn-secondary" data-id="' + escapeText(item.id) + '" onclick="startAccountFor(this.dataset.id)">建立帳號</button> ' : '') + '<button class="btn btn-secondary" data-id="' + escapeText(item.id) + '" onclick="editMember(this.dataset.id)">編輯</button> <button class="btn btn-danger" data-id="' + escapeText(item.id) + '" onclick="deleteMember(this.dataset.id)">刪除</button></td></tr>';
    }).join('') || '<tr><td colspan="11" style="text-align:center; color:var(--text-muted)">查無社員資料。</td></tr>';
    visibleMemberIds = members.map(item => item.id);
    for (const id of [...selectedMembers]) if (!all.some(item => item.id === id)) selectedMembers.delete(id);
    updateMemberSelection();
    const select=document.getElementById('fee-member'); if(select){const current=select.value;select.innerHTML='<option value="">選社員或手動填寫</option>'+all.map(item=>'<option value="'+escapeText(item.id)+'">'+escapeText(item.name||'姓名待查')+'（'+escapeText(item.studentId||'無學號')+'）'+(item.status.unpaid?'・未繳費':'')+'</option>').join('');select.value=current;}
}
const canCreateAccounts = ADMIN.isPresident;
function memberName(item) { return (item.name || '姓名待查') + (item.studentId ? '（' + item.studentId + '）' : ''); }
const selectedMembers = new Set();
let visibleMemberIds = [];
function updateMemberSelection() {
    const count = document.getElementById('member-selected-count'); if (!count) return;
    const shown = visibleMemberIds.filter(id => selectedMembers.has(id)).length;
    const hidden = selectedMembers.size - shown;
    count.textContent = selectedMembers.size ? '已選 ' + selectedMembers.size + ' 位' + (hidden ? '（其中 ' + hidden + ' 位不在目前篩選結果中）' : '') : '尚未選取；可先用上方篩選（例如「未繳費社員」），再按全選';
    const all = document.getElementById('member-select-all');
    all.checked = visibleMemberIds.length > 0 && shown === visibleMemberIds.length;
    all.indeterminate = shown > 0 && shown < visibleMemberIds.length;
}
function toggleMember(id, checked) { if (checked) selectedMembers.add(id); else selectedMembers.delete(id); loadMembersFromCache(); }
function toggleAllMembers(checked) { for (const id of visibleMemberIds) { if (checked) selectedMembers.add(id); else selectedMembers.delete(id); } if (!checked && !visibleMemberIds.length) selectedMembers.clear(); loadMembersFromCache(); }
function loadMembersFromCache() {
    document.querySelectorAll('#members-list input[type="checkbox"][data-id]').forEach(box => { box.checked = selectedMembers.has(box.dataset.id); box.closest('tr').style.background = box.checked ? 'rgba(96,165,250,.08)' : ''; });
    updateMemberSelection();
}
async function applyBulkMembers() {
    if (!selectedMembers.size) return showToast('請先勾選社員，或按「全選」', true);
    const level = document.getElementById('bulk-level').value, feeStatus = document.getElementById('bulk-fee-status').value, feeSemester = document.getElementById('bulk-fee-semester').value.trim();
    if (!level && !feeStatus) return showToast('請選擇要改成的身分或社費狀態', true);
    const parts = [level && '身分改為「' + memberLevelLabels[level] + '」', feeStatus && '社費改為「' + {unpaid:'未繳費',semester:'一年會籍' + (feeSemester ? ' ' + feeSemester : '（本學期）'),lifetime:'在學會籍'}[feeStatus] + '」'].filter(Boolean).join('，');
    if (!confirm('將 ' + selectedMembers.size + ' 位社員的' + parts + '？')) return;
    const res = await fetch('/api/members/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [...selectedMembers], level, feeStatus, feeSemester }) });
    const data = await res.json(); showToast(res.ok ? '已更新 ' + data.updated + ' 位社員' : data.error, !res.ok);
    if (res.ok) { selectedMembers.clear(); document.getElementById('bulk-level').value = ''; document.getElementById('bulk-fee-status').value = ''; document.getElementById('bulk-fee-semester').style.display = 'none'; loadMembers(); }
}
async function deleteBulkMembers() {
    if (!selectedMembers.size) return showToast('請先勾選要刪除的社員', true);
    const names = memberCache.filter(item => selectedMembers.has(item.id)).slice(0, 5).map(memberName).join('、');
    if (!confirm('確定刪除 ' + selectedMembers.size + ' 位社員（' + names + (selectedMembers.size > 5 ? '…' : '') + '）？綁定的帳號會自動解除綁定，此操作無法復原。')) return;
    const res = await fetch('/api/members/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [...selectedMembers], action: 'delete' }) });
    const data = await res.json(); showToast(res.ok ? '已刪除 ' + data.deleted + ' 位社員' : data.error, !res.ok);
    if (res.ok) { selectedMembers.clear(); loadMembers(); }
}
function resetMemberForm() { const form=document.getElementById('member-form'); if(form)form.reset(); document.getElementById('member-edit-id').value=''; document.getElementById('member-editing').style.display='none'; document.getElementById('member-submit').textContent='新增社員'; document.getElementById('member-reset').textContent='清除表單'; syncMemberForm(); }
function startFeeFor(id) {
    const item = memberCache.find(member => member.id === id); if (!item) return;
    document.getElementById('fee-member').value = id; fillFeePayer();
    const type = document.getElementById('fee-type'); if (!type.value) type.value = item.feeStatus === 'lifetime' ? 'lifetime' : 'semester'; fillFeeAmount();
    const form = document.getElementById('fee-form'); form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.getElementById(document.getElementById('fee-receiver').value ? 'fee-receipt-number' : 'fee-receiver').focus({ preventScroll: true });
    showToast('已帶入 ' + memberName(item) + '，確認金額與收款人後按「記錄社費簽收」');
}
function startAccountFor(id) {
    const item = memberCache.find(member => member.id === id); if (!item) return;
    pendingAccountMember = id;
    showPanel('users'); loadUsers();
    const username = document.getElementById('account-username');
    username.value = String(item.studentId || '').toLowerCase().replace(/[^a-z0-9._-]/g, '');
    document.getElementById('account-role').value = 'member';
    document.getElementById(username.value ? 'account-password' : 'account-username').focus();
    showToast('已帶入 ' + memberName(item) + '：帳號預設為學號，請設定初始密碼');
}
// Keep in sync with feePrices() in src/membership.js: 115-1 and 116-1 are promo terms.
const FEE_PROMO_SEMESTERS = ['115-1', '116-1'];
function feePrices(dateText) {
    const m = /^(\d{4})-(\d{2})/.exec(dateText || '') || /^(\d{4})-(\d{2})/.exec(new Date().toISOString());
    const year = Number(m[1]), month = Number(m[2]);
    const semester = month >= 8 ? (year - 1911) + '-1' : (year - 1912) + '-' + (month === 1 ? 1 : 2);
    return FEE_PROMO_SEMESTERS.includes(semester) ? { semester: 300, lifetime: 800, promo: true } : { semester: 500, lifetime: 1000, promo: false };
}
function fillFeeAmount() { const type = document.getElementById('fee-type').value; const amount = document.getElementById('fee-amount'); const prices = feePrices(document.getElementById('fee-date').value); if (type === 'semester') amount.value = prices.semester; else if (type === 'lifetime') amount.value = prices.lifetime; }
function editMember(id) { const item=memberCache.find(member=>member.id===id); if(!item)return; document.getElementById('member-edit-id').value=item.id; document.getElementById('member-name').value=item.name||''; document.getElementById('member-student-id').value=item.studentId||''; document.getElementById('member-position').value=item.position||''; document.getElementById('member-email').value=item.email||''; document.getElementById('member-phone').value=item.phone||''; document.getElementById('member-note').value=item.note||''; document.getElementById('member-joined-at').value=item.joinedAt||''; document.getElementById('member-level').value=item.status.level; document.getElementById('member-fee-status').value=item.status.feeStatus; document.getElementById('member-fee-semester').value=item.feeSemester||''; document.getElementById('member-trial-uses').value=item.trialUses||0; syncMemberForm(); const editing=document.getElementById('member-editing'); editing.textContent='正在編輯：'+memberName(item)+'。改完按「更新社員資料」，或按「取消編輯」放棄。'; editing.style.display='block'; document.getElementById('member-submit').textContent='更新社員資料'; document.getElementById('member-reset').textContent='取消編輯'; document.getElementById('member-form').closest('details').open=true; document.getElementById('member-form').scrollIntoView({behavior:'smooth',block:'center'}); }
async function saveMember(event) { event.preventDefault(); const id=document.getElementById('member-edit-id').value; const body={name:document.getElementById('member-name').value,studentId:document.getElementById('member-student-id').value,position:document.getElementById('member-position').value,email:document.getElementById('member-email').value,phone:document.getElementById('member-phone').value,note:document.getElementById('member-note').value,joinedAt:document.getElementById('member-joined-at').value,level:document.getElementById('member-level').value,feeStatus:document.getElementById('member-fee-status').value,feeSemester:document.getElementById('member-fee-semester').value,trialUses:Number(document.getElementById('member-trial-uses').value||0)}; const res=await fetch(id?'/api/members/'+encodeURIComponent(id):'/api/members',{method:id?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); const data=await res.json(); showToast(res.ok?(id?'社員資料已更新':'社員已新增（'+data.status.levelLabel+'・'+data.status.feeLabel+'）'):data.error,!res.ok); if(res.ok){resetMemberForm();loadMembers();} }
async function deleteMember(id) { const target=memberCache.find(member=>member.id===id); if (!confirm('確定刪除 '+(target?memberName(target):'此社員')+'？'+(target&&target.account?'綁定的帳號 '+target.account+' 會自動解除綁定（帳號本身保留）。':'')+'此操作無法復原。')) return; const res=await fetch('/api/members/'+encodeURIComponent(id),{method:'DELETE'}); const data=await res.json(); showToast(res.ok?'社員已刪除':data.error,!res.ok); if(res.ok)loadMembers(); }
function fillFeePayer() { const item=memberCache.find(member=>member.id===document.getElementById('fee-member').value); if(!item)return; document.getElementById('fee-payer-name').value=item.name||''; document.getElementById('fee-student-id').value=item.studentId||''; }
async function loadFeeReceipts() { const body=document.getElementById('fee-receipts-list'); if(!body)return; const res=await fetch('/api/member-fee-receipts'); const data=await res.json(); if(!res.ok){body.innerHTML='<tr><td colspan="7">'+escapeText(data.error||'無法載入簽收紀錄')+'</td></tr>';return;} body.innerHTML=data.map(item=>'<tr><td>'+escapeText(item.date)+'</td><td>'+escapeText(item.payerName||'姓名待查')+'<br><small>'+escapeText(item.studentId||'無學號')+'</small></td><td>NT$ '+new Intl.NumberFormat('zh-TW').format(item.amount)+(item.feeType?'<br><small>'+escapeText(feeTypeLabels[item.feeType]||'')+(item.feeType==='semester'&&item.semester?' '+escapeText(item.semester):'')+'</small>':'')+'</td><td>'+escapeText(item.receiver)+'</td><td>'+escapeText(item.receiptNumber||'—')+(item.note?'<br><small>'+escapeText(item.note)+'</small>':'')+'</td><td>'+escapeText(item.recordedBy)+'</td><td><button class="btn btn-danger" data-id="'+escapeText(item.id)+'" onclick="deleteFeeReceipt(this.dataset.id)">刪除</button></td></tr>').join('')||'<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">尚無社費簽收紀錄。</td></tr>'; const date=document.getElementById('fee-date'); if(date&&!date.value)date.value=new Date().toISOString().slice(0,10); restoreFeeReceiver(); }
async function createFeeReceipt(event) { event.preventDefault(); const memberId=document.getElementById('fee-member').value; const body={memberId,payerName:document.getElementById('fee-payer-name').value,studentId:document.getElementById('fee-student-id').value,amount:Number(document.getElementById('fee-amount').value),feeType:document.getElementById('fee-type').value,date:document.getElementById('fee-date').value,receiver:document.getElementById('fee-receiver').value,receiptNumber:document.getElementById('fee-receipt-number').value,note:document.getElementById('fee-note').value}; const res=await fetch('/api/member-fee-receipts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); const data=await res.json(); showToast(res.ok?(data.memberStatus?'社費簽收已記錄，社員狀態更新為：'+data.memberStatus.levelLabel+'・'+data.memberStatus.feeLabel:'社費簽收已記錄'):data.error,!res.ok); if(res.ok){try{localStorage.setItem('feeReceiver',body.receiver);}catch{} event.target.reset();restoreFeeReceiver();loadFeeReceipts();loadMembers();} }
function restoreFeeReceiver() { const input=document.getElementById('fee-receiver'); if(!input||input.value)return; try{input.value=localStorage.getItem('feeReceiver')||'';}catch{} }
async function deleteFeeReceipt(id) { if(!confirm('確定刪除此簽收紀錄？'))return; const res=await fetch('/api/member-fee-receipts/'+encodeURIComponent(id),{method:'DELETE'}); const data=await res.json(); showToast(res.ok?'簽收紀錄已刪除':data.error,!res.ok); if(res.ok)loadFeeReceipts(); }
if (ADMIN.manageMembers) loadFeeReceipts();
async function loadMyMember() {
    const box = document.getElementById('my-member'); if (!box) return;
    try {
        const res = await fetch('/api/me'); const data = await res.json();
        if (!res.ok) { box.textContent = data.error || '無法載入'; return; }
        if (!data.member) { box.innerHTML = '此帳號（' + escapeText(data.username) + '）尚未綁定社員資料。請聯絡社長在「帳號與權限」完成綁定。'; return; }
        const m = data.member, status = m.status;
        const rows = [['姓名', m.name || '—'], ['學號', m.studentId || '—'], ['身分', status.levelLabel + (status.level === 'trial' ? '（免費體驗社課剩 ' + status.trialRemaining + ' 次）' : '')], ['社費', status.feeLabel], ['表決權', status.voting ? '有（列入社員總額）' : '無'], ['幹部職務', m.position || '—'], ['加入日期', m.joinedAt || '—'], ['社課出席', ((m.attendance && m.attendance.total) || 0) + ' 次（本學年 ' + ((m.attendance && m.attendance.year) || 0) + ' 次）']];
        let html = '<dl style="display:grid; grid-template-columns:max-content 1fr; gap:6px 16px; margin:0; color:var(--text-main);">' + rows.map(([k, v]) => '<dt style="color:var(--text-muted);">' + k + '</dt><dd style="margin:0;">' + escapeText(v) + '</dd>').join('') + '</dl>';
        if (status.unpaid) html += '<p style="margin-top:12px; color:#fbbf24;">目前為未繳費狀態。依《社費細則》，一年會籍（原價 500 元，繳費學期加下一學期連續兩學期有效）、在學會籍（原價 1,000 元）；115-1、116-1 為優惠價 300／800 元；繳費後請向總務簽收。</p>';
        if (data.feeReceipts.length) html += '<p style="margin-top:12px;">繳費紀錄：' + data.feeReceipts.map(item => escapeText(item.date + ' NT$ ' + item.amount + (feeTypeLabels[item.feeType] ? '（' + feeTypeLabels[item.feeType] + '）' : ''))).join('、') + '</p>';
        box.innerHTML = html;
    } catch { box.textContent = '無法載入社員資料'; }
}
if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('load', loadMyMember);

let regulationCache = [];
let amendmentCache = [];
const isPresident = ADMIN.canResolve ?? ADMIN.isPresident;
const currentUsername = ADMIN.username;
const canPropose = ADMIN.viewCms;
const amendmentStatusLabels = { proposed: '提案中', awaiting_school: '已通過，待學校核備', effective: '已生效', rejected: '未通過', withdrawn: '已撤回' };
const amendmentStatusColors = { proposed: '#fbbf24', awaiting_school: '#60a5fa', effective: '#34d399', rejected: '#f87171', withdrawn: '#9ca3af' };
const amendmentActionLabels = { amend: '修正', create: '制定', repeal: '廢止' };
const regulationKindLabels = { charter: '組織章程', bylaw: '施行細則', school: '學校法規' };
const regulationHeading = /^(第[一二三四五六七八九十百零〇]+條|[壹貳參肆伍陸柒捌玖拾]+、)/;
function procedureText(kind, needsAssembly) {
    if (kind === 'charter') return '<strong>組織章程修正程序</strong>（章程第十條、第十三條）：①由法規監察委員會提出，或正式社員 5 人以上連署 → ②社員大會：社員總額三分之二以上出席、出席社員三分之二以上同意 → ③送學校核備，核備後才生效。';
    if (kind === 'school') return '<strong>學校法規</strong>由學校訂定，本社不能修改。只能在學校公告新版本後，登錄學校公告日期與來源，更新為學校版本。';
    return '<strong>施行細則修正程序</strong>（各細則施行條文）：①幹部會議通過 → ②報請社長核定後施行。' + (needsAssembly ? '<br>③因涉及社員權利義務之重大變更或社費標準，另須社員大會決議（社員總額三分之一以上出席、出席社員二分之一以上同意）。' : '<br>若涉及社員權利義務之重大變更或社費標準，請勾選下方選項，另提社員大會。');
}
function regulationSections(content) {
    const sections = []; let current = { heading: '', lines: [] };
    for (const line of String(content || '').split('\n')) {
        if (regulationHeading.test(line.trim())) { if (current.heading || current.lines.some(Boolean)) sections.push(current); current = { heading: line.trim(), lines: [] }; }
        else current.lines.push(line);
    }
    if (current.heading || current.lines.some(Boolean)) sections.push(current);
    return sections;
}
function highlightText(text, keyword) {
    const safe = escapeText(text); if (!keyword) return safe;
    const needle = escapeText(keyword); return safe.split(needle).join('<mark>' + needle + '</mark>');
}
// Line diff (longest common subsequence) between the current and proposed text.
function lineDiff(before, after) {
    const a = String(before || '').split('\n'), b = String(after || '').split('\n');
    if (a.length * b.length > 400000) return '<p style="color:var(--text-muted);">條文過長，無法顯示差異。</p>';
    const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    const rows = []; let i = 0, j = 0;
    while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) { rows.push(['same', a[i]]); i++; j++; }
        else if (i < a.length && (j >= b.length || table[i + 1][j] >= table[i][j + 1])) { rows.push(['del', a[i]]); i++; }
        else { rows.push(['add', b[j]]); j++; }
    }
    if (!rows.some(row => row[0] !== 'same')) return '<p style="color:var(--text-muted);">沒有差異。</p>';
    const style = { same: 'color:var(--text-muted);', add: 'background:rgba(52,211,153,.15); color:#6ee7b7;', del: 'background:rgba(248,113,113,.15); color:#fca5a5; text-decoration:line-through;' };
    const mark = { same: '　', add: '＋', del: '－' };
    // Keep two unchanged lines around each change so the context stays readable.
    const keep = rows.map((row, index) => row[0] !== 'same' || rows.slice(Math.max(0, index - 2), index + 3).some(near => near[0] !== 'same'));
    let html = '', skipped = false;
    rows.forEach((row, index) => {
        if (!keep[index]) { if (!skipped) html += '<div style="color:var(--text-muted); padding:2px 8px;">⋯</div>'; skipped = true; return; }
        skipped = false; html += '<div style="padding:2px 8px; white-space:pre-wrap; ' + style[row[0]] + '">' + mark[row[0]] + ' ' + escapeText(row[1]) + '</div>';
    });
    return '<div style="border:1px solid var(--border-glass); border-radius:8px; font-size:.88rem; line-height:1.6; max-height:420px; overflow:auto;">' + html + '</div>';
}
async function loadRegulations() {
    const [res, amendRes] = await Promise.all([fetch('/api/regulations'), fetch('/api/regulation-amendments')]);
    const data = await res.json();
    if (!res.ok) return showToast(data.error || '無法載入法規', true);
    regulationCache = data; amendmentCache = amendRes.ok ? await amendRes.json() : [];
    const select = document.getElementById('regulation-doc'); const current = select.value;
    select.innerHTML = '<option value="">全部法規</option>' + data.map(item => '<option value="' + escapeText(item.id) + '">' + escapeText(item.title) + (item.repealed ? '（已廢止）' : '') + '</option>').join('');
    select.value = data.some(item => item.id === current) ? current : '';
    renderRegulations(); renderAmendments();
}
function searchRegulation(keyword) { const input = document.getElementById('regulation-search'); input.value = keyword; renderRegulations(); input.focus(); }
function renderRegulations() {
    const keyword = document.getElementById('regulation-search').value.trim();
    const docId = document.getElementById('regulation-doc').value;
    const html = regulationCache.filter(item => (!docId || item.id === docId) && (!item.repealed || docId)).map(item => {
        let sections = regulationSections(item.content);
        if (keyword) sections = sections.filter(section => (section.heading + '\n' + section.lines.join('\n')).includes(keyword) || item.title.includes(keyword));
        if (keyword && !sections.length) return '';
        const body = sections.map(section => (section.heading ? '<h3 style="font-size:1rem; margin:14px 0 6px; color:var(--color-cyan);">' + highlightText(section.heading, keyword) + '</h3>' : '') + section.lines.filter(line => line.trim()).map(line => '<p style="margin:4px 0; line-height:1.7;">' + highlightText(line, keyword) + '</p>').join('')).join('');
        const pending = amendmentCache.filter(entry => entry.regulationId === item.id && (entry.status === 'proposed' || entry.status === 'awaiting_school')).length;
        const history = (item.history || []).slice().reverse();
        const historyHtml = history.length ? '<details style="margin-top:12px;"><summary style="cursor:pointer; color:var(--text-muted);">修正沿革（' + history.length + ' 個舊版本）</summary>' + history.map((old, index) => { const next = index === 0 ? item : history[index - 1]; return '<details style="margin:8px 0 0 12px;"><summary style="cursor:pointer;">' + escapeText(old.version || '原始版本') + ' → ' + escapeText(next.version || '') + '</summary>' + lineDiff(old.content, next.content) + '</details>'; }).join('') + '</details>' : '';
        const actions = canPropose && !item.repealed ? '<button type="button" class="btn btn-secondary" data-id="' + escapeText(item.id) + '" onclick="openAmendmentForm(this.dataset.id)">' + (item.kind === 'school' ? '更新為學校新版' : '提出修正案') + '</button>' : '';
        const meta = [regulationKindLabels[item.kind] || item.category, item.version].filter(Boolean).join('・') + (pending ? '・<span style="color:#fbbf24;">' + pending + ' 件修正案進行中</span>' : '') + (item.repealed ? '・<span style="color:#f87171;">已廢止</span>' : '') + (keyword ? '・符合 ' + sections.length + ' 條' : '');
        return '<details class="forms-card" ' + (keyword || docId ? 'open' : '') + ' style="margin-bottom:14px; padding:16px; border:1px solid var(--border-glass); border-radius:12px;"><summary style="cursor:pointer; font-weight:600;">' + escapeText(item.title) + ' <small style="color:var(--text-muted); font-weight:400;">' + meta + '</small></summary><div style="display:flex; justify-content:flex-end; margin-top:8px;">' + actions + '</div>' + body + historyHtml + '</details>';
    }).join('');
    document.getElementById('regulation-results').innerHTML = html || '<p style="color:var(--text-muted);">' + (keyword ? '找不到包含「' + escapeText(keyword) + '」的條文，換個說法試試，例如「社員大會」、「繳費」。' : '尚無法規資料。') + '</p>';
}
function renderAmendments() {
    const box = document.getElementById('amendment-list'); if (!box) return;
    const open = amendmentCache.filter(item => item.status === 'proposed' || item.status === 'awaiting_school');
    const closed = amendmentCache.filter(item => !(item.status === 'proposed' || item.status === 'awaiting_school'));
    const card = item => {
        const regulation = regulationCache.find(entry => entry.id === item.regulationId);
        const badge = '<span style="padding:2px 8px; border-radius:999px; font-size:.8rem; border:1px solid ' + amendmentStatusColors[item.status] + '; color:' + amendmentStatusColors[item.status] + ';">' + amendmentStatusLabels[item.status] + '</span>';
        const source = item.source === 'petition' ? '正式社員 ' + item.signers + ' 人連署' : item.source === 'committee' ? '法規監察委員會提出' : '';
        const r = item.resolution || {};
        const record = [r.officersMeetingDate && '幹部會議 ' + r.officersMeetingDate, r.presidentApprovedAt && '社長核定 ' + r.presidentApprovedAt, r.assembly && '社員大會 ' + r.assembly.date + '（總額 ' + r.assembly.total + '、出席 ' + r.assembly.attendance + '、同意 ' + r.assembly.agree + '）', r.schoolApprovedAt && '學校核備 ' + r.schoolApprovedAt, r.schoolAnnouncedAt && '學校公告 ' + r.schoolAnnouncedAt + '（' + r.source + '）', item.closeNote && '說明：' + item.closeNote].filter(Boolean).join('；');
        const diff = item.action === 'repeal' ? '<p>廢止「' + escapeText(item.title) + '」全文。</p>' : item.action === 'create' ? lineDiff('', item.content) : lineDiff(item.baseContent, item.content);
        const outdated = regulation && item.status !== 'effective' && (regulation.revision || 0) !== item.baseRevision;
        let actions = '';
        if (item.status === 'proposed') actions = (isPresident ? '<button type="button" class="btn btn-primary" data-id="' + escapeText(item.id) + '" onclick="openAdoptForm(this.dataset.id)">登錄通過</button> <button type="button" class="btn btn-secondary" data-id="' + escapeText(item.id) + '" onclick="closeAmendment(this.dataset.id,\'rejected\')">登錄未通過</button> ' : '') + (isPresident || item.proposedBy === currentUsername ? '<button type="button" class="btn btn-secondary" data-id="' + escapeText(item.id) + '" onclick="closeAmendment(this.dataset.id,\'withdrawn\')">撤回</button>' : '');
        if (item.status === 'awaiting_school' && isPresident) actions = '<button type="button" class="btn btn-primary" data-id="' + escapeText(item.id) + '" onclick="recordSchoolApproval(this.dataset.id)">登錄學校核備</button> <button type="button" class="btn btn-secondary" data-id="' + escapeText(item.id) + '" onclick="closeAmendment(this.dataset.id,\'rejected\')">學校未核備</button>';
        return '<details style="margin-bottom:10px; padding:12px 14px; border:1px solid var(--border-glass); border-radius:10px;"' + (item.status === 'proposed' || item.status === 'awaiting_school' ? ' open' : '') + '><summary style="cursor:pointer;">' + badge + ' <strong>' + amendmentActionLabels[item.action] + '「' + escapeText(item.title) + '」</strong> <small style="color:var(--text-muted);">' + escapeText(item.proposedAt.slice(0, 10) + ' 由 ' + item.proposedBy + ' 登錄' + (source ? '・' + source : '') + (item.needsAssembly ? '・需社員大會' : '')) + '</small></summary>' +
            '<p style="margin:10px 0 6px;"><strong>修正理由：</strong>' + escapeText(item.reason) + '</p>' + (record ? '<p style="margin:6px 0; color:var(--text-muted);">' + escapeText(record) + '</p>' : '') +
            (outdated ? '<p style="color:#fbbf24;">此法規在提案後已有其他修正生效，這份提案已過時，請撤回後以最新條文重新提案。</p>' : '') +
            '<details style="margin:8px 0;"><summary style="cursor:pointer;">條文差異</summary>' + diff + '</details>' + (actions ? '<div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">' + actions + '</div>' : '') + '<div id="adopt-' + escapeText(item.id) + '"></div></details>';
    };
    box.innerHTML = (open.length ? '<h2 style="font-size:1.05rem; margin-bottom:10px;">進行中的修正案（' + open.length + '）</h2>' + open.map(card).join('') : '') + (closed.length ? '<details style="margin-top:8px;"><summary style="cursor:pointer; color:var(--text-muted);">已結案的修正案（' + closed.length + '）</summary><div style="margin-top:10px;">' + closed.map(card).join('') + '</div></details>' : '');
}
function selectedAmendmentKind() {
    const action = document.getElementById('amendment-action').value;
    if (action === 'create') return document.getElementById('amendment-kind').value;
    const regulation = regulationCache.find(item => item.id === document.getElementById('amendment-regulation').value);
    return regulation ? (regulation.kind || 'bylaw') : 'bylaw';
}
function syncAmendmentForm(reload) {
    const action = document.getElementById('amendment-action').value;
    const select = document.getElementById('amendment-regulation');
    if (reload) {
        const current = select.value;
        const options = regulationCache.filter(item => !item.repealed && (action !== 'repeal' || item.kind === 'bylaw'));
        select.innerHTML = options.map(item => '<option value="' + escapeText(item.id) + '">' + escapeText(item.title) + '</option>').join('');
        if (options.some(item => item.id === current)) select.value = current;
    }
    const regulation = regulationCache.find(item => item.id === select.value);
    const kind = selectedAmendmentKind();
    document.getElementById('amendment-regulation-wrap').style.display = action === 'create' ? 'none' : 'grid';
    document.getElementById('amendment-kind-wrap').style.display = action === 'create' ? 'grid' : 'none';
    document.getElementById('amendment-source-wrap').style.display = kind === 'charter' ? 'grid' : 'none';
    document.getElementById('amendment-signers-wrap').style.display = document.getElementById('amendment-source').value === 'petition' ? 'grid' : 'none';
    document.getElementById('amendment-assembly-wrap').style.display = kind === 'bylaw' && action !== 'create' || (action === 'create' && kind === 'bylaw') ? 'flex' : 'none';
    const repeal = action === 'repeal';
    for (const id of ['amendment-title', 'amendment-content', 'amendment-diff-wrap']) document.getElementById(id).style.display = repeal ? 'none' : '';
    if (reload && !repeal) {
        document.getElementById('amendment-title').value = action === 'create' ? '' : (regulation?.title || '');
        document.getElementById('amendment-content').value = action === 'create' ? '' : (regulation?.content || '');
    }
    document.getElementById('amendment-procedure').innerHTML = procedureText(kind, document.getElementById('amendment-needs-assembly').checked);
    renderAmendmentDiff();
}
function renderAmendmentDiff() {
    const action = document.getElementById('amendment-action').value;
    const regulation = regulationCache.find(item => item.id === document.getElementById('amendment-regulation').value);
    document.getElementById('amendment-diff').innerHTML = lineDiff(action === 'create' ? '' : regulation?.content, document.getElementById('amendment-content').value);
}
function openAmendmentForm(id) {
    const form = document.getElementById('amendment-form'); if (!form) return;
    form.reset(); form.style.display = 'grid';
    document.getElementById('amendment-action').value = 'amend';
    syncAmendmentForm(true);
    if (id) { document.getElementById('amendment-regulation').value = id; syncAmendmentForm(true); }
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function closeAmendmentForm() { const form = document.getElementById('amendment-form'); if (form) { form.reset(); form.style.display = 'none'; } }
async function submitAmendment(event) {
    event.preventDefault();
    const action = document.getElementById('amendment-action').value;
    const body = { action, regulationId: document.getElementById('amendment-regulation').value, kind: document.getElementById('amendment-kind').value, title: document.getElementById('amendment-title').value, content: document.getElementById('amendment-content').value, reason: document.getElementById('amendment-reason').value, source: document.getElementById('amendment-source').value, signers: Number(document.getElementById('amendment-signers').value || 0), needsAssembly: document.getElementById('amendment-needs-assembly').checked };
    const res = await fetch('/api/regulation-amendments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json(); showToast(res.ok ? '修正案已登錄為「提案中」，條文尚未變更' : data.error, !res.ok);
    if (res.ok) { closeAmendmentForm(); loadRegulations(); }
}
const dateInput = (id, label) => '<label style="display:grid; gap:4px; font-size:.85rem; color:var(--text-muted);">' + label + '<input id="' + id + '" class="form-control" type="date" value="' + new Date().toISOString().slice(0, 10) + '"></label>';
const numberInput = (id, label, value) => '<label style="display:grid; gap:4px; font-size:.85rem; color:var(--text-muted);">' + label + '<input id="' + id + '" class="form-control" type="number" min="0" step="1" value="' + (value ?? '') + '" oninput="updateThresholdHint()"></label>';
let adoptingAmendment = null;
async function openAdoptForm(id) {
    const item = amendmentCache.find(entry => entry.id === id); if (!item) return;
    document.querySelectorAll('[id^="adopt-"]').forEach(node => { node.innerHTML = ''; });
    adoptingAmendment = item;
    let votingTotal = '';
    if (item.kind === 'charter' || item.needsAssembly) { try { const res = await fetch('/api/members?filter=voting'); if (res.ok) votingTotal = (await res.json()).length; } catch {} }
    let fields = '';
    if (item.kind === 'bylaw') fields += dateInput('adopt-officers-date', '幹部會議通過日期') + dateInput('adopt-president-date', '社長核定日期');
    if (item.kind === 'charter' || item.needsAssembly) fields += dateInput('adopt-assembly-date', '社員大會日期') + numberInput('adopt-total', '社員總額（具表決權人數' + (votingTotal !== '' ? '，名冊目前 ' + votingTotal + ' 人' : '') + '）', votingTotal) + numberInput('adopt-attendance', '出席人數') + numberInput('adopt-agree', '同意人數');
    if (item.kind === 'charter') fields += '<label style="display:grid; gap:4px; font-size:.85rem; color:var(--text-muted);">學校核備日期（尚未核備請留空）<input id="adopt-school-date" class="form-control" type="date"></label>';
    if (item.kind === 'school') fields += dateInput('adopt-school-announced', '學校公告／會議日期') + '<label style="display:grid; gap:4px; font-size:.85rem; color:var(--text-muted);">學校公告來源<input id="adopt-source" class="form-control" maxlength="200" placeholder="例如 115 學年度第 1 學期學務會議"></label>';
    fields += '<label style="display:grid; gap:4px; font-size:.85rem; color:var(--text-muted);">版本標示（選填，預設依日期產生）<input id="adopt-version" class="form-control" maxlength="60" placeholder="例如 115.12.01 修訂"></label>';
    document.getElementById('adopt-' + id).innerHTML = '<form onsubmit="adoptAmendment(event)" style="display:grid; gap:12px; margin-top:12px; padding:14px; border:1px dashed var(--border-glass); border-radius:10px;"><div style="color:#bfdbfe; font-size:.88rem;">' + procedureText(item.kind, item.needsAssembly) + '</div><div class="responsive-form-grid" style="display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px;">' + fields + '</div><p id="adopt-threshold" style="margin:0; font-size:.88rem;"></p><div style="display:flex; gap:8px;"><button class="btn btn-primary" type="submit">確認登錄</button><button class="btn btn-secondary" type="button" onclick="this.closest(\'form\').remove()">取消</button></div></form>';
    updateThresholdHint();
}
function updateThresholdHint() {
    const hint = document.getElementById('adopt-threshold'); if (!hint || !adoptingAmendment || !document.getElementById('adopt-total')) { if (hint) hint.textContent = ''; return; }
    const major = adoptingAmendment.kind === 'charter';
    const total = Number(document.getElementById('adopt-total').value || 0), attendance = Number(document.getElementById('adopt-attendance').value || 0), agree = Number(document.getElementById('adopt-agree').value || 0);
    const needAttend = Math.ceil(total * (major ? 2 : 1) / 3), needAgree = major ? Math.ceil(attendance * 2 / 3) : Math.ceil(attendance / 2);
    const ok = total > 0 && attendance <= total && agree <= attendance && attendance >= needAttend && agree >= needAgree;
    hint.style.color = ok ? '#34d399' : '#fbbf24';
    hint.textContent = (major ? '重大決議' : '一般決議') + '門檻：出席需 ' + needAttend + ' 人以上' + (attendance ? '、同意需 ' + needAgree + ' 人以上' : '') + '。' + (total ? (ok ? '✓ 已達門檻，可以登錄通過。' : '✗ 目前未達門檻；若會議實際未達門檻，請改按「登錄未通過」。') : '請先填社員總額。');
}
async function adoptAmendment(event) {
    event.preventDefault(); const item = adoptingAmendment; if (!item) return;
    const value = id => document.getElementById(id)?.value || '';
    const body = { officersMeetingDate: value('adopt-officers-date'), presidentApprovedAt: value('adopt-president-date'), schoolApprovedAt: value('adopt-school-date'), schoolAnnouncedAt: value('adopt-school-announced'), source: value('adopt-source'), version: value('adopt-version') };
    if (document.getElementById('adopt-total')) body.assembly = { date: value('adopt-assembly-date'), total: Number(value('adopt-total')), attendance: Number(value('adopt-attendance')), agree: Number(value('adopt-agree')) };
    const res = await fetch('/api/regulation-amendments/' + encodeURIComponent(item.id) + '/adopt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    showToast(res.ok ? (data.status === 'awaiting_school' ? '已登錄社員大會通過，待學校核備後生效' : '修正案已生效，條文已更新') : data.error, !res.ok);
    if (res.ok) { adoptingAmendment = null; loadRegulations(); }
}
async function recordSchoolApproval(id) {
    const date = prompt('學校核備日期（YYYY-MM-DD）', new Date().toISOString().slice(0, 10)); if (!date) return;
    const res = await fetch('/api/regulation-amendments/' + encodeURIComponent(id) + '/school-approval', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schoolApprovedAt: date }) });
    const data = await res.json(); showToast(res.ok ? '學校已核備，章程修正生效' : data.error, !res.ok); if (res.ok) loadRegulations();
}
async function closeAmendment(id, outcome) {
    const note = outcome === 'rejected' ? prompt('請說明未通過的情形（例如：社員大會出席 8 人，未達 10 人門檻）') : (confirm('確定撤回這份修正案？') ? '' : null);
    if (note === null || (outcome === 'rejected' && !note.trim())) return;
    const res = await fetch('/api/regulation-amendments/' + encodeURIComponent(id) + '/close', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outcome, note }) });
    const data = await res.json(); showToast(res.ok ? (outcome === 'rejected' ? '已登錄為未通過' : '修正案已撤回') : data.error, !res.ok); if (res.ok) loadRegulations();
}

function setNoteDate() { const date = document.getElementById('note-date'); if (date && !date.value) date.value = new Date().toISOString().slice(0, 10); }
function addNoteLink() { const container = document.getElementById('note-links'); if (!container || container.children.length >= 20) return showToast('每則備忘最多 20 個網址', true); container.insertAdjacentHTML('beforeend', '<div class="note-link-row responsive-form-grid" style="display:grid; grid-template-columns:1fr 2fr auto; gap:8px;"><input class="form-control note-link-label" placeholder="網址說明，例如：課程投影片" maxlength="100"><input class="form-control note-link-url" type="url" placeholder="https://..." maxlength="2048"><button type="button" class="btn btn-danger" onclick="this.parentElement.remove()" aria-label="移除此網址">移除</button></div>'); }
async function loadNotes() {
    const container = document.getElementById('notes-list'); if (!container) return;
    const res = await fetch('/api/notes'); const data = await res.json();
    if (!res.ok) { container.innerHTML = '<p style="color:#f87171;">' + escapeText(data.error || '無法載入備忘錄') + '</p>'; return; }
    container.innerHTML = data.map(note => '<article style="padding:18px; border:1px solid var(--border-glass); border-radius:12px; background:rgba(255,255,255,.025);"><div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;"><div><p style="color:var(--color-cyan); font-size:.85rem; margin-bottom:6px;">' + escapeText(note.date) + '</p><h2 style="font-size:1.15rem;">' + escapeText(note.title) + '</h2></div>' + (ADMIN.editCms ? '<button type="button" class="btn btn-danger" data-id="' + escapeText(note.id) + '" onclick="deleteNote(this.dataset.id)">刪除</button>' : '') + '</div>' + (note.content ? '<p style="white-space:pre-wrap; margin-top:12px; line-height:1.7;">' + escapeText(note.content) + '</p>' : '') + (note.links?.length ? '<ul style="display:grid; gap:8px; margin:14px 0 0; padding-left:20px;">' + note.links.map(link => '<li><a href="' + escapeText(link.url) + '" target="_blank" rel="noopener noreferrer" style="color:var(--color-cyan);">' + escapeText(link.label) + ' ↗</a></li>').join('') + '</ul>' : '<p style="color:var(--text-muted); margin-top:12px;">尚未記錄相關網址。</p>') + '<small style="display:block; color:var(--text-muted); margin-top:12px;">紀錄者：' + escapeText(note.createdBy) + '</small></article>').join('') || '<p style="color:var(--text-muted);">尚無社課紀錄。</p>';
    setNoteDate();
}
async function createNote(event) {
    event.preventDefault();
    const links = [...document.querySelectorAll('.note-link-row')].map(row => ({label:row.querySelector('.note-link-label').value, url:row.querySelector('.note-link-url').value})).filter(link => link.url.trim());
    const res = await fetch('/api/notes', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({title:document.getElementById('note-title').value, date:document.getElementById('note-date').value, content:document.getElementById('note-content').value, links})});
    const data = await res.json(); showToast(res.ok ? '社課紀錄已儲存' : data.error, !res.ok);
    if (res.ok) { event.target.reset(); document.getElementById('note-links').innerHTML = '<div class="note-link-row responsive-form-grid" style="display:grid; grid-template-columns:1fr 2fr auto; gap:8px;"><input class="form-control note-link-label" placeholder="網址說明，例如：課程投影片" maxlength="100"><input class="form-control note-link-url" type="url" placeholder="https://..." maxlength="2048"><button type="button" class="btn btn-danger" onclick="this.parentElement.remove()" aria-label="移除此網址">移除</button></div>'; setNoteDate(); loadNotes(); }
}
async function deleteNote(id) { if (!confirm('確定刪除此社課紀錄？')) return; const res = await fetch('/api/notes/' + encodeURIComponent(id), {method:'DELETE'}); const data = await res.json(); showToast(res.ok ? '社課紀錄已刪除' : data.error, !res.ok); if (res.ok) loadNotes(); }
if (ADMIN.viewCms) { loadNotes(); setNoteDate(); }

// ── Homepage Settings ───────────────────────────────────────
const hpFieldIdMap = {
    heroTitle: 'hp-hero-title', heroDesc: 'hp-hero-desc', heroBadge: 'hp-hero-badge',
    aboutTitle: 'hp-about-title', aboutSubtitle: 'hp-about-subtitle',
    aboutCard1Title: 'hp-about-c1-title', aboutCard1Desc: 'hp-about-c1-desc',
    aboutCard2Title: 'hp-about-c2-title', aboutCard2Desc: 'hp-about-c2-desc',
    aboutCard3Title: 'hp-about-c3-title', aboutCard3Desc: 'hp-about-c3-desc',
    featuresTitle: 'hp-features-title', featuresSubtitle: 'hp-features-subtitle',
    feat1Title: 'hp-feat1-title', feat1Desc: 'hp-feat1-desc',
    feat2Title: 'hp-feat2-title', feat2Desc: 'hp-feat2-desc',
    feat3Title: 'hp-feat3-title', feat3Desc: 'hp-feat3-desc',
    feat4Title: 'hp-feat4-title', feat4Desc: 'hp-feat4-desc',
    ctaTitle: 'hp-cta-title', ctaDesc: 'hp-cta-desc',
    lineLink: 'hp-line-link', igLink: 'hp-ig-link', emailLink: 'hp-email',
    igCard1Tag: 'hp-ig1-tag', igCard1Caption: 'hp-ig1-caption', igCard1Img: 'hp-ig1-img', igCard1Likes: 'hp-ig1-likes', igCard1Comments: 'hp-ig1-comments',
    igCard2Tag: 'hp-ig2-tag', igCard2Caption: 'hp-ig2-caption', igCard2Img: 'hp-ig2-img', igCard2Likes: 'hp-ig2-likes', igCard2Comments: 'hp-ig2-comments',
    igCard3Tag: 'hp-ig3-tag', igCard3Caption: 'hp-ig3-caption', igCard3Img: 'hp-ig3-img', igCard3Likes: 'hp-ig3-likes', igCard3Comments: 'hp-ig3-comments',
    igCard4Tag: 'hp-ig4-tag', igCard4Caption: 'hp-ig4-caption', igCard4Img: 'hp-ig4-img', igCard4Likes: 'hp-ig4-likes', igCard4Comments: 'hp-ig4-comments'
};

async function loadHomepageData() {
    try {
        const res = await fetch('/api/homepage');
        if (!res.ok) return;
        const data = await res.json();
        Object.keys(hpFieldIdMap).forEach(function(key) {
            const elem = document.getElementById(hpFieldIdMap[key]);
            if (elem && data[key] !== undefined) {
                elem.value = data[key];
            }
        });
    } catch (e) { /* silently ignore */ }
}
if (ADMIN.viewCms) loadHomepageData();

async function saveHomepage() {
    const payload = {};
    Object.keys(hpFieldIdMap).forEach(function(key) {
        const elem = document.getElementById(hpFieldIdMap[key]);
        if (elem) payload[key] = elem.value;
    });
    try {
        const res = await fetch('/api/homepage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            showToast('所有首頁設定已儲存！前台即時生效。');
        } else {
            const d = await res.json();
            showToast(d.error || '儲存失敗', true);
        }
    } catch (e) {
        showToast('連線失敗，請重試', true);
    }
}

async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    location.href = '/admin';
}
