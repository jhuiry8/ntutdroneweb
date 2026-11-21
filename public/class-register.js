// Public class list and pre-registration (/classes): upcoming sessions with seats left, one-click sign-up for
// signed-in members, 學號＋姓名＋captcha for everyone else. Values are inserted with textContent only.
(function () {
    'use strict';
    var app = document.getElementById('app');
    var state = { classes: [], signedIn: false, name: '', limit: 2 };
    var notice = {};    // class id → { text, cls }
    var captcha = null; // { captchaId, svg } | { turnstile }
    var turnstileToken = '';
    var form = '';      // id of the class whose guest form is open

    function h(tag, attrs, kids) {
        var node = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (key) { if (key === 'text') node.textContent = attrs[key]; else node.setAttribute(key, attrs[key]); });
        [].concat(kids || []).forEach(function (kid) { if (kid) node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid); });
        return node;
    }
    function stored(id) { try { return JSON.parse(localStorage.getItem('clsreg:' + id) || 'null'); } catch (e) { return null; } }
    function keep(id, value) { try { if (value) localStorage.setItem('clsreg:' + id, JSON.stringify(value)); else localStorage.removeItem('clsreg:' + id); } catch (e) { /* private mode */ } }
    function call(path, method, body) {
        return fetch(path, { method: method || 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }).then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (data) { if (!response.ok) throw new Error(data.error || '連線失敗，請稍後再試'); return data; });
        });
    }
    function say(id, text, cls) { notice[id] = { text: text, cls: cls || '' }; }

    function trialText(trial) {
        if (!trial) return '';
        return trial.needsFee
            ? '您本學年的 ' + trial.limit + ' 次免費體驗已用完。需要先繳費，但仍可報名，是否放行由幹部決定。'
            : '您是非正式社員，本學年還剩 ' + trial.remaining + ' 次免費體驗。';
    }
    function seatsText(r) {
        if (!r.enabled) return '現場簽到，免報名';
        var seats = r.capacity ? '名額 ' + r.capacity + ' 人，剩餘 ' + r.seatsLeft + ' 位' : '名額不限';
        return seats + '・已報名 ' + r.confirmed + ' 人' + (r.waitlist ? '・候補 ' + r.waitlist + ' 人' : '');
    }

    function guestForm(c) {
        var sid = h('input', { type: 'text', name: 'studentId', maxlength: '30', required: 'required', autocomplete: 'off', autocapitalize: 'characters' });
        var name = h('input', { type: 'text', name: 'name', maxlength: '50', required: 'required', autocomplete: 'name' });
        var code = null, cap = h('div', { 'class': 'captcha' });
        if (captcha && captcha.svg) {
            var img = document.createElement('img'); img.alt = '驗證碼'; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(captcha.svg);
            cap.appendChild(img);
            code = h('input', { type: 'text', name: 'captcha', required: 'required', autocomplete: 'off', placeholder: '輸入圖片中的驗證碼' });
            cap.appendChild(code);
        } else if (captcha && captcha.turnstile !== undefined) {
            if (!document.querySelector('script[src*="turnstile"]')) { var ts = document.createElement('script'); ts.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; ts.async = true; document.head.appendChild(ts); }
            var widget = h('div'); cap.appendChild(widget);
            var tries = 0;
            (function mount() { if (window.turnstile && captcha.turnstile) window.turnstile.render(widget, { sitekey: captcha.turnstile, callback: function (token) { turnstileToken = token; } }); else if (tries++ < 50) setTimeout(mount, 200); })();
        }
        var button = h('button', { type: 'submit', text: '送出報名' });
        var f = h('form', { 'class': 'row', style: 'display:block' }, [
            h('label', {}, ['學號', sid]), h('label', {}, ['姓名', name]), cap,
            h('div', { 'class': 'row' }, [button, h('button', { type: 'button', 'class': 'secondary', text: '取消' })])
        ]);
        f.lastChild.lastChild.onclick = function () { form = ''; render(); };
        f.onsubmit = function (event) {
            event.preventDefault(); button.disabled = true;
            register(c, { studentId: sid.value, name: name.value, captchaId: captcha && captcha.captchaId, captcha: code ? code.value : '', turnstileToken: turnstileToken });
        };
        return f;
    }

    function register(c, body) {
        call('/api/public/classes/' + encodeURIComponent(c.id) + '/register', 'POST', body || {}).then(function (data) {
            if (data.cancelToken) keep(c.id, { registrationId: data.registration.id, token: data.cancelToken });
            say(c.id, (data.registration.status === 'confirmed' ? '報名成功！' : '名額已滿，您在候補第 ' + data.registration.position + ' 位，有人取消時會自動遞補。') + (data.trial ? ' ' + trialText(data.trial) : '') + (data.cancelToken ? ' 這台裝置已記住取消憑證，請勿清除瀏覽器資料；要取消請在這台裝置按「取消報名」。' : ''), 'ok');
            form = ''; return load();
        }).catch(function (error) { say(c.id, error.message, 'bad'); if (form) loadCaptcha().then(render); else render(); });
    }
    function cancel(c) {
        if (!confirm('確定要取消「' + c.topic + '」的報名？')) return;
        var saved = stored(c.id);
        call('/api/public/classes/' + encodeURIComponent(c.id) + '/cancel', 'POST', state.signedIn ? {} : { registrationId: saved && saved.registrationId, token: saved && saved.token }).then(function () {
            keep(c.id, null); say(c.id, '已取消報名。', 'ok'); return load();
        }).catch(function (error) { say(c.id, error.message, 'bad'); render(); });
    }

    function card(c) {
        var r = c.registration, saved = stored(c.id);
        var mine = c.me || (!state.signedIn && saved ? { id: saved.registrationId, status: 'saved' } : null);
        var meta = [c.date + (c.time ? ' ' + c.time : ''), c.instructor && '講師 ' + c.instructor, c.location].filter(Boolean).join('・');
        var node = h('div', { 'class': 'card' }, [h('h2', { text: c.topic }), h('p', { 'class': 'muted', text: meta }), h('p', { text: seatsText(r) + (r.enabled ? '・對象：' + r.audienceLabel : '') })]);
        if (r.enabled && c.trial) node.appendChild(h('p', { 'class': c.trial.needsFee ? 'warn' : 'muted', text: trialText(c.trial) }));
        if (r.enabled) {
            if (mine) {
                var label = mine.status === 'confirmed' ? '✅ 您已報名' : mine.status === 'waitlist' ? '⏳ 您在候補第 ' + mine.position + ' 位' : '您在這台裝置報名過這場社課';
                node.appendChild(h('div', { 'class': 'row' }, [h('span', { 'class': 'ok', text: label }), h('button', { type: 'button', 'class': 'secondary', text: '取消報名' })]));
                node.lastChild.lastChild.onclick = function () { cancel(c); };
            } else if (!r.open) node.appendChild(h('p', { 'class': 'muted', text: '報名已截止。' }));
            else if (state.signedIn) {
                var go = h('button', { type: 'button', text: r.full ? '加入候補' : '一鍵報名' });
                go.onclick = function () { go.disabled = true; register(c); };
                node.appendChild(h('div', { 'class': 'row' }, [go, h('span', { 'class': 'muted', text: '以 ' + state.name + ' 報名' })]));
            } else if (form === c.id) node.appendChild(guestForm(c));
            else {
                var open = h('button', { type: 'button', text: r.full ? '加入候補' : '我要報名' });
                open.onclick = function () { form = c.id; loadCaptcha().then(render); };
                node.appendChild(h('div', { 'class': 'row' }, [open, h('a', { href: '/admin', 'class': 'muted', text: '社員可登入後一鍵報名' })]));
            }
        }
        if (notice[c.id]) node.appendChild(h('div', { 'class': 'msg ' + notice[c.id].cls, text: notice[c.id].text }));
        return node;
    }

    function render() {
        app.textContent = '';
        app.appendChild(h('p', { 'class': 'muted', text: '北科無人機社' }));
        app.appendChild(h('h1', { text: '社課列表與報名' }));
        if (!state.classes.length) app.appendChild(h('div', { 'class': 'card' }, [h('p', { 'class': 'muted', text: '近期沒有排定的社課，請稍後再回來看看。' })]));
        state.classes.forEach(function (c) { app.appendChild(card(c)); });
    }
    function loadCaptcha() {
        return call('/api/public/classes/captcha').then(function (data) { captcha = data; }).catch(function () { captcha = null; });
    }
    function load() {
        return call('/api/public/classes').then(function (data) { state = { classes: data.classes, signedIn: data.signedIn, name: data.name, limit: data.freeTrialClasses }; render(); })
            .catch(function (error) { app.textContent = ''; app.appendChild(h('div', { 'class': 'msg bad', text: error.message })); });
    }
    load();
})();
