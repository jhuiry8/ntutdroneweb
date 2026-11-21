// Officer page for surveys: list, create (blank or from a template), copy, and the question editor.
(function () {
    'use strict';
    var app = document.getElementById('app');
    var meta = { audiences: {}, types: {}, limits: {} };
    var surveys = [], templates = [];
    var notice = h('div', {});

    function h(tag, attrs, kids) {
        var el = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) {
            if (k === 'text') el.textContent = attrs[k]; else if (k === 'class') el.className = attrs[k];
            else if (k.slice(0, 2) === 'on') el[k] = attrs[k]; else el.setAttribute(k, attrs[k]);
        });
        (kids || []).forEach(function (kid) { if (kid) el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid); });
        return el;
    }
    function call(path, method, body) {
        return fetch(path, { method: method || 'GET', credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
            .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || '發生錯誤'); return d; }); });
    }
    function say(text, bad) { notice.textContent = text; notice.className = 'msg' + (bad ? ' err' : ''); }
    function fail(e) { say(e.message, true); }
    function fmt(iso) { return iso ? new Date(iso).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : '—'; }
    function taipeiInput(iso) { if (iso && iso.length === 16) return iso; return iso ? new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0, 16) : ''; }
    var STATES = { open: '開放中', notStarted: '尚未開放', closed: '已截止' };

    function load() {
        return Promise.all([call('/api/surveys'), call('/api/surveys/templates')]).then(function (r) { surveys = r[0].surveys; meta = r[0].meta; templates = r[1].templates; list(); }).catch(function (e) { app.textContent = e.message; });
    }

    function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(function () { say('已複製連結：' + text); }, function () { window.prompt('複製連結', text); });
        window.prompt('複製連結', text); return Promise.resolve();
    }

    function list() {
        app.textContent = '';
        app.appendChild(h('h1', { text: '問卷與回饋' }));
        app.appendChild(h('p', { class: 'muted noprint' }, [h('a', { href: '/admin/dashboard', text: '← 回後台' })]));
        app.appendChild(notice);
        var create = h('div', { class: 'card noprint' }, [h('h2', { text: '建立問卷' })]);
        var row = h('div', { class: 'row' }, [h('button', { text: '＋ 空白問卷', onclick: function () { edit(null); } })]);
        templates.forEach(function (t) {
            row.appendChild(h('button', { class: 'secondary', title: t.description, text: '範本：' + t.name, onclick: function () {
                call('/api/surveys', 'POST', { template: t.key }).then(function (s) { return load().then(function () { edit(s.id); }); }).catch(fail);
            } }));
        });
        create.appendChild(row);
        app.appendChild(create);

        var box = h('div', { class: 'card' });
        if (!surveys.length) box.appendChild(h('p', { class: 'muted', text: '還沒有問卷。可以從上方範本一鍵建立。' }));
        else {
            var table = h('table', {}, [h('tr', {}, ['問卷', '狀態', '對象', '回覆', '期間', ''].map(function (t) { return h('th', { text: t }); }))]);
            surveys.forEach(function (s) {
                var link = location.origin + '/survey/' + s.id;
                table.appendChild(h('tr', {}, [
                    h('td', {}, [h('strong', { text: s.title }), s.anonymous ? h('span', { class: 'tag', style: 'margin-left:6px', text: '匿名' }) : null,
                        s.link ? h('div', { class: 'muted', text: (s.link.type === 'class' ? '社課：' : '活動：') + (s.link.label || s.link.id) }) : null]),
                    h('td', { text: STATES[s.state] || s.state }), h('td', { text: s.audienceLabel }), h('td', { text: String(s.responseCount) }),
                    h('td', { class: 'muted', text: s.opensAt || s.closesAt ? fmt(s.opensAt) + ' ～ ' + fmt(s.closesAt) : '不限' }),
                    h('td', {}, [
                        h('a', { class: 'btn', href: '/admin/surveys/' + s.id + '/report', text: '報表' }), ' ',
                        h('button', { class: 'secondary', text: '編輯', onclick: function () { edit(s.id); } }), ' ',
                        h('button', { class: 'secondary', text: '複製連結', onclick: function () { copyText(link); } }), ' ',
                        h('button', { class: 'secondary', text: '複製問卷', onclick: function () { call('/api/surveys/' + s.id + '/duplicate', 'POST', {}).then(function () { say('已複製問卷'); return load(); }).catch(fail); } }), ' ',
                        h('button', { class: 'danger', text: '刪除', onclick: function () {
                            if (confirm('確定刪除「' + s.title + '」與其 ' + s.responseCount + ' 份回覆？此動作無法復原。')) call('/api/surveys/' + s.id, 'DELETE').then(function () { say('已刪除'); return load(); }).catch(fail);
                        } })
                    ])
                ]));
            });
            box.appendChild(h('div', { class: 'wrap' }, [table]));
        }
        app.appendChild(box);
    }

    // ---- editor ----
    var draft = null, locked = false;
    function edit(id) {
        if (!id) { draft = { title: '', description: '', questions: [blankQuestion()], audience: 'public', anonymous: false, limitOnce: true, allowEdit: false, enabled: true, link: null, opensAt: null, closesAt: null, responseCount: 0 }; return editor(); }
        call('/api/surveys/' + id).then(function (s) { draft = s; editor(); }).catch(fail);
    }
    function blankQuestion() { return { type: 'single', title: '', description: '', required: false, options: [{ label: '選項 1' }], scale: 5, style: 'star' }; }

    function field(label, input) { return h('label', {}, [label, input]); }
    function textInput(obj, key, max, tag) {
        var el = h(tag || 'input', tag ? { maxlength: String(max) } : { type: 'text', maxlength: String(max) });
        el.value = obj[key] || ''; el.oninput = function () { obj[key] = el.value; };
        return el;
    }
    function check(obj, key, label, after) {
        var input = h('input', { type: 'checkbox' }); input.checked = obj[key] === true;
        input.onchange = function () { obj[key] = input.checked; if (after) after(); };
        return h('label', { class: 'inline' }, [input, label]);
    }

    function editor() {
        locked = draft.responseCount > 0;
        app.textContent = '';
        app.appendChild(h('h1', { text: draft.id ? '編輯問卷' : '新增問卷' }));
        app.appendChild(h('p', { class: 'muted' }, [h('a', { href: '#', text: '← 回問卷列表', onclick: function (e) { e.preventDefault(); load(); } })]));
        app.appendChild(notice);
        if (locked) app.appendChild(h('div', { class: 'msg', text: '這份問卷已有 ' + draft.responseCount + ' 份回覆：可以改文字與選項，但不能更改既有題目的題型或評分範圍。' }));

        var basics = h('div', { class: 'card' }, [h('h2', { text: '基本資料' }), field('標題（最多 120 字）', textInput(draft, 'title', 120)), field('說明（最多 2000 字）', textInput(draft, 'description', 2000, 'textarea'))]);
        app.appendChild(basics);

        var settings = h('div', { class: 'card' }, [h('h2', { text: '設定' })]);
        var grid = h('div', { class: 'grid' });
        var opens = h('input', { type: 'datetime-local' }); opens.value = taipeiInput(draft.opensAt); opens.onchange = function () { draft.opensAt = opens.value; };
        var closes = h('input', { type: 'datetime-local' }); closes.value = taipeiInput(draft.closesAt); closes.onchange = function () { draft.closesAt = closes.value; };
        var audience = h('select', {}); Object.keys(meta.audiences).forEach(function (k) { audience.appendChild(h('option', { value: k, text: meta.audiences[k] })); });
        audience.value = draft.audience; audience.onchange = function () { draft.audience = audience.value; };
        grid.appendChild(field('開放時間（台北時間，留空＝立即）', opens)); grid.appendChild(field('截止時間（留空＝不截止）', closes)); grid.appendChild(field('填寫對象', audience));
        settings.appendChild(grid);
        var flags = h('div', { class: 'row' });
        var editBox;
        var sync = function () { if (draft.anonymous) draft.allowEdit = false; if (!draft.limitOnce) draft.allowEdit = false; editBox.input.disabled = draft.anonymous || !draft.limitOnce; if (editBox.input.disabled) editBox.input.checked = false; };
        flags.appendChild(check(draft, 'enabled', '開放填寫（取消勾選＝手動關閉）'));
        flags.appendChild(check(draft, 'anonymous', '匿名（不記錄填寫者，也不能修改答案）', function () { sync(); }));
        flags.appendChild(check(draft, 'limitOnce', '每人限填一次（登入者以帳號、訪客以裝置判斷）', function () { sync(); }));
        var editLabel = check(draft, 'allowEdit', '允許修改答案');
        editBox = { input: editLabel.querySelector('input') };
        flags.appendChild(editLabel); sync();
        settings.appendChild(flags);
        settings.appendChild(h('p', { class: 'muted', text: '訪客（未登入）填寫需通過驗證碼，並受每 IP 每小時填寫次數限制；訪客的「限填一次」依瀏覽器 cookie 判斷，無法完全防止刻意清除資料重填。' }));
        if (draft.link) settings.appendChild(h('div', { class: 'row' }, [h('span', { class: 'tag', text: (draft.link.type === 'class' ? '關聯社課：' : '關聯活動：') + (draft.link.label || draft.link.id) }),
            h('button', { class: 'secondary', text: '取消關聯', onclick: function () { draft.link = null; editor(); } })]));
        app.appendChild(settings);

        var qbox = h('div', { class: 'card' }, [h('h2', { text: '題目（' + draft.questions.length + '/' + (meta.limits.questions || 50) + '）' })]);
        draft.questions.forEach(function (q, i) { qbox.appendChild(questionEditor(q, i)); });
        qbox.appendChild(h('div', { class: 'row' }, [h('button', { text: '＋ 新增題目', onclick: function () { if (draft.questions.length >= (meta.limits.questions || 50)) return say('題目數已達上限', true); draft.questions.push(blankQuestion()); editor(); } })]));
        app.appendChild(qbox);

        app.appendChild(h('div', { class: 'row' }, [h('button', { text: '儲存問卷', onclick: save }), h('button', { class: 'secondary', text: '取消', onclick: load })]));
    }

    function move(list, i, d) { var j = i + d; if (j < 0 || j >= list.length) return; var t = list[i]; list[i] = list[j]; list[j] = t; }

    function questionEditor(q, i) {
        var existing = q.id && locked; // an id means it was saved before
        var box = h('div', { class: 'q' });
        box.appendChild(h('strong', { text: '第 ' + (i + 1) + ' 題' }));
        var type = h('select', {}); Object.keys(meta.types).forEach(function (k) { type.appendChild(h('option', { value: k, text: meta.types[k] })); });
        type.value = q.type; type.disabled = existing;
        type.onchange = function () {
            q.type = type.value;
            if (['single', 'multi', 'dropdown'].indexOf(q.type) >= 0 && !(q.options && q.options.length)) q.options = [{ label: '選項 1' }];
            editor();
        };
        var grid = h('div', { class: 'grid' }, [field('題型', type), field('題目（最多 200 字）', textInput(q, 'title', 200))]);
        box.appendChild(grid);
        box.appendChild(field('補充說明（選填，最多 500 字）', textInput(q, 'description', 500)));
        if (['single', 'multi', 'dropdown'].indexOf(q.type) >= 0) {
            var opts = h('div', {}, [h('label', { text: '選項（最多 ' + (meta.limits.options || 20) + ' 個，每個最多 80 字）' })]);
            q.options.forEach(function (o, j) {
                var input = h('input', { type: 'text', maxlength: '80', 'aria-label': '選項 ' + (j + 1) }); input.value = o.label; input.oninput = function () { o.label = input.value; };
                opts.appendChild(h('div', { class: 'row', style: 'margin-top:4px' }, [input,
                    h('button', { class: 'secondary', type: 'button', text: '↑', 'aria-label': '上移', onclick: function () { move(q.options, j, -1); editor(); } }),
                    h('button', { class: 'secondary', type: 'button', text: '↓', 'aria-label': '下移', onclick: function () { move(q.options, j, 1); editor(); } }),
                    h('button', { class: 'danger', type: 'button', text: '刪', 'aria-label': '刪除選項', onclick: function () { if (q.options.length > 1) { q.options.splice(j, 1); editor(); } } })]));
            });
            opts.appendChild(h('div', { class: 'row' }, [h('button', { class: 'secondary', type: 'button', text: '＋ 選項', onclick: function () { if (q.options.length < (meta.limits.options || 20)) { q.options.push({ label: '選項 ' + (q.options.length + 1) }); editor(); } } })]));
            box.appendChild(opts);
        }
        if (q.type === 'rating') {
            var scale = h('select', {}, [h('option', { value: '5', text: '1～5' }), h('option', { value: '10', text: '1～10' })]); scale.value = String(q.scale || 5); scale.disabled = existing; scale.onchange = function () { q.scale = Number(scale.value); };
            var style = h('select', {}, [h('option', { value: 'star', text: '星等' }), h('option', { value: 'scale', text: '數字量表' })]); style.value = q.style || 'star'; style.onchange = function () { q.style = style.value; };
            box.appendChild(h('div', { class: 'grid' }, [field('範圍', scale), field('樣式', style)]));
        }
        box.appendChild(h('div', { class: 'row' }, [check(q, 'required', '必填'),
            h('button', { class: 'secondary', type: 'button', text: '↑ 上移', onclick: function () { move(draft.questions, i, -1); editor(); } }),
            h('button', { class: 'secondary', type: 'button', text: '↓ 下移', onclick: function () { move(draft.questions, i, 1); editor(); } }),
            h('button', { class: 'secondary', type: 'button', text: '複製此題', onclick: function () {
                if (draft.questions.length >= (meta.limits.questions || 50)) return say('題目數已達上限', true);
                var copy = JSON.parse(JSON.stringify(q)); delete copy.id; (copy.options || []).forEach(function (o) { delete o.id; }); draft.questions.splice(i + 1, 0, copy); editor();
            } }),
            h('button', { class: 'danger', type: 'button', text: '刪除此題', onclick: function () { if (draft.questions.length > 1) { draft.questions.splice(i, 1); editor(); } else say('至少需要一個題目', true); } })]));
        return box;
    }

    function save() {
        var body = {
            title: draft.title, description: draft.description, questions: draft.questions, audience: draft.audience, anonymous: draft.anonymous,
            limitOnce: draft.limitOnce, allowEdit: draft.allowEdit, enabled: draft.enabled, link: draft.link || null,
            opensAt: draft.opensAt && draft.opensAt.length === 16 ? draft.opensAt : (draft.opensAt || ''), closesAt: draft.closesAt && draft.closesAt.length === 16 ? draft.closesAt : (draft.closesAt || '')
        };
        // Values from the server are ISO strings with a zone; values from the inputs are Taipei local 'YYYY-MM-DDTHH:mm'.
        var request = draft.id ? call('/api/surveys/' + draft.id, 'PATCH', body) : call('/api/surveys', 'POST', body);
        request.then(function (s) { draft = s; say('已儲存'); editor(); }).catch(fail);
    }

    load();
})();
