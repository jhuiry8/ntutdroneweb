// Event page: details, one-click registration for signed-in members, guest registration, cancellation.
(function () {
    var app = document.getElementById('event-app');
    if (!app) return;
    var id = app.dataset.id, lang = app.dataset.lang, siteKey = app.dataset.turnstile;
    var T = JSON.parse(document.getElementById('event-i18n').textContent);
    var STORE = 'evtreg:' + id;
    var turnstileToken = '', captchaId = '';
    var root = document.createElement('div'); app.appendChild(root);

    function h(tag, attrs, kids) {
        var el = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') el.textContent = attrs[k]; else if (k === 'class') el.className = attrs[k]; else if (k.slice(0, 2) === 'on') el[k] = attrs[k]; else el.setAttribute(k, attrs[k]); });
        (kids || []).forEach(function (kid) { if (kid) el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid); });
        return el;
    }
    function fmt(iso) {
        if (!iso) return '';
        return new Date(iso).toLocaleString(lang === 'en' ? 'en-US' : 'zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    }
    function say(el, text, bad) { el.textContent = text; el.className = 'evt-msg' + (bad ? ' err' : ''); }
    function stash(v) { try { if (v) localStorage.setItem(STORE, JSON.stringify(v)); else localStorage.removeItem(STORE); } catch (e) {} }
    function stashed() { try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { return null; } }
    function call(path, method, body) {
        return fetch(path, { method: method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
            .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || T.evtError); return d; }); });
    }

    function render(ev, notice) {
        root.textContent = '';
        var meta = h('dl', { class: 'evt-meta' }, [
            h('dt', { text: T.evtTime }), h('dd', { text: fmt(ev.startsAt) + (ev.endsAt ? ' – ' + fmt(ev.endsAt) : '') }),
            ev.location ? h('dt', { text: T.evtPlace }) : null, ev.location ? h('dd', { text: ev.location }) : null,
            h('dt', { text: T.evtCapacity }), h('dd', { text: (ev.capacity ? ev.confirmed + ' / ' + ev.capacity : ev.confirmed + ' (' + T.evtUnlimited + ')') + (ev.waitlist ? ' · ' + T.evtWaitlistCount + ' ' + ev.waitlist : '') }),
            h('dt', { text: T.evtDeadline }), h('dd', { text: fmt(ev.registrationDeadline) }),
            h('dt', { text: T.evtFee }), h('dd', { text: ev.feeRequired ? T.evtFeeNote.replace('{n}', ev.feeAmount) : T.evtFeeFree }),
            h('dt', { text: T.evtAudience }), h('dd', { text: ev.audienceLabel })
        ]);
        var desc = h('div', { class: 'evt-desc' }); desc.innerHTML = ev.descriptionHtml; // sanitized on the server
        root.appendChild(h('h1', { text: ev.title }));
        root.appendChild(h('div', { class: 'evt-card' }, [meta]));
        if (ev.descriptionHtml) root.appendChild(h('div', { class: 'evt-card' }, [desc]));
        var card = h('div', { class: 'evt-card' }); root.appendChild(card);
        var msg = h('div', {}); if (notice) say(msg, notice);
        var memberOnly = ev.audience !== 'public' && !ev.canRegister;

        if (ev.me) {
            card.appendChild(h('p', { text: ev.me.status === 'confirmed' ? T.evtConfirmed : T.evtWaitlisted.replace('{n}', ev.me.position) }));
            card.appendChild(h('button', { class: 'btn btn-secondary', text: T.evtCancel, onclick: function () {
                if (!confirm(T.evtCancelConfirm)) return;
                call('/api/events/' + id + '/cancel', 'POST', {}).then(function (d) { render(d.event, T.evtCancelled); }).catch(function (e) { say(msg, e.message, true); });
            } }));
        } else if (memberOnly) {
            card.appendChild(h('p', { text: ev.audience === 'officers' ? T.evtOfficersOnly : T.evtLoginRequired }));
            if (ev.audience !== 'officers') card.appendChild(h('a', { class: 'btn btn-primary', href: '/admin', text: T.evtLogin }));
        } else if (!ev.open) {
            card.appendChild(h('p', { text: T.evtClosed }));
        } else if (ev.canRegister && !ev.guestAllowed) {
            card.appendChild(h('button', { class: 'btn btn-primary', text: ev.full ? T.evtJoinWaitlist : T.evtRegister, onclick: function () {
                call('/api/events/' + id + '/register', 'POST', {}).then(function (d) { render(d, null); }).catch(function (e) { say(msg, e.message, true); });
            } }));
        } else if (ev.guestAllowed) {
            var saved = stashed();
            if (saved) {
                card.appendChild(h('p', { text: T.evtGuestMine.replace('{status}', saved.status === 'confirmed' ? T.evtStatusConfirmed : T.evtStatusWaitlist) }));
                card.appendChild(h('p', {}, [T.evtCancelCode + ': ', h('code', { text: saved.token })]));
                card.appendChild(h('button', { class: 'btn btn-secondary', text: T.evtCancel, onclick: function () {
                    if (!confirm(T.evtCancelConfirm)) return;
                    call('/api/events/' + id + '/cancel', 'POST', { registrationId: saved.id, token: saved.token }).then(function (d) { stash(null); render(d.event, T.evtCancelled); }).catch(function (e) { say(msg, e.message, true); });
                } }));
            } else guestForm(card, ev, msg);
        }
        card.appendChild(msg);
        var manage = h('a', { href: '/admin/events', text: T.evtManage, style: 'display:none;margin-top:12px;' });
        root.appendChild(manage);
        if (ev.description !== undefined) manage.style.display = 'inline-block';
    }

    function guestForm(card, ev, msg) {
        card.appendChild(h('h3', { text: T.evtGuestTitle }));
        var form = h('form', { class: 'evt-form' });
        function field(name, label, type) { var input = h('input', { name: name, type: type || 'text', required: 'required', autocomplete: 'off' }); form.appendChild(h('label', { text: label }, [input])); return input; }
        var name = field('name', T.evtName), sid = field('studentId', T.evtStudentId), email = field('email', T.evtEmail, 'email');
        var capBox = h('div', {}); form.appendChild(capBox);
        var code = null;
        function loadCaptcha() {
            capBox.textContent = ''; captchaId = ''; turnstileToken = '';
            call('/api/public/events/captcha', 'GET').then(function (d) {
                if (d.turnstile !== undefined) {
                    var holder = h('div', { style: 'margin-top:10px;' }); capBox.appendChild(holder);
                    var tries = 0;
                    (function mount() { if (window.turnstile && siteKey) window.turnstile.render(holder, { sitekey: siteKey, callback: function (tk) { turnstileToken = tk; } }); else if (tries++ < 50) setTimeout(mount, 200); })();
                    return;
                }
                captchaId = d.captchaId;
                var img = h('div', { style: 'margin-top:10px;background:#fff;border-radius:8px;display:inline-block;' }); img.innerHTML = d.svg; // server-generated SVG strokes
                code = h('input', { name: 'captcha', required: 'required', autocomplete: 'off', placeholder: T.evtCaptcha });
                capBox.appendChild(img);
                capBox.appendChild(h('button', { type: 'button', class: 'btn btn-secondary', style: 'margin-left:8px;', text: T.evtRefreshCaptcha, onclick: loadCaptcha }));
                capBox.appendChild(code);
            }).catch(function (e) { say(msg, e.message, true); });
        }
        loadCaptcha();
        form.appendChild(h('button', { type: 'submit', class: 'btn btn-primary', style: 'margin-top:14px;', text: ev.full ? T.evtJoinWaitlist : T.evtSubmit }));
        form.onsubmit = function (e) {
            e.preventDefault();
            call('/api/events/' + id + '/register', 'POST', { guest: { name: name.value, studentId: sid.value, email: email.value }, captchaId: captchaId, captcha: code ? code.value : '', turnstileToken: turnstileToken })
                .then(function (d) { stash({ id: d.registration.id, token: d.cancelToken, status: d.registration.status }); render(d.event, T.evtGuestDone); })
                .catch(function (err) { say(msg, err.message, true); loadCaptcha(); });
        };
        card.appendChild(form);
    }

    call('/api/events/' + id, 'GET').then(function (ev) { render(ev, null); }).catch(function (e) { root.textContent = ''; root.appendChild(h('p', { class: 'evt-msg err', text: e.message })); });
})();
