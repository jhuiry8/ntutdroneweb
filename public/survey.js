// Public survey page (/survey/<id>): mobile-first form for every question type, strict client checks
// (the server validates everything again), CAPTCHA for visitors, and edit-after-submit when allowed.
(function () {
    'use strict';
    var app = document.getElementById('survey-app');
    if (!app) return;
    var id = app.dataset.id, lang = app.dataset.lang, siteKey = app.dataset.turnstile;
    var T = JSON.parse(document.getElementById('survey-i18n').textContent);
    var survey = null, values = {}, captchaId = '', turnstileToken = '', sending = false, done = '';
    var fields = {};

    function h(tag, attrs, kids) {
        var el = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) {
            if (k === 'text') el.textContent = attrs[k]; else if (k === 'class') el.className = attrs[k];
            else if (k.slice(0, 2) === 'on') el[k] = attrs[k]; else el.setAttribute(k, attrs[k]);
        });
        (kids || []).forEach(function (kid) { if (kid) el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid); });
        return el;
    }
    function fmt(template, map) { return String(template).replace(/\{(\w+)\}/g, function (_, k) { return map[k]; }); }
    function when(iso) { return iso ? new Date(iso).toLocaleString(lang === 'en' ? 'en-US' : 'zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : ''; }
    function call(path, method, body) {
        return fetch(path, { method: method || 'GET', credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
            .then(function (r) { return r.json().then(function (d) { if (!r.ok) { var e = new Error(d.error || T.svyError); e.status = r.status; throw e; } return d; }); });
    }
    function message(text, bad) { return h('div', { class: 'svy-msg' + (bad ? ' err' : ''), role: bad ? 'alert' : 'status', text: text }); }
    function langLink() { return h('p', { style: 'text-align:right;margin:0' }, [h('a', { href: '?lang=' + (lang === 'en' ? 'zh' : 'en'), text: T.svyLangToggle })]); }

    function heading() {
        var nodes = [langLink(), h('h1', { text: survey.title })];
        if (survey.description) nodes.push(h('p', { style: 'white-space:pre-wrap;color:var(--text-secondary)', text: survey.description }));
        return nodes;
    }
    function show(nodes) { app.textContent = ''; nodes.forEach(function (n) { app.appendChild(n); }); }

    // ---- inputs ----
    function inputFor(q) {
        var wrap = h('div', {});
        if (q.type === 'single') {
            q.options.forEach(function (o) {
                var input = h('input', { type: 'radio', name: 'q_' + q.id, value: o.id });
                input.checked = values[q.id] === o.id;
                input.onchange = function () { values[q.id] = o.id; };
                wrap.appendChild(h('label', { class: 'svy-opt' }, [input, h('span', { text: o.label })]));
            });
        } else if (q.type === 'multi') {
            q.options.forEach(function (o) {
                var input = h('input', { type: 'checkbox', value: o.id });
                input.checked = (values[q.id] || []).indexOf(o.id) >= 0;
                input.onchange = function () {
                    var list = (values[q.id] || []).filter(function (v) { return v !== o.id; });
                    if (input.checked) list.push(o.id);
                    values[q.id] = list;
                };
                wrap.appendChild(h('label', { class: 'svy-opt' }, [input, h('span', { text: o.label })]));
            });
        } else if (q.type === 'dropdown') {
            var select = h('select', { 'aria-label': q.title }, [h('option', { value: '', text: T.svySelect })]);
            q.options.forEach(function (o) { select.appendChild(h('option', { value: o.id, text: o.label })); });
            select.value = values[q.id] || '';
            select.onchange = function () { values[q.id] = select.value; };
            wrap.appendChild(select);
        } else if (q.type === 'short') {
            var text = h('input', { type: 'text', maxlength: '200', 'aria-label': q.title, autocomplete: 'off' });
            text.value = values[q.id] || '';
            text.oninput = function () { values[q.id] = text.value; };
            wrap.appendChild(text);
        } else if (q.type === 'paragraph') {
            var area = h('textarea', { maxlength: '2000', 'aria-label': q.title });
            var count = h('div', { class: 'svy-count' });
            var upd = function () { count.textContent = fmt(T.svyChars, { n: area.value.length, max: 2000 }); };
            area.value = values[q.id] || ''; upd();
            area.oninput = function () { values[q.id] = area.value; upd(); };
            wrap.appendChild(area); wrap.appendChild(count);
        } else if (q.type === 'date') {
            var date = h('input', { type: 'date', 'aria-label': q.title, min: '1900-01-01', max: '2200-12-31' });
            date.value = values[q.id] || '';
            date.onchange = function () { values[q.id] = date.value; };
            wrap.appendChild(date);
        } else if (q.type === 'rating') {
            var row = h('div', { class: 'svy-stars ' + (q.style === 'star' ? 'star' : 'scale'), role: 'group', 'aria-label': q.title });
            var buttons = [];
            var paint = function () { buttons.forEach(function (b, i) { b.setAttribute('aria-pressed', String(values[q.id] === i + 1)); }); };
            for (var n = 1; n <= q.scale; n++) (function (n) {
                var label = q.style === 'star' ? '★' : String(n);
                var b = h('button', { type: 'button', text: label, 'aria-label': fmt(T.svyStars, { n: n, max: q.scale }), title: String(n) });
                if (q.style === 'star') b.appendChild(h('span', { style: 'font-size:.7rem;margin-left:2px', text: String(n) }));
                b.onclick = function () { values[q.id] = values[q.id] === n ? undefined : n; paint(); };
                buttons.push(b); row.appendChild(b);
            })(n);
            paint();
            wrap.appendChild(row);
            wrap.appendChild(h('div', { class: 'svy-scale-note' }, [h('span', { text: '1 ' + T.svyScaleLow }), h('span', { text: q.scale + ' ' + T.svyScaleHigh })]));
        }
        return wrap;
    }

    function questionCard(q) {
        var card = h('div', { class: 'svy-card', id: 'card_' + q.id }, [
            h('p', { class: 'svy-q' }, [q.title, q.required ? h('span', { class: 'req', text: '*', title: T.svyRequired }) : null])
        ]);
        if (q.description) card.appendChild(h('p', { class: 'svy-help', text: q.description }));
        card.appendChild(inputFor(q));
        card.appendChild(h('div', { class: 'svy-err', style: 'color:#ef4444;font-size:.85rem;margin-top:6px', role: 'alert' }));
        fields[q.id] = card;
        return card;
    }

    function blank(v) { return v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'string' && !v.trim()); }
    function collect() {
        var answers = {}, bad = null;
        survey.questions.forEach(function (q) {
            var card = fields[q.id], err = card.querySelector('.svy-err'), v = values[q.id];
            card.classList.remove('bad'); err.textContent = '';
            if (blank(v)) { if (q.required) { card.classList.add('bad'); err.textContent = T.svyMissing + q.title; bad = bad || card; } return; }
            answers[q.id] = typeof v === 'string' && (q.type === 'short' || q.type === 'paragraph') ? v.trim() : v;
        });
        if (bad) { bad.scrollIntoView({ block: 'center', behavior: 'smooth' }); return null; }
        return answers;
    }

    // ---- CAPTCHA (visitors) ----
    var captchaBox = h('div', {});
    var captchaInput = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'characters', maxlength: '8', 'aria-label': T.svyCaptcha });
    function loadCaptcha() {
        captchaBox.textContent = ''; captchaId = ''; turnstileToken = ''; captchaInput.value = '';
        return call('/api/public/surveys/captcha').then(function (d) {
            if (d.turnstile) {
                var holder = h('div', {}); captchaBox.appendChild(holder);
                var tries = 0;
                (function mountTs() {
                    if (window.turnstile) { window.turnstile.render(holder, { sitekey: d.turnstile, callback: function (t) { turnstileToken = t; } }); return; }
                    if (tries++ < 50) setTimeout(mountTs, 200);
                })();
                return;
            }
            captchaId = d.captchaId;
            var pic = h('div', { 'aria-hidden': 'true' }); pic.innerHTML = d.svg; // generated by the server from stroke paths
            captchaBox.appendChild(h('label', { style: 'display:block;margin-bottom:6px', text: T.svyCaptcha }));
            captchaBox.appendChild(h('div', { class: 'svy-cap' }, [pic, h('button', { type: 'button', class: 'svy-link', style: 'min-height:44px;padding:0 12px;border-radius:8px;border:1px solid var(--border-color);background:transparent;color:var(--text-primary);cursor:pointer', text: T.svyRefreshCaptcha, onclick: loadCaptcha })]));
            captchaBox.appendChild(captchaInput);
        }).catch(function () { /* the submit will explain */ });
    }

    // ---- screens ----
    function renderForm(notice) {
        fields = {};
        var nodes = heading();
        var window_ = [];
        if (survey.opensAt) window_.push(T.svyOpens + ' ' + when(survey.opensAt));
        if (survey.closesAt) window_.push(T.svyCloses + ' ' + when(survey.closesAt));
        if (window_.length) nodes.push(h('p', { class: 'svy-help', text: window_.join(' · ') }));
        nodes.push(h('p', { class: 'svy-help', text: survey.anonymous ? T.svyAnonymous : (survey.signedIn ? T.svyNamed : '') }));
        if (survey.me && survey.me.submitted) nodes.push(message(T.svyAlreadyEdit));
        if (notice) nodes.push(message(notice, true));
        if (!survey.questions.length) nodes.push(message(T.svyNoQuestions, true));
        var form = h('form', { novalidate: 'novalidate' });
        survey.questions.forEach(function (q) { form.appendChild(questionCard(q)); });
        if (survey.needCaptcha) { form.appendChild(h('div', { class: 'svy-card' }, [captchaBox])); }
        var submit = h('button', { type: 'submit', class: 'svy-submit', text: survey.me && survey.me.submitted ? T.svyUpdate : T.svySubmit });
        form.appendChild(submit);
        form.onsubmit = function (event) {
            event.preventDefault();
            if (sending) return;
            var answers = collect();
            if (!answers) return;
            var body = { answers: answers };
            if (survey.needCaptcha) {
                if (siteKey || turnstileToken) { if (!turnstileToken) { show2(T.svyVerify); return; } body.turnstileToken = turnstileToken; }
                else { body.captchaId = captchaId; body.captcha = captchaInput.value; }
            }
            sending = true; submit.disabled = true; submit.textContent = T.svySending;
            call('/api/public/surveys/' + encodeURIComponent(id) + '/respond', 'POST', body).then(function (d) {
                done = d.edited ? T.svyThanksEdit : T.svyThanks; sending = false; renderDone();
            }).catch(function (e) {
                sending = false; render(e.message);
            });
        };
        nodes.push(form);
        show(nodes);
        if (survey.needCaptcha) loadCaptcha();
    }
    function show2(text) { var old = app.querySelector('.svy-msg.err'); if (old) old.remove(); app.insertBefore(message(text, true), app.querySelector('form')); }
    function renderDone() { show(heading().concat([message(done)])); window.scrollTo(0, 0); }

    function render(notice) {
        if (survey.restricted) {
            show([langLink(), h('h1', { text: survey.title }), message(survey.requiresLogin ? T.svyLogin : T.svyRestricted, true), survey.requiresLogin ? h('p', {}, [h('a', { href: '/admin', text: T.svyLoginLink })]) : null]);
            return;
        }
        if (survey.state === 'notStarted') { show(heading().concat([message(T.svyNotStarted + (survey.opensAt ? ' ' + when(survey.opensAt) : ''), true)])); return; }
        if (survey.state === 'closed') { show(heading().concat([message(T.svyClosed, true)])); return; }
        if (survey.me && survey.me.submitted && !survey.allowEdit) { show(heading().concat([message(T.svyAlready)])); return; }
        if (survey.me && survey.me.answers && !Object.keys(values).length) values = Object.assign({}, survey.me.answers);
        renderForm(notice);
    }

    call('/api/public/surveys/' + encodeURIComponent(id)).then(function (d) { survey = d; render(); })
        .catch(function (e) { show([h('p', { class: 'svy-msg err', text: e.status === 404 ? (lang === 'en' ? 'Survey not found.' : '找不到這份問卷。') : e.message })]); });
})();
