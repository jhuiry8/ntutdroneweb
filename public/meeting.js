// Public meeting page: members without accounts check in with 學號＋姓名 and vote.
// The server ties the check-in to this browser (HttpOnly cookie) and may limit it to the venue network.
(function () {
    'use strict';
    var app = document.getElementById('app');
    var id = app.dataset.meeting;
    var state = null, error = '', timer = null, sending = false;

    function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    async function call(path, body) {
        var response = await fetch('/api/public/meetings/' + encodeURIComponent(id) + (path || ''), body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
        var data = {};
        try { data = await response.json(); } catch (e) { /* empty */ }
        if (!response.ok) throw new Error(data.error || '連線失敗，請稍後再試');
        return data;
    }

    function voteHtml(item) {
        var vote = item.vote;
        if (item.threshold === 'none') return '<p class="muted">' + (item.kindLabel === '報告事項' ? '報告事項，不表決。' : '此項不表決；如有提案，主席會另列議案表決。') + '</p>';
        if (vote.state === 'open') {
            if (item.voted) return '<p class="ok">✅ 您已投票（無記名，系統不記錄您投給哪一方）</p>';
            if (!state.me) return '<p class="warn">🗳️ 投票中，請先簽到。</p>';
            if (!state.me.canVote) return '<p class="muted">🗳️ 投票中。您以列席身分出席，不具表決權。</p>';
            return '<p class="warn">🗳️ 投票中，請選擇：</p><div class="row"><button class="primary" data-choice="agree" data-item="' + esc(item.id) + '">同意</button><button class="danger" data-choice="oppose" data-item="' + esc(item.id) + '">反對</button><button class="secondary" data-choice="abstain" data-item="' + esc(item.id) + '">棄權</button></div>';
        }
        if (vote.state === 'closed' && vote.result) return '<p>同意 ' + vote.agree + '・反對 ' + vote.oppose + '・棄權 ' + vote.abstain + '</p><p class="' + (vote.result.passed ? 'ok' : 'bad') + '">' + esc(vote.result.reason) + '</p>';
        return '<p class="muted">尚未表決</p>';
    }

    function render() {
        var focused = document.activeElement;
        if (focused && focused.tagName === 'INPUT' && timer) return; // keep what the person is typing
        if (!state) { app.innerHTML = '<h1>會議簽到</h1>' + (error ? '<div class="error">' + esc(error) + '</div>' : '<p class="muted">載入中…</p>'); return; }
        var m = state;
        var html = '<p class="muted">北科無人機社・' + esc(m.typeLabel) + '</p><h1>' + esc(m.title) + '</h1><p class="muted">' + esc(m.date + (m.time ? ' ' + m.time : '') + (m.location ? '・' + m.location : '')) + '・' + esc(m.statusLabel) + '</p>';
        if (m.onlineUrl) html += '<p><a href="' + esc(m.onlineUrl) + '" target="_blank" rel="noopener noreferrer" style="color:#93c5fd;">線上會議連結</a></p>';
        if (error) html += '<div class="error">' + esc(error) + '</div>';

        if (m.me) html += '<div class="card"><p class="ok">✅ 已簽到：' + esc(m.me.name) + '</p><p class="muted">' + (m.me.voting ? '您具有表決權。' : '您以列席身分出席，不具表決權。') + '請不要清除瀏覽器資料或換裝置，否則需要請主席重設。</p></div>';
        else if (m.status === 'open') html += '<form class="card" id="checkin"><h2>簽到</h2><p class="muted">請輸入社員名冊上的學號與姓名。一台裝置只能替一位社員簽到。</p><label>學號<input name="studentId" autocomplete="off" autocapitalize="characters" maxlength="30" required></label><label>姓名<input name="name" autocomplete="name" maxlength="50" required></label>' + '<label>現場簽到碼<input name="code" autocomplete="off" autocapitalize="characters" maxlength="12" required></label>' + '<div class="row"><button class="primary" type="submit">簽到</button></div></form>';
        else if (m.status === 'announced') html += '<div class="card"><p>會議尚未開始，開會時主席開放後即可在此頁簽到。</p></div>';
        else html += '<div class="card"><p>會議已散會。</p></div>';

        if (m.notice && m.status === 'announced') html += '<div class="card"><h2>開會通知</h2><div class="pre">' + esc(m.notice) + '</div></div>';
        if (m.totalMembers != null) html += '<p class="muted" style="margin-top:12px;">應出席 ' + m.totalMembers + ' 人，目前計入法定人數 ' + m.counted + ' 人。</p>';
        if (m.agenda.length) html += '<h2 style="margin-top:20px;">議程</h2>' + m.agenda.map(function (item, index) {
            return '<div class="card"><p class="muted">' + esc(item.kindLabel + '・第 ' + (index + 1) + ' 案') + '</p><h2>' + esc(item.title) + '</h2>' + (item.description ? '<p class="pre">' + esc(item.description) + '</p>' : '') + voteHtml(item) + (item.resolution ? '<p><strong>決議：</strong>' + esc(item.resolution) + '</p>' : '') + '</div>';
        }).join('');
        if (m.minutes) html += '<div class="card"><h2>會議紀錄</h2><div class="pre">' + esc(m.minutes) + '</div></div>';
        app.innerHTML = html;

        var form = document.getElementById('checkin');
        if (form) form.onsubmit = async function (event) {
            event.preventDefault();
            if (sending) return;
            sending = true; form.querySelector('button').disabled = true;
            try {
                state = await call('/checkin', { studentId: form.elements.studentId.value, name: form.elements.name.value, code: form.elements.code ? form.elements.code.value : '' });
                error = '';
            } catch (e) { error = e.message; }
            sending = false; document.activeElement && document.activeElement.blur(); render(); schedule();
        };
        app.querySelectorAll('[data-choice]').forEach(function (button) {
            button.onclick = async function () {
                var label = { agree: '同意', oppose: '反對', abstain: '棄權' }[button.dataset.choice];
                if (!confirm('確定投「' + label + '」？送出後不能更改。')) return;
                app.querySelectorAll('[data-choice]').forEach(function (b) { b.disabled = true; });
                try { state = await call('/ballot', { itemId: button.dataset.item, choice: button.dataset.choice }); error = ''; }
                catch (e) { error = e.message; }
                render();
            };
        });
    }

    async function refresh() {
        try { state = await call(''); if (error && state.me) error = ''; }
        catch (e) { error = e.message; }
        render(); schedule();
    }
    // Refresh every 4 seconds while the meeting is open so new votes appear without reloading.
    function schedule() {
        if (timer) clearTimeout(timer);
        timer = state && state.status === 'open' ? setTimeout(refresh, 4000) : null;
    }
    refresh();
})();
