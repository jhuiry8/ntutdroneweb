// Officer page for events: create / edit, roster, manual add / remove, paid flag, CSV export.
(function () {
    var app = document.getElementById('app');
    var meta = { audiences: {}, categories: {} };
    var events = [];
    function h(tag, attrs, kids) {
        var el = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') el.textContent = attrs[k]; else if (k === 'class') el.className = attrs[k]; else if (k.slice(0, 2) === 'on') el[k] = attrs[k]; else el.setAttribute(k, attrs[k]); });
        (kids || []).forEach(function (kid) { if (kid) el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid); });
        return el;
    }
    function call(path, method, body) {
        return fetch(path, { method: method || 'GET', credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
            .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || '發生錯誤'); return d; }); });
    }
    function fmt(iso) { return iso ? new Date(iso).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : ''; }
    var notice = h('div', {});
    function say(text, bad) { notice.textContent = text; notice.className = 'msg' + (bad ? ' err' : ''); }

    function load() {
        return call('/api/events').then(function (d) { events = d.events; meta = d; draw(); }).catch(function (e) { app.textContent = e.message; });
    }

    function draw() {
        app.textContent = '';
        app.appendChild(h('h1', { text: '活動管理' }));
        app.appendChild(h('p', { class: 'muted' }, [h('a', { href: '/admin/dashboard', text: '← 回後台' }), ' · ', h('a', { href: '/calendar', text: '前台行事曆' })]));
        app.appendChild(notice);
        app.appendChild(h('button', { text: '＋ 新增活動', onclick: function () { form(null); } }));
        var box = h('div', { class: 'card' });
        var table = h('table', {}, [h('tr', {}, ['活動', '時間', '對象', '已報名', '候補', ''].map(function (t) { return h('th', { text: t }); }))]);
        events.slice().sort(function (a, b) { return b.startsAt.localeCompare(a.startsAt); }).forEach(function (ev) {
            table.appendChild(h('tr', {}, [
                h('td', {}, [h('strong', { text: ev.title }), h('span', { class: 'tag', text: ev.categoryLabel, style: 'margin-left:6px;' })]),
                h('td', { text: fmt(ev.startsAt) }), h('td', { text: ev.audienceLabel }),
                h('td', { text: ev.capacity ? ev.confirmed + '/' + ev.capacity : String(ev.confirmed) }), h('td', { text: String(ev.waitlist) }),
                h('td', {}, [h('button', { class: 'secondary', text: '名單', onclick: function () { roster(ev); } }), ' ', h('button', { class: 'secondary', text: '編輯', onclick: function () { form(ev); } })])
            ]));
        });
        box.appendChild(h('div', { class: 'wrap' }, [table]));
        app.appendChild(box);
        app.appendChild(h('div', { id: 'detail' }));
    }

    function detail() { var d = document.getElementById('detail'); d.textContent = ''; return d; }

    function form(ev) {
        var d = detail();
        var f = {};
        function field(key, label, type, value, extra) {
            var input = type === 'select' ? h('select', {}) : type === 'textarea' ? h('textarea', { rows: '5' }) : h('input', { type: type });
            if (type === 'select') Object.keys(extra).forEach(function (k) { input.appendChild(h('option', { value: k, text: extra[k] })); });
            if (type === 'checkbox') input.checked = !!value; else input.value = value == null ? '' : value;
            f[key] = input; return h('label', { text: label }, [input]);
        }
        var card = h('div', { class: 'card' }, [h('h2', { text: ev ? '編輯活動' : '新增活動' }),
            h('div', { class: 'grid' }, [
                field('title', '標題', 'text', ev && ev.title), field('category', '類別', 'select', ev ? ev.category : 'other', meta.categories),
                field('startsAt', '開始時間（台北）', 'datetime-local', ev && ev.startsLocal), field('endsAt', '結束時間', 'datetime-local', ev && ev.endsLocal),
                field('location', '地點', 'text', ev && ev.location), field('capacity', '名額（0 = 不限）', 'number', ev ? ev.capacity : 0),
                field('registrationDeadline', '報名截止（空白 = 活動開始前）', 'datetime-local', ev && ev.deadlineLocal), field('audience', '限制對象', 'select', ev ? ev.audience : 'public', meta.audiences),
                field('feeRequired', '需要繳費', 'checkbox', ev && ev.feeRequired), field('feeAmount', '費用（NT$）', 'number', ev ? ev.feeAmount : 0)
            ]),
            field('description', '說明（Markdown）', 'textarea', ev && ev.description)
        ]);
        var save = h('button', { text: '儲存', onclick: function () {
            var body = {};
            Object.keys(f).forEach(function (k) { body[k] = f[k].type === 'checkbox' ? f[k].checked : f[k].value; });
            ['capacity', 'feeAmount'].forEach(function (k) { body[k] = body[k] === '' ? 0 : Number(body[k]); });
            call(ev ? '/api/events/' + ev.id : '/api/events', ev ? 'PATCH' : 'POST', body).then(function () { say('已儲存'); d.textContent = ''; return load(); }).catch(function (e) { say(e.message, true); });
        } });
        var row = h('div', { class: 'row' }, [save, h('button', { class: 'secondary', text: '取消', onclick: function () { d.textContent = ''; } })]);
        if (ev) row.appendChild(h('button', { class: 'danger', text: '刪除活動', onclick: function () {
            if (!confirm('刪除活動會一併刪除所有報名資料，確定嗎？')) return;
            call('/api/events/' + ev.id, 'DELETE').then(function () { say('已刪除'); d.textContent = ''; return load(); }).catch(function (e) { say(e.message, true); });
        } }));
        card.appendChild(row); d.appendChild(card);
    }

    function roster(ev) {
        var d = detail();
        call('/api/events/' + ev.id + '/registrations').then(function (data) { drawRoster(d, data.event, data.registrations); }).catch(function (e) { say(e.message, true); });
    }
    function drawRoster(d, ev, regs) {
        d.textContent = '';
        var card = h('div', { class: 'card' }, [h('h2', { text: ev.title + ' － 報名名單' }),
            h('p', { class: 'muted', text: '已報名 ' + ev.confirmed + (ev.capacity ? ' / ' + ev.capacity : '') + '，候補 ' + ev.waitlist + (ev.reminderSentAt ? '，已發送前一天提醒' : '') })]);
        var table = h('table', {}, [h('tr', {}, ['#', '狀態', '姓名', '學號', 'Email', '來源'].concat(ev.feeRequired ? ['已繳費'] : []).concat(['']).map(function (t) { return h('th', { text: t }); }))]);
        regs.forEach(function (r) {
            var cells = [h('td', { text: String(r.order) }), h('td', { text: r.status === 'confirmed' ? '已報名' : '候補' }), h('td', { text: r.name }), h('td', { text: r.studentId }), h('td', { text: r.email }), h('td', { text: { member: '社員帳號', guest: '訪客', manual: '幹部加入' }[r.kind] || r.kind })];
            if (ev.feeRequired) {
                var paid = h('input', { type: 'checkbox' }); paid.checked = r.paid;
                paid.onchange = function () { call('/api/events/' + ev.id + '/registrations/' + r.id, 'PATCH', { paid: paid.checked }).catch(function (e) { say(e.message, true); }); };
                cells.push(h('td', {}, [paid]));
            }
            cells.push(h('td', {}, [h('button', { class: 'danger', text: '移除', onclick: function () {
                if (!confirm('移除 ' + r.name + '？若為正式名額，候補第一位會自動遞補。')) return;
                call('/api/events/' + ev.id + '/registrations/' + r.id, 'DELETE').then(function (data) { drawRoster(d, data.event, data.registrations); load(); }).catch(function (e) { say(e.message, true); });
            } })]));
            table.appendChild(h('tr', {}, cells));
        });
        card.appendChild(h('div', { class: 'wrap' }, [table]));
        card.appendChild(h('div', { class: 'row' }, [h('a', { class: 'btn secondary', href: '/api/events/' + ev.id + '/registrations.csv', text: '匯出 CSV' })]));
        var add = {};
        function f(k, label, type) { add[k] = h('input', { type: type || 'text' }); return h('label', { text: label }, [add[k]]); }
        var force = h('input', { type: 'checkbox' });
        card.appendChild(h('h3', { text: '手動加入' }));
        card.appendChild(h('div', { class: 'grid' }, [f('name', '姓名'), f('studentId', '學號'), f('email', 'Email', 'email'), h('label', {}, [force, ' 名額已滿仍直接列為正式名額'])]));
        card.appendChild(h('div', { class: 'row' }, [h('button', { text: '加入', onclick: function () {
            call('/api/events/' + ev.id + '/registrations', 'POST', { name: add.name.value, studentId: add.studentId.value, email: add.email.value, force: force.checked })
                .then(function (data) { drawRoster(d, data.event, data.registrations); load(); }).catch(function (e) { say(e.message, true); });
        } })]));
        d.appendChild(card);
    }

    load();
})();
