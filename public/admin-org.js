// 帳號、職位與權限 (extra cards inside #panel-users) and 幹部名冊 (#panel-officers).
// The server decides what is allowed (permission codes, see src/permissions.js); this file only presents it.
// Everything coming from the server is inserted as text, never as HTML.
(function () {
    'use strict';
    var ADMIN_CONFIG = (typeof ADMIN !== 'undefined' && ADMIN) || {};
    var toast = function (text, isError) { if (typeof showToast === 'function') showToast(text, isError); };

    function h(tag, props) {
        var node = document.createElement(tag);
        Object.keys(props || {}).forEach(function (key) {
            if (props[key] === undefined || props[key] === null || props[key] === false) return;
            if (key === 'text') node.textContent = props[key];
            else if (key === 'class') node.className = props[key];
            else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), props[key]);
            else if (key === 'style') node.style.cssText = props[key];
            else node.setAttribute(key, props[key]);
        });
        // Children may be nodes, strings, or arrays of them (e.g. a list of position chips).
        (function append(children) {
            children.forEach(function (child) {
                if (child === null || child === undefined || child === false) return;
                if (Array.isArray(child)) append(child);
                else node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
            });
        })(Array.prototype.slice.call(arguments, 2));
        return node;
    }
    async function api(path, method, body) {
        var response = await fetch(path, { method: method || 'GET', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
        var data = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error(data.error || '操作失敗');
        return data;
    }
    async function attempt(action, success) {
        try { var result = await action(); if (success) toast(success); return result; } catch (error) { toast(error.message, true); return null; }
    }

    var style = h('style', { text: [
        '.org-card { padding:18px; border:1px solid var(--border-glass); border-radius:12px; margin-bottom:20px; }',
        '.org-card h2 { font-size:1.1rem; margin-bottom:10px; }',
        '.org-muted { color:var(--text-muted); font-size:.88rem; }',
        '.org-row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin:8px 0; }',
        '.org-perms { display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:4px 14px; margin:8px 0; }',
        '.org-perms label, .org-checks label { display:flex; gap:6px; align-items:flex-start; font-size:.88rem; }',
        '.org-group { font-weight:600; margin-top:10px; }',
        '.org-warn { color:#fbbf24; } .org-bad { color:#f87171; } .org-ok { color:#34d399; }',
        '.org-chip { display:inline-block; padding:2px 10px; margin:2px 4px 2px 0; border-radius:999px; border:1px solid var(--border-glass); font-size:.82rem; }',
        '.org-editor { margin-top:10px; padding:14px; border:1px dashed var(--border-glass); border-radius:10px; }',
        '.org-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:10px; }'
    ].join('\n') });
    document.head.appendChild(style);

    var overview = null;
    function positionName(id) { var found = overview && overview.positions.find(function (item) { return item.id === id; }); return found ? found.name : id; }
    function permLabel(code) { var found = overview && overview.permissions.find(function (item) { return item.code === code; }); return found ? found.label : code; }

    // A grouped checklist of every permission code. `locked` codes are shown but cannot be changed.
    function permissionChecklist(selected, options) {
        options = options || {};
        var box = h('div', { class: 'org-perms' });
        var boxes = {};
        var lastGroup = '';
        overview.permissions.forEach(function (item) {
            if (item.group !== lastGroup) { lastGroup = item.group; box.appendChild(h('div', { class: 'org-group', style: 'grid-column:1/-1;', text: item.group })); }
            var input = h('input', { type: 'checkbox' });
            input.checked = selected.indexOf(item.code) !== -1;
            if (options.disabled || (options.hide && options.hide.indexOf(item.code) !== -1)) input.disabled = true;
            boxes[item.code] = input;
            box.appendChild(h('label', { title: item.code }, input, h('span', { text: item.label + (item.presidentOnly ? '（僅社長可授予）' : '') })));
        });
        box.value = function () { return Object.keys(boxes).filter(function (code) { return boxes[code].checked; }); };
        return box;
    }

    // ---------------------------------------------------------------- 帳號、職位與權限
    var usersPanel = document.getElementById('panel-users');
    var orgHost = null;
    if (usersPanel) {
        orgHost = h('div', { id: 'org-host' });
        usersPanel.appendChild(orgHost);
        var originalLoadUsers = window.loadUsers;
        window.loadUsers = async function () {
            if (typeof originalLoadUsers === 'function') await originalLoadUsers.apply(this, arguments);
            loadOrg();
        };
    }

    async function loadOrg() {
        if (!orgHost) return;
        try {
            overview = await api('/api/org/overview');
            var users = await api('/api/users');
            orgHost.replaceChildren(actingCard(), accountsCard(users), positionsCard(), auditCard());
            loadAudit();
        } catch (error) {
            orgHost.replaceChildren(h('p', { class: 'org-muted', text: '職位與權限設定無法載入：' + error.message }));
        }
    }

    function actingCard() {
        var acting = overview.config.acting || {};
        var note = h('input', { class: 'form-control', placeholder: '原因（例如：社長出國交流）', maxlength: '200', style: 'max-width:340px;' });
        var button = h('button', { class: 'btn ' + (acting.active ? 'btn-secondary' : 'btn-primary'), type: 'button', text: acting.active ? '結束代理，社長回任' : '開啟代理社長' });
        button.disabled = !overview.canActing;
        button.addEventListener('click', async function () {
            if (!confirm(acting.active ? '結束代理後，副社長將失去社長權限。確定？' : '開啟後，副社長會擁有社長的全部權限，並留下紀錄。確定？')) return;
            if (await attempt(function () { return api('/api/org/acting', 'PUT', { active: !acting.active, note: note.value }); }, acting.active ? '已結束代理' : '已開啟代理社長')) loadOrg();
        });
        return h('div', { class: 'org-card' }, h('h2', { text: '代理社長' }),
            h('p', { class: 'org-muted', text: '社長因故不能行使職權時（章程第五條），由社長或系統管理者開啟；開啟期間副社長擁有社長權限。開關與時間都會記入稽核紀錄。' }),
            h('p', { class: acting.active ? 'org-warn' : 'org-muted', text: acting.active ? '目前：代理中（' + (acting.since || '').slice(0, 10) + ' 起，' + (acting.by || '') + ' 開啟' + (acting.note ? '，' + acting.note : '') + '）' : '目前：未代理' }),
            h('div', { class: 'org-row' }, acting.active ? null : note, button),
            overview.canActing ? null : h('p', { class: 'org-muted', text: '只有社長或系統管理者可以操作這個開關。' }));
    }

    function accountsCard(users) {
        var card = h('div', { class: 'org-card' }, h('h2', { text: '帳號的職位與個別權限' }),
            h('p', { class: 'org-muted', text: '實際權限 = 所有職位權限的聯集 + 個別授予 − 個別收回。名冊指派（幹部名冊）在任期內另外加上職位，任期結束自動失效。' }));
        users.forEach(function (user) {
            var chips = (user.positions || []).map(function (id) { return h('span', { class: 'org-chip', text: positionName(id) }); });
            var holder = h('div', { class: 'org-editor', hidden: 'hidden' });
            var edit = h('button', { class: 'btn btn-secondary', type: 'button', text: '編輯職位與權限' });
            edit.addEventListener('click', function () { holder.hidden = !holder.hidden; if (!holder.hidden && !holder.childNodes.length) holder.appendChild(accountEditor(user)); });
            card.appendChild(h('div', { style: 'padding:10px 0; border-top:1px solid var(--border-glass);' },
                h('div', { class: 'org-row' }, h('strong', { text: user.username }), user.active ? null : h('span', { class: 'org-bad', text: '（停用）' }), chips.length ? chips : h('span', { class: 'org-muted', text: '社員' }), edit),
                (user.grants || []).length || (user.revokes || []).length ? h('div', { class: 'org-muted', text: '個別授予 ' + (user.grants || []).length + ' 項、收回 ' + (user.revokes || []).length + ' 項' }) : null,
                holder));
        });
        return card;
    }

    function accountEditor(user) {
        var standing = user.standingPositions || [];
        var positionBoxes = {};
        var positionList = h('div', { class: 'org-perms' });
        overview.positions.filter(function (item) { return item.id !== 'member'; }).forEach(function (item) {
            var input = h('input', { type: 'checkbox' });
            input.checked = standing.indexOf(item.id) !== -1;
            if (item.id === 'president' && !overview.realPresident) input.disabled = true;
            positionBoxes[item.id] = input;
            positionList.appendChild(h('label', {}, input, h('span', { text: item.name })));
        });
        var grants = permissionChecklist(user.grants || [], {});
        var revokes = permissionChecklist(user.revokes || [], {});
        var effective = h('div', {}, (user.permissions || []).map(function (code) { return h('span', { class: 'org-chip', title: code, text: permLabel(code) }); }));
        var save = h('button', { class: 'btn btn-primary', type: 'button', text: '儲存' });
        save.addEventListener('click', async function () {
            var positions = Object.keys(positionBoxes).filter(function (id) { return positionBoxes[id].checked; });
            if (await attempt(function () { return api('/api/users', 'PATCH', { username: user.username, positions: positions, grants: grants.value(), revokes: revokes.value() }); }, '已更新 ' + user.username + ' 的職位與權限')) loadOrg();
        });
        return h('div', {}, h('div', { class: 'org-group', text: '常設職位（可兼任）' }), positionList,
            h('div', { class: 'org-group', text: '個別授予（額外給予這個帳號）' }), grants,
            h('div', { class: 'org-group', text: '個別收回（從職位權限中拿掉）' }), revokes,
            h('div', { class: 'org-group', text: '目前實際權限' }), effective,
            h('p', { class: 'org-muted', text: '社長帳號不能被收回「帳號管理」；只有社長可以授予它，且不能授予自己沒有的權限。' }), save);
    }

    function positionsCard() {
        var card = h('div', { class: 'org-card' }, h('h2', { text: '職位與預設權限' }),
            h('p', { class: 'org-muted', text: '調整某個職位的預設權限，所有擔任該職位的人立即生效。也可以新增自訂職位（例如「網管」）。' }));
        overview.positions.filter(function (item) { return item.id !== 'member'; }).forEach(function (item) {
            var holder = h('div', { class: 'org-editor', hidden: 'hidden' });
            var edit = h('button', { class: 'btn btn-secondary', type: 'button', text: item.locked ? '檢視權限' : '編輯權限' });
            edit.addEventListener('click', function () { holder.hidden = !holder.hidden; if (!holder.hidden && !holder.childNodes.length) holder.appendChild(positionEditor(item)); });
            card.appendChild(h('div', { style: 'padding:8px 0; border-top:1px solid var(--border-glass);' },
                h('div', { class: 'org-row' }, h('strong', { text: item.name }), h('span', { class: 'org-muted', text: item.group + '・' + item.permissions.length + ' 項權限' + (item.builtin ? '' : '・自訂') }), edit), holder));
        });
        var id = h('input', { class: 'form-control', placeholder: '代號（小寫英數，例如 netadmin）', maxlength: '30' });
        var name = h('input', { class: 'form-control', placeholder: '職位名稱（例如 網管）', maxlength: '30' });
        var description = h('input', { class: 'form-control', placeholder: '說明（選填）', maxlength: '200' });
        var perms = permissionChecklist([], { hide: ['users.manage'] });
        var create = h('button', { class: 'btn btn-primary', type: 'button', text: '新增自訂職位' });
        create.addEventListener('click', async function () {
            if (await attempt(function () { return api('/api/org/positions', 'POST', { id: id.value.trim(), name: name.value, description: description.value, permissions: perms.value() }); }, '已新增職位')) loadOrg();
        });
        card.appendChild(h('div', { class: 'org-editor' }, h('div', { class: 'org-group', text: '新增自訂職位' }), h('div', { class: 'org-grid' }, id, name, description), perms, create));
        return card;
    }

    function positionEditor(item) {
        var perms = permissionChecklist(item.permissions, { disabled: item.locked, hide: item.locked ? [] : ['users.manage'] });
        var row = h('div', { class: 'org-row' });
        if (item.locked) return h('div', {}, perms, h('p', { class: 'org-muted', text: '社長固定擁有全部權限，不能修改。' }));
        var save = h('button', { class: 'btn btn-primary', type: 'button', text: '儲存權限' });
        save.addEventListener('click', async function () {
            if (await attempt(function () { return api('/api/org/positions/' + item.id, 'PUT', { permissions: perms.value() }); }, '已更新「' + item.name + '」的權限')) loadOrg();
        });
        row.appendChild(save);
        if (item.builtin) {
            var reset = h('button', { class: 'btn btn-secondary', type: 'button', text: '恢復預設' });
            reset.addEventListener('click', async function () {
                if (confirm('恢復「' + item.name + '」的預設權限？')) { if (await attempt(function () { return api('/api/org/positions/' + item.id, 'PUT', { permissions: item.defaults }); }, '已恢復預設')) loadOrg(); }
            });
            row.appendChild(reset);
        } else {
            var remove = h('button', { class: 'btn btn-secondary', type: 'button', text: '刪除這個職位' });
            remove.addEventListener('click', async function () {
                if (confirm('刪除自訂職位「' + item.name + '」？')) { if (await attempt(function () { return api('/api/org/positions/' + item.id, 'DELETE'); }, '已刪除')) loadOrg(); }
            });
            row.appendChild(remove);
        }
        return h('div', {}, perms, row);
    }

    var auditBody = null;
    function auditCard() {
        var target = h('input', { class: 'form-control', placeholder: '帳號或職位（選填）', style: 'max-width:220px;' });
        var action = h('input', { class: 'form-control', placeholder: '動作前綴，例如 account、position、acting、officer', style: 'max-width:340px;' });
        var search = h('button', { class: 'btn btn-secondary', type: 'button', text: '查詢' });
        auditBody = h('tbody');
        search.addEventListener('click', function () { loadAudit(target.value.trim(), action.value.trim()); });
        return h('div', { class: 'org-card' }, h('h2', { text: '稽核紀錄' }),
            h('p', { class: 'org-muted', text: '誰、何時、改了誰的什麼：職位與權限、代理社長、幹部名冊的所有變更都在這裡。' }),
            h('div', { class: 'org-row' }, target, action, search),
            h('div', { class: 'table-container' }, h('table', {}, h('thead', {}, h('tr', {}, ['時間', '操作者', '動作', '對象', '內容'].map(function (title) { return h('th', { text: title }); }))), auditBody)));
    }
    async function loadAudit(target, action) {
        if (!auditBody) return;
        var query = '?limit=100' + (target ? '&target=' + encodeURIComponent(target) : '') + (action ? '&action=' + encodeURIComponent(action) : '');
        var data = await attempt(function () { return api('/api/org/audit' + query); });
        if (!data) return;
        auditBody.replaceChildren.apply(auditBody, data.entries.map(function (entry) {
            return h('tr', {}, h('td', { text: new Date(entry.at).toLocaleString('zh-TW', { hour12: false }) }), h('td', { text: entry.actor }), h('td', { text: entry.action }), h('td', { text: entry.target }), h('td', { style: 'max-width:420px; word-break:break-all; font-size:.82rem;', text: JSON.stringify(entry.detail) }));
        }));
    }

    // ---------------------------------------------------------------- 幹部名冊
    var officersPanel = document.getElementById('panel-officers');
    if (officersPanel) {
        var nav = document.querySelector('button[onclick*="showPanel(\'officers\')"]');
        if (nav) nav.addEventListener('click', function () { loadOfficers(); });
    }
    var officerState = { year: '', data: null, me: null };
    var STATUS = { active: '在任', upcoming: '尚未到任', ended: '已解任', replaced: '已由他人遞補', completed: '任期屆滿' };

    async function loadOfficers(year) {
        if (!officersPanel) return;
        try {
            overview = overview || await api('/api/org/overview');
        } catch (error) { overview = null; }
        var sections = [h('div', { class: 'content-header' }, h('div', {}, h('h1', { text: '幹部名冊' }), h('p', { class: 'org-muted', text: '任期以學年計算（每年 8 月 1 日起）。指派職位後，帳號的權限會依任期自動生效與失效；歷屆資料永久保留。' })))];
        var me = await attempt(function () { return api('/api/officers/me'); });
        officerState.me = me;
        if (me && me.assignments.length) sections.push(myProfileCard(me));
        try {
            var data = await api('/api/org/officers' + (year ? '?year=' + encodeURIComponent(year) : ''));
            officerState.data = data; officerState.year = data.year;
            sections.push(rosterCard(data));
            if (data.canManage !== false) sections.push(assignCard(data));
        } catch (error) {
            if (!(me && me.assignments.length)) sections.push(h('p', { class: 'org-muted', text: '您目前沒有幹部職位，也沒有檢視名冊的權限。' }));
        }
        officersPanel.replaceChildren.apply(officersPanel, sections);
    }

    function field(label, input) { return h('label', { class: 'org-muted', style: 'display:grid; gap:4px;' }, label, input); }

    function myProfileCard(me) {
        var profile = me.profile || { fields: {}, visibility: {} };
        var inputs = {};
        var grid = h('div', { class: 'org-grid' });
        var defaults = me.defaults || {};
        Object.keys(me.fields).forEach(function (key) {
            if (key === 'bio' || key === 'duties' || key === 'handover') return;
            var input = h('input', { class: 'form-control', maxlength: String(me.fields[key].max), value: (profile.fields[key] !== undefined ? profile.fields[key] : defaults[key]) || '' });
            inputs[key] = input;
            grid.appendChild(field(me.fields[key].label + (me.publicFields.indexOf(key) !== -1 ? '（可公開）' : ''), input));
        });
        var areas = {};
        ['bio', 'duties', 'handover'].forEach(function (key) {
            var area = h('textarea', { class: 'form-control', rows: '3', maxlength: String(me.fields[key].max) });
            area.value = profile.fields[key] || '';
            areas[key] = area;
        });
        var visibility = {};
        var checks = h('div', { class: 'org-checks org-row' });
        [['name', '公開姓名'], ['photo', '公開大頭照'], ['bio', '公開自我介紹']].forEach(function (pair) {
            var box = h('input', { type: 'checkbox' });
            box.checked = profile.visibility && profile.visibility[pair[0]] === true;
            visibility[pair[0]] = box;
            checks.appendChild(h('label', {}, box, h('span', { text: pair[1] })));
        });
        var photo = h('select', { class: 'form-control' }, h('option', { value: '', text: '（不使用大頭照）' }));
        api('/api/files?kind=image&limit=100').then(function (files) {
            files.items.forEach(function (item) { photo.appendChild(h('option', { value: item.id, text: item.name + (item.visibility === 'public' ? '（公開）' : '（非公開，無法公開顯示）') })); });
            photo.value = profile.photoFileId || '';
        }).catch(function () { /* the file library may be off */ });
        var save = h('button', { class: 'btn btn-primary', type: 'button', text: '儲存我的資料', disabled: me.canEdit ? undefined : 'disabled' });
        save.addEventListener('click', async function () {
            var fields = {};
            Object.keys(inputs).forEach(function (key) { fields[key] = inputs[key].value; });
            Object.keys(areas).forEach(function (key) { fields[key] = areas[key].value; });
            var vis = {};
            Object.keys(visibility).forEach(function (key) { vis[key] = visibility[key].checked; });
            if (await attempt(function () { return api('/api/officers/me', 'PUT', { fields: fields, visibility: vis, photoFileId: photo.value }); }, '已儲存')) loadOfficers(officerState.year);
        });
        var positions = me.assignments.map(function (a) { return h('span', { class: 'org-chip', text: a.year + ' 學年 ' + positionName(a.position) + '（' + (STATUS[a.status] || a.status) + '）' }); });
        return h('div', { class: 'org-card' }, h('h2', { text: '我的幹部資料' }),
            h('div', { class: 'org-row' }, h('span', { class: 'org-muted', text: '我的職位（由社長指派，不能自行修改）：' }), positions),
            me.canEdit ? null : h('p', { class: 'org-warn', text: '您目前沒有現任或即將上任的職位，無法修改資料。' }),
            grid, field('自我介紹', areas.bio), field('負責業務', areas.duties), field('交接事項', areas.handover),
            h('div', { class: 'org-group', text: '大頭照（從檔案庫選取；要上傳新照片請先到「檔案庫」上傳）' }), photo,
            h('div', { class: 'org-group', text: '前台公開幹部頁面時，只會顯示您勾選公開的項目（姓名、職位、大頭照、自我介紹）；電話、學號、Email 等不會公開。' }), checks, save);
    }

    function rosterCard(data) {
        var years = {};
        (data.terms || []).forEach(function (term) { years[term.year] = true; });
        years[data.year] = true;
        var yearSelect = h('select', { class: 'form-control', style: 'max-width:220px;', 'aria-label': '學年' });
        Object.keys(years).sort().reverse().forEach(function (year) { yearSelect.appendChild(h('option', { value: year, text: year + ' 學年' + (year === data.year && data.term && data.term.current ? '（本學年）' : '') })); });
        yearSelect.value = data.year;
        yearSelect.addEventListener('change', function () { loadOfficers(yearSelect.value); });
        var csv = h('a', { class: 'btn btn-secondary', href: '/api/org/officers.csv?year=' + encodeURIComponent(data.year), text: '匯出 CSV（學校幹部登記）' });
        var body = h('tbody');
        data.assignments.forEach(function (row) {
            var fields = (row.profile && row.profile.fields) || {};
            var actions = h('div', { class: 'org-row' });
            var canChange = row.status === 'active' || row.status === 'upcoming';
            var history = h('button', { class: 'btn btn-secondary', type: 'button', text: '歷任紀錄' });
            history.addEventListener('click', async function () {
                var result = await attempt(function () { return api('/api/org/officers/history?username=' + encodeURIComponent(row.username)); });
                if (result) alert(row.username + ' 的歷任紀錄\n' + result.assignments.map(function (a) { return a.yearLabel + ' ' + a.positionName + '（' + a.start + ' ~ ' + (a.endedOn || a.end) + '，' + (STATUS[a.status] || a.status) + '）'; }).join('\n'));
            });
            actions.appendChild(history);
            if (canChange && data.canManage !== false) {
                var end = h('button', { class: 'btn btn-secondary', type: 'button', text: '解任' });
                end.addEventListener('click', async function () {
                    var date = prompt('解任生效日（YYYY-MM-DD，留空＝今天立即生效）', '');
                    if (date === null) return;
                    var reason = confirm('這是「主動請辭」嗎？按「確定」記為請辭，按「取消」記為解任。') ? 'resigned' : 'dismissed';
                    if (await attempt(function () { return api('/api/org/officers/' + row.year + '/' + row.id + '/end', 'POST', { effective: date.trim() || undefined, reason: reason }); }, '已解任')) loadOfficers(data.year);
                });
                var replace = h('button', { class: 'btn btn-secondary', type: 'button', text: '遞補' });
                replace.addEventListener('click', async function () {
                    var username = prompt('接任者的帳號'); if (!username) return;
                    var start = prompt('接任日（YYYY-MM-DD，留空＝今天）', '');
                    var result = await attempt(function () { return api('/api/org/officers/' + row.year + '/' + row.id + '/replace', 'POST', { username: username.trim(), start: (start || '').trim() || undefined }); }, '已遞補');
                    if (result) { if (result.warnings && result.warnings.length) alert(result.warnings.join('\n')); loadOfficers(data.year); }
                });
                actions.append(end, replace);
            }
            body.appendChild(h('tr', {}, h('td', { text: positionName(row.position) }), h('td', { text: row.displayName || row.username }), h('td', { text: fields.name ? fields.name : '（尚未填寫）' }),
                h('td', { text: row.start + ' ~ ' + (row.endedOn ? row.endedOn + '（解任）' : row.end) }), h('td', { class: row.status === 'active' ? 'org-ok' : 'org-muted', text: STATUS[row.status] || row.status }), h('td', {}, actions)));
        });
        if (!data.assignments.length) body.appendChild(h('tr', {}, h('td', { colspan: '6', class: 'org-muted', text: '這個學年還沒有指派幹部。' })));
        var settings = null;
        if (data.canManage !== false) {
            var limit = h('input', { class: 'form-control', type: 'number', min: '1', max: '20', value: String(data.officerLimit), style: 'max-width:90px;' });
            var pub = h('input', { type: 'checkbox' });
            pub.checked = !!(overview && overview.config && overview.config.publicOfficers);
            var saveSettings = h('button', { class: 'btn btn-secondary', type: 'button', text: '儲存設定' });
            saveSettings.addEventListener('click', async function () {
                if (await attempt(function () { return api('/api/org/settings', 'PUT', { officerLimit: Number(limit.value), publicOfficers: pub.checked }); }, '已儲存')) { overview = null; loadOfficers(data.year); }
            });
            var newTerm = h('button', { class: 'btn btn-secondary', type: 'button', text: '建立新學年名冊' });
            newTerm.addEventListener('click', async function () {
                var year = prompt('學年（三位數，例如 116）', String(Number(overview ? overview.currentYear : data.year) + 1)); if (!year) return;
                if (await attempt(function () { return api('/api/org/terms/' + encodeURIComponent(year.trim()), 'PUT', {}); }, '已建立 ' + year + ' 學年')) loadOfficers(year.trim());
            });
            settings = h('div', { class: 'org-row' }, h('label', { class: 'org-muted' }, '兼任上限（學校規定，預設 3）：'), limit,
                h('label', { class: 'org-checks' }, pub, h('span', { text: '在前台公開「幹部介紹」頁面（/officers）' })), saveSettings, newTerm);
        }
        return h('div', { class: 'org-card' }, h('h2', { text: '幹部名冊' }), h('div', { class: 'org-row' }, yearSelect, csv), settings,
            data.term ? h('p', { class: 'org-muted', text: '任期：' + data.term.start + ' ~ ' + data.term.end }) : h('p', { class: 'org-muted', text: '這個學年尚未建立名冊；指派第一位幹部時會自動建立。' }),
            h('div', { class: 'table-container' }, h('table', {}, h('thead', {}, h('tr', {}, ['職位', '帳號', '姓名', '任期', '狀態', '操作'].map(function (title) { return h('th', { text: title }); }))), body)));
    }

    function assignCard(data) {
        var username = h('input', { class: 'form-control', placeholder: '帳號', list: 'org-users', maxlength: '40' });
        var datalist = h('datalist', { id: 'org-users' });
        api('/api/users').then(function (users) { users.forEach(function (user) { datalist.appendChild(h('option', { value: user.username })); }); }).catch(function () { /* needs users.manage */ });
        var position = h('select', { class: 'form-control' });
        ((overview && overview.positions) || []).filter(function (item) { return item.id !== 'member'; }).forEach(function (item) { position.appendChild(h('option', { value: item.id, text: item.name })); });
        var start = h('input', { class: 'form-control', type: 'date' });
        var end = h('input', { class: 'form-control', type: 'date' });
        var note = h('input', { class: 'form-control', placeholder: '備註（選填）', maxlength: '200' });
        var assign = h('button', { class: 'btn btn-primary', type: 'button', text: '指派職位' });
        assign.addEventListener('click', async function () {
            var result = await attempt(function () { return api('/api/org/officers', 'POST', { year: data.year, username: username.value.trim(), position: position.value, start: start.value || undefined, end: end.value || undefined, note: note.value }); }, '已指派');
            if (result) { if (result.warnings && result.warnings.length) alert('提醒：\n' + result.warnings.join('\n')); loadOfficers(data.year); }
        });
        return h('div', { class: 'org-card' }, h('h2', { text: data.year + ' 學年：指派職位' }),
            h('p', { class: 'org-muted', text: '一個人可以兼任多個職位（含實習幹部）。任期預設為整個學年，也可指定起訖日；未到開始日的指派會先放著，到期才生效。你只能指派權限不超過自己的職位。' }),
            h('div', { class: 'org-grid' }, field('帳號', username), field('職位', position), field('任期開始（選填）', start), field('任期結束（選填）', end), field('備註', note)), datalist, h('div', { class: 'org-row' }, assign));
    }
})();
