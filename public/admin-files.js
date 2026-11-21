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

    function absolute(item) { return isLink(item) ? item.url : location.origin + item.url; }
    function isImage(item) { return item.mime && item.mime.indexOf('image/') === 0; }
    function isLink(item) { return item.type === 'drive'; }
    // Only Drive / Docs preview pages may be framed; anything else is refused here as well as by the CSP.
    function safeEmbed(url) { return typeof url === 'string' && /^https:\/\/(drive|docs)\.google\.com\//.test(url) ? url : ''; }
    function thumb(item) {
        if (isLink(item)) return '<span aria-hidden="true">☁️</span>';
        return isImage(item) ? '<img loading="lazy" alt="' + esc(item.name) + '" src="' + esc(item.url) + '">' : '<span aria-hidden="true">📄</span>';
    }
    // Preview of a Drive item in a sandboxed frame; "open" goes to Google in a new tab.
    function previewDialog(title, embedUrl, openUrl) {
        var overlay = document.createElement('div');
        overlay.className = 'files-pick';
        var box = document.createElement('div'); box.className = 'files-pick-box'; box.style.width = 'min(960px,100%)';
        var bar = document.createElement('div'); bar.style.cssText = 'display:flex; gap:8px; justify-content:space-between; align-items:center; margin-bottom:10px;';
        var heading = document.createElement('strong'); heading.textContent = title;
        var actions = document.createElement('span'); actions.style.cssText = 'display:flex; gap:8px;';
        if (openUrl) { var open = document.createElement('a'); open.className = 'btn btn-secondary'; open.href = openUrl; open.target = '_blank'; open.rel = 'noopener noreferrer'; open.textContent = '在 Google 開啟'; actions.appendChild(open); }
        var close = document.createElement('button'); close.type = 'button'; close.className = 'btn btn-secondary'; close.textContent = '關閉'; actions.appendChild(close);
        bar.appendChild(heading); bar.appendChild(actions); box.appendChild(bar);
        if (safeEmbed(embedUrl)) {
            var frame = document.createElement('iframe');
            frame.src = embedUrl; frame.title = title; frame.referrerPolicy = 'no-referrer';
            frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
            frame.style.cssText = 'width:100%; height:70vh; border:0; border-radius:8px; background:#fff;';
            box.appendChild(frame);
        } else { var note = document.createElement('p'); note.style.color = 'var(--text-muted)'; note.textContent = '這個項目無法內嵌預覽，請用「在 Google 開啟」。'; box.appendChild(note); }
        overlay.appendChild(box); document.body.appendChild(overlay);
        function done() { overlay.remove(); }
        close.addEventListener('click', done);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) done(); });
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
            (isLink(item) ? (safeEmbed(item.embedUrl) ? '<button type="button" class="btn btn-secondary" data-act="preview" data-id="' + esc(item.id) + '">預覽</button>' : '') + '<a class="btn btn-secondary" href="' + esc(item.url) + '" target="_blank" rel="noopener noreferrer">在 Google 開啟</a>' : '<a class="btn btn-secondary" href="' + esc(item.url) + '?download=1">下載</a>') +
            (item.canManage ? '<button type="button" class="btn btn-secondary" data-act="edit" data-id="' + esc(item.id) + '">改名／說明</button><button type="button" class="btn btn-danger" data-act="delete" data-id="' + esc(item.id) + '">刪除</button>' : '');
        return '<div class="file-card"><a class="file-thumb" href="' + esc(item.url) + '" target="_blank" rel="noopener noreferrer">' + thumb(item) + '</a><div class="file-body"><strong>' + esc(item.name) + '</strong>' +
            '<span><span class="file-badge">' + esc(vis[item.visibility] || item.visibility) + '</span><span class="file-badge">' + esc(cats[item.category] || item.category) + '</span></span>' +
            (item.description ? '<small>' + esc(item.description) + '</small>' : '') +
            '<small>' + (isLink(item) ? 'Google 雲端硬碟連結' : size(item.size)) + '・' + esc(item.uploadedBy) + '・' + when(item.createdAt) + '</small></div><div class="file-actions">' + actions + '</div></div>';
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
            if (button.dataset.act === 'link') copy(isLink(item) ? item.url : absolute(item), '連結');
            else if (button.dataset.act === 'preview') previewDialog(item.name, item.embedUrl, item.url);
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


    // ---- Drive link form ----------------------------------------------------------------
    var linkForm = $('files-link-form');
    if (linkForm) linkForm.addEventListener('submit', async function (event) {
        event.preventDefault();
        try {
            await api('/api/files/links', 'POST', {
                url: $('files-link-url').value, name: $('files-link-name').value, visibility: $('files-link-visibility').value,
                category: $('files-up-category').value, description: $('files-up-description').value
            });
            linkForm.reset(); toast('已新增雲端硬碟連結'); load(false);
        } catch (error) { toast(error.message, true); }
    });

    // ---- 雲端硬碟 tab (read-only; appears only when the server has the Google service account) ----
    var drive = { enabled: false, canConfigure: false, folders: [], root: '', stack: [], next: null, items: [] };
    var tabs = panel.querySelectorAll('[data-files-tab]');
    function showTab(name) {
        $('files-library').hidden = name !== 'library';
        $('files-drive').hidden = name !== 'drive';
        tabs.forEach(function (tab) { var on = tab.dataset.filesTab === name; tab.className = 'btn ' + (on ? 'btn-primary' : 'btn-secondary'); tab.setAttribute('aria-selected', String(on)); });
        if (name === 'drive') loadDriveFolders();
    }
    tabs.forEach(function (tab) { tab.addEventListener('click', function () { showTab(tab.dataset.filesTab); }); });
    function driveSize(bytes) { return bytes ? size(bytes) : ''; }
    function driveCard(item) {
        var thumbHtml = item.isFolder ? '<span aria-hidden="true">📁</span>' : item.hasThumb ? '<img loading="lazy" alt="" src="/api/drive/thumb?root=' + encodeURIComponent(drive.root) + '&file=' + encodeURIComponent(item.id) + '">' : '<span aria-hidden="true">📄</span>';
        var open = item.isFolder ? '<button type="button" class="btn btn-secondary" data-drive-open="' + esc(item.id) + '" data-name="' + esc(item.name) + '">開啟資料夾</button>' :
            (item.previewUrl ? '<button type="button" class="btn btn-secondary" data-drive-preview="' + esc(item.id) + '">預覽</button>' : '') + '<a class="btn btn-secondary" href="' + esc(item.openUrl) + '" target="_blank" rel="noopener noreferrer">在 Google 開啟</a>';
        return '<div class="file-card"><div class="file-thumb">' + thumbHtml + '</div><div class="file-body"><strong>' + esc(item.name) + '</strong><small>' + esc(driveSize(item.size)) + (item.modifiedTime ? (item.size ? '・' : '') + when(item.modifiedTime) : '') + '</small></div><div class="file-actions">' + open + '</div></div>';
    }
    function renderDrive() {
        $('drive-grid').innerHTML = drive.items.map(driveCard).join('') || '<p style="color:var(--text-muted);">這個資料夾是空的。</p>';
        $('drive-more').style.display = drive.next ? '' : 'none';
        var crumbs = [{ id: '', name: (drive.folders.find(function (f) { return f.id === drive.root; }) || {}).name || '根目錄' }].concat(drive.stack);
        $('drive-crumbs').innerHTML = crumbs.map(function (c, i) { return '<button type="button" class="btn btn-secondary" style="padding:4px 10px; min-height:30px;" data-crumb="' + i + '">' + esc(c.name) + '</button>'; }).join('');
    }
    async function loadDriveFolder(more) {
        var current = drive.stack.length ? drive.stack[drive.stack.length - 1].id : drive.root;
        var params = new URLSearchParams({ root: drive.root, folder: current });
        if (more && drive.next) params.set('pageToken', drive.next);
        try {
            var data = await api('/api/drive/list?' + params);
            drive.items = more ? drive.items.concat(data.items) : data.items; drive.next = data.nextPageToken; renderDrive();
        } catch (error) { toast(error.message, true); $('drive-grid').innerHTML = ''; }
    }
    async function loadDriveFolders() {
        try {
            drive.folders = await api('/api/drive/folders');
            $('drive-root').innerHTML = drive.folders.map(function (f) { return '<option value="' + esc(f.id) + '">' + esc(f.name) + '</option>'; }).join('');
            $('drive-config-text').value = drive.folders.map(function (f) { return f.id + ', ' + f.name + ', ' + f.visibility; }).join('\n');
            if (!drive.folders.length) { $('drive-grid').innerHTML = '<p style="color:var(--text-muted);">尚未設定要顯示的資料夾' + (drive.canConfigure ? '，請按「設定資料夾」。' : '，請洽社長。') + '</p>'; $('drive-crumbs').innerHTML = ''; return; }
            if (!drive.folders.some(function (f) { return f.id === drive.root; })) drive.root = drive.folders[0].id;
            $('drive-root').value = drive.root; drive.stack = []; loadDriveFolder(false);
        } catch (error) { toast(error.message, true); }
    }
    $('drive-root').addEventListener('change', function () { drive.root = $('drive-root').value; drive.stack = []; loadDriveFolder(false); });
    $('drive-more').addEventListener('click', function () { loadDriveFolder(true); });
    $('drive-crumbs').addEventListener('click', function (event) {
        var button = event.target.closest('[data-crumb]'); if (!button) return;
        drive.stack = drive.stack.slice(0, Number(button.dataset.crumb)); loadDriveFolder(false);
    });
    $('drive-grid').addEventListener('click', function (event) {
        var folder = event.target.closest('[data-drive-open]');
        if (folder) { drive.stack.push({ id: folder.dataset.driveOpen, name: folder.dataset.name }); return loadDriveFolder(false); }
        var preview = event.target.closest('[data-drive-preview]');
        if (preview) { var item = drive.items.find(function (entry) { return entry.id === preview.dataset.drivePreview; }); if (item) previewDialog(item.name, item.previewUrl, item.openUrl); }
    });
    $('drive-config-button').addEventListener('click', function () { $('drive-config').hidden = !$('drive-config').hidden; });
    $('drive-config-save').addEventListener('click', async function () {
        var folders = $('drive-config-text').value.split('\n').map(function (line) { return line.trim(); }).filter(Boolean).map(function (line) {
            var parts = line.split(',').map(function (part) { return part.trim(); });
            return { id: parts[0], name: parts[1] || '', visibility: parts[2] || 'cadre' };
        });
        try { await api('/api/drive/folders', 'PUT', { folders: folders }); toast('已儲存資料夾設定'); $('drive-config').hidden = true; loadDriveFolders(); }
        catch (error) { toast(error.message, true); }
    });
    // Nothing is shown (and no error appears) until the server reports the Drive secret is configured.
    fetch('/api/drive/status', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : { enabled: false }; }).then(function (status) {
        drive.enabled = !!status.enabled; drive.canConfigure = !!status.canConfigure;
        if (!drive.enabled) return;
        panel.querySelector('[data-files-tab="drive"]').hidden = false;
        $('drive-config-button').hidden = !drive.canConfigure;
    }).catch(function () { /* feature stays hidden */ });

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
