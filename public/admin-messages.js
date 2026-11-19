// 社團通訊 panel: chat rooms, private messages, announcements, and (president)
// the optional external push module. Polls the server for new messages; the
// desktop program uses the same /api/messages and /api/announcements routes.
(function () {
    'use strict';
    var nav = document.querySelector('.sidebar-nav');
    var main = document.querySelector('.main-content');
    if (!nav || !main) return;

    var state = { me: {}, people: [], conversations: [], announcements: [], conv: '', messages: [], lastSeq: 0, tab: 'chat', summary: null };
    var chatTimer = null;

    function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function toast(message, isError) { if (typeof showToast === 'function') showToast(message, isError); else if (isError) alert(message); }
    async function api(path, method, body) {
        var response = await fetch(path, { method: method || 'GET', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
        var data = {};
        try { data = await response.json(); } catch (e) { /* empty */ }
        if (!response.ok) throw new Error(data.error || ('請求失敗（' + response.status + '）'));
        return data;
    }
    function when(iso) {
        if (!iso) return '';
        var date = new Date(iso), now = new Date();
        var time = date.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
        return date.toDateString() === now.toDateString() ? time : date.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' }) + ' ' + time;
    }
    function personName(username) {
        var person = state.people.find(function (p) { return p.username === username; });
        return person ? (person.name ? person.name + '（' + person.username + '）' : person.username) : username;
    }
    // Plain text with clickable links; no HTML from users is ever inserted.
    function linkify(text) {
        return esc(text).replace(/https?:\/\/[^\s<]+/g, function (url) { return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>'; }).replace(/\n/g, '<br>');
    }

    var style = document.createElement('style');
    style.textContent = [
        '.msg-tabs { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }',
        '.msg-layout { display:grid; grid-template-columns:260px 1fr; gap:14px; min-height:480px; }',
        '.msg-list { border:1px solid var(--border-glass); border-radius:12px; overflow:auto; max-height:640px; }',
        '.msg-conv { display:block; width:100%; text-align:left; padding:10px 12px; border:0; border-bottom:1px solid var(--border-glass); background:none; color:inherit; cursor:pointer; }',
        '.msg-conv:hover, .msg-conv.active { background:rgba(96,165,250,.12); }',
        '.msg-conv small { display:block; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
        '.msg-badge { display:inline-block; min-width:20px; padding:0 6px; border-radius:999px; background:#ef4444; color:#fff; font-size:.75rem; text-align:center; margin-left:6px; }',
        '.msg-chat { display:flex; flex-direction:column; border:1px solid var(--border-glass); border-radius:12px; min-height:480px; }',
        '.msg-head { padding:10px 14px; border-bottom:1px solid var(--border-glass); }',
        '.msg-stream { flex:1; overflow:auto; padding:12px 14px; max-height:520px; }',
        '.msg-item { margin-bottom:10px; } .msg-item .who { font-weight:600; font-size:.88rem; } .msg-item .at { color:var(--text-muted); font-size:.78rem; margin-left:6px; }',
        '.msg-item .text { margin-top:2px; line-height:1.6; word-break:break-word; } .msg-item.mine .who { color:var(--color-cyan); }',
        '.msg-item .tools button { background:none; border:0; color:var(--text-muted); cursor:pointer; font-size:.78rem; }',
        '.msg-item .tools button + button { margin-left:6px; } .msg-item a, .msg-ann a { color:var(--color-cyan); text-decoration:underline; }',
        '.msg-compose { display:flex; gap:8px; padding:10px; border-top:1px solid var(--border-glass); } .msg-compose textarea { flex:1; resize:vertical; min-height:44px; }',
        '.msg-ann { padding:14px 16px; border:1px solid var(--border-glass); border-radius:12px; margin-bottom:12px; } .msg-ann.unread { border-color:#60a5fa; }',
        '.msg-ann .body { white-space:pre-wrap; line-height:1.7; margin-top:6px; }',
        '.msg-muted { color:var(--text-muted); font-size:.86rem; }',
        '@media (max-width: 760px) { .msg-layout { grid-template-columns:1fr; } }'
    ].join('\n');
    document.head.appendChild(style);

    // Navigation group 社團通訊 with an unread badge.
    var group = document.createElement('div');
    group.className = 'nav-group';
    group.innerHTML = '<p class="nav-group-label">社團通訊</p>';
    var navButton = document.createElement('button');
    navButton.className = 'nav-item'; navButton.type = 'button';
    navButton.setAttribute('onclick', "showPanel('messages')");
    navButton.innerHTML = '<i data-lucide="messages-square"></i> 訊息中心 <span id="msg-nav-badge"></span>';
    navButton.addEventListener('click', function () { open(state.tab); });
    group.appendChild(navButton);
    nav.insertBefore(group, nav.children[1] || null);

    var panel = document.createElement('div');
    panel.id = 'panel-messages'; panel.className = 'panel';
    panel.innerHTML = '<div class="content-header"><div><h1>訊息中心</h1><p class="msg-muted" style="margin-top:6px;">社團聊天室、私人訊息與公告。桌面版「社務管理系統」也能收發，新訊息會跳出通知。</p></div><div><button type="button" class="btn btn-secondary" id="msg-read-all">全部標為已讀</button></div></div>'
        + '<div class="msg-tabs" id="msg-tabs"></div><div id="msg-body"><p class="msg-muted">載入中…</p></div>';
    main.appendChild(panel);
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
    document.getElementById('msg-read-all').onclick = async function () {
        try { await api('/api/messages/read-all', 'POST', {}); await poll(); open(state.tab); } catch (error) { toast(error.message, true); }
    };

    function renderTabs() {
        var s = state.summary || { unreadMessages: 0, unreadAnnouncements: 0 };
        var dmUnread = state.conversations.filter(function (c) { return c.kind === 'dm'; }).reduce(function (sum, c) { return sum + c.unread; }, 0);
        var chUnread = state.conversations.filter(function (c) { return c.kind === 'channel'; }).reduce(function (sum, c) { return sum + c.unread; }, 0);
        var tabs = [['chat', '聊天室', chUnread], ['dm', '私人訊息', dmUnread], ['announcements', '公告', s.unreadAnnouncements]];
        if (state.me.president) tabs.push(['push', '外部推播設定', 0]);
        var box = document.getElementById('msg-tabs');
        box.innerHTML = tabs.map(function (t) { return '<button type="button" class="btn ' + (state.tab === t[0] ? 'btn-primary' : 'btn-secondary') + '" data-tab="' + t[0] + '">' + t[1] + (t[2] ? '<span class="msg-badge">' + t[2] + '</span>' : '') + '</button>'; }).join('');
        box.querySelectorAll('button').forEach(function (b) { b.onclick = function () { open(b.dataset.tab); }; });
    }

    async function open(tab) {
        state.tab = tab || 'chat';
        if (state.tab !== 'chat' && state.tab !== 'dm') stopChat();
        try {
            if (!state.people.length) { var who = await api('/api/messages/people'); state.me = who.me; state.people = who.people; }
            state.conversations = await api('/api/messages/conversations');
            renderTabs();
            if (state.tab === 'announcements') return renderAnnouncements();
            if (state.tab === 'push') return renderPush();
            renderChat();
        } catch (error) { document.getElementById('msg-body').innerHTML = '<p class="msg-muted">' + esc(error.message) + '</p>'; }
    }

    // ───────────── Chat rooms and private messages ─────────────
    function renderChat() {
        var dm = state.tab === 'dm';
        var list = state.conversations.filter(function (c) { return dm ? c.kind === 'dm' : c.kind === 'channel'; })
            .sort(function (a, b) { return (b.lastAt || '').localeCompare(a.lastAt || ''); });
        if (state.conv && !list.some(function (c) { return c.conv === state.conv; }) && !(dm && state.conv.indexOf('dm~') === 0)) state.conv = '';
        if (!state.conv && list.length && !dm) state.conv = list[0].conv;
        var tools = dm
            ? '<div style="padding:10px; border-bottom:1px solid var(--border-glass);"><select id="msg-dm-target" class="form-control"><option value="">寫訊息給…</option>' + state.people.filter(function (p) { return p.username !== state.me.username; }).map(function (p) { return '<option value="' + esc(p.username) + '">' + esc((p.name || p.username) + '（' + p.username + '・' + p.roleLabel + '）') + '</option>'; }).join('') + '</select></div>'
            : (state.me.officer ? '<div style="padding:10px; border-bottom:1px solid var(--border-glass);"><button type="button" class="btn btn-secondary" id="msg-new-channel" style="width:100%;">＋ 建立聊天室</button></div>' : '');
        var items = list.map(function (c) {
            var title = c.kind === 'dm' ? personName(c.with) : c.name + (c.archived ? '（已封存）' : '');
            var sub = c.lastPreview ? (c.lastAuthor ? c.lastAuthor + '：' : '') + c.lastPreview : (c.description || '尚無訊息');
            return '<button type="button" class="msg-conv' + (c.conv === state.conv ? ' active' : '') + '" data-conv="' + esc(c.conv) + '"><strong>' + esc(title) + '</strong>' + (c.unread ? '<span class="msg-badge">' + c.unread + '</span>' : '') + '<small>' + esc(sub) + '</small></button>';
        }).join('') || '<p class="msg-muted" style="padding:12px;">' + (dm ? '還沒有私人訊息，從上方選擇對象開始。' : '沒有可用的聊天室。') + '</p>';
        document.getElementById('msg-body').innerHTML = '<div class="msg-layout"><div class="msg-list">' + tools + items + '</div><div class="msg-chat" id="msg-chat"><p class="msg-muted" style="padding:14px;">請選擇左側的對話。</p></div></div>';
        document.querySelectorAll('.msg-conv').forEach(function (b) { b.onclick = function () { state.conv = b.dataset.conv; renderChat(); }; });
        var target = document.getElementById('msg-dm-target');
        if (target) target.onchange = async function () {
            if (!target.value) return;
            try { state.conv = (await api('/api/messages/dm', 'POST', { username: target.value })).conv; renderChat(); } catch (error) { toast(error.message, true); }
        };
        var create = document.getElementById('msg-new-channel');
        if (create) create.onclick = function () { channelForm(null); };
        if (state.conv) loadConversation(true); else stopChat();
    }

    function currentConv() { return state.conversations.find(function (c) { return c.conv === state.conv; }); }

    async function loadConversation(reset) {
        stopChat();
        if (reset) { state.messages = []; state.lastSeq = 0; }
        var conv = currentConv();
        var dm = state.conv.indexOf('dm~') === 0;
        var other = dm ? state.conv.split('~').slice(1).find(function (n) { return n !== state.me.username; }) || state.me.username : '';
        var title = dm ? personName(other) : (conv ? conv.name : '');
        var canManage = conv && conv.kind === 'channel' && (state.me.president || conv.createdBy === state.me.username);
        var canWrite = !conv || (!conv.archived && (!conv.readOnly || state.me.officer));
        var chat = document.getElementById('msg-chat');
        chat.innerHTML = '<div class="msg-head"><strong>' + esc(title) + '</strong>' + (conv && conv.audienceLabel ? ' <span class="msg-muted">・' + esc(conv.audienceLabel) + (conv.readOnly ? '・僅幹部可發言' : '') + '</span>' : '') + (canManage ? ' <button type="button" class="btn btn-secondary" id="msg-edit-channel" style="float:right; padding:4px 10px;">設定</button>' : '') + (conv && conv.description ? '<div class="msg-muted">' + esc(conv.description) + '</div>' : '') + '</div>'
            + '<div class="msg-stream" id="msg-stream"></div>'
            + (canWrite ? '<form class="msg-compose" id="msg-compose"><textarea class="form-control" id="msg-text" maxlength="4000" placeholder="輸入訊息，Enter 送出、Shift+Enter 換行"></textarea><button class="btn btn-primary" type="submit">送出</button></form>' : '<p class="msg-muted" style="padding:10px;">此聊天室目前無法發言。</p>');
        var edit = document.getElementById('msg-edit-channel');
        if (edit) edit.onclick = function () { channelForm(conv); };
        var form = document.getElementById('msg-compose');
        if (form) {
            var box = document.getElementById('msg-text');
            box.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
            form.onsubmit = async function (e) {
                e.preventDefault();
                var text = box.value.trim();
                if (!text) return;
                try { await api('/api/messages/c/' + encodeURIComponent(state.conv), 'POST', { text: text }); box.value = ''; await fetchNew(); } catch (error) { toast(error.message, true); }
            };
            box.focus();
        }
        await fetchNew();
        chatTimer = setInterval(fetchNew, 4000);
    }

    var fetching = false;
    async function fetchNew() {
        if (!state.conv || !document.getElementById('msg-stream')) return stopChat();
        // The timer and the refresh after sending must not both append the same new messages.
        if (fetching) return;
        fetching = true;
        var requested = state.conv, after = state.lastSeq;
        try {
            var data = await api('/api/messages/c/' + encodeURIComponent(state.conv) + (state.lastSeq ? '?after=' + state.lastSeq : '?limit=80'));
            if (data.conv !== state.conv || after !== state.lastSeq) return;
            var fresh = data.messages.filter(function (m) { return m.seq > state.lastSeq; });
            if (fresh.length) {
                fresh.forEach(function (m) { state.messages.push(m); });
                state.lastSeq = fresh[fresh.length - 1].seq;
                renderMessages();
                await api('/api/messages/c/' + encodeURIComponent(state.conv) + '/read', 'POST', { seq: state.lastSeq });
                poll();
            } else if (!state.messages.length) renderMessages();
        } catch (error) { stopChat(); toast(error.message, true); }
        finally {
            fetching = false;
            // The user switched (or reopened) a conversation while this request was running: load it now.
            if ((state.conv !== requested || after !== state.lastSeq) && state.conv && document.getElementById('msg-stream')) fetchNew();
        }
    }

    function renderMessages() {
        var stream = document.getElementById('msg-stream');
        if (!stream) return;
        var atBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 60;
        stream.innerHTML = state.messages.map(function (m) {
            var mine = m.author === state.me.username;
            var tools = m.deleted ? '' : '<span class="tools">' + (mine ? '<button type="button" data-edit="' + m.seq + '">編輯</button>' : '') + (mine || state.me.president ? '<button type="button" data-delete="' + m.seq + '">刪除</button>' : '') + '</span>';
            return '<div class="msg-item' + (mine ? ' mine' : '') + '"><span class="who">' + esc(m.authorName || m.author) + '</span><span class="at">' + when(m.createdAt) + (m.editedAt && !m.deleted ? '（已編輯）' : '') + '</span> ' + tools
                + '<div class="text">' + (m.deleted ? '<em class="msg-muted">訊息已刪除</em>' : linkify(m.text)) + '</div></div>';
        }).join('') || '<p class="msg-muted">還沒有訊息，說聲嗨吧！</p>';
        stream.querySelectorAll('[data-edit]').forEach(function (b) { b.onclick = function () { editMessage(Number(b.dataset.edit)); }; });
        stream.querySelectorAll('[data-delete]').forEach(function (b) { b.onclick = function () { deleteMessage(Number(b.dataset.delete)); }; });
        if (atBottom || state.messages.length <= 80) stream.scrollTop = stream.scrollHeight;
    }

    async function editMessage(seq) {
        var message = state.messages.find(function (m) { return m.seq === seq; });
        var text = prompt('修改訊息', message.text);
        if (text === null || !text.trim()) return;
        try { Object.assign(message, await api('/api/messages/c/' + encodeURIComponent(state.conv) + '/' + seq, 'PATCH', { text: text })); renderMessages(); } catch (error) { toast(error.message, true); }
    }
    async function deleteMessage(seq) {
        if (!confirm('確定刪除這則訊息？')) return;
        var message = state.messages.find(function (m) { return m.seq === seq; });
        try { Object.assign(message, await api('/api/messages/c/' + encodeURIComponent(state.conv) + '/' + seq, 'DELETE')); renderMessages(); } catch (error) { toast(error.message, true); }
    }
    function stopChat() { if (chatTimer) { clearInterval(chatTimer); chatTimer = null; } }

    function channelForm(channel) {
        stopChat();
        var c = channel || { name: '', description: '', audience: 'all', members: [], readOnly: false };
        var chat = document.getElementById('msg-chat');
        chat.innerHTML = '<form id="msg-channel-form" style="padding:16px; display:grid; gap:10px;"><h3>' + (channel ? '聊天室設定' : '建立聊天室') + '</h3>'
            + '<label>名稱<input class="form-control" id="ch-name" maxlength="40" required value="' + esc(c.name) + '"></label>'
            + '<label>說明<input class="form-control" id="ch-desc" maxlength="200" value="' + esc(c.description) + '"></label>'
            + '<label>誰可以看到<select class="form-control" id="ch-audience"><option value="all">全體社員</option><option value="officers">幹部限定</option><option value="custom">指定成員</option></select></label>'
            + '<label id="ch-members-box">指定成員（按住 Ctrl 複選）<select class="form-control" id="ch-members" multiple size="8">' + state.people.map(function (p) { return '<option value="' + esc(p.username) + '"' + (c.members.indexOf(p.username) >= 0 ? ' selected' : '') + '>' + esc((p.name || p.username) + '（' + p.username + '）') + '</option>'; }).join('') + '</select></label>'
            + '<label><input type="checkbox" id="ch-readonly"' + (c.readOnly ? ' checked' : '') + '> 只有幹部可以發言（公告用頻道）</label>'
            + '<div class="mt-row" style="display:flex; gap:8px; flex-wrap:wrap;"><button class="btn btn-primary" type="submit">儲存</button><button class="btn btn-secondary" type="button" id="ch-cancel">取消</button>'
            + (channel ? '<button class="btn btn-danger" type="button" id="ch-archive">' + (channel.archived ? '取消封存' : '封存聊天室') + '</button>' : '') + '</div></form>';
        var audience = document.getElementById('ch-audience');
        audience.value = c.audience;
        var sync = function () { document.getElementById('ch-members-box').style.display = audience.value === 'custom' ? '' : 'none'; };
        audience.onchange = sync; sync();
        document.getElementById('ch-cancel').onclick = function () { renderChat(); };
        var archive = document.getElementById('ch-archive');
        if (archive) archive.onclick = async function () {
            if (!channel.archived && !confirm('封存後無法再發言，確定封存？')) return;
            try { await api('/api/messages/channels/' + encodeURIComponent(channel.id), 'PATCH', { archived: !channel.archived }); toast('已更新'); open('chat'); } catch (error) { toast(error.message, true); }
        };
        document.getElementById('msg-channel-form').onsubmit = async function (e) {
            e.preventDefault();
            var body = { name: document.getElementById('ch-name').value, description: document.getElementById('ch-desc').value, audience: audience.value, readOnly: document.getElementById('ch-readonly').checked,
                members: Array.prototype.map.call(document.getElementById('ch-members').selectedOptions, function (o) { return o.value; }) };
            try {
                var saved = channel ? await api('/api/messages/channels/' + encodeURIComponent(channel.id), 'PATCH', body) : await api('/api/messages/channels', 'POST', body);
                state.conv = saved.conv; toast('聊天室已儲存'); open('chat');
            } catch (error) { toast(error.message, true); }
        };
    }

    // ───────────── Announcements ─────────────
    async function renderAnnouncements() {
        stopChat();
        var body = document.getElementById('msg-body');
        try { state.announcements = await api('/api/announcements'); } catch (error) { body.innerHTML = '<p class="msg-muted">' + esc(error.message) + '</p>'; return; }
        var form = state.me.officer ? '<form id="ann-form" class="msg-ann" style="display:grid; gap:10px;"><h3>發布公告</h3><input class="form-control" id="ann-title" maxlength="120" placeholder="公告標題" required>'
            + '<textarea class="form-control" id="ann-content" rows="4" maxlength="10000" placeholder="公告內容" required></textarea>'
            + '<div style="display:flex; gap:14px; flex-wrap:wrap; align-items:center;"><select class="form-control" id="ann-audience" style="max-width:180px;"><option value="all">全體社員</option><option value="officers">幹部限定</option></select>'
            + '<label><input type="checkbox" id="ann-pinned"> 置頂</label><label><input type="checkbox" id="ann-push" checked> 同步外部推播（若社長已啟用）</label><button class="btn btn-primary" type="submit">發布</button></div></form>' : '';
        var list = state.announcements.map(function (a) {
            var manage = state.me.president || a.createdBy === state.me.username;
            return '<div class="msg-ann' + (a.read ? '' : ' unread') + '"><div><strong>' + (a.pinned ? '📌 ' : '') + esc(a.title) + '</strong>' + (a.read ? '' : ' <span class="msg-badge">新</span>') + (a.audience === 'officers' ? ' <span class="msg-muted">（幹部限定）</span>' : '') + '</div>'
                + '<div class="msg-muted">' + esc(a.createdByName || a.createdBy) + '・' + when(a.createdAt) + (state.me.officer ? '・已讀 ' + a.readCount + ' 人' : '') + '</div>'
                + '<div class="body">' + linkify(a.content) + '</div><div style="display:flex; gap:8px; margin-top:8px;">'
                + (a.read ? '' : '<button type="button" class="btn btn-secondary" data-read="' + esc(a.id) + '">標為已讀</button>')
                + (manage ? '<button type="button" class="btn btn-secondary" data-pin="' + esc(a.id) + '">' + (a.pinned ? '取消置頂' : '置頂') + '</button><button type="button" class="btn btn-danger" data-del="' + esc(a.id) + '">刪除</button>' : '')
                + (state.me.officer && a.readBy && a.readBy.length ? '<details><summary class="msg-muted">已讀名單</summary>' + esc(a.readBy.map(personName).join('、')) + '</details>' : '') + '</div></div>';
        }).join('') || '<p class="msg-muted">目前沒有公告。</p>';
        body.innerHTML = form + list;
        var f = document.getElementById('ann-form');
        if (f) f.onsubmit = async function (e) {
            e.preventDefault();
            try {
                var saved = await api('/api/announcements', 'POST', { title: document.getElementById('ann-title').value, content: document.getElementById('ann-content').value, audience: document.getElementById('ann-audience').value, pinned: document.getElementById('ann-pinned').checked, push: document.getElementById('ann-push').checked });
                var pushed = (saved.push || []).map(function (p) { return p.target + '：' + (p.result === 'sent' ? '成功' : '失敗'); }).join('、');
                toast('公告已發布' + (pushed ? '（外部推播 ' + pushed + '）' : '')); renderAnnouncements();
            } catch (error) { toast(error.message, true); }
        };
        body.querySelectorAll('[data-read]').forEach(function (b) { b.onclick = async function () { await api('/api/announcements/' + b.dataset.read + '/read', 'POST', {}); poll(); renderAnnouncements(); }; });
        body.querySelectorAll('[data-pin]').forEach(function (b) { b.onclick = async function () { var a = state.announcements.find(function (x) { return x.id === b.dataset.pin; }); try { await api('/api/announcements/' + a.id, 'PATCH', { pinned: !a.pinned }); renderAnnouncements(); } catch (error) { toast(error.message, true); } }; });
        body.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = async function () { if (!confirm('確定刪除此公告？')) return; try { await api('/api/announcements/' + b.dataset.del, 'DELETE'); renderAnnouncements(); } catch (error) { toast(error.message, true); } }; });
        renderTabs();
    }

    // ───────────── External push (optional module, president) ─────────────
    async function renderPush() {
        stopChat();
        var body = document.getElementById('msg-body');
        var s;
        try { s = await api('/api/messages/push-settings'); } catch (error) { body.innerHTML = '<p class="msg-muted">' + esc(error.message) + '</p>'; return; }
        var rows = (s.webhooks.length ? s.webhooks : [{ label: '', url: '' }]).concat([{ label: '', url: '' }]).slice(0, 5);
        body.innerHTML = '<form id="push-form" class="msg-ann" style="display:grid; gap:12px;"><h3>外部推播（選用模組）</h3>'
            + '<p class="msg-muted">預設關閉。啟用後，給全體社員的公告（以及可選的網站新文章）會同步發送到 Discord、Slack、Google Chat、Microsoft Teams 或 LINE 官方帳號。幹部限定的公告與聊天內容永遠不會外流。</p>'
            + '<label><input type="checkbox" id="push-enabled"' + (s.enabled ? ' checked' : '') + '> 啟用外部推播</label>'
            + '<label><input type="checkbox" id="push-ann"' + (s.announcements ? ' checked' : '') + '> 推播「全體社員」公告</label>'
            + '<label><input type="checkbox" id="push-posts"' + (s.posts ? ' checked' : '') + '> 推播網站新文章</label>'
            + '<div><strong>Webhook 網址</strong><p class="msg-muted">在 Discord 頻道設定 → 整合 → Webhook 建立後貼上；Slack／Google Chat／Teams 的「Incoming Webhook」也可以。已儲存的網址會遮蔽顯示，不修改即保留。</p>'
            + rows.map(function (w, i) { return '<div style="display:grid; grid-template-columns:160px 1fr; gap:8px; margin-top:6px;"><input class="form-control push-label" placeholder="名稱，例如 Discord 社團" value="' + esc(w.label) + '"><input class="form-control push-url" placeholder="https://discord.com/api/webhooks/…" value="' + esc(w.url) + '"></div>'; }).join('') + '</div>'
            + '<label>LINE 官方帳號 Channel access token（Messaging API，會廣播給所有好友，留空不使用）<input class="form-control" id="push-line" value="' + esc(s.lineToken) + '" autocomplete="off"></label>'
            + '<div style="display:flex; gap:8px;"><button class="btn btn-primary" type="submit">儲存設定</button><button class="btn btn-secondary" type="button" id="push-test">發送測試訊息</button></div></form>';
        document.getElementById('push-form').onsubmit = async function (e) {
            e.preventDefault();
            var labels = body.querySelectorAll('.push-label'), urls = body.querySelectorAll('.push-url'), webhooks = [];
            urls.forEach(function (u, i) { if (u.value.trim()) webhooks.push({ url: u.value.trim(), label: labels[i].value }); });
            try {
                await api('/api/messages/push-settings', 'PUT', { enabled: document.getElementById('push-enabled').checked, announcements: document.getElementById('push-ann').checked, posts: document.getElementById('push-posts').checked, webhooks: webhooks, lineToken: document.getElementById('push-line').value });
                toast('推播設定已儲存'); renderPush();
            } catch (error) { toast(error.message, true); }
        };
        document.getElementById('push-test').onclick = async function () {
            try { var r = await api('/api/messages/push-test', 'POST', {}); toast(r.results.length ? r.results.map(function (x) { return x.target + '：' + (x.result === 'sent' ? '成功' : x.result); }).join('、') : '沒有設定任何推播目的地'); } catch (error) { toast(error.message, true); }
        };
    }

    // ───────────── Unread badge and notifications ─────────────
    async function poll() {
        try {
            var s = await api('/api/messages/summary');
            state.summary = s;
            var total = s.unreadMessages + s.unreadAnnouncements;
            var badge = document.getElementById('msg-nav-badge');
            if (badge) badge.innerHTML = total ? '<span class="msg-badge">' + (total > 99 ? '99+' : total) + '</span>' : '';
            document.title = (total ? '(' + total + ') ' : '') + document.title.replace(/^\(\d+\+?\) /, '');
            // admin-notifications.js turns new items into pop-ups and the bell's list.
            if (window.ClubMessages) window.ClubMessages.lastSummary = s;
            window.dispatchEvent(new CustomEvent('club:summary', { detail: s }));
            if (panel.classList.contains('active')) renderTabs();
        } catch (e) { /* offline or feature not deployed: keep quiet */ }
    }
    // Used by the notification centre to jump to a conversation or announcement.
    window.ClubMessages = {
        show: async function (tab, conv) {
            if (typeof showPanel === 'function') showPanel('messages');
            await open(tab || 'chat');
            if (conv && (tab === 'chat' || tab === 'dm')) {
                var button = document.querySelector('.msg-conv[data-conv="' + (window.CSS && CSS.escape ? CSS.escape(conv) : conv) + '"]');
                if (button) button.click();
            }
        },
        refresh: function () { return poll().then(function () { if (panel.classList.contains('active')) open(state.tab); }); },
        current: function () { return panel.classList.contains('active') && (state.tab === 'chat' || state.tab === 'dm') ? state.conv : ''; }
    };
    poll();
    setInterval(poll, 20000);
    // Check right away when the tab comes back to the foreground (timers are throttled in the background).
    document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
})();
