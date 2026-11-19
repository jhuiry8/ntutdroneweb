// Back-office mobile / iOS support: standalone detection, bottom tab bar state,
// drawer (backdrop, swipe, Android back button), table -> card labels, install hint,
// offline badge and keyboard handling. Loaded with defer; every step is feature-guarded.
(function () {
    'use strict';
    var doc = document, body = doc.body, root = doc.documentElement;
    var ua = navigator.userAgent || '';
    var isIos = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    var standalone = !!(navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches));
    if (isIos) root.classList.add('is-ios');
    if (standalone) root.classList.add('is-standalone');

    // ── Tab bar + title follow the active panel ──
    var titles = { posts: '文章管理', pages: '頁面管理', homepage: '首頁設定', forms: '表單申請', members: '社員管理', finance: '財務管理', equipment: '設備管理', notes: '社課備忘錄', regulations: '法規查詢', settings: '系統設定', users: '帳號與權限', meetings: '社課簽到' };
    function syncChrome() {
        var panel = doc.querySelector('.panel.active');
        var name = panel ? panel.id.replace(/^panel-/, '') : '';
        var title = doc.getElementById('mobile-admin-title');
        if (title) title.textContent = titles[name] || 'NTUT DRONE 後台';
        doc.querySelectorAll('.mobile-tab[data-panel]').forEach(function (tab) {
            var on = tab.getAttribute('data-panel') === name;
            tab.classList.toggle('active', on);
            if (on) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
        });
    }
    var originalShowPanel = window.showPanel;
    if (typeof originalShowPanel === 'function') {
        window.showPanel = function () {
            var result = originalShowPanel.apply(this, arguments);
            syncChrome();
            var main = doc.querySelector('.main-content');
            if (main) main.scrollTop = 0;
            window.scrollTo(0, 0);
            return result;
        };
    }
    doc.querySelectorAll('.mobile-tab[data-panel]').forEach(function (tab) {
        tab.addEventListener('click', function () {
            var loader = tab.getAttribute('data-loader');
            window.showPanel(tab.getAttribute('data-panel'));
            if (loader && typeof window[loader] === 'function') window[loader]();
        });
    });
    syncChrome();

    // ── Drawer: lock scroll, backdrop, swipe left to close, Android back button ──
    var backdrop = doc.getElementById('admin-backdrop');
    var origToggle = window.toggleAdminMenu, origClose = window.closeAdminMenu;
    var historyPushed = false;
    function drawerOpen() { return body.classList.contains('menu-open'); }
    window.toggleAdminMenu = function () {
        origToggle && origToggle();
        if (drawerOpen() && !historyPushed) { try { history.pushState({ adminMenu: 1 }, ''); historyPushed = true; } catch (_) {} }
    };
    window.closeAdminMenu = function () {
        origClose && origClose();
        if (historyPushed) { historyPushed = false; try { if (history.state && history.state.adminMenu) history.back(); } catch (_) {} }
    };
    window.addEventListener('popstate', function () {
        if (drawerOpen()) { historyPushed = false; origClose && origClose(); }
    });
    if (backdrop) backdrop.addEventListener('click', function () { window.closeAdminMenu(); });
    var sidebar = doc.getElementById('admin-sidebar'), startX = null;
    if (sidebar) {
        sidebar.addEventListener('touchstart', function (e) { startX = e.touches[0].clientX; }, { passive: true });
        sidebar.addEventListener('touchend', function (e) {
            if (startX !== null && startX - e.changedTouches[0].clientX > 60) window.closeAdminMenu();
            startX = null;
        }, { passive: true });
    }

    // ── Tables become labelled cards on phones ──
    function labelTable(table) {
        if (table.closest('.forms-items, .pl-table, .keep-table')) return;
        var heads = Array.prototype.map.call(table.querySelectorAll('thead th'), function (th) { return (th.textContent || '').trim(); });
        if (!heads.length) return;
        table.classList.add('card-table');
        table.querySelectorAll('tbody tr').forEach(function (tr) {
            var cells = tr.children, single = cells.length === 1;
            tr.classList.toggle('card-empty', single);
            for (var i = 0; i < cells.length; i++) {
                if (!single && heads[i] && cells[i].getAttribute('data-label') !== heads[i]) cells[i].setAttribute('data-label', heads[i]);
            }
        });
    }
    function labelAll() { doc.querySelectorAll('.table-container table').forEach(labelTable); }
    labelAll();
    if ('MutationObserver' in window) {
        var pending = false;
        new MutationObserver(function () {
            if (pending) return; pending = true;
            requestAnimationFrame(function () { pending = false; labelAll(); });
        }).observe(doc.querySelector('.main-content') || body, { childList: true, subtree: true });
    }

    // ── Offline badge ──
    var badge = doc.getElementById('offline-badge');
    function net() { if (badge) badge.hidden = navigator.onLine !== false; }
    window.addEventListener('online', net); window.addEventListener('offline', net); net();

    // ── Keep focused fields above the on-screen keyboard (iOS does not always do this) ──
    doc.addEventListener('focusin', function (e) {
        var el = e.target;
        if (!/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || !window.matchMedia('(max-width: 768px)').matches) return;
        setTimeout(function () { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {} }, 300);
    });

    // ── Install hint: iOS Safari needs manual "Add to Home Screen"; Android gets the real prompt ──
    var hint = doc.getElementById('install-hint'), hintText = doc.getElementById('install-hint-text'), hintBtn = doc.getElementById('install-hint-btn');
    function dismissed() { try { return localStorage.getItem('ntut-admin-install-dismissed') === '1'; } catch (_) { return false; } }
    function showHint(text, action) {
        if (!hint || standalone || dismissed() || !window.matchMedia('(max-width: 768px)').matches) return;
        hintText.textContent = text;
        hintBtn.textContent = '下載'; hintBtn.hidden = !action; hintBtn.onclick = action || null;
        hint.hidden = false;
    }
    // iOS -> PWA (Safari "Add to Home Screen"); Android -> native APK from GitHub Releases.
    var APK_URL = 'https://github.com/jhuiry8/ntutdroneweb/releases/latest';
    var isAndroid = /android/i.test(ua);
    window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); }); // no PWA prompt on Android
    if (isIos && !standalone) {
        if (/safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua)) {
            showHint('點 Safari 下方「分享」圖示 → 「加入主畫面」，即可像 App 一樣使用', null);
        } else {
            showHint('請用 Safari 開啟本頁，再點「分享」→「加入主畫面」安裝', null);
        }
    } else if (isAndroid && !standalone) {
        showHint('Android 請安裝原生 App（APK）以獲得最佳體驗', function () { window.open(APK_URL, '_blank', 'noopener'); });
    }
    var close = doc.getElementById('install-hint-close');
    if (close) close.addEventListener('click', function () {
        hint.hidden = true; try { localStorage.setItem('ntut-admin-install-dismissed', '1'); } catch (_) {}
    });

    if (window.lucide && lucide.createIcons) lucide.createIcons();
})();
