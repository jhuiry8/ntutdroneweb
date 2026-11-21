// 檔案庫 panel: drag-and-drop upload, thumbnails, copy link / Markdown, rename, delete, and a
// picker other forms use to insert a file link. Talks to /api/files; files themselves are
// served from /files/<id>. No HTML from the server is ever inserted unescaped.
(function () {
    'use strict';
    var panel = document.getElementById('panel-files');
    if (!panel) return;

    var canUpload = panel.dataset.canUpload === '1';
    var state = { config: null, items: [], cursor: null, total: 0, loading: false };
    var $ = function (id) { return document.getElementById(id); };
    function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function toast(message, isError) { if (typeof showToast === 'function') showToast(message, isError); else if (isError) alert(message); }
    function size(bytes) { return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB'; }
    function when(iso) { return iso ? new Date(iso).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' }) : ''; }
    async function api(path, method, body) {
        var response = await fetch(path, { method: method || 'GET', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
        var data = {};
        try { data = await response.json(); } catch (e) { /* empty */ }
        if (!response.ok) throw new Error(data.error || ('請求失敗（' + response.status + '）'));
        return data;
    }

    var style = document.createElement('style');
    style.textContent = [
        '.files-drop { display:grid; gap:6px; justify-items:center; padding:28px 16px; border:2px dashed var(--border-glass); border-radius:14px; cursor:pointer; text-align:center; }',
        '.files-drop:hover, .files-drop:focus, .files-drop.over { border-color:var(--color-cyan); background:rgba(34,211,238,.08); outline:none; }',
        '.files-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:14px; }',
        '.file-card { border:1px solid var(--border-glass); border-radius:12px; overflow:hidden; display:flex; flex-direction:column; }',
        '.file-thumb { height:130px; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,.04); font-size:2rem; }',
        '.file-thumb img { width:100%; height:100%; object-fit:cover; }',
        '.file-body { padding:10px 12px; display:grid; gap:4px; flex:1; }',
        '.file-body strong { word-break:break-all; font-size:.92rem; } .file-body small { color:var(--text-muted); }',
        '.file-actions { display:flex; gap:6px; flex-wrap:wrap; padding:0 12px 12px; }',
        '.file-actions .btn { padding:6px 10px; font-size:.8rem; min-height:34px; }',
        '.file-badge { display:inline-block; padding:1px 8px; border-radius:999px; font-size:.72rem; background:rgba(96,165,250,.18); margin-right:4px; }',
        '.files-queue-row { display:flex; justify-content:space-between; gap:10px; font-size:.88rem; padding:6px 10px; border:1px solid var(--border-glass); border-radius:8px; }',
        '.files-pick { position:fixed; inset:0; z-index:200; background:rgba(0,0,0,.6); display:flex; align-items:center; justify-content:center; padding:16px; }',
        '.files-pick-box { background:var(--bg-darker, #0b1220); border:1px solid var(--border-glass); border-radius:14px; width:min(760px,100%); max-height:86vh; overflow:auto; padding:16px; }',
        '.files-pick-list { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:10px; margin-top:12px; }',
        '.files-pick-list button { text-align:left; border:1px solid var(--border-glass); background:none; color:inherit; border-radius:10px; padding:0; cursor:pointer; overflow:hidden; }',
        '.files-pick-list .file-thumb { height:84px; } .files-pick-list span { display:block; padding:6px 8px; font-size:.8rem; word-break:break-all; }',
        '.files-attach { margin:4px 0 0; }'
    ].join('\n');
    document.head.appendChild(style);

    function absolute(item) { return location.origin + item.url; }
    function isImage(item) { return item.mime && item.mime.indexOf('image/') === 0; }
    function thumb(item) {
        return isImage(item) ? '<img loading="lazy" alt="' + esc(item.name) + '" src="' + esc(item.url) + '">' : '<span aria-hidden="true">📄</span>';
    }
    async function copy(text, label) {
        try { await navigator.clipboard.writeText(text); toast(label + '已複製'); }
        catch (e) { window.prompt('請手動複製：', text); }
    }

    function fillSelects() {
        var cats = state.config.categories, vis = state.config.visibilities;
        function options(map, first) { return (first ? '<option value="">' + first + '</option>' : '') + Object.keys(map).map(function (k) { return '<option value="' + esc(k) + '">' + esc(map[k]) + '</option>'; }).join(''); }
        $('files-filter-category').innerHTML = options(cats, '全部分類');
        if ($('files-up-category')) {
            $('files-up-category').innerHTML = options(cats);
            $('files-up-visibility').innerHTML = options(vis);
            $('files-up-visibility').value = 'cadre';
            $('files-up-category').value = 'other';
        }
    }

    function cardHtml(item) {
        var cats = state.config.categories, vis = state.config.visibilities;
        var actions = '<button type="button" class="btn btn-secondary" data-act="link" data-id="' + esc(item.id) + '">複製連結</button>' +
            (isImage(item) ? '<button type="button" class="btn btn-secondary" data-act="md" data-id="' + esc(item.id) + '">複製 Markdown</button>' : '') +
            '<a class="btn btn-secondary" href="' + esc(item.url) + '?download=1">下載</a>' +
            (item.canManage ? '<button type="button" class="btn btn-secondary" data-act="edit" data-id="' + esc(item.id) + '">改名／說明</button><button type="button" class="btn btn-danger" data-act="delete" data-id="' + esc(item.id) + '">刪除</button>' : '');
        return '<div class="file-card"><a class="file-thumb" href="' + esc(item.url) + '" target="_blank" rel="noopener">' + thumb(item) + '</a><div class="file-body"><strong>' + esc(item.name) + '</strong>' +
            '<span><span class="file-badge">' + esc(vis[item.visibility] || item.visibility) + '</span><span class="file-badge">' + esc(cats[item.category] || item.category) + '</span></span>' +
            (item.description ? '<small>' + esc(item.description) + '</small>' : '') +
            '<small>' + size(item.size) + '・' + esc(item.uploadedBy) + '・' + when(item.createdAt) + '</small></div><div class="file-actions">' + actions + '</div></div>';
    }
    function render() {
        $('files-grid').innerHTML = state.items.map(cardHtml).join('') || '<p style="color:var(--text-muted);">沒有符合的檔案。</p>';
        $('files-more').style.display = state.cursor ? '' : 'none';
    }

    function query(extra) {
        var params = new URLSearchParams();
        if ($('files-filter-category').value) params.set('category', $('files-filter-category').value);
        if ($('files-filter-kind').value) params.set('kind', $('files-filter-kind').value);
        if ($('files-search').value.trim()) params.set('q', $('files-search').value.trim());
        params.set('limit', '24');
        if (extra) params.set('cursor', extra);
        return params.toString();
    }
    async function load(more) {
        if (state.loading) return;
        state.loading = true;
        try {
            if (!state.config) { state.config = await api('/api/files/config'); fillSelects(); }
            var data = await api('/api/files?' + query(more ? state.cursor : ''));
            state.items = more ? state.items.concat(data.items) : data.items;
            state.cursor = data.nextCursor; state.total = data.total;
            render();
        } catch (error) { toast(error.message, true); }
        finally { state.loading = false; }
    }
    window.loadFiles = function () { return load(false); };

    // ---- upload -------------------------------------------------------------------------
    function uploadOne(file, row) {
        return new Promise(function (resolve) {
            var form = new FormData();
            form.append('file', file);
            form.append('category', $('files-up-category').value);
            form.append('visibility', $('files-up-visibility').value);
            form.append('description', $('files-up-description').value);
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/files');
            xhr.upload.onprogress = function (e) { if (e.lengthComputable) row.lastChild.textContent = Math.round(e.loaded / e.total * 100) + '%'; };
            xhr.onload = function () {
                var data = {}; try { data = JSON.parse(xhr.responseText); } catch (e) { /* empty */ }
                if (xhr.status === 201) { row.lastChild.textContent = '✓ 完成'; resolve(true); }
                else { row.lastChild.textContent = '✗ ' + (data.error || ('失敗（' + xhr.status + '）')); row.lastChild.style.color = '#f87171'; resolve(false); }
            };
            xhr.onerror = function () { row.lastChild.textContent = '✗ 網路錯誤'; row.lastChild.style.color = '#f87171'; resolve(false); };
            xhr.send(form);
        });
    }
    async function uploadFiles(fileList) {
        var files = Array.prototype.slice.call(fileList || []);
        if (!files.length) return;
        var queue = $('files-queue'), ok = 0;
        for (var i = 0; i < files.length; i++) {
            var file = files[i];
            var row = document.createElement('div'); row.className = 'files-queue-row';
            row.innerHTML = '<span>' + esc(file.name) + '（' + size(file.size) + '）</span><span>上傳中…</span>';
            queue.appendChild(row);
            var limit = state.config.maxFileBytes;
            if (file.size > limit) { row.lastChild.textContent = '✗ 超過 ' + size(limit); row.lastChild.style.color = '#f87171'; continue; }
            if (await uploadOne(file, row)) ok++;
        }
        if (ok) { toast('已上傳 ' + ok + ' 個檔案'); load(false); }
    }
    if (canUpload) {
        var drop = $('files-drop'), input = $('files-input');
        drop.addEventListener('click', function () { input.click(); });
        drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
        input.addEventListener('change', function () { uploadFiles(input.files); input.value = ''; });
        ['dragenter', 'dragover'].forEach(function (name) { drop.addEventListener(name, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
        ['dragleave', 'drop'].forEach(function (name) { drop.addEventListener(name, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
        drop.addEventListener('drop', function (e) { uploadFiles(e.dataTransfer.files); });
    }

    // ---- card actions -------------------------------------------------------------------
    $('files-grid').addEventListener('click', async function (event) {
        var button = event.target.closest('button[data-act]');
        if (!button) return;
        var item = state.items.find(function (entry) { return entry.id === button.dataset.id; });
        if (!item) return;
        try {
            if (button.dataset.act === 'link') copy(absolute(item), '連結');
            else if (button.dataset.act === 'md') copy('![' + item.name.replace(/[\[\]]/g, '') + '](' + absolute(item) + ')', 'Markdown 語法');
            else if (button.dataset.act === 'edit') {
                var name = prompt('檔名', item.name); if (name === null) return;
                var description = prompt('說明', item.description || ''); if (description === null) return;
                await api('/api/files/' + item.id, 'PATCH', { name: name, description: description });
                toast('已更新'); load(false);
            } else if (button.dataset.act === 'delete') {
                if (!confirm('確定刪除「' + item.name + '」？已貼進文章的連結會失效，且無法復原。')) return;
                await api('/api/files/' + item.id, 'DELETE');
                toast('已刪除'); load(false);
            }
        } catch (error) { toast(error.message, true); }
    });
    ['files-filter-category', 'files-filter-kind'].forEach(function (id) { $(id).addEventListener('change', function () { load(false); }); });
    var timer = null;
    $('files-search').addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { load(false); }, 300); });
    $('files-more').addEventListener('click', function () { load(true); });

    // ---- picker: other forms can insert a link to a stored file --------------------------
    window.openFilePicker = async function (onPick, options) {
        options = options || {};
        var overlay = document.createElement('div');
        overlay.className = 'files-pick';
        overlay.innerHTML = '<div class="files-pick-box" role="dialog" aria-label="選擇檔案"><div style="display:flex; gap:8px; justify-content:space-between;"><strong>從檔案庫選擇</strong><button type="button" class="btn btn-secondary" data-close>關閉</button></div><input class="form-control" style="margin-top:10px;" placeholder="搜尋檔名或說明" data-q><div class="files-pick-list" data-list></div></div>';
        document.body.appendChild(overlay);
        var list = overlay.querySelector('[data-list]'), items = [];
        function close() { overlay.remove(); }
        overlay.addEventListener('click', function (e) { if (e.target === overlay || e.target.hasAttribute('data-close')) close(); });
        overlay.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
        async function fetchList() {
            var params = new URLSearchParams({ limit: '48' });
            if (options.kind) params.set('kind', options.kind);
            if (options.category) params.set('category', options.category);
            var q = overlay.querySelector('[data-q]').value.trim(); if (q) params.set('q', q);
            try {
                items = (await api('/api/files?' + params)).items;
                list.innerHTML = items.map(function (item, index) { return '<button type="button" data-i="' + index + '"><div class="file-thumb">' + thumb(item) + '</div><span>' + esc(item.name) + '</span></button>'; }).join('') || '<p style="color:var(--text-muted);">檔案庫中沒有符合的檔案。</p>';
            } catch (error) { list.textContent = error.message; }
        }
        list.addEventListener('click', function (e) { var b = e.target.closest('button[data-i]'); if (b) { var item = items[Number(b.dataset.i)]; close(); onPick(item, absolute(item)); } });
        var t = null; overlay.querySelector('[data-q]').addEventListener('input', function () { clearTimeout(t); t = setTimeout(fetchList, 250); });
        fetchList();
    };

    // Adds a "插入檔案連結" button under an existing field; picking a file appends its URL (or Markdown
    // for images when `markdown` is set). The target forms themselves are not changed.
    function attach(fieldId, options) {
        var field = $(fieldId);
        if (!field || field.dataset.filesAttached) return;
        field.dataset.filesAttached = '1';
        var button = document.createElement('button');
        button.type = 'button'; button.className = 'btn btn-secondary files-attach'; button.textContent = '📎 插入檔案連結';
        button.addEventListener('click', function () {
            window.openFilePicker(function (item, url) {
                var text = options.markdown && isImage(item) ? '![' + item.name.replace(/[\[\]]/g, '') + '](' + url + ')' : url;
                var maxLength = field.maxLength > 0 ? field.maxLength : Infinity;
                var next = (field.value ? field.value + (field.tagName === 'TEXTAREA' ? '\n' : ' ') : '') + text;
                if (next.length > maxLength) return toast('欄位字數不足以放入連結', true);
                field.value = next; field.dispatchEvent(new Event('input', { bubbles: true }));
            }, { category: options.category });
        });
        field.insertAdjacentElement('afterend', button);
    }
    function attachAll() {
        attach('post-content', { markdown: true });
        attach('page-content', { markdown: true });
        attach('equipment-note', { category: 'equipment' });
        attach('fee-note', { category: 'receipt' });
        attach('note-content', {});
        attach('mt-minutes', { markdown: true, category: 'meeting' });
    }
    attachAll();
    // The meeting minutes editor is drawn on demand, so look again whenever the page changes.
    new MutationObserver(function () { attach('mt-minutes', { markdown: true, category: 'meeting' }); }).observe(document.body, { childList: true, subtree: true });
})();
