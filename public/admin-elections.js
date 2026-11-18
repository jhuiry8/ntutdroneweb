// Admin 「選舉管理」 panel: elections, candidates (選舉公報), voting status, audit log and results.
(function () {
    'use strict';

    var root = document.getElementById('panel-elections');
    if (!root) return;
    var IS_PRESIDENT = root.dataset.role === 'president';
    var STATUS = { draft: '草稿', published: '已公告', open: '投票中', closed: '已結束' };
    var EVENT_LABELS = {
        'verify-ok': '身分驗證通過', 'verify-failed': '身分驗證失敗', 'verify-already-voted': '重複投票嘗試',
        'verify-device-used': '裝置已投過票', 'cast-device-mismatch': '換裝置投票被拒', 'voted': '完成投票',
        'status:publish': '公告選舉', 'status:unpublish': '撤回公告', 'status:open': '開始投票', 'status:close': '結束投票',
        'status:publish-results': '公布結果', 'status:hide-results': '隱藏結果'
    };
    var state = { elections: [], current: null };

    function $(id) { return document.getElementById(id); }
    function esc(value) {
        return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function toast(message, isError) {
        if (typeof window.showToast === 'function') window.showToast(message, isError);
        else window.alert(message);
    }
    function time(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        return isNaN(d) ? '' : d.toLocaleString('zh-TW', { hour12: false, timeZone: 'Asia/Taipei' });
    }
    // ISO → value for <input type="datetime-local"> in Taipei time.
    function localInput(iso) {
        if (!iso) return '';
        var d = new Date(Date.parse(iso) + 8 * 3600000);
        return isNaN(d) ? '' : d.toISOString().slice(0, 16);
    }
    async function api(url, options) {
        options = options || {};
        if (options.body && typeof options.body !== 'string') {
            options.body = JSON.stringify(options.body);
            options.headers = { 'Content-Type': 'application/json' };
        }
        var response = await fetch(url, options);
        var data = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error(data.error || '操作失敗');
        return data;
    }

    function renderList() {
        var rows = state.elections.map(function (e) {
            return '<tr><td><strong>' + esc(e.title) + '</strong><div class="forms-muted">' + esc(e.position || '') + '</div></td>' +
                '<td>' + esc(STATUS[e.status] || e.status) + (e.status === 'closed' ? (e.resultsPublic ? '・結果已公布' : '・結果未公布') : '') + '</td>' +
                '<td>' + (e.candidates || []).length + '</td>' +
                '<td>' + (e.rollSize ? e.voterCount + ' / ' + e.rollSize : '—') + '</td>' +
                '<td style="white-space:nowrap;"><button type="button" class="btn btn-secondary" data-open="' + esc(e.id) + '">管理</button></td></tr>';
        }).join('');
        $('election-list').innerHTML = '<div class="table-container"><table><thead><tr><th>選舉</th><th>狀態</th><th>候選人</th><th>已投票／選舉人</th><th></th></tr></thead><tbody>' +
            (rows || '<tr><td colspan="5" style="color:var(--text-muted);">尚未建立選舉。</td></tr>') + '</tbody></table></div>';
    }

    window.loadElections = async function () {
        try {
            state.elections = await api('/api/elections');
            renderList();
            if (state.current) {
                var fresh = state.elections.filter(function (e) { return e.id === state.current.id; })[0];
                if (fresh) showDetail(fresh); else closeDetail();
            }
        } catch (error) { toast(error.message, true); }
    };

    function candidateBlock(c, index) {
        c = c || {};
        var field = function (key, label, type, extra) {
            return '<div class="form-group"><label>' + label + '</label><input class="form-control" data-c="' + key + '" type="' + (type || 'text') + '" value="' + esc(c[key] === undefined ? '' : c[key]) + '"' + (extra || '') + '></div>';
        };
        var area = function (key, label, rows, max) {
            return '<div class="form-group" style="grid-column:1/-1;"><label>' + label + '</label><textarea class="form-control" data-c="' + key + '" rows="' + rows + '" maxlength="' + max + '">' + esc(c[key] || '') + '</textarea></div>';
        };
        return '<fieldset class="forms-card election-candidate" data-id="' + esc(c.id || '') + '" style="margin-bottom:12px;"><legend style="padding:0 6px;">候選人</legend>' +
            '<div class="forms-grid">' +
            field('number', '號次', 'number', ' min="1" max="99" step="1"' + (c.number ? '' : ' placeholder="' + (index + 1) + '"')) +
            field('name', '姓名 *', 'text', ' maxlength="50"') +
            field('department', '系級', 'text', ' maxlength="50" placeholder="例如：機械三"') +
            field('slogan', '競選標語', 'text', ' maxlength="100"') +
            '<div class="form-group" style="grid-column:span 2;"><label>照片網址（https://）</label><input class="form-control" data-c="photoUrl" type="url" maxlength="500" value="' + esc(c.photoUrl || '') + '"></div>' +
            area('experience', '經歷', 3, 2000) + area('platform', '政見', 6, 5000) +
            '</div><button type="button" class="btn btn-danger" data-remove-candidate>移除此候選人</button></fieldset>';
    }

    function openEditor(election) {
        var e = election || { candidates: [], oneVotePerDevice: true, eligibility: 'voting' };
        var editor = $('election-editor');
        editor.dataset.id = e.id || '';
        editor.innerHTML = '<h2 style="font-size:1.1rem; margin-bottom:12px;">' + (e.id ? '編輯選舉' : '新增選舉') + '</h2>' +
            '<div class="forms-grid">' +
            '<div class="form-group" style="grid-column:span 2;"><label>選舉名稱 *</label><input class="form-control" id="el-title" maxlength="100" value="' + esc(e.title || '') + '" placeholder="例如：第 116 學年度社長選舉"></div>' +
            '<div class="form-group"><label>選舉職位</label><input class="form-control" id="el-position" maxlength="50" value="' + esc(e.position || '') + '" placeholder="例如：社長"></div>' +
            '<div class="form-group"><label>投票開始（臺灣時間，可留空）</label><input class="form-control" id="el-startsAt" type="datetime-local" value="' + esc(localInput(e.startsAt)) + '"></div>' +
            '<div class="form-group"><label>投票截止（臺灣時間，可留空）</label><input class="form-control" id="el-endsAt" type="datetime-local" value="' + esc(localInput(e.endsAt)) + '"></div>' +
            '<div class="form-group"><label>選舉人資格</label><select class="form-control" id="el-eligibility"><option value="voting"' + (e.eligibility !== 'roster' ? ' selected' : '') + '>具表決權之社員</option><option value="roster"' + (e.eligibility === 'roster' ? ' selected' : '') + '>社員名冊上所有人</option></select></div>' +
            '<div class="form-group" style="grid-column:1/-1;"><label>選舉說明（選舉公報前言、投票規則等）</label><textarea class="form-control" id="el-description" rows="4" maxlength="5000">' + esc(e.description || '') + '</textarea></div>' +
            '<label style="grid-column:1/-1; display:flex; gap:8px; align-items:center;"><input type="checkbox" id="el-device"' + (e.oneVotePerDevice !== false ? ' checked' : '') + '> 每台裝置只能投一票（防止一人拿他人學號姓名代投；建議開啟）</label>' +
            '</div>' +
            '<p class="forms-muted" style="margin-bottom:12px;">投票開始時會依當下社員名冊鎖定選舉人名冊，之後修改名冊不影響本次選舉。設定開始／截止時間時，社長按「開始投票」後，系統只在時間內收票。</p>' +
            '<h3 style="font-size:1rem; margin:8px 0;">候選人（選舉公報）</h3><p class="forms-muted" style="margin-bottom:8px;">只有一位候選人時，選票為「同意／不同意」。</p>' +
            '<div id="el-candidates">' + (e.candidates || []).map(candidateBlock).join('') + '</div>' +
            '<div class="forms-actions" style="display:flex; gap:10px; flex-wrap:wrap; margin-top:8px;"><button type="button" class="btn btn-secondary" id="el-add-candidate">新增候選人</button><button type="submit" class="btn btn-primary">儲存</button><button type="button" class="btn btn-secondary" id="el-cancel">取消</button></div>';
        editor.hidden = false;
        $('election-detail').hidden = true;
        if (!(e.candidates || []).length) addCandidate();
        editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function addCandidate() {
        var list = $('el-candidates');
        list.insertAdjacentHTML('beforeend', candidateBlock(null, list.children.length));
    }

    function collectEditor() {
        var candidates = Array.prototype.map.call(document.querySelectorAll('#el-candidates .election-candidate'), function (block, index) {
            var get = function (key) { return block.querySelector('[data-c="' + key + '"]').value.trim(); };
            return { id: block.dataset.id || undefined, number: Number(get('number') || index + 1), name: get('name'), department: get('department'), slogan: get('slogan'), photoUrl: get('photoUrl'), experience: get('experience'), platform: get('platform') };
        });
        return {
            title: $('el-title').value.trim(), position: $('el-position').value.trim(), description: $('el-description').value,
            startsAt: $('el-startsAt').value, endsAt: $('el-endsAt').value, eligibility: $('el-eligibility').value,
            oneVotePerDevice: $('el-device').checked, candidates: candidates
        };
    }

    function closeDetail() {
        state.current = null;
        $('election-detail').hidden = true;
    }

    function showDetail(e) {
        state.current = e;
        $('election-editor').hidden = true;
        var editable = e.status === 'draft' || e.status === 'published';
        var actions = [];
        if (editable) actions.push('<button type="button" class="btn btn-secondary" data-edit>編輯內容與候選人</button>');
        if (e.status === 'draft') actions.push('<button type="button" class="btn btn-primary" data-status="publish">公告選舉公報</button>');
        if (e.status === 'published') actions.push('<button type="button" class="btn btn-secondary" data-status="unpublish">撤回公告</button>');
        if (IS_PRESIDENT && editable) actions.push('<button type="button" class="btn btn-primary" data-status="open">開始投票</button>');
        if (IS_PRESIDENT && e.status === 'open') actions.push('<button type="button" class="btn btn-danger" data-status="close">結束投票</button>');
        if (IS_PRESIDENT && e.status === 'closed') actions.push(e.resultsPublic ? '<button type="button" class="btn btn-secondary" data-status="hide-results">隱藏結果</button>' : '<button type="button" class="btn btn-primary" data-status="publish-results">公布結果</button>');
        if (editable) actions.push('<button type="button" class="btn btn-danger" data-delete>刪除</button>');
        if (e.status !== 'draft') actions.push('<a class="btn btn-secondary" href="/vote/' + encodeURIComponent(e.id) + '" target="_blank" rel="noopener">開啟公開頁面</a>');
        actions.push('<button type="button" class="btn btn-secondary" data-close>關閉</button>');
        var detail = $('election-detail');
        detail.innerHTML = '<div class="forms-card"><h2 style="font-size:1.15rem;">' + esc(e.title) + '</h2>' +
            '<p class="forms-muted">狀態：' + esc(STATUS[e.status]) + '・候選人 ' + (e.candidates || []).length + ' 位・投票期間：' + (e.startsAt ? esc(time(e.startsAt)) : '宣布開始') + ' ～ ' + (e.endsAt ? esc(time(e.endsAt)) : '宣布結束') +
            (e.rollSize ? '・已投票 ' + e.voterCount + ' / ' + e.rollSize + ' 人' : '') + '</p>' +
            '<div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:12px;">' + actions.join('') + '</div></div>' +
            '<div id="election-results"></div><div id="election-audit"></div>';
        detail.hidden = false;
        if (e.status === 'closed') loadResults(e.id);
        if (e.status === 'open' || e.status === 'closed') loadAudit(e.id);
    }

    async function loadResults(id) {
        try {
            var r = await api('/api/elections/' + encodeURIComponent(id) + '/results');
            var top = Math.max.apply(null, [1].concat(r.options.map(function (o) { return o.votes; })));
            $('election-results').innerHTML = '<div class="forms-card" style="margin-top:12px;"><h3 style="font-size:1rem; margin-bottom:8px;">開票結果</h3>' +
                r.options.map(function (o) {
                    return '<div style="display:grid; grid-template-columns:minmax(120px,220px) 1fr 70px; gap:10px; align-items:center; margin:6px 0;"><strong>' + esc(o.label) + '</strong><div style="height:10px; background:rgba(255,255,255,.08); border-radius:5px; overflow:hidden;"><div style="height:100%; width:' + Math.round(o.votes / top * 100) + '%; background:var(--color-cyan, #22d3ee);"></div></div><span>' + o.votes + ' 票</span></div>';
                }).join('') +
                '<p class="forms-muted">選票 ' + r.totalBallots + ' 張・投票紀錄 ' + r.voters + ' 筆' + (r.totalBallots !== r.voters ? '（<strong style="color:#f87171;">數量不一致，請檢查</strong>）' : '（一致）') + '・選舉人 ' + r.rollSize + ' 人・投票率 ' + (r.turnout * 100).toFixed(1) + '%</p></div>';
        } catch (error) { $('election-results').innerHTML = '<p class="forms-muted">' + esc(error.message) + '</p>'; }
    }

    function deviceText(v) {
        return [v.platform, v.screen, v.timezone, v.touch ? '觸控' : ''].filter(Boolean).map(esc).join('・') +
            '<div class="forms-muted" title="' + esc(v.userAgent) + '" style="max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + esc(v.userAgent) + '</div>';
    }

    async function loadAudit(id) {
        try {
            var a = await api('/api/elections/' + encodeURIComponent(id) + '/audit');
            var flags = a.flags.map(function (f) {
                return '<li style="color:' + (f.level === 'danger' ? '#f87171' : '#fbbf24') + '; margin:4px 0;">' + esc(f.message) + '<div class="forms-muted">學號：' + f.studentIds.map(esc).join('、') + '</div></li>';
            }).join('');
            var voters = a.voters.map(function (v) {
                return '<tr><td>' + esc(time(v.votedAt)) + '</td><td>' + esc(v.studentId) + '<div class="forms-muted">' + esc(v.name) + '</div></td><td>' + esc(v.ip) + '<div class="forms-muted">' + esc([v.network, v.city, v.country].filter(Boolean).join('・')) + '</div></td><td>' + deviceText(v) + '</td><td><code title="裝置 ID">' + esc((v.deviceId || '').slice(0, 10)) + '</code><div class="forms-muted" title="裝置特徵">' + esc((v.fingerprint || '').slice(0, 10)) + '</div></td></tr>';
            }).join('');
            var events = a.events.slice(0, 300).map(function (ev) {
                return '<tr><td>' + esc(time(ev.at)) + '</td><td>' + esc(EVENT_LABELS[ev.type] || ev.type) + '</td><td>' + esc(ev.studentId || ev.by || '') + '</td><td>' + esc(ev.ip || '') + '</td><td><code>' + esc((ev.deviceId || '').slice(0, 10)) + '</code></td></tr>';
            }).join('');
            $('election-audit').innerHTML = '<div class="forms-card" style="margin-top:12px;"><h3 style="font-size:1rem;">稽核提示</h3>' +
                (flags ? '<ul style="padding-left:20px; margin:8px 0;">' + flags + '</ul>' : '<p class="forms-muted">目前沒有異常（同 IP 多人投票、同裝置多人投票、大量驗證失敗）。</p>') + '</div>' +
                '<div class="forms-card" style="margin-top:12px;"><h3 style="font-size:1rem;">投票紀錄（' + a.voters.length + ' / ' + a.rollSize + ' 人）</h3><p class="forms-muted">只記錄誰在何時、從哪裡投票；不含投票內容。</p>' +
                '<div class="table-container"><table><thead><tr><th>時間</th><th>學號／姓名</th><th>IP／網路</th><th>裝置</th><th>裝置 ID／特徵</th></tr></thead><tbody>' + (voters || '<tr><td colspan="5" class="forms-muted">尚無投票。</td></tr>') + '</tbody></table></div></div>' +
                '<details class="forms-card" style="margin-top:12px;"><summary style="cursor:pointer;">選務事件紀錄（最近 ' + Math.min(a.events.length, 300) + ' 筆）</summary><div class="table-container" style="margin-top:8px;"><table><thead><tr><th>時間</th><th>事件</th><th>學號／操作者</th><th>IP</th><th>裝置</th></tr></thead><tbody>' + events + '</tbody></table></div></details>';
        } catch (error) { $('election-audit').innerHTML = '<p class="forms-muted">' + esc(error.message) + '</p>'; }
    }

    var CONFIRM = {
        open: '開始投票後會依目前社員名冊鎖定選舉人名冊，選舉內容與候選人也不能再修改。確定開始？',
        close: '結束投票後不再收票並開票。確定結束？',
        'publish-results': '公布後任何人都能在公開頁面看到開票結果。確定公布？'
    };

    root.addEventListener('click', async function (event) {
        var target = event.target.closest('button, a');
        if (!target) return;
        try {
            if (target.id === 'election-new') return openEditor(null);
            if (target.id === 'el-add-candidate') return addCandidate();
            if (target.id === 'el-cancel') { $('election-editor').hidden = true; if (state.current) showDetail(state.current); return; }
            if (target.hasAttribute('data-remove-candidate')) return target.closest('.election-candidate').remove();
            if (target.dataset.open) return showDetail(state.elections.filter(function (e) { return e.id === target.dataset.open; })[0]);
            if (target.hasAttribute('data-close')) return closeDetail();
            if (target.hasAttribute('data-edit')) return openEditor(state.current);
            if (target.hasAttribute('data-delete')) {
                if (!window.confirm('確定刪除「' + state.current.title + '」？')) return;
                await api('/api/elections/' + encodeURIComponent(state.current.id), { method: 'DELETE' });
                closeDetail();
                toast('已刪除');
                return window.loadElections();
            }
            if (target.dataset.status) {
                var action = target.dataset.status;
                if (CONFIRM[action] && !window.confirm(CONFIRM[action])) return;
                target.disabled = true;
                state.current = await api('/api/elections/' + encodeURIComponent(state.current.id) + '/status', { method: 'POST', body: { action: action } });
                toast('已更新');
                return window.loadElections();
            }
        } catch (error) {
            toast(error.message, true);
            target.disabled = false;
        }
    });

    $('election-editor').addEventListener('submit', async function (event) {
        event.preventDefault();
        var id = this.dataset.id;
        try {
            var saved = await api(id ? '/api/elections/' + encodeURIComponent(id) : '/api/elections', { method: id ? 'PUT' : 'POST', body: collectEditor() });
            toast('已儲存');
            state.current = saved;
            await window.loadElections();
            showDetail(saved);
        } catch (error) { toast(error.message, true); }
    });
})();
