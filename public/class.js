// Public class check-in page, opened from the QR code officers show in class.
// Members sign in with 學號＋姓名; names that are not on the roster can sign in as a visitor.
// The link carries a short-lived token (?t=…); the server ties each check-in to this browser.
(function () {
    'use strict';
    var app = document.getElementById('app');
    var id = app.dataset.class;
    var token = new URLSearchParams(location.search).get('t') || '';
    var state = null, error = '', sending = false, guestPrompt = null;

    function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    async function call(body) {
        var base = '/api/public/classes/' + encodeURIComponent(id);
        var response = body
            ? await fetch(base + '/checkin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ t: token }, body)) })
            : await fetch(base + '?t=' + encodeURIComponent(token));
        var data = {};
        try { data = await response.json(); } catch (e) { /* empty */ }
        if (!response.ok) { var failure = new Error(data.error || '連線失敗，請稍後再試'); failure.notInRoster = data.notInRoster === true && response.status === 404; throw failure; }
        return data;
    }

    function resultHtml(me) {
        var html = '<div class="card"><p class="ok">✅ 簽到完成：' + esc(me.name) + '（' + esc(me.kindLabel) + '）</p>';
        if (me.overLimit) html += '<p class="warn">您本學年的免費體驗次數（2 次）已用完，後續社課需要繳費。這筆簽到已先記錄，是否放行由幹部決定，請向幹部說明。</p>';
        else if (me.kind === 'trial') html += '<p>' + (me.joined ? '已將您加入非正式社員。' : '') + '這是免費體驗社課，本學年還剩 <strong>' + esc(me.remaining) + '</strong> 次免費體驗。</p>';
        else if (me.kind === 'guest') html += '<p class="muted">已用訪客身分簽到。想成為社員，歡迎向幹部詢問。</p>';
        return html + '<p class="muted">請不要清除瀏覽器資料或換裝置；一台裝置只能替一個人簽到。</p></div>';
    }

    function render() {
        if (!state) { app.innerHTML = '<h1>社課簽到</h1>' + (error ? '<div class="error">' + esc(error) + '</div>' : '<p class="muted">載入中…</p>'); return; }
        var c = state;
        var html = '<p class="muted">北科無人機社・社課簽到</p><h1>' + esc(c.topic) + '</h1><p class="muted">' + esc(c.date + (c.time ? ' ' + c.time : '') + (c.instructor ? '・講師 ' + c.instructor : '') + (c.location ? '・' + c.location : '')) + '</p>';
        if (error) html += '<div class="error">' + esc(error) + '</div>';
        if (c.me) html += resultHtml(c.me);
        else if (c.tokenError) html += '<div class="card"><p class="warn">' + esc(c.tokenError) + '</p></div>';
        else if (guestPrompt) html += '<form class="card" id="guest"><h2>名冊中找不到您</h2><p class="muted">學號 ' + esc(guestPrompt.studentId) + '・' + esc(guestPrompt.name) + '。如果是第一次來，可以用訪客身分簽到。</p>'
            + '<label class="check"><input type="checkbox" name="join"><span>同時加入社團成為非正式社員（本次算第 1 次免費體驗，每學年最多免費 2 次）</span></label>'
            + '<div class="row"><button class="secondary" type="button" id="back">返回修改</button><button class="primary" type="submit">以訪客身分簽到</button></div></form>';
        else html += '<form class="card" id="checkin"><h2>簽到</h2><p class="muted">請輸入社員名冊上的學號與姓名。一台裝置只能替一個人簽到。</p><label>學號<input type="text" name="studentId" autocomplete="off" autocapitalize="characters" maxlength="30" required></label><label>姓名<input type="text" name="name" autocomplete="name" maxlength="50" required></label><div class="row"><button class="primary" type="submit">簽到</button></div></form>';
        app.innerHTML = html;

        var form = document.getElementById('checkin');
        if (form) form.onsubmit = function (event) {
            event.preventDefault();
            submit({ studentId: form.elements.studentId.value, name: form.elements.name.value }, form);
        };
        var guest = document.getElementById('guest');
        if (guest) {
            document.getElementById('back').onclick = function () { guestPrompt = null; error = ''; render(); };
            guest.onsubmit = function (event) {
                event.preventDefault();
                submit({ studentId: guestPrompt.studentId, name: guestPrompt.name, asGuest: true, join: guest.elements.join.checked }, guest);
            };
        }
    }

    async function submit(body, form) {
        if (sending) return;
        sending = true; form.querySelector('button[type=submit]').disabled = true;
        try {
            state = await call(body); error = ''; guestPrompt = null;
        } catch (failure) {
            error = failure.message;
            if (failure.notInRoster) { guestPrompt = { studentId: body.studentId, name: body.name }; error = ''; }
        }
        sending = false; render();
    }

    call().then(function (data) { state = data; render(); }).catch(function (failure) { error = failure.message; render(); });
})();
