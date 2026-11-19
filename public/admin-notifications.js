// 通知中心 for the website back office: a bell with an unread count, a drop-down
// list of unread announcements and conversations plus recent notification
// history, per-browser settings, and system (OS) notifications through the
// Notification API / service worker so they appear even when the tab is in the
// background. Fed by the unread summary that admin-messages.js polls
// (window event "club:summary"); the desktop program has its own 通知中心.
(function () {
    'use strict';
    var main = document.querySelector('.main-content');
    if (!main) return;

    // Per account, so the next person on a shared computer never sees someone else's previews.
    var owner = (document.getElementById('panel-forms') || {}).dataset || {};
    var KEY_SETTINGS = 'club-notify-settings:' + (owner.username || '_');
    var KEY_HISTORY = 'club-notify-history:' + (owner.username || '_');
    try { localStorage.removeItem('club-notify-history'); } catch (e) { /* storage blocked */ }
    var DEFAULTS = { system: false, announcements: true, messages: true, sound: true, mute: false };
    var settings = load(KEY_SETTINGS, DEFAULTS);
    var history = load(KEY_HISTORY, []);
    var seen = {};        // keys already notified in this page
    var primed = false;   // the first summary only seeds `seen` (no pop-up for old items)
    var summary = { unreadMessages: 0, unreadAnnouncements: 0, conversations: [], announcements: [] };

    function load(key, fallback) {
        try {
            var value = JSON.parse(localStorage.getItem(key) || 'null');
            if (Array.isArray(fallback)) return Array.isArray(value) ? value : [];
            return Object.assign({}, fallback, value || {});
        } catch (e) { return Array.isArray(fallback) ? [] : Object.assign({}, fallback); }
    }
    function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage blocked */ } }
    function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function when(iso) {
        if (!iso) return '';
        var date = new Date(iso), now = new Date();
        var time = date.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
        return date.toDateString() === now.toDateString() ? time : date.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' }) + ' ' + time;
    }
    function supported() { return 'Notification' in window; }

    var style = document.createElement('style');
    style.textContent = [
        '#notify-bell { position:fixed; top:14px; right:18px; z-index:60; width:42px; height:42px; border-radius:50%; border:1px solid var(--border-glass); background:rgba(15,23,42,.85); color:#fff; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:1.2rem; backdrop-filter:blur(8px); }',
        '#notify-bell .count { position:absolute; top:-4px; right:-4px; min-width:20px; padding:0 5px; border-radius:999px; background:#ef4444; color:#fff; font-size:.72rem; line-height:20px; text-align:center; }',
        '#notify-panel { position:fixed; top:64px; right:18px; z-index:61; width:min(380px, calc(100vw - 32px)); max-height:min(560px, calc(100vh - 90px)); overflow:auto; border:1px solid var(--border-glass); border-radius:14px; background:rgba(15,23,42,.97); color:#e2e8f0; box-shadow:0 20px 50px rgba(0,0,0,.5); display:none; }',
        '#notify-panel.open { display:block; }',
        '#notify-panel header { display:flex; justify-content:space-between; align-items:center; padding:12px 14px; border-bottom:1px solid var(--border-glass); position:sticky; top:0; background:inherit; }',
        '#notify-panel header button, #notify-panel .row-actions button { background:none; border:0; color:var(--color-cyan, #22d3ee); cursor:pointer; font-size:.82rem; }',
        '#notify-panel h4 { margin:10px 14px 4px; font-size:.78rem; color:var(--text-muted, #94a3b8); font-weight:600; }',
        '.notify-item { display:block; width:100%; text-align:left; padding:9px 14px; border:0; background:none; color:inherit; cursor:pointer; border-bottom:1px solid rgba(148,163,184,.12); }',
        '.notify-item:hover { background:rgba(96,165,250,.12); } .notify-item strong { display:block; font-size:.9rem; } .notify-item small { color:var(--text-muted, #94a3b8); display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
        '.notify-item.unread strong::before { content:""; display:inline-block; width:7px; height:7px; border-radius:50%; background:#60a5fa; margin-right:6px; vertical-align:middle; }',
        '.notify-empty { padding:14px; color:var(--text-muted, #94a3b8); font-size:.88rem; }',
        '.notify-settings { padding:10px 14px 14px; border-top:1px solid var(--border-glass); display:grid; gap:6px; font-size:.86rem; }',
        '.notify-settings label { display:flex; gap:8px; align-items:center; cursor:pointer; }',
        '@media (min-width: 769px) { .main-content .content-header { padding-right:56px; } }',
        '@media (max-width: 768px) { #notify-bell { top:7px; right:10px; width:40px; height:40px; } #notify-panel { top:58px; right:10px; } }'
    ].join('\n');
    document.head.appendChild(style);

    var bell = document.createElement('button');
    bell.id = 'notify-bell'; bell.type = 'button';
    bell.setAttribute('aria-label', '通知中心'); bell.setAttribute('aria-expanded', 'false'); bell.setAttribute('aria-controls', 'notify-panel');
    bell.innerHTML = '🔔<span class="count" hidden></span>';
    var panel = document.createElement('div');
    panel.id = 'notify-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '通知中心');
    document.body.appendChild(bell);
    document.body.appendChild(panel);

    bell.onclick = function (event) {
        event.stopPropagation();
        var open = !panel.classList.contains('open');
        panel.classList.toggle('open', open);
        bell.setAttribute('aria-expanded', String(open));
        if (open) render();
    };
    panel.addEventListener('click', function (event) { event.stopPropagation(); });
    document.addEventListener('click', function (event) { if (event.target !== bell) close(); });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') close(); });
    function close() { panel.classList.remove('open'); bell.setAttribute('aria-expanded', 'false'); }

    function go(target) {
        close();
        if (window.ClubMessages && window.ClubMessages.show) window.ClubMessages.show(target.tab || 'chat', target.conv || '');
        else if (typeof showPanel === 'function') showPanel('messages');
    }

    function render() {
        var anns = summary.announcements || [], convs = summary.conversations || [];
        var html = '<header><strong>通知中心</strong><span><button type="button" data-act="read-all">全部標為已讀</button></span></header>';
        html += '<h4>未讀（' + (summary.unreadMessages + summary.unreadAnnouncements) + '）</h4>';
        if (!anns.length && !convs.length) html += '<div class="notify-empty">沒有未讀的訊息或公告 🎉</div>';
        anns.forEach(function (a) {
            html += '<button type="button" class="notify-item unread" data-tab="announcements"><strong>' + (a.pinned ? '📌 ' : '📢 ') + esc(a.title) + '</strong><small>公告・' + esc(a.createdByName || '') + '・' + esc(when(a.createdAt)) + '</small></button>';
        });
        convs.forEach(function (c) {
            html += '<button type="button" class="notify-item unread" data-tab="' + (c.kind === 'dm' ? 'dm' : 'chat') + '" data-conv="' + esc(c.conv) + '"><strong>💬 ' + esc(c.name || '私人訊息') + '（' + c.unread + '）</strong><small>' + esc(c.lastAuthor || '') + '：' + esc(c.lastPreview || '') + '</small></button>';
        });
        html += '<h4>最近通知</h4>';
        if (!history.length) html += '<div class="notify-empty">尚無通知紀錄</div>';
        history.slice(0, 20).forEach(function (h) {
            html += '<button type="button" class="notify-item" data-tab="' + esc(h.tab) + '" data-conv="' + esc(h.conv || '') + '"><strong>' + esc(h.title) + '</strong><small>' + esc(when(h.at)) + '・' + esc(h.body) + '</small></button>';
        });
        if (history.length) html += '<div class="row-actions" style="padding:6px 14px;"><button type="button" data-act="clear">清除通知紀錄</button></div>';
        var perm = supported() ? Notification.permission : 'unsupported';
        html += '<div class="notify-settings"><strong>通知設定（此瀏覽器）</strong>'
            + check('system', '顯示系統通知（分頁在背景時也會跳出）', perm === 'unsupported')
            + (perm === 'denied' ? '<small class="notify-empty" style="padding:0">瀏覽器已封鎖本網站通知，請到網址列左側的網站設定開啟。</small>' : '')
            + (perm === 'unsupported' ? '<small class="notify-empty" style="padding:0">此瀏覽器不支援系統通知。</small>' : '')
            + check('announcements', '新公告') + check('messages', '新訊息（聊天室、私訊）') + check('sound', '提示音') + check('mute', '勿擾模式（暫停所有通知）')
            + '</div>';
        panel.innerHTML = html;
        panel.querySelectorAll('.notify-item').forEach(function (b) { b.onclick = function () { go({ tab: b.dataset.tab, conv: b.dataset.conv }); }; });
        panel.querySelectorAll('.notify-settings input').forEach(function (input) { input.onchange = function () { setOption(input.dataset.key, input.checked); }; });
        var readAll = panel.querySelector('[data-act="read-all"]');
        readAll.onclick = async function () {
            try {
                var response = await fetch('/api/messages/read-all', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
                if (!response.ok) throw new Error();
                if (window.ClubMessages && window.ClubMessages.refresh) window.ClubMessages.refresh();
            } catch (e) { if (typeof showToast === 'function') showToast('無法標為已讀', true); }
        };
        var clear = panel.querySelector('[data-act="clear"]');
        if (clear) clear.onclick = function () { history = []; save(KEY_HISTORY, history); render(); };
    }
    function check(key, label, disabled) {
        return '<label><input type="checkbox" data-key="' + key + '"' + (settings[key] ? ' checked' : '') + (disabled ? ' disabled' : '') + '> ' + label + '</label>';
    }

    async function setOption(key, value) {
        if (key === 'system' && value && supported() && Notification.permission !== 'granted') {
            var result = await Notification.requestPermission();
            value = result === 'granted';
        }
        settings[key] = value;
        save(KEY_SETTINGS, settings);
        render();
    }

    function beep() {
        try {
            var Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            var ctx = new Ctx(), osc = ctx.createOscillator(), gain = ctx.createGain();
            osc.frequency.value = 880; gain.gain.value = 0.06;
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start(); gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35); osc.stop(ctx.currentTime + 0.36);
            osc.onended = function () { ctx.close(); };
        } catch (e) { /* audio blocked until the user interacts with the page */ }
    }

    async function systemNotify(item) {
        if (!settings.system || !supported() || Notification.permission !== 'granted') return false;
        var options = { body: item.body, icon: '/assets/icons/icon-192x192.png', badge: '/assets/icons/icon-192x192.png', tag: item.key, data: { url: '/admin/dashboard#notify=' + encodeURIComponent(item.tab) + ':' + encodeURIComponent(item.conv || ''), tab: item.tab, conv: item.conv || '' } };
        try {
            var reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration('/') : null;
            if (reg && reg.showNotification) { await reg.showNotification(item.title, options); return true; }
            var note = new Notification(item.title, options);
            note.onclick = function () { window.focus(); go(item); note.close(); };
            return true;
        } catch (e) { return false; }
    }

    function notify(item) {
        history.unshift({ title: item.title, body: item.body, tab: item.tab, conv: item.conv || '', at: new Date().toISOString() });
        history = history.slice(0, 50);
        save(KEY_HISTORY, history);
        if (settings.mute) return;
        if (settings.sound) beep();
        // In the foreground a toast is enough; in the background use the OS notification.
        var toast = function () { if (typeof showToast === 'function') showToast(item.title + '：' + item.body); };
        if (!document.hidden) return toast();
        systemNotify(item).then(function (shown) { if (!shown) toast(); });
    }

    function onSummary(s) {
        summary = s;
        var total = (s.unreadMessages || 0) + (s.unreadAnnouncements || 0);
        var count = bell.querySelector('.count');
        count.hidden = !total;
        count.textContent = total > 99 ? '99+' : String(total);
        var fresh = [];
        (s.announcements || []).forEach(function (a) {
            var key = 'a:' + a.id;
            if (seen[key]) return;
            seen[key] = true;
            if (settings.announcements) fresh.push({ key: key, title: '📢 新公告', body: a.title, tab: 'announcements' });
        });
        var current = window.ClubMessages && window.ClubMessages.current ? window.ClubMessages.current() : '';
        (s.conversations || []).forEach(function (c) {
            var key = 'c:' + c.conv + ':' + c.lastAt;
            if (seen[key]) return;
            seen[key] = true;
            if (c.conv === current && !document.hidden) return; // already on screen
            if (settings.messages) fresh.push({ key: key, title: '💬 ' + (c.name || '新訊息'), body: (c.lastAuthor ? c.lastAuthor + '：' : '') + (c.lastPreview || ''), tab: c.kind === 'dm' ? 'dm' : 'chat', conv: c.conv });
        });
        if (primed) fresh.slice(0, 3).forEach(notify);
        primed = true;
        if (panel.classList.contains('open')) render();
    }

    window.addEventListener('club:summary', function (event) { onSummary(event.detail || {}); });
    if (window.ClubMessages && window.ClubMessages.lastSummary) onSummary(window.ClubMessages.lastSummary);
    // Opened from an OS notification while no back-office tab was open.
    var hash = /^#notify=([^:]*):(.*)$/.exec(location.hash);
    if (hash) {
        window.history.replaceState(null, '', location.pathname + location.search);
        setTimeout(function () { go({ tab: decodeURIComponent(hash[1]), conv: decodeURIComponent(hash[2]) }); }, 0);
    }
    // A click on an OS notification focuses this tab; the service worker tells us where to go.
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', function (event) {
            if (event.data && event.data.type === 'notification-click') go(event.data);
        });
        navigator.serviceWorker.getRegistration('/').then(function (reg) {
            if (!reg) navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () { /* optional */ });
        }).catch(function () { /* optional */ });
    }
    window.ClubNotifications = { open: function () { bell.click(); }, settings: function () { return Object.assign({}, settings); } };
})();
