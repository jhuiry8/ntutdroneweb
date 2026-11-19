// Shared theme controller (public site + back-office). Loaded blocking in <head> so the
// first paint already has the right colours. Preference: 'auto' (follow the phone), 'light', 'dark'.
(function () {
    var KEY = 'ntut-theme', root = document.documentElement;
    var mq = window.matchMedia ? matchMedia('(prefers-color-scheme: light)') : null;
    var COLORS = { dark: '#0f172a', light: '#f2f5fa' };
    function pref() { var v = null; try { v = localStorage.getItem(KEY); } catch (_) {} return v === 'light' || v === 'dark' ? v : 'auto'; }
    function resolve(p) { return p === 'auto' ? (mq && mq.matches ? 'light' : 'dark') : p; }
    function apply() {
        var p = pref(), t = resolve(p);
        root.setAttribute('data-theme', t);
        root.setAttribute('data-theme-pref', p);
        root.style.colorScheme = t;
        var metas = document.querySelectorAll('meta[name="theme-color"]');
        if (!metas.length && document.head) { var m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); metas = [m]; }
        Array.prototype.forEach.call(metas, function (m) { m.removeAttribute('media'); m.setAttribute('content', COLORS[t]); });
        document.querySelectorAll('[data-theme-toggle]').forEach(paint);
        return t;
    }
    function paint(btn) {
        var p = pref(), t = resolve(p);
        var label = p === 'auto' ? '跟隨系統' : (p === 'light' ? '淺色' : '深色');
        var icon = p === 'auto' ? '🌓' : (t === 'light' ? '☀️' : '🌙');
        if (btn.id === 'theme-toggle-btn') { btn.textContent = icon; btn.title = '外觀：' + label + '（點擊切換）'; return; }
        var i = btn.querySelector('.theme-icon'), l = btn.querySelector('.theme-label');
        if (i) i.textContent = icon; if (l) l.textContent = '外觀：' + label;
        btn.setAttribute('aria-label', '切換外觀，目前' + label);
    }
    function set(p) { try { if (p === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, p); } catch (_) {} return apply(); }
    function cycle() { set({ auto: 'light', light: 'dark', dark: 'auto' }[pref()]); }
    window.NtutTheme = { get: pref, set: set, cycle: cycle, resolved: function () { return resolve(pref()); } };
    window.toggleTheme = cycle;
    var ua = navigator.userAgent || '';
    if (/iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) root.classList.add('is-ios');
    if (navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches)) root.classList.add('is-standalone');
    apply();
    if (mq) (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(function () { if (pref() === 'auto') apply(); });
    document.addEventListener('DOMContentLoaded', function () { apply(); });
    document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-theme-toggle]'); if (b) cycle(); });
})();
